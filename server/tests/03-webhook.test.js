import './setup-env.js';
import {
  resetDb,
  seedCatalog,
  loginAs,
  app,
  createTestOrder,
  payTestOrder,
  q,
} from './helpers.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import request from 'supertest';
import { pool } from '../src/db/pool.js';
import { testProvider } from '../src/services/payments/testProvider.js';

const SECRET = 'test_webhook_secret_for_tests';

/** สร้าง raw body + ลายเซ็น แบบเดียวกับที่โหมดทดสอบส่งจริง */
function signedWebhook({ chargeId, status = 'paid', amountCents, eventId }) {
  const body = JSON.stringify({
    event_id: eventId || `evt_${chargeId}_${status}`,
    type: `charge.${status}`,
    data: { id: chargeId, status, amount: amountCents, currency: 'THB' },
  });
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex');
  return { body, headers: { 'x-test-signature': `t=${ts},v=${sig}` } };
}

async function postWebhook(provider, body, headers) {
  return request(app())
    .post(`/api/webhooks/payments/${provider}`)
    .set(headers)
    .set('Content-Type', 'application/json')
    .send(body);
}

/**
 * เทสต์เคส 5, 6, 7, 12:
 * webhook ซ้ำ / ลายเซ็นปลอม / ยอดไม่ตรง / gateway ล่ม + webhook ช้า
 */
describe('Webhook security & payment confirmation', () => {
  let catalog;
  let buyer;

  before(async () => {
    await resetDb();
    catalog = await seedCatalog();
    buyer = await loginAs(app(), {
      sub: 'webhook-buyer',
      email: 'webhook@demo.test',
      email_verified: true,
      name: 'Webhook Buyer',
    });
  });

  it('ชำระสำเร็จ -> order paid + มีสิทธิ์ดาวน์โหลด (ผ่าน webhook จริง)', async () => {
    const { order } = await createTestOrder(buyer.agent, buyer.token, catalog.productId);
    const [payment] = await pool.execute(
      `SELECT * FROM payments WHERE order_id = (SELECT id FROM orders WHERE order_number = ?)`,
      [order.orderNumber]
    );
    assert.equal(payment[0].provider, 'test');
    assert.ok(payment[0].provider_charge_id, 'มี charge id จาก provider');

    const { body, headers } = signedWebhook({
      chargeId: payment[0].provider_charge_id,
      amountCents: Math.round(Number(payment[0].amount) * 100),
    });
    const res = await postWebhook('test', body, headers);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.ok, true);

    const [orders] = await pool.execute(`SELECT status FROM orders WHERE order_number = ?`, [
      order.orderNumber,
    ]);
    assert.equal(orders[0].status, 'paid');
    const lib = await q('SELECT * FROM user_library WHERE product_id = ?', [catalog.productId]);
    assert.equal(lib.length, 1);
  });

  it('เทสต์เคส 5: webhook ส่งซ้ำ -> ไม่สร้างสิทธิ์/ธุรกรรมซ้ำ', async () => {
    const { order } = await createTestOrder(buyer.agent, buyer.token, catalog.productId);
    const [payment] = await pool.execute(
      `SELECT * FROM payments WHERE order_id = (SELECT id FROM orders WHERE order_number = ?)`,
      [order.orderNumber]
    );
    const chargeId = payment[0].provider_charge_id;
    const { body, headers } = signedWebhook({
      chargeId,
      amountCents: Math.round(Number(payment[0].amount) * 100),
    });

    const first = await postWebhook('test', body, headers);
    assert.equal(first.body.data.ok, true);

    const second = await postWebhook('test', body, headers);
    assert.equal(second.status, 200);
    assert.equal(second.body.data.duplicate, true, 'webhook ซ้ำถูก idempotency ดัก');

    // user_library ต้องมีแค่ 1 แถวต่อ (user, product) แม้ webhook ซ้ำ
    const lib = await q('SELECT * FROM user_library WHERE product_id = ?', [catalog.productId]);
    assert.equal(lib.length, 1);
    // payments ที่ paid มีแค่รายการเดียว
    const [paid] = await pool.execute(
      `SELECT COUNT(*) c FROM payments WHERE order_id = (SELECT id FROM orders WHERE order_number = ?) AND status = 'paid'`,
      [order.orderNumber]
    );
    assert.equal(Number(paid[0].c), 1);
    // เหตุการณ์ webhook ถูกบันทึกไว้ 1 ครั้ง
    const [events] = await pool.execute(
      `SELECT COUNT(*) c FROM payment_webhook_events WHERE event_id = ?`,
      [`evt_${chargeId}_paid`]
    );
    assert.equal(Number(events[0].c), 1);
  });

  it('เทสต์เคส 6: ลายเซ็นปลอม -> 403 และไม่ปลดล็อก', async () => {
    const { order } = await createTestOrder(buyer.agent, buyer.token, catalog.productId);
    const [payment] = await pool.execute(
      `SELECT * FROM payments WHERE order_id = (SELECT id FROM orders WHERE order_number = ?)`,
      [order.orderNumber]
    );
    const chargeId = payment[0].provider_charge_id;
    const amountCents = Math.round(Number(payment[0].amount) * 100);

    // 1) ลายเซ็นผิดค่า
    const badSig = signedWebhook({ chargeId, amountCents, eventId: `evt_${chargeId}_paid` });
    const res1 = await postWebhook('test', badSig.body, {
      'x-test-signature': 't=1700000000,v=deadbeef',
    });
    assert.equal(res1.status, 403);

    // 2) ไม่มีลายเซ็นเลย
    const res2 = await postWebhook('test', badSig.body, {});
    assert.equal(res2.status, 403);

    // 3) timestamp เก่า (replay)
    const staleBody = JSON.stringify({
      event_id: `evt_${chargeId}_paid`,
      type: 'charge.paid',
      data: { id: chargeId, status: 'paid', amount: amountCents, currency: 'THB' },
    });
    const oldTs = Math.floor(Date.now() / 1000) - 3600;
    const staleSig = crypto.createHmac('sha256', SECRET).update(`${oldTs}.${staleBody}`).digest('hex');
    const res3 = await postWebhook('test', staleBody, {
      'x-test-signature': `t=${oldTs},v=${staleSig}`,
    });
    assert.equal(res3.status, 403);

    // ต้องยังไม่ paid + ยังไม่มีสิทธิ์
    const [orders] = await pool.execute(`SELECT status FROM orders WHERE order_number = ?`, [
      order.orderNumber,
    ]);
    assert.equal(orders[0].status, 'pending');
    const ent = await q(
      `SELECT * FROM user_library WHERE user_id = ? AND order_id = (SELECT id FROM orders WHERE order_number = ?)`,
      [buyer.user.id, order.orderNumber]
    );
    assert.equal(ent.length, 0, 'ไม่มีการสร้างสิทธิ์ให้คำสั่งซื้อนี้');
    const [paidEvents] = await pool.execute(
      `SELECT processed FROM payment_webhook_events WHERE charge_id = ? AND processed = 1`,
      [chargeId]
    );
    assert.equal(paidEvents.length, 0, 'ไม่มี event ที่ประมวลผลสำเร็จ');
  });

  it('เทสต์เคส 7: ยอดเงินไม่ตรง -> ไม่ปลดล็อกสินค้า', async () => {
    const { order } = await createTestOrder(buyer.agent, buyer.token, catalog.productId);
    const [payment] = await pool.execute(
      `SELECT * FROM payments WHERE order_id = (SELECT id FROM orders WHERE order_number = ?)`,
      [order.orderNumber]
    );
    const chargeId = payment[0].provider_charge_id;
    const realCents = Math.round(Number(payment[0].amount) * 100);

    // ยอดใน payload ต่ำกว่าความจริง 1 สตางค์
    const { body, headers } = signedWebhook({ chargeId, amountCents: realCents - 1 });
    const res = await postWebhook('test', body, headers);
    assert.equal(res.status, 200, 'ตอบ 200 แต่ไม่ปลดล็อก (กัน retry ไม่รู้จบ)');
    assert.equal(res.body.data.ok, false);
    assert.equal(res.body.data.reason, 'payload_amount_mismatch');

    const [orders] = await pool.execute(`SELECT status FROM orders WHERE order_number = ?`, [
      order.orderNumber,
    ]);
    assert.notEqual(orders[0].status, 'paid');
    const ent = await q(
      `SELECT * FROM user_library WHERE user_id = ? AND product_id = ? AND order_id = (SELECT id FROM orders WHERE order_number = ?)`,
      [buyer.user.id, catalog.productId, order.orderNumber]
    );
    assert.equal(ent.length, 0, 'ไม่มีการสร้างสิทธิ์');
  });

  it('charge ที่ไม่มีอยู่จริง -> ไม่ปลดล็อก', async () => {
    const { body, headers } = signedWebhook({
      chargeId: 'testch_does_not_exist',
      amountCents: 10000,
    });
    const res = await postWebhook('test', body, headers);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.ok, false);
    assert.equal(res.body.data.reason, 'charge_not_found_at_gateway');
  });

  it('เทสต์เคส 12a: gateway ล่มตอน checkout -> บันทึก failed + retry ได้', async () => {
    const original = testProvider.createCharge;
    testProvider.createCharge = async () => {
      throw Object.assign(new Error('ECONNREFUSED gateway down'), { status: 503 });
    };
    let failedRes;
    try {
      failedRes = await buyer.agent
        .post('/api/checkout')
        .set('X-CSRF-Token', buyer.token)
        .send({ items: [{ productId: catalog.productId, quantity: 1 }] });
    } finally {
      testProvider.createCharge = original;
    }
    assert.equal(failedRes.status, 503, 'gateway ล่ม -> ตอบ 503 ไม่ใช่สำเร็จปลอมๆ');

    const orderNumber = failedRes.body?.error?.details?.orderNumber || null;
    // order ถูกสร้างและยัง pending (retry ได้) หรือสร้างไม่ได้ -> ต้องไม่มีการปลดล็อก
    const [orders] = await pool.execute(
      `SELECT status FROM orders ORDER BY id DESC LIMIT 1`
    );
    if (orderNumber || orders.length) {
      assert.notEqual(orders[0].status, 'paid');
    }

    // จ่ายใหม่ (gateway กลับมาแล้ว)
    const fresh = await createTestOrder(buyer.agent, buyer.token, catalog.productId);
    const paid = await payTestOrder(buyer.agent, buyer.token, fresh.order.orderNumber);
    assert.equal(paid.order.status, 'paid');
  });

  it('เทสต์เคส 12b: webhook มาช้า (หลัง order หมดอายุ) -> ถ้าเงินเข้าจริงต้องปลดล็อก', async () => {
    const { order } = await createTestOrder(buyer.agent, buyer.token, catalog.productId);
    // จำลองคำสั่งซื้อหมดอายุ (sweep job ในเครื่องจริงทำแบบนี้)
    await pool.execute(
      `UPDATE orders SET status = 'expired' WHERE order_number = ?`,
      [order.orderNumber]
    );
    const [payment] = await pool.execute(
      `SELECT * FROM payments WHERE order_id = (SELECT id FROM orders WHERE order_number = ?)`,
      [order.orderNumber]
    );
    await pool.execute(`UPDATE payments SET status = 'expired' WHERE id = ?`, [payment[0].id]);

    const { body, headers } = signedWebhook({
      chargeId: payment[0].provider_charge_id,
      amountCents: Math.round(Number(payment[0].amount) * 100),
    });
    const res = await postWebhook('test', body, headers);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.ok, true, 'เงินเข้าจริง -> ปลดล็อกแม้เลยเวลา');

    const [orders] = await pool.execute(`SELECT status FROM orders WHERE order_number = ?`, [
      order.orderNumber,
    ]);
    assert.equal(orders[0].status, 'paid');
    const ent = await q(
      `SELECT * FROM user_library WHERE user_id = ? AND order_id = (SELECT id FROM orders WHERE order_number = ?)`,
      [buyer.user.id, order.orderNumber]
    );
    assert.equal(ent.length, 1);
  });

  it('provider ที่ไม่รู้จัก -> 404 และโหมด live ไม่เปิด provider test', async () => {
    const res = await postWebhook('stripe', '{}', {});
    assert.equal(res.status, 404);
  });
});

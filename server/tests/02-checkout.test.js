import './setup-env.js';
import {
  request,
  resetDb,
  seedCatalog,
  loginAs,
  post,
  app,
} from './helpers.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { pool, q } from '../src/db/pool.js';

/**
 * เทสต์เคสที่เกี่ยวกับตะกร้า/Checkout:
 * - ราคาทั้งหมดมาจาก Backend (แก้ราคาจาก Browser ไม่มีผล)
 * - คูปอง, การสร้าง Order ไม่ซ้ำ, snapshot ราคาใน order_items
 */
describe('Cart & Checkout (server-side pricing)', () => {
  let catalog;
  let buyer;

  before(async () => {
    await resetDb();
    catalog = await seedCatalog();
    buyer = await loginAs(app(), {
      sub: 'buyer-checkout',
      email: 'checkout@demo.test',
      email_verified: true,
      name: 'Checkout Buyer',
    });
  });

  it('quote คำนวณราคาจาก DB ไม่สนใจ ราคาที่ฝั่ง client ส่งมา', async () => {
    // client พยายามส่งราคา/ส่วนลด มาเอง -> ต้องไม่มีผลอะไร
    const res = await post(buyer.agent, buyer.token, '/api/cart/quote').send({
      items: [{ productId: catalog.productId, quantity: 2, price: '0.01', discount: 99 }],
    });
    assert.equal(res.status, 200);
    const data = res.body.data;
    assert.equal(data.items[0].unitPrice, '100.00');
    assert.equal(data.items[0].lineTotal, '200.00');
    assert.equal(data.total, '200.00');
  });

  it('สร้าง Order พร้อม snapshot ราคา และไม่เชื่อ field ราคาจาก client', async () => {
    const res = await post(buyer.agent, buyer.token, '/api/checkout').send({
      items: [{ productId: catalog.productId, quantity: 3 }],
      total: '1.00', // พยายามกำหนดยอดเอง
      price: '0.01',
    });
    assert.equal(res.status, 201);
    const order = res.body.data.order;
    assert.equal(order.subtotal, '300.00');
    assert.equal(order.total, '300.00');
    assert.match(order.orderNumber, /^DM-[0-9A-F]{12}$/);

    const items = await q('SELECT * FROM order_items WHERE order_id = (SELECT id FROM orders WHERE order_number = ?)', [order.orderNumber]);
    assert.equal(items.length, 1);
    assert.equal(Number(items[0].unit_price), 100);
    assert.equal(Number(items[0].line_total), 300);
    assert.equal(items[0].product_title, 'สินค้าทดสอบ'); // snapshot ชื่อ ณ เวลาซื้อ
  });

  it('เลขคำสั่งซื้อไม่ซ้ำกัน', async () => {
    const numbers = new Set();
    for (let i = 0; i < 5; i++) {
      const res = await post(buyer.agent, buyer.token, '/api/checkout').send({
        items: [{ productId: catalog.productId, quantity: 1 }],
      });
      assert.equal(res.status, 201);
      numbers.add(res.body.data.order.orderNumber);
    }
    assert.equal(numbers.size, 5);
  });

  it('คูปองส่วนลดถูกต้อง (percent) และบันทึก redemptions', async () => {
    await pool.execute(
      `INSERT INTO coupons (code, type, value, min_order_amount, is_active)
       VALUES ('TESTPCT', 'percent', '10.00', '0.00', 1)`
    );
    const res = await post(buyer.agent, buyer.token, '/api/checkout').send({
      items: [{ productId: catalog.productId, quantity: 1 }],
      couponCode: 'TESTPCT',
    });
    assert.equal(res.status, 201);
    const order = res.body.data.order;
    assert.equal(order.subtotal, '100.00');
    assert.equal(order.discountAmount, '10.00');
    assert.equal(order.total, '90.00');

    const coupon = (await q(`SELECT * FROM coupons WHERE code = 'TESTPCT'`))[0];
    assert.equal(coupon.used_count, 1);
    const [reds] = await pool.execute(
      `SELECT * FROM coupon_redemptions cr JOIN orders o ON o.id = cr.order_id WHERE o.order_number = ?`,
      [order.orderNumber]
    );
    assert.equal(reds.length, 1);
    assert.equal(Number(reds[0].discount_amount), 10);
  });

  it('คูปองผิด/หมดอายุ -> ไม่ fail ทั้ง quote แต่รายงาน couponError', async () => {
    const res = await post(buyer.agent, buyer.token, '/api/cart/quote').send({
      items: [{ productId: catalog.productId, quantity: 1 }],
      couponCode: 'NOCODE',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.coupon, null);
    assert.match(res.body.data.couponError, /ไม่พบรหัสคูปอง/);
  });

  it('สินค้าที่ไม่ได้เปิดขาย -> checkout ถูกปฏิเสธ', async () => {
    const [p] = await pool.execute(
      `INSERT INTO products (category_id, slug, title, price, status) VALUES (?, 'closed-p', 'สินค้าปิด', '50.00', 'closed')`,
      [catalog.categoryId]
    );
    const res = await post(buyer.agent, buyer.token, '/api/checkout').send({
      items: [{ productId: p.insertId, quantity: 1 }],
    });
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /ไม่ได้เปิดขาย/);
  });

  it('ดึง order ของตัวเองได้ / เดาเลขข้ามสถานะได้ 404', async () => {
    const created = await post(buyer.agent, buyer.token, '/api/checkout').send({
      items: [{ productId: catalog.productId, quantity: 1 }],
    });
    const orderNumber = created.body.data.order.orderNumber;

    const ok = await buyer.agent.get(`/api/orders/${orderNumber}`);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.order.orderNumber, orderNumber);

    const missing = await buyer.agent.get('/api/orders/DM-000000000000');
    assert.equal(missing.status, 404);
  });
});

import './setup-env.js';
import {
  resetDb,
  seedCatalog,
  loginAs,
  post,
  patch,
  app,
  q,
  createTestOrder,
  payTestOrder,
} from './helpers.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { pool } from '../src/db/pool.js';

/**
 * เทสต์เคส 8: ผู้ใช้ A ต้องไม่เข้าถึงคำสั่งซื้อ/ไฟล์ของผู้ใช้ B ได้
 */
describe('Cross-user isolation', () => {
  let catalog;
  let alice; // A
  let bob; // B
  let bobOrder;
  let bobDownload;

  before(async () => {
    await resetDb();
    catalog = await seedCatalog();
    alice = await loginAs(app(), {
      sub: 'alice-sub',
      email: 'alice@demo.test',
      email_verified: true,
      name: 'Alice',
    });
    bob = await loginAs(app(), {
      sub: 'bob-sub',
      email: 'bob@demo.test',
      email_verified: true,
      name: 'Bob',
    });
    bobOrder = await createTestOrder(bob.agent, bob.token, catalog.productId);
    await payTestOrder(bob.agent, bob.token, bobOrder.order.orderNumber);
    const dl = await post(bob.agent, bob.token, `/api/downloads/${catalog.productId}`).send({});
    bobDownload = dl.body.data;
  });

  it('A เดาเลขคำสั่งซื้อของ B -> 404', async () => {
    const r1 = await alice.agent.get(`/api/orders/${bobOrder.order.orderNumber}`);
    assert.equal(r1.status, 404);
    const r2 = await alice.agent.get(`/api/orders/${bobOrder.order.orderNumber}/status`);
    assert.equal(r2.status, 404);
    const r3 = await alice.agent
      .post(`/api/orders/${bobOrder.order.orderNumber}/pay`)
      .set('X-CSRF-Token', alice.token)
      .send({ method: 'promptpay' });
    assert.equal(r3.status, 404);
  });

  it('A เรียก simulate การจ่ายเงินของ B -> 404', async () => {
    const r = await post(alice.agent, alice.token, '/api/test-payments/simulate').send({
      orderNumber: bobOrder.order.orderNumber,
      outcome: 'paid',
    });
    assert.equal(r.status, 404);
  });

  it('A ใช้ signed URL ของ B -> ถูกปฏิเสธ', async () => {
    const r = await alice.agent.get(
      `/api/downloads/${bobDownload.downloadId}/file?token=${encodeURIComponent(bobDownload.token)}`
    );
    assert.equal(r.status, 403, 'token ผูกกับ user id ของ B -> A ใช้ไม่ได้');

    const s = await alice.agent.get(`/api/downloads/${bobDownload.downloadId}/status`);
    assert.equal(s.status, 404, 'A ดูสถานะดาวน์โหลดของ B ไม่ได้');
  });

  it('A ยังไม่ซื้อ -> ขอลิงก์ดาวน์โหลดสินค้าเดียวกันถูกปฏิเสธ', async () => {
    const r = await post(alice.agent, alice.token, `/api/downloads/${catalog.productId}`).send({});
    assert.equal(r.status, 403);
  });

  it('คลังสินค้า (My Library) แยกกันชัดเจน', async () => {
    const aLib = await alice.agent.get('/api/library');
    const bLib = await bob.agent.get('/api/library');
    assert.equal(aLib.body.data.items.length, 0, 'A ไม่มีสินค้า');
    assert.equal(bLib.body.data.items.length, 1, 'B มีสินค้า 1 ชิ้น');
    assert.equal(bLib.body.data.items[0].productId, catalog.productId);
  });

  it('A แก้โปรไฟล์ตัวเอง ไม่สามารถยัด role/email ได้', async () => {
    const r = await patch(alice.agent, alice.token, '/api/auth/me').send({
      displayName: 'Alice Changed',
      role: 'admin',
      email: 'bob@demo.test',
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.user.displayName, 'Alice Changed');
    assert.equal(r.body.data.user.role, 'user', 'role ไม่เปลี่ยนจาก client');
    assert.equal(r.body.data.user.email, 'alice@demo.test', 'email ไม่เปลี่ยนจาก client');

    const rows = await q('SELECT role, email FROM users WHERE id = ?', [alice.user.id]);
    assert.equal(rows[0].role, 'user');
    assert.equal(rows[0].email, 'alice@demo.test');
  });

  it('A ไม่มีทางเห็นคำสั่งซื้อของ B ในรายการคำสั่งซื้อของตัวเอง', async () => {
    const r = await alice.agent.get('/api/orders');
    assert.equal(r.status, 200);
    assert.equal(r.body.data.orders.length, 0);
    const b = await bob.agent.get('/api/orders');
    assert.equal(b.body.data.orders.length, 1);
    assert.equal(b.body.data.orders[0].orderNumber, bobOrder.order.orderNumber);
  });

  it('รีวิว: A (ยังไม่ซื้อ) รีวิวไม่ได้ / B (ซื้อแล้ว) รีวิวได้ 1 ครั้ง', async () => {
    const anon = request(app());
    const a1 = await post(alice.agent, alice.token, `/api/products/${catalog.slug ?? 'demo-product'}/reviews`)
      .send({ rating: 5, comment: 'ดีมาก' });
    // alice ยังไม่ซื้อ -> 403
    assert.equal(a1.status, 403);

    const slug = (await q('SELECT slug FROM products WHERE id = ?', [catalog.productId]))[0].slug;
    const b1 = await post(bob.agent, bob.token, `/api/products/${slug}/reviews`).send({
      rating: 5,
      comment: 'ใช้งานดีครับ',
    });
    assert.equal(b1.status, 201);

    const b2 = await post(bob.agent, bob.token, `/api/products/${slug}/reviews`).send({
      rating: 1,
      comment: 'รีวิวซ้ำ',
    });
    assert.equal(b2.status, 409, 'รีวิวซ้ำถูกกัน');
  });
});

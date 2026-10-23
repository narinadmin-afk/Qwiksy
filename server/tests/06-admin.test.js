import './setup-env.js';
import {
  resetDb,
  seedCatalog,
  loginAs,
  post,
  del,
  app,
  q,
  createTestOrder,
  payTestOrder,
} from './helpers.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { pool } from '../src/db/pool.js';
import { config } from '../src/config/index.js';

/**
 * เทสต์เคส 10: Admin เพิ่มสินค้า + อัปโหลดไฟล์ได้
 * + คืนเงินผ่านกระบวนการ + audit log + mark-paid ต้องมีเหตุผล/บันทึก + RBAC
 */
describe('Admin dashboard & moderation', () => {
  let catalog;
  let admin;
  let buyer;

  before(async () => {
    await resetDb();
    catalog = await seedCatalog();
    admin = await loginAs(app(), {
      sub: 'admin-sub',
      email: 'admin@demo.test', // อยู่ใน ADMIN_EMAILS
      email_verified: true,
      name: 'Admin',
    });
    buyer = await loginAs(app(), {
      sub: 'admin-buyer',
      email: 'buyer2@demo.test',
      email_verified: true,
      name: 'Buyer',
    });
  });

  it('ผู้ใช้ธรรมดาเข้า /api/admin ไม่ได้ (403)', async () => {
    const r = await buyer.agent.get('/api/admin/dashboard/stats');
    assert.equal(r.status, 403);
    const r2 = await post(buyer.agent, buyer.token, '/api/admin/products').send({
      title: 'x',
      price: 1,
      categoryId: 1,
    });
    assert.equal(r2.status, 403);
  });

  it('ยังไม่ login เข้า /api/admin ไม่ได้ (401)', async () => {
    const anon = request(app());
    const r = await anon.get('/api/admin/orders');
    assert.equal(r.status, 401);
  });

  it('เทสต์เคส 10: admin เพิ่มสินค้า + อัปโหลดไฟล์เข้า Private Storage', async () => {
    // สร้างสินค้า
    const create = await post(admin.agent, admin.token, '/api/admin/products').send({
      title: 'สินค้าที่เพิ่มโดย Admin',
      description: 'รายละเอียด',
      licenseTerms: 'ใช้ส่วนตัว',
      categoryId: catalog.categoryId,
      price: 250,
      discountPercent: 0,
      status: 'published',
      maxDownloads: 5,
      downloadExpiresDays: 30,
    });
    assert.equal(create.status, 201);
    const productId = create.body.data.product.id;
    assert.equal(create.body.data.product.title, 'สินค้าที่เพิ่มโดย Admin');

    // อัปโหลดไฟล์สินค้า (multipart) -> ต้องลง private storage
    const upload = await admin.agent
      .post(`/api/admin/products/${productId}/files`)
      .set('X-CSRF-Token', admin.token)
      .attach('files', Buffer.from('ไฟล์สินค้าตัวอย่างของ Admin\n'), {
        filename: 'admin-product.txt',
        contentType: 'text/plain',
      });
    assert.equal(upload.status, 201);
    const file = upload.body.data.files[0];
    assert.equal(file.originalName, 'admin-product.txt');

    // ไฟล์อยู่ใน private storage (นอก uploads/)
    const row = (await q('SELECT * FROM product_files WHERE id = ?', [file.id]))[0];
    assert.ok(!row.storage_key.startsWith('uploads/'), 'ห้ามอยู่ใน public uploads');
    const abs = path.resolve(config.storage.privateDir, row.storage_key);
    assert.ok(fs.existsSync(abs), 'ไฟล์มีอยู่จริงใน private storage');
    assert.ok(abs.startsWith(path.resolve(config.storage.privateDir)));

    // Public API ห้ามเปิดเผย storage_key / ชื่อไฟล์ภายใน
    const pub = await request(app()).get(`/api/products/${create.body.data.product.slug}`);
    assert.equal(pub.status, 200);
    const pubStr = JSON.stringify(pub.body);
    assert.ok(!pubStr.includes('storage_key'), 'ไม่เปิดเผย storage_key');
    assert.ok(!pubStr.includes('admin-product.txt'), 'ไม่เปิดเผยชื่อไฟล์ภายใน');
    assert.equal(pub.body.data.product.files.count, 1);

    // น้ำหนักไฟล์รวมถูกต้อง
    assert.ok(pub.body.data.product.files.totalBytes > 0);
  });

  it('อัปโหลดนามสกุลที่ไม่อนุญาต -> 400', async () => {
    const upload = await admin.agent
      .post(`/api/admin/products/${catalog.productId}/files`)
      .set('X-CSRF-Token', admin.token)
      .attach('files', Buffer.from('MZ executable-ish'), {
        filename: 'virus.exe',
        contentType: 'application/octet-stream',
      });
    assert.equal(upload.status, 400);
  });

  it('dashboard แสดงตัวเลขสถิติ', async () => {
    const r = await admin.agent.get('/api/admin/dashboard/stats');
    assert.equal(r.status, 200);
    const s = r.body.data.stats;
    assert.equal(typeof s.todaySales, 'string');
    assert.ok(Number(s.totalMembers) >= 2);
    assert.ok(Array.isArray(s.topProducts));
  });

  it('mark-paid โดยไม่มีเหตุผล -> 400, พร้อมเหตุผล -> paid + audit log', async () => {
    const order = await createTestOrder(buyer.agent, buyer.token, catalog.productId);
    const [o] = await pool.execute(`SELECT id FROM orders WHERE order_number = ?`, [
      order.order.orderNumber,
    ]);
    const orderId = o[0].id;

    const noReason = await post(
      admin.agent,
      admin.token,
      `/api/admin/orders/${orderId}/mark-paid`
    ).send({ reason: 'สั้น' });
    assert.equal(noReason.status, 400, 'เหตุผลสั่นเกินไป -> 400');

    const ok = await post(
      admin.agent,
      admin.token,
      `/api/admin/orders/${orderId}/mark-paid`
    ).send({ reason: 'ลูกค้าแนบสลิปยืนยันการโอนเงินทางไลน์' });
    assert.equal(ok.status, 200);

    // ผู้ซื้อได้สิทธิ์ดาวน์โหลด
    const lib = await q(
      `SELECT * FROM user_library WHERE order_id = ? AND revoked_at IS NULL`,
      [orderId]
    );
    assert.equal(lib.length, 1);

    // audit log ถูกบันทึก
    const audit = await q(
      `SELECT * FROM admin_audit_logs WHERE action = 'order.mark_paid' AND entity_id = ?`,
      [order.order.orderNumber]
    );
    assert.equal(audit.length, 1);
    assert.equal(audit[0].admin_email, 'admin@demo.test');
    assert.match(audit[0].reason, /สลิป/);
    assert.ok(audit[0].before_data, 'มี before snapshot');
    assert.ok(audit[0].after_data, 'มี after snapshot');

    // mark-paid ซ้ำบน order ที่ paid แล้ว -> 409
    const again = await post(
      admin.agent,
      admin.token,
      `/api/admin/orders/${orderId}/mark-paid`
    ).send({ reason: 'พยายามยืนยันซ้ำอีกครั้งหนึ่งเพื่อดูระบบ' });
    assert.equal(again.status, 409);
  });

  it('คืนเงิน: เรียกผ่าน provider + สิทธิ์ถูกถอน + audit log', async () => {
    const order = await createTestOrder(buyer.agent, buyer.token, catalog.productId);
    await payTestOrder(buyer.agent, buyer.token, order.order.orderNumber);
    const [o] = await pool.execute(`SELECT id FROM orders WHERE order_number = ?`, [
      order.order.orderNumber,
    ]);
    const orderId = o[0].id;

    // ผู้ซื้อโหลดได้ก่อนคืนเงิน
    const before = await post(buyer.agent, buyer.token, `/api/downloads/${catalog.productId}`).send({});
    assert.equal(before.status, 201);

    const refund = await post(
      admin.agent,
      admin.token,
      `/api/admin/orders/${orderId}/refund`
    ).send({ reason: 'ลูกค้าขอคืนเงินภายใน 7 วัน' });
    assert.equal(refund.status, 200);
    assert.ok(refund.body.data.refundId, 'มี refund id จาก provider');

    const [orders] = await pool.execute(`SELECT status FROM orders WHERE id = ?`, [orderId]);
    assert.equal(orders[0].status, 'refunded');

    // สิทธิ์ดาวน์โหลดถูกถอน -> ดาวน์โหลดต่อไม่ได้
    const after = await post(buyer.agent, buyer.token, `/api/downloads/${catalog.productId}`).send({});
    const ent = await q(`SELECT * FROM user_library WHERE order_id = ?`, [orderId]);
    assert.ok(ent.every((e) => e.revoked_at), 'ทุกสิทธิ์ของ order นี้ถูกถอน');

    const audit = await q(
      `SELECT * FROM admin_audit_logs WHERE action = 'order.refund' AND entity_id = ?`,
      [order.order.orderNumber]
    );
    assert.equal(audit.length, 1);
    assert.match(audit[0].reason, /คืนเงิน/);
  });

  it('คืนเงินที่ไม่ใช่ order paid -> 409', async () => {
    const order = await createTestOrder(buyer.agent, buyer.token, catalog.productId);
    const [o] = await pool.execute(`SELECT id FROM orders WHERE order_number = ?`, [
      order.order.orderNumber,
    ]);
    const r = await post(admin.agent, admin.token, `/api/admin/orders/${o[0].id}/refund`).send({
      reason: 'พยายามคืนเงิน order ที่ยังไม่จ่าย',
    });
    assert.equal(r.status, 409);
  });

  it('admin ระงับผู้ใช้ -> ผู้ใช้ใช้ API ต่อไม่ได้ + audit log', async () => {
    const victim = await loginAs(app(), {
      sub: 'victim-sub',
      email: 'victim@demo.test',
      email_verified: true,
      name: 'Victim',
    });
    const r = await post(
      admin.agent,
      admin.token,
      `/api/admin/users/${victim.user.id}/status`
    ).send({ status: 'suspended' });
    assert.equal(r.status, 200);

    const lib = await victim.agent.get('/api/library');
    assert.equal(lib.status, 401, 'session ถูกเด้งออกทันทีที่ถูกระงับ');

    const audit = await q(
      `SELECT * FROM admin_audit_logs WHERE action = 'user.suspend' AND entity_id = ?`,
      [String(victim.user.id)]
    );
    assert.equal(audit.length, 1);
  });

  it('admin สร้าง/ปิดคูปอง + ใช้กับ checkout ได้', async () => {
    const c = await post(admin.agent, admin.token, '/api/admin/coupons').send({
      code: 'ADMIN10',
      type: 'percent',
      value: 10,
      minOrderAmount: 0,
    });
    assert.equal(c.status, 201);

    const order = await createTestOrder(buyer.agent, buyer.token, catalog.productId, {
      couponCode: 'ADMIN10',
    });
    assert.equal(order.order.discountAmount, '10.00');

    const offRes = await admin.agent
      .patch(`/api/admin/coupons/${c.body.data.coupon.id}`)
      .set('X-CSRF-Token', admin.token)
      .send({ isActive: false });
    assert.equal(offRes.status, 200);

    const used = await post(buyer.agent, buyer.token, '/api/cart/quote').send({
      items: [{ productId: catalog.productId, quantity: 1 }],
      couponCode: 'ADMIN10',
    });
    assert.match(used.body.data.couponError, /ปิดใช้งาน/);
  });

  it('admin ลบสินค้า = soft delete (order เดิมยังสมบูรณ์)', async () => {
    const create = await post(admin.agent, admin.token, '/api/admin/products').send({
      title: 'สินค้าที่จะลบ',
      categoryId: catalog.categoryId,
      price: 50,
      status: 'published',
    });
    const productId = create.body.data.product.id;

    const delRes = await del(admin.agent, admin.token, `/api/admin/products/${productId}`);
    assert.equal(delRes.status, 200);

    const rows = await q('SELECT deleted_at, status FROM products WHERE id = ?', [productId]);
    assert.ok(rows[0].deleted_at, 'deleted_at ถูกตั้ง (soft delete)');

    const pub = await request(app()).get(`/api/products/${create.body.data.product.slug}`);
    assert.equal(pub.status, 404, 'สินค้าที่ลบหายจากหน้าร้าน');

    const audit = await q(
      `SELECT * FROM admin_audit_logs WHERE action = 'product.delete' AND entity_id = ?`,
      [String(productId)]
    );
    assert.equal(audit.length, 1);
  });

  it('audit log ดูย้อนหลังได้', async () => {
    const r = await admin.agent.get('/api/admin/audit-logs');
    assert.equal(r.status, 200);
    assert.ok(r.body.data.total >= 5, 'มี audit หลายเหตุการณ์');
    const actions = r.body.data.items.map((i) => i.action);
    assert.ok(actions.includes('product.create'));
    assert.ok(actions.includes('product.file_upload'));
  });
});

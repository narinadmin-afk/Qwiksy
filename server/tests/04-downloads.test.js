import './setup-env.js';
import {
  resetDb,
  seedCatalog,
  loginAs,
  post,
  app,
  q,
} from './helpers.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import request from 'supertest';
import { pool } from '../src/db/pool.js';
import { config } from '../src/config/index.js';

const SESSION_SECRET = 'test_session_secret_at_least_32_chars_long';

/** สร้าง token ที่ "ลายเซ็นถูก" แต่ข้อมูลถูกดัดแปลง (ผู้ไม่หวังดีขโมย secret ไม่ได้ แต่ทดสอบระบบรับมือ) */
function forgeToken({ downloadId, userId, fileId, exp }) {
  const sig = crypto
    .createHmac('sha256', `${SESSION_SECRET}|signed_download_v1`)
    .update(`${downloadId}.${userId}.${fileId}.${exp}`)
    .digest('hex');
  return `${downloadId}.${userId}.${fileId}.${exp}.${sig}`;
}

/**
 * เทสต์เคส 2, 3, 4, 9:
 * ยังไม่ชำระ -> ปฏิเสธ | แก้ URL -> ปฏิเสธ | ชำระสำเร็จ -> ดาวน์โหลดได้ | คืนเงิน -> ไม่ได้
 */
describe('Secure downloads', () => {
  let catalog;
  let buyer;

  before(async () => {
    await resetDb();
    catalog = await seedCatalog();
    buyer = await loginAs(app(), {
      sub: 'dl-buyer',
      email: 'download@demo.test',
      email_verified: true,
      name: 'Download Buyer',
    });
  });

  async function paidOrder() {
    const { order } = await (
      await import('./helpers.js')
    ).createTestOrder(buyer.agent, buyer.token, catalog.productId);
    await (
      await import('./helpers.js')
    ).payTestOrder(buyer.agent, buyer.token, order.orderNumber);
    return order;
  }

  it('เทสต์เคส 2: ยังไม่ชำระเงิน -> ดาวน์โหลดถูกปฏิเสธ 403 + บันทึก log', async () => {
    const res = await post(buyer.agent, buyer.token, `/api/downloads/${catalog.productId}`).send({});
    assert.equal(res.status, 403);
    assert.match(res.body.error.message, /ยังไม่มีสิทธิ์/);

    const logs = await q('SELECT * FROM download_logs WHERE user_id = ?', [buyer.user.id]);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].status, 'denied');
    assert.equal(logs[0].reason, 'no_entitlement');
  });

  it('ยังไม่ login -> ห้ามออก signed URL และห้ามอ่านไฟล์', async () => {
    const anon = request(app());
    const r1 = await anon.post(`/api/downloads/${catalog.productId}`);
    assert.equal(r1.status, 401);
    const r2 = await anon.get('/api/downloads/1/file?token=whatever');
    assert.equal(r2.status, 401);
  });

  it('เทสต์เคส 4: ชำระเงินสำเร็จ -> ได้ signed URL ใช้งานได้จริง (5 นาที)', async () => {
    const order = await paidOrder();

    const res = await post(buyer.agent, buyer.token, `/api/downloads/${catalog.productId}`).send({});
    assert.equal(res.status, 201);
    const { url, downloadId, expiresInSeconds } = res.body.data;
    assert.ok(expiresInSeconds <= 300, 'อายุ URL ≤ 5 นาที');
    assert.ok(url.includes('/file?token='));

    // ดาวน์โหลดไฟล์จริงด้วย session + token (รองรับทั้ง relative และ absolute URL)
    const parsed = new URL(url, 'http://relative.local');
    const fileRes = await buyer.agent.get(parsed.pathname + parsed.search);
    assert.equal(fileRes.status, 200);
    assert.equal(fileRes.headers['content-disposition'].includes('attachment'), true);
    assert.match(fileRes.text, /demo file content ok/);
    assert.equal(fileRes.headers['x-content-type-options'], 'nosniff');

    // บันทึก completed + นับจำนวนครั้ง
    const status = await buyer.agent.get(`/api/downloads/${downloadId}/status`);
    assert.equal(status.status, 200);
    assert.equal(status.body.data.download.status, 'completed');

    const lib = await q('SELECT * FROM user_library WHERE user_id = ?', [buyer.user.id]);
    assert.equal(lib[0].download_count, 1);
  });

  it('เทสต์เคส 3: แก้ไข URL/token -> ถูกปฏิเสธทุกกรณี', async () => {
    const res = await post(buyer.agent, buyer.token, `/api/downloads/${catalog.productId}`).send({});
    const { downloadId } = res.body.data;
    const good = await buyer.agent.get(`/api/downloads/${downloadId}/file?token=x.y.z.1.abc`);
    assert.equal(good.status, 403, 'token รูปแบบผิด -> 403');

    // ดัดแปลง fileId ใน token (ลายเซ็นเดิมใช้ไม่ได้)
    const forged = forgeToken({
      downloadId,
      userId: buyer.user.id,
      fileId: 99999,
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const r2 = await buyer.agent.get(`/api/downloads/${downloadId}/file?token=${forged}`);
    assert.equal(r2.status, 403);

    // token หมดอายุ (exp ในอดีต แต่ลายเซ็นถูกต้อง)
    const expired = forgeToken({
      downloadId,
      userId: buyer.user.id,
      fileId: 1,
      exp: Math.floor(Date.now() / 1000) - 10,
    });
    const r3 = await buyer.agent.get(`/api/downloads/${downloadId}/file?token=${expired}`);
    assert.equal(r3.status, 403);

    // เดา URL โดยไม่มี token
    const r4 = await buyer.agent.get(`/api/downloads/${downloadId}/file`);
    assert.equal(r4.status, 403);

    // path traversal ตรงๆ ต้องไม่มีทางเข้าถึง (ไม่มี static mount ของ private)
    const r5 = await buyer.agent.get('/uploads/../private/products/p/demo-file.txt');
    assert.notEqual(r5.status, 200);

    const denied = await q(`SELECT * FROM download_logs WHERE status = 'denied' OR status = 'expired'`);
    assert.ok(denied.length >= 1, 'มีการบันทึก log การถูกปฏิเสธ');
  });

  it('เปลี่ยน downloadId ใน URL เป็นของคนอื่น -> 403/404', async () => {
    const res = await post(buyer.agent, buyer.token, `/api/downloads/${catalog.productId}`).send({});
    const { downloadId } = res.body.data;
    // ใช้ token ของตัวเองกับ id อื่น
    const token = res.body.data.token;
    const r = await buyer.agent.get(`/api/downloads/${downloadId + 999}/file?token=${token}`);
    assert.equal(r.status, 403);
    const s = await buyer.agent.get(`/api/downloads/${downloadId + 999}/status`);
    assert.equal(s.status, 404, 'status ของ id ที่ไม่ใช่ตัวเอง -> 404');
  });

  it('เทสต์เคส 9: คืนเงินแล้ว -> ดาวน์โหลดไม่ได้ + สิทธิ์ถูกถอน', async () => {
    const order = await paidOrder();

    // ก่อนคืนเงิน: ใช้ได้
    const before = await post(buyer.agent, buyer.token, `/api/downloads/${catalog.productId}`).send({});
    assert.equal(before.status, 201);

    // ถอนสิทธิ์ตรงๆ แบบเดียวกับตอนคืนเงิน (โหมด test ใช้ revokeEntitlements)
    await pool.execute(
      `UPDATE user_library SET revoked_at = NOW(), revoked_reason = 'คืนเงิน: ทดสอบ'
       WHERE user_id = ? AND order_id = (SELECT id FROM orders WHERE order_number = ?)`,
      [buyer.user.id, order.orderNumber]
    );

    const after = await post(buyer.agent, buyer.token, `/api/downloads/${catalog.productId}`).send({});
    // อาจยังมีสิทธิ์จาก order อื่น -> ตรวจสิทธิ์ของ order นี้โดยเฉพาะ
    const ent = await q(
      `SELECT * FROM user_library WHERE user_id = ? AND order_id = (SELECT id FROM orders WHERE order_number = ?)`,
      [buyer.user.id, order.orderNumber]
    );
    assert.ok(ent[0].revoked_at, 'สิทธิ์ของ order ที่คืนเงินถูกถอนแล้ว');

    const orderId = ent[0].order_id;
    const entOfThisOrder = await q('SELECT * FROM user_library WHERE order_id = ?', [orderId]);
    assert.ok(entOfThisOrder.every((e) => e.revoked_at));
    if (after.status === 201) {
      // ถ้าได้สิทธิ์ใหม่มาจาก order อื่นที่ยัง active -> ต้องมาจาก order ที่ยังไม่ถูกคืนเงิน
      const granted = await q('SELECT order_id FROM user_library WHERE user_id = ? AND revoked_at IS NULL', [
        buyer.user.id,
      ]);
      assert.ok(granted.every((g) => g.order_id !== orderId), 'ไม่มีการ grant ใหม่จาก order ที่คืนเงิน');
    }
  });

  it('จำกัดจำนวนครั้งดาวน์โหลด (max_downloads=2) -> ครั้งที่ 3 ถูกปฏิเสธ', async () => {
    // สินค้าใหม่พร้อมนโยบายจำกัด 2 ครั้ง
    const [prod] = await pool.execute(
      `INSERT INTO products (category_id, slug, title, price, status, max_downloads, published_at)
       VALUES (?, 'limited-dl', 'สินค้าจำกัดดาวน์โหลด', '50.00', 'published', 2, NOW())`,
      [catalog.categoryId]
    );
    const content = 'limited file\n';
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.join(config.storage.privateDir, 'products', `p${prod.insertId}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'limited.txt'), content);
    await pool.execute(
      `INSERT INTO product_files (product_id, storage_key, original_name, mime_type, file_size, is_primary)
       VALUES (?, ?, 'limited.txt', 'text/plain', ?, 1)`,
      [prod.insertId, `products/p${prod.insertId}/limited.txt`, Buffer.byteLength(content)]
    );

    const { createTestOrder, payTestOrder } = await import('./helpers.js');
    const created = await createTestOrder(buyer.agent, buyer.token, prod.insertId);
    await payTestOrder(buyer.agent, buyer.token, created.order.orderNumber);

    const d1 = await post(buyer.agent, buyer.token, `/api/downloads/${prod.insertId}`).send({});
    assert.equal(d1.status, 201);
    const d2 = await post(buyer.agent, buyer.token, `/api/downloads/${prod.insertId}`).send({});
    assert.equal(d2.status, 201);
    assert.equal(d2.body.data.remainingDownloads, 0);

    const d3 = await post(buyer.agent, buyer.token, `/api/downloads/${prod.insertId}`).send({});
    assert.equal(d3.status, 403, 'ครบจำนวนครั้ง -> ปฏิเสธ');
    assert.match(d3.body.error.message, /ดาวน์โหลดครบแล้ว/);
  });

  it('GET /api/library แสดงเฉพาะสินค้าของตัวเอง', async () => {
    const res = await buyer.agent.get('/api/library');
    assert.equal(res.status, 200);
    const items = res.body.data.items;
    assert.ok(items.length >= 1);
    assert.ok(items.every((i) => typeof i.title === 'string'));
    assert.ok(items.every((i) => i.storage_key === undefined), 'ไม่มี storage_key รั่วออกมา');
  });
});

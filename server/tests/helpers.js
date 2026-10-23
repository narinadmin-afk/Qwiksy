/**
 * Test helpers - ต้อง import คู่กับ ./setup-env.js (ตัวแรกสุด) ในไฟล์ test ทุกไฟล์
 */
import './setup-env.js';
import fs from 'node:fs';
import path from 'node:path';
import { pool, q } from '../src/db/pool.js';
import { migrate } from '../src/db/migrate.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config/index.js';
import request from 'supertest';

export { request, pool, q };

const ALL_TABLES = [
  'users',
  'product_categories',
  'products',
  'product_files',
  'orders',
  'order_items',
  'payments',
  'payment_webhook_events',
  'user_library',
  'download_logs',
  'reviews',
  'coupons',
  'coupon_redemptions',
  'admin_audit_logs',
  'sessions',
];

let migrated = false;

/** เตรียม schema + ล้างข้อมูลทั้งหมด (รันก่อนชุดทดสอบ) */
export async function resetDb() {
  if (!migrated) {
    await migrate();
    migrated = true;
  }
  // ใช้ connection เดียวทั้งชุด เพราะ FOREIGN_KEY_CHECKS เป็นราย connection
  const conn = await pool.getConnection();
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS sessions (
      session_id VARCHAR(128) NOT NULL, expires INT UNSIGNED NOT NULL, data MEDIUMTEXT,
      PRIMARY KEY (session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ALL_TABLES) {
      await conn.query(`TRUNCATE TABLE ${t}`);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    conn.release();
  }
}

export function app() {
  return createApp();
}

/** seed หมวดหมู่ + สินค้าทดสอบเล็กน้อย */
export async function seedCatalog() {
  const [cat] = await pool.execute(
    `INSERT INTO product_categories (name, slug, sort_order) VALUES ('ทดสอบ', 'test-cat', 1)`
  );
  const [prod] = await pool.execute(
    `INSERT INTO products (category_id, slug, title, description, license_terms, price,
                           discount_percent, status, cover_image_url, published_at)
     VALUES (?, 'demo-product', 'สินค้าทดสอบ', 'คำอธิบาย', 'ใช้ส่วนตัว', '100.00', '0.00',
             'published', '/uploads/covers/demo.png', NOW())`,
    [cat.insertId]
  );
  const content = 'demo file content ok\n'; // 21 bytes
  const dir = path.join(config.storage.privateDir, 'products', `p${prod.insertId}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'demo-file.txt'), content, 'utf8');
  await pool.execute(
    `INSERT INTO product_files (product_id, storage_key, original_name, mime_type, file_size, is_primary)
     VALUES (?, ?, 'demo.txt', 'text/plain', ?, 1)`,
    [prod.insertId, `products/p${prod.insertId}/demo-file.txt`, Buffer.byteLength(content)]
  );
  return { categoryId: cat.insertId, productId: prod.insertId };
}

// ---------------- Google OAuth login ผ่านเส้นทางจริง (mock ฝั่ง Google เท่านั้น) ----------------

const realFetch = globalThis.fetch;

/** เปลี่ยน global fetch ให้ตอบเหมือน Google ชั่วคราว (คืนฟังก์ชัน restore) */
export function mockGoogleEndpoints(profile) {
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'mock-access-token', id_token: 'mock' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (u.includes('openidconnect.googleapis.com/v1/userinfo')) {
      return new Response(JSON.stringify(profile), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return realFetch(url, opts);
  };
  return () => {
    globalThis.fetch = realFetch;
  };
}

/**
 * Login ด้วย Google ผ่าน route จริง /api/auth/google -> callback (mock ข้อมูลจาก Google)
 * คืน { agent, user } พร้อม session + csrf token
 */
export async function loginAs(application, profile) {
  const restore = mockGoogleEndpoints(profile);
  const agent = request.agent(application);

  // 1) เริ่ม OAuth -> ได้ redirect พร้อม state
  const start = await agent.get('/api/auth/google').redirects(0);
  const location = start.headers.location || '';
  const state = new URL(location, 'http://x').searchParams.get('state');
  if (!state) {
    restore();
    throw new Error('ไม่พบ state ใน redirect: ' + location);
  }

  // 2) callback พร้อม code ปลอม (Google endpoints ถูก mock แล้ว)
  const cb = await agent
    .get(`/api/auth/google/callback?code=mock-code&state=${encodeURIComponent(state)}`)
    .redirects(0);
  restore();
  if (cb.status !== 302 || !String(cb.headers.location).includes('status=success')) {
    throw new Error(`login ไม่สำเร็จ: ${cb.status} ${cb.headers.location}`);
  }

  // 3) ดึง CSRF token สำหรับ POSTs
  const csrf = await agent.get('/api/csrf');
  const token = csrf.body?.data?.token;

  const me = await agent.get('/api/auth/me');
  return { agent, token, user: me.body?.data?.user };
}

/** POST helper ที่แนบ CSRF header อัตโนมัติ */
export function post(agent, token, url) {
  return agent.post(url).set('X-CSRF-Token', token || '');
}
export function patch(agent, token, url) {
  return agent.patch(url).set('X-CSRF-Token', token || '');
}
export function del(agent, token, url) {
  return agent.delete(url).set('X-CSRF-Token', token || '');
}

/** checkout จนได้ orderNumber + payment (สถานะ pending) */
export async function createTestOrder(agent, token, productId, extra = {}) {
  const res = await post(agent, token, '/api/checkout').send({
    items: [{ productId, quantity: 1 }],
    ...extra,
  });
  if (res.status !== 201) {
    throw new Error(`checkout ไม่สำเร็จ: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

/** จ่ายเงินสำเร็จผ่าน endpoint จำลอง (โหมด test) */
export async function payTestOrder(agent, token, orderNumber) {
  const res = await post(agent, token, '/api/test-payments/simulate').send({
    orderNumber,
    outcome: 'paid',
  });
  if (res.status !== 200 || !res.body?.data?.simulateResult?.ok) {
    throw new Error(`simulate ไม่สำเร็จ: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

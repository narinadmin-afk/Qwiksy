import './setup-env.js';
import {
  request,
  resetDb,
  seedCatalog,
  loginAs,
  app,
} from './helpers.js';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { mockGoogleEndpoints } from './helpers.js';

/**
 * เทสต์เคส 1: ผู้ใช้ Login ด้วย Google สำเร็จ
 * - ผ่านเส้นทางจริง /api/auth/google -> callback (mock เฉพาะปลายทางฝั่ง Google)
 * - ตรวจสอบ session, การสร้างบัญชี, role จาก ADMIN_EMAILS, state mismatch, logout
 */
describe('Google OAuth login', () => {
  before(async () => {
    await resetDb();
    await seedCatalog();
  });

  it('login สำเร็จ สร้างบัญชี + session + ได้ข้อมูลผู้ใช้', async () => {
    const { agent, token, user } = await loginAs(app(), {
      sub: 'google-sub-123',
      email: 'buyer@demo.test',
      email_verified: true,
      name: 'ผู้ซื้อทดสอบ',
      picture: 'https://example.com/a.png',
    });
    assert.ok(token, 'ได้ CSRF token');
    assert.equal(user.email, 'buyer@demo.test');
    assert.equal(user.displayName, 'ผู้ซื้อทดสอบ');
    assert.equal(user.role, 'user');
    assert.equal(user.emailVerified, true);
    // ห้ามเปิดเผย google_sub ทาง API
    assert.equal(user.google_sub, undefined);
    assert.equal(user.googleSub, undefined);

    const me = await agent.get('/api/auth/me');
    assert.equal(me.body.data.user.email, 'buyer@demo.test');
  });

  it('อีเมลใน ADMIN_EMAILS ได้สิทธิ์ admin', async () => {
    const { user } = await loginAs(app(), {
      sub: 'google-sub-admin',
      email: 'admin@demo.test',
      email_verified: true,
      name: 'Admin',
    });
    assert.equal(user.role, 'admin');
  });

  it('state ไม่ถูกต้อง -> ถูกปฏิเสธ (ป้องกัน login CSRF)', async () => {
    const restore = mockGoogleEndpoints({ sub: 'x', email: 'x@y.test', email_verified: true });
    const agent = request.agent(app());
    const start = await agent.get('/api/auth/google').redirects(0);
    assert.equal(start.status, 302);
    const cb = await agent
      .get('/api/auth/google/callback?code=abc&state=WRONG_STATE')
      .redirects(0);
    restore();
    assert.equal(cb.status, 302);
    assert.match(cb.headers.location, /error=state_mismatch/);
  });

  it('อีเมลที่ Google ยังไม่ยืนยัน -> ถูกปฏิเสธ', async () => {
    const restore = mockGoogleEndpoints({
      sub: 'unverified-sub',
      email: 'unverified@demo.test',
      email_verified: false,
    });
    const agent = request.agent(app());
    const start = await agent.get('/api/auth/google').redirects(0);
    const state = new URL(start.headers.location, 'http://x').searchParams.get('state');
    const cb = await agent
      .get(`/api/auth/google/callback?code=abc&state=${state}`)
      .redirects(0);
    restore();
    assert.match(cb.headers.location, /error=email_not_verified/);
  });

  it('logout ทำลาย session', async () => {
    const { agent, token } = await loginAs(app(), {
      sub: 'logout-sub',
      email: 'logout@demo.test',
      email_verified: true,
      name: 'Logout',
    });
    const out = await agent.post('/api/auth/logout').set('X-CSRF-Token', token);
    assert.equal(out.status, 200);
    const me = await agent.get('/api/auth/me');
    assert.equal(me.body.data.user, null);
  });

  it('บัญชีที่ถูกระงับ login ไม่ได้', async () => {
    const { user } = await loginAs(app(), {
      sub: 'suspended-sub',
      email: 'suspended@demo.test',
      email_verified: true,
      name: 'Suspended',
    });
    const { pool } = await import('../src/db/pool.js');
    await pool.execute(`UPDATE users SET status = 'suspended' WHERE id = ?`, [user.id]);

    const restore = mockGoogleEndpoints({
      sub: 'suspended-sub',
      email: 'suspended@demo.test',
      email_verified: true,
    });
    const agent = request.agent(app());
    const start = await agent.get('/api/auth/google').redirects(0);
    const state = new URL(start.headers.location, 'http://x').searchParams.get('state');
    const cb = await agent
      .get(`/api/auth/google/callback?code=abc&state=${state}`)
      .redirects(0);
    restore();
    assert.match(cb.headers.location, /error=suspended/);
  });

  it('API ที่ต้อง login ตอบ 401 เมื่อยังไม่ login', async () => {
    const anon = request(app());
    const res = await anon.get('/api/library');
    assert.equal(res.status, 401);
    const co = await anon.post('/api/checkout').send({ items: [{ productId: 1 }] });
    assert.equal(co.status, 401);
  });

  it('CSRF: POST โดยไม่มี token ถูกปฏิเสธ', async () => {
    const { agent } = await loginAs(app(), {
      sub: 'csrf-sub',
      email: 'csrf@demo.test',
      email_verified: true,
      name: 'CSRF',
    });
    const res = await agent.post('/api/checkout').send({ items: [{ productId: 1 }] });
    assert.equal(res.status, 403);
    assert.match(res.body.error.message, /CSRF/);
  });
});

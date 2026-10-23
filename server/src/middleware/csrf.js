import { randomToken, safeEqual } from '../utils/crypto.js';
import { config } from '../config/index.js';
import { errors } from '../utils/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_COOKIE = 'csrf_token';

/** สร้าง/คืน CSRF token ของ session ปัจจุบัน */
export function issueCsrfToken(req, res) {
  if (!req.session) {
    // บังคับสร้าง session เมื่อยังไม่มี
    req.session.csrfIssuedAt = Date.now();
  }
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomToken(24);
  }
  res.cookie(CSRF_COOKIE, req.session.csrfToken, {
    httpOnly: false, // client อ่านได้เพื่อส่ง header (XSS ที่อ่านได้ก็ข้าม CSRF อยู่แล้ว)
    sameSite: 'lax',
    secure: config.session.cookieSecure,
    path: '/',
    maxAge: config.session.ttlMs,
  });
  return req.session.csrfToken;
}

/** endpoint ให้ frontend ดึง token: GET /api/csrf */
export function csrfTokenHandler(req, res) {
  const token = issueCsrfToken(req, res);
  res.json({ ok: true, data: { token } });
}

/**
 * บังคับตรวจสอบ CSRF กับทุก request ที่ไม่ใช่ safe method ใต้ /api
 * ยกเว้น webhook (ใช้ลายเซ็น HMAC ของ Gateway แทน)
 */
export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.path.startsWith('/webhooks/')) return next(); // signature-protected

  const sessionToken = req.session?.csrfToken;
  // ไม่มี session ที่ผูก token = ไม่มี credential ให้ CSRF ขโมย -> ปล่อยให้ auth layer ตอบ 401 เอง
  // (ผู้ใช้ทุกรายที่ Login จะมี csrfToken เสมอ จึงถูกคุ้มครองครบทุกบัญชี)
  if (!sessionToken) return next();

  const headerToken = req.get('x-csrf-token') || req.body?._csrf;
  if (!headerToken || !safeEqual(sessionToken, headerToken)) {
    return next(errors.forbidden('CSRF token ไม่ถูกต้องหรือหมดอายุ'));
  }
  next();
}

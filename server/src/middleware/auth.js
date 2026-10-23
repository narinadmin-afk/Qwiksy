import { q } from '../db/pool.js';
import { errors } from '../utils/errors.js';

/** โหลดผู้ใช้จาก session (ถ้ามี) ใส่ req.user - ตรวจสอบสถานะบัญชีทุกครั้งจาก DB */
export async function attachUser(req, res, next) {
  try {
    req.user = null;
    const uid = req.session?.userId;
    if (!uid) return next();
    const rows = await q(
      `SELECT id, google_sub, email, email_verified, display_name, avatar_url, role, status,
              last_login_at, created_at
       FROM users WHERE id = ? LIMIT 1`,
      [uid]
    );
    if (rows.length === 0) {
      // session ค้างแต่ user ถูกลบ -> ล้าง session
      return req.session.destroy(() => next());
    }
    req.user = rows[0];
    next();
  } catch (err) {
    next(err);
  }
}

/** ต้อง Login ก่อน (API ทุกตัวที่เป็นของผู้ใช้) */
export function requireAuth(req, res, next) {
  if (!req.user) return next(errors.unauthorized('กรุณาเข้าสู่ระบบ'));
  if (req.user.status === 'suspended') {
    return next(errors.forbidden('บัญชีของคุณถูกระงับ กรุณาติดต่อผู้ดูแล'));
  }
  next();
}

/** ต้องเป็น Admin (สิทธิ์มาจาก DB เท่านั้น ไม่เชื่อฝั่ง Frontend) */
export function requireAdmin(req, res, next) {
  if (!req.user) return next(errors.unauthorized('กรุณาเข้าสู่ระบบ'));
  if (req.user.status === 'suspended') {
    return next(errors.forbidden('บัญชีของคุณถูกระงับ'));
  }
  if (req.user.role !== 'admin') return next(errors.forbidden('ต้องเป็นผู้ดูแลระบบเท่านั้น'));
  next();
}

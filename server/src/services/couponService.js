import { errors } from '../utils/errors.js';
import { toCents, fromCents } from '../utils/money.js';

/** ตรวจคูปองแบบอ่านอย่างเดียว (ใช้ตอนผู้ใช้กรอกในตะกร้า) */
export async function previewCoupon({ code, userId, subtotalCents }) {
  const [rows] = await import('../db/pool.js').then((m) =>
    m.pool.execute('SELECT * FROM coupons WHERE code = ? LIMIT 1', [String(code).toUpperCase()])
  );
  if (rows.length === 0) throw errors.badRequest('ไม่พบรหัสคูปองนี้');
  return validateCoupon({ coupon: rows[0], userId, subtotalCents });
}

/**
 * ตรวจ + จองคูปองภายในธุรกรรม (SELECT ... FOR UPDATE กันใช้ซ้ำพร้อมกัน)
 * คืน { coupon, discountCents }
 */
export async function lockCouponForRedemption(conn, { code, userId, subtotalCents }) {
  const [rows] = await conn.execute(
    'SELECT * FROM coupons WHERE code = ? LIMIT 1 FOR UPDATE',
    [String(code).toUpperCase()]
  );
  if (rows.length === 0) throw errors.badRequest('ไม่พบรหัสคูปองนี้');
  return validateCoupon({ coupon: rows[0], userId, subtotalCents });
}

function validateCoupon({ coupon, userId, subtotalCents }) {
  const now = Date.now();
  if (!coupon.is_active) throw errors.badRequest('คูปองนี้ถูกปิดใช้งานแล้ว');
  if (coupon.starts_at && new Date(coupon.starts_at).getTime() > now) {
    throw errors.badRequest('คูปองยังไม่เริ่มใช้งาน');
  }
  if (coupon.ends_at && new Date(coupon.ends_at).getTime() < now) {
    throw errors.badRequest('คูปองหมดอายุแล้ว');
  }
  if (subtotalCents < toCents(coupon.min_order_amount)) {
    throw errors.badRequest(
      `ยอดสุทธิต้องอย่างน้อย ${fromCents(toCents(coupon.min_order_amount))} บาท`
    );
  }
  if (coupon.max_uses != null && coupon.used_count >= coupon.max_uses) {
    throw errors.badRequest('คูปองใช้ครบจำนวนแล้ว');
  }
  const discountCents =
    coupon.type === 'percent'
      ? Math.round((subtotalCents * Number(coupon.value)) / 100)
      : Math.min(toCents(coupon.value), subtotalCents);
  if (discountCents <= 0) throw errors.badRequest('คูปองไม่สามารถใช้ได้กับยอดนี้');
  return { coupon, discountCents: Math.min(discountCents, subtotalCents), userId };
}

/** ตรวจสิทธิ์ต่อผู้ใช้ (นับการใช้ซ้ำ) - เรียกในธุรกรรมหลัง lock แล้ว */
export async function assertPerUserLimit(conn, { coupon, userId }) {
  if (coupon.max_uses_per_user == null) return;
  const [rows] = await conn.execute(
    'SELECT COUNT(*) AS c FROM coupon_redemptions WHERE coupon_id = ? AND user_id = ?',
    [coupon.id, userId]
  );
  if (Number(rows[0].c) >= coupon.max_uses_per_user) {
    throw errors.badRequest('คุณใช้คูปองนี้ครบสิทธิ์แล้ว');
  }
}

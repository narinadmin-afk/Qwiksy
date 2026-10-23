import crypto from 'node:crypto';

/** เลขคำสั่งซื้อที่ไม่ซ้ำ เช่น DM-3F8A21C09B5D (สุ่ม 12 bytes hex) */
export function newOrderNumber() {
  return `DM-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

/** token สุ่มความยาวสูง (base64url) */
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function hmacHex(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/** เทียบค่าแบบ timing-safe */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** slug จากชื่อสินค้า (รองรับ ASCII; ชื่อไทยจะได้ fallback) */
export function slugify(text, fallbackPrefix = 'p') {
  const slug = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  if (slug.length >= 3) return slug;
  return `${fallbackPrefix}-${crypto.randomBytes(4).toString('hex')}`;
}

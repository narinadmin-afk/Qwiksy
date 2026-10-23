import { pool, q } from '../db/pool.js';
import { config } from '../config/index.js';
import { errors } from '../utils/errors.js';

/**
 * สร้าง/อัปเดตบัญชีผู้ใช้จากโปรไฟล์ Google ที่ Backend ตรวจสอบแล้ว
 * - ต้องเป็นอีเมลที่ Google ยืนยันแล้วเท่านั้น (email_verified)
 * - ไม่มีการเก็บรหัสผ่าน/Token ของ Google ลงฐานข้อมูล
 * - role: อิงจาก ADMIN_EMAILS ใน environment เท่านั้น (env = แหล่งความจริง)
 */
export async function upsertUserFromGoogle(profile) {
  const email = String(profile.email || '').toLowerCase();
  if (!email) throw errors.forbidden('บัญชี Google นี้ไม่มีอีเมล');

  const verified =
    profile.email_verified === true || profile.email_verified === 'true';
  if (!verified) throw errors.forbidden('ต้องใช้อีเมลที่ Google ยืนยันแล้วเท่านั้น');

  const isAdmin = config.adminEmails.includes(email);
  const role = isAdmin ? 'admin' : 'user';

  await pool.execute(
    `INSERT INTO users (google_sub, email, email_verified, display_name, avatar_url, role, last_login_at)
     VALUES (?, ?, 1, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       email = VALUES(email),
       email_verified = VALUES(email_verified),
       display_name = VALUES(display_name),
       avatar_url = VALUES(avatar_url),
       role = VALUES(role),
       last_login_at = NOW()`,
    [
      String(profile.sub),
      email,
      String(profile.name || '').slice(0, 120),
      profile.picture ? String(profile.picture).slice(0, 512) : null,
      role,
    ]
  );

  const rows = await q('SELECT * FROM users WHERE google_sub = ? LIMIT 1', [
    String(profile.sub),
  ]);
  if (rows.length === 0) throw errors.internal('สร้างบัญชีผู้ใช้ไม่สำเร็จ');
  return rows[0];
}

/** ข้อมูลผู้ใช้ที่ปลอดภัยจะส่งออกทาง API (ไม่รวม google_sub) */
export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    emailVerified: Boolean(user.email_verified),
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    role: user.role,
    status: user.status,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
  };
}

export async function getUserById(id) {
  const rows = await q('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

/** แก้ไขโปรไฟล์ (เฉพาะ display_name - อีเมลมาจาก Google เท่านั้น) */
export async function updateProfile(userId, { displayName }) {
  await pool.execute('UPDATE users SET display_name = ? WHERE id = ?', [
    String(displayName).slice(0, 120),
    userId,
  ]);
  return getUserById(userId);
}

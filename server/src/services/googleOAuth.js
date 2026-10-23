import { config } from '../config/index.js';
import { errors } from '../utils/errors.js';

/**
 * Google OAuth 2.0 - Authorization Code Flow ฝั่ง Backend ทั้งหมด
 * ค่า client_secret ไม่ออกจากฝั่ง Server เด็ดขาด
 */

export function ensureGoogleConfigured() {
  if (!config.google.enabled) {
    throw errors.unavailable(
      'ยังไม่ได้ตั้งค่า Google OAuth (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) - ดู docs/GOOGLE_OAUTH_SETUP.md'
    );
  }
}

/** URL ไปหน้า Login ของ Google */
export function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.callbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** แลก code -> access_token (เรียกจาก server เท่านั้น) */
export async function exchangeCodeForTokens(code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: config.google.callbackUrl,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw errors.badRequest('Google ปฏิเสธการแลกเปลี่ยน code (หมดอายุหรือถูกใช้ไปแล้ว)');
  }
  return res.json();
}

/** ดึงข้อมูลผู้ใช้ยืนยันตัวตนจาก Google โดยตรงด้วย access_token */
export async function fetchGoogleUserInfo(accessToken) {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw errors.unavailable('ดึงข้อมูลผู้ใช้จาก Google ไม่สำเร็จ กรุณาลองใหม่');
  }
  return res.json();
  // { sub, email, email_verified, name, picture, ... }
}

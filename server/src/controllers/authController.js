import { config } from '../config/index.js';
import { errors, asyncHandler } from '../utils/errors.js';
import { destroySession } from '../middleware/session.js';
import { randomToken, safeEqual } from '../utils/crypto.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import {
  ensureGoogleConfigured,
  buildAuthUrl,
  exchangeCodeForTokens,
  fetchGoogleUserInfo,
} from '../services/googleOAuth.js';
import { upsertUserFromGoogle, publicUser, updateProfile } from '../services/authService.js';

const APP = () => config.appUrl;

/** GET /api/auth/status - ให้ frontend ตรวจว่า OAuth ตั้งค่าแล้วหรือยัง */
export const authStatus = (req, res) => {
  res.json({
    ok: true,
    data: { configured: config.google.enabled, paymentMode: config.payments.mode },
  });
};

/** GET /api/auth/google - redirect ไป Google (สร้าง state กัน CSRF/Login CSRF) */
export const googleLogin = [
  loginLimiter,
  asyncHandler(async (req, res) => {
    ensureGoogleConfigured();
    const state = randomToken(16);
    req.session.oauthState = state;
    await new Promise((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve()))
    );
    res.redirect(buildAuthUrl(state));
  }),
];

/** GET /api/auth/google/callback - ตรวจสอบ state + แลก code + ยืนยันตัวตนจาก Google */
export const googleCallback = asyncHandler(async (req, res) => {
  const fail = (code) => res.redirect(`${APP()}/login?error=${code}`);

  if (!config.google.enabled) return fail('not_configured');
  const { code, state, error } = req.query;
  if (error) return fail('denied');
  if (!code || !state) return fail('bad_request');

  const expected = req.session?.oauthState;
  if (!expected || !safeEqual(expected, String(state))) return fail('state_mismatch');
  delete req.session.oauthState; // ใช้แล้วทิ้ง กัน replay

  let profile;
  try {
    const tokens = await exchangeCodeForTokens(String(code));
    if (!tokens.access_token) return fail('exchange_failed');
    profile = await fetchGoogleUserInfo(tokens.access_token);
  } catch (err) {
    return fail('exchange_failed');
  }

  let user;
  try {
    user = await upsertUserFromGoogle(profile);
  } catch (err) {
    if (err.status === 403) return fail('email_not_verified');
    throw err;
  }
  if (user.status === 'suspended') return fail('suspended');

  // session fixation: regenerate session ใหม่ทั้งหมดก่อนผูก userId
  await new Promise((resolve, reject) =>
    req.session.regenerate((err) => (err ? reject(err) : resolve()))
  );
  req.session.userId = user.id;
  req.session.csrfToken = randomToken(24); // token ใหม่หลัง login
  await new Promise((resolve, reject) =>
    req.session.save((err) => (err ? reject(err) : resolve()))
  );

  res.redirect(`${APP()}/login?status=success`);
});

/** POST /api/auth/logout */
export const logout = asyncHandler(async (req, res) => {
  if (req.session) await destroySession(req);
  res.clearCookie('dmp_sid', { path: '/' });
  res.clearCookie('csrf_token', { path: '/' });
  res.json({ ok: true, data: { message: 'ออกจากระบบแล้ว' } });
});

/** GET /api/auth/me */
export const me = (req, res) => {
  res.json({ ok: true, data: { user: publicUser(req.user) } });
};

/** PATCH /api/auth/me - แก้ไขโปรไฟล์ */
export const updateMe = asyncHandler(async (req, res) => {
  const { displayName } = req.valid.body;
  const user = await updateProfile(req.user.id, { displayName });
  res.json({ ok: true, data: { user: publicUser(user) } });
});

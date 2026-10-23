import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '../../..'); // workspace root
dotenv.config({ path: process.env.ENV_FILE || path.join(rootDir, '.env') });

const bool = (v, def = false) =>
  v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
const int = (v, def) => {
  if (v === undefined || String(v).trim() === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

const serverDir = path.resolve(here, '../..'); // server/

export const config = {
  env: process.env.NODE_ENV || 'development',
  get isProd() {
    return this.env === 'production';
  },
  // PORT=0 (ค่าจาก environment บางเครื่อง) หรือค่าว่าง -> ใช้ 4000
  port: (() => {
    const p = int(process.env.PORT, 4000);
    return Number.isInteger(p) && p > 0 ? p : 4000;
  })(),
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  apiBaseUrl: process.env.API_URL || 'http://localhost:4000',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: int(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'digital_marketplace',
    connectionLimit: int(process.env.DB_CONNECTION_LIMIT, 10),
  },

  session: {
    secret: process.env.SESSION_SECRET || 'dev_insecure_session_secret_change_me',
    cookieSecure: bool(process.env.COOKIE_SECURE, false),
    ttlMs: int(process.env.SESSION_TTL_DAYS, 7) * 24 * 60 * 60 * 1000,
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    callbackUrl:
      process.env.GOOGLE_CALLBACK_URL || 'http://localhost:4000/api/auth/google/callback',
    get enabled() {
      return Boolean(this.clientId && this.clientSecret);
    },
  },

  adminEmails: (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  payments: {
    mode: (process.env.PAYMENT_MODE || 'test') === 'live' ? 'live' : 'test',
    expiryMinutes: int(process.env.PAYMENT_EXPIRY_MINUTES, 30),
    testWebhookSecret: process.env.TEST_WEBHOOK_SECRET || 'test_webhook_secret_dev',
    cardEnabled: bool(process.env.OPN_CARD_ENABLED, false),
    opn: {
      secretKey: process.env.OPN_SECRET_KEY || '',
      publicKey: process.env.OPN_PUBLIC_KEY || '',
      webhookSecret: process.env.OPN_WEBHOOK_SECRET || '',
      apiBase: process.env.OPN_API_BASE || 'https://api.opnpayments.com',
      get enabled() {
        return Boolean(this.secretKey);
      },
    },
  },

  downloads: {
    ttlSeconds: int(process.env.DOWNLOAD_URL_TTL_SECONDS, 300),
  },

  flags: {
    revokeOnRefund: bool(process.env.REVOKE_DOWNLOADS_ON_REFUND, true),
    reviewEnabled: bool(process.env.REVIEW_ENABLED, true),
  },

  storage: {
    publicDir: path.join(serverDir, 'storage', 'public'),
    privateDir: path.join(serverDir, 'storage', 'private'),
  },

  rateLimit: {
    loginMax: int(process.env.RATE_LOGIN_MAX, 10),
    checkoutMax: int(process.env.RATE_CHECKOUT_MAX, 30),
    downloadMax: int(process.env.RATE_DOWNLOAD_MAX, 30),
    generalMax: int(process.env.RATE_GENERAL_MAX, 300),
    windowMs: 15 * 60 * 1000,
  },
};

/** ตรวจสอบค่าที่จำเป็นตอนบูต (ไม่พิมพ์ค่าลับออกมา) */
export function validateConfig() {
  const warnings = [];
  if (config.isProd) {
    if (config.session.secret.length < 32) {
      throw new Error('SESSION_SECRET ต้องมีความยาวอย่างน้อย 32 ตัวอักษรใน production');
    }
    if (!config.session.cookieSecure) {
      warnings.push('COOKIE_SECURE=false ใน production - แนะนำให้ตั้งค่า true หลัง HTTPS');
    }
  }
  if (!config.google.enabled) {
    warnings.push('GOOGLE_CLIENT_ID/SECRET ยังไม่ได้ตั้งค่า - การ Login ด้วย Google จะยังใช้ไม่ได้');
  }
  if (config.payments.mode === 'live' && !config.payments.opn.enabled) {
    warnings.push('PAYMENT_MODE=live แต่ยังไม่ได้ตั้ง OPN_SECRET_KEY - Payment จะสร้างไม่ได้');
  }
  for (const w of warnings) console.warn(`[config] ⚠ ${w}`);
  return warnings;
}

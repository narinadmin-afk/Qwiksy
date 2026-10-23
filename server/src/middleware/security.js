import helmet from 'helmet';
import cors from 'cors';
import { config } from '../config/index.js';

/** Security headers - ปิด CSP เพราะ frontend คนละ origin ตอน dev; จัดการฝั่ง reverse proxy ใน prod */
export const securityHeaders = helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginEmbedderPolicy: false,
});

/** CORS: จำกัด origin ตาม environment, เปิด credentials (cookie session) */
// รองรับ localhost <-> 127.0.0.1 ทั้งสองแบบ (เป็น origin แยกกันในบราวเซอร์)
const allowedOrigins = new Set();
for (const o of config.corsOrigins) {
  allowedOrigins.add(o);
  try {
    const u = new URL(o);
    if (u.hostname === 'localhost') {
      allowedOrigins.add(u.origin.replace('localhost', '127.0.0.1'));
    } else if (u.hostname === '127.0.0.1') {
      allowedOrigins.add(u.origin.replace('127.0.0.1', 'localhost'));
    }
  } catch {
    /* ignore invalid */
  }
}

export const corsMiddleware = cors({
  origin(origin, cb) {
    // ไม่มี origin (curl, mobile, webhook จาก gateway) -> อนุญาต
    if (!origin) return cb(null, true);
    if (allowedOrigins.has(origin)) return cb(null, true);
    const err = new Error(`Origin ไม่ได้รับอนุญาต: ${origin}`);
    err.status = 403;
    return cb(err);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Test-Signature', 'X-Opn-Signature'],
});

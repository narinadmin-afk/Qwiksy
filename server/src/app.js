import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import { config } from './config/index.js';
import { securityHeaders, corsMiddleware } from './middleware/security.js';
import { sessionMiddleware } from './middleware/session.js';
import { attachUser } from './middleware/auth.js';
import { csrfProtection, csrfTokenHandler } from './middleware/csrf.js';
import { generalLimiter } from './middleware/rateLimit.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import { ensureStorageDirs } from './services/storageService.js';
import { pingDb } from './db/pool.js';
import authRoutes from './routes/auth.routes.js';
import catalogRoutes from './routes/catalog.routes.js';
import shopRoutes from './routes/shop.routes.js';
import downloadRoutes from './routes/download.routes.js';
import adminRoutes from './routes/admin.routes.js';
import webhookRoutes from './routes/webhook.routes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, '../../client/dist');

export function createApp() {
  ensureStorageDirs();
  const app = express();

  if (config.isProd) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(securityHeaders);
  app.use(corsMiddleware);

  // session/cookies ก่อน middleware ที่ใช้ session ทุกตัว
  app.use(cookieParser());
  app.use(sessionMiddleware);

  // Webhook: raw body ก่อน express.json เพื่อตรวจสอบลายเซ็น
  app.use('/api/webhooks', webhookRoutes);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  // static: เฉพาะภาพปก/ภาพตัวอย่าง (public) - ไฟล์สินค้าต้นฉบับอยู่คนละที่ ห้าม mount
  app.use(
    '/uploads',
    express.static(path.join(config.storage.publicDir, 'uploads'), {
      index: false,
      maxAge: '7d',
    })
  );

  // rate limit -> user จาก session -> CSRF (ยกเว้น webhook ที่คุ้มครองด้วยลายเซ็น)
  app.use('/api', generalLimiter);
  app.use('/api', attachUser);
  app.use('/api', csrfProtection);

  app.get('/api/health', async (req, res) => {
    try {
      await pingDb();
      res.json({
        ok: true,
        data: { status: 'up', env: config.env, paymentMode: config.payments.mode },
      });
    } catch {
      res.status(503).json({ ok: false, error: { message: 'database down' } });
    }
  });

  // ดึง CSRF token (สร้าง session ใหม่ถ้ายังไม่มี)
  app.get('/api/csrf', csrfTokenHandler);

  app.use('/api/auth', authRoutes);
  app.use('/api', catalogRoutes); // categories, products, reviews
  app.use('/api', shopRoutes); // cart, checkout, orders, test-payments
  app.use('/api', downloadRoutes); // library, downloads
  app.use('/api/admin', adminRoutes);

  // Production: เสิร์ฟ client build (SPA) บน origin เดียวกัน
  if (fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

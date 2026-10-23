import { createApp } from './app.js';
import { config, validateConfig } from './config/index.js';
import { pingDb } from './db/pool.js';
import { logger } from './utils/logger.js';
import { expireStaleOrders } from './services/checkoutService.js';

async function start() {
  validateConfig();

  try {
    await pingDb();
    logger.info('MySQL connected', { host: config.db.host, port: config.db.port, db: config.db.database });
  } catch (err) {
    logger.error('เชื่อมต่อ MySQL ไม่สำเร็จ - ตรวจ DB_HOST/DB_PORT/DB_USER/DB_PASSWORD ใน .env', {
      err: err.message,
    });
    process.exit(1);
  }

  // auto-migrate เฉพาะ dev (idempotent) - production ให้รัน npm run migrate แยกต่างหาก
  const autoMigrate =
    process.env.AUTO_MIGRATE === 'true' ||
    (process.env.AUTO_MIGRATE !== 'false' && !config.isProd);
  if (autoMigrate) {
    try {
      const { migrate } = await import('./db/migrate.js');
      await migrate();
    } catch (err) {
      logger.error('auto-migrate failed', { err: err.message });
      process.exit(1);
    }
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(`Server listening on http://localhost:${config.port}`, {
      env: config.env,
      paymentMode: config.payments.mode,
      googleOAuth: config.google.enabled ? 'configured' : 'not_configured',
    });
  });

  // sweep: ปิดคำสั่งซื้อ/การชำระเงินที่หมดอายุ ทุก 60 วินาที
  const sweep = setInterval(() => {
    expireStaleOrders().catch((err) => logger.error('sweep failed', { err: err.message }));
  }, 60_000);
  sweep.unref?.();

  const shutdown = () => {
    logger.info('shutting down...');
    clearInterval(sweep);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('unhandledRejection', (err) => logger.error('unhandledRejection', err));
  process.on('uncaughtException', (err) => logger.error('uncaughtException', err));
}

start();

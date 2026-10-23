import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';
import { errors } from '../utils/errors.js';

const jsonHandler = (req, res, next) => {
  next(errors.tooMany('คำขอมากเกินไป กรุณารอสักครู่แล้วลองใหม่'));
};

const base = {
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonHandler,
  validate: false, // รันหลัง proxy หลายชั้น (trust proxy) ไม่ต้องเตือน
};

/** key: ใช้ user id ถ้า Login แล้ว มิฉะนั้นใช้ IP */
const keyByUserOrIp = (req) => (req.user ? `u:${req.user.id}` : `ip:${req.ip}`);

export const generalLimiter = rateLimit({
  ...base,
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.generalMax,
  keyGenerator: keyByUserOrIp,
});

export const loginLimiter = rateLimit({
  ...base,
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.loginMax,
  keyGenerator: (req) => `ip:${req.ip}`,
});

export const checkoutLimiter = rateLimit({
  ...base,
  windowMs: 10 * 60 * 1000,
  limit: config.rateLimit.checkoutMax,
  keyGenerator: keyByUserOrIp,
});

export const downloadLimiter = rateLimit({
  ...base,
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.downloadMax,
  keyGenerator: keyByUserOrIp,
});

export const webhookLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 120,
  keyGenerator: (req) => `ip:${req.ip}`,
});

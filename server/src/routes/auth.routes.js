import { Router } from 'express';
import { z } from 'zod';
import * as ctrl from '../controllers/authController.js';
import { csrfTokenHandler } from '../middleware/csrf.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

// CSRF token ให้ frontend ดึง (สร้าง session + token ถ้ายังไม่มี)
router.get('/csrf', csrfTokenHandler);

// Google OAuth
router.get('/status', ctrl.authStatus);
router.get('/google', ctrl.googleLogin); // [rateLimiter, handler]
router.get('/google/callback', ctrl.googleCallback);

// Session
router.post('/logout', ctrl.logout);
router.get('/me', ctrl.me);
router.patch(
  '/me',
  requireAuth,
  validateBody(
    z.object({
      displayName: z
        .string()
        .trim()
        .min(1, 'กรุณากรอกชื่อที่แสดง')
        .max(80, 'ชื่อที่แสดงต้องไม่เกิน 80 ตัวอักษร'),
    })
  ),
  asyncHandler(ctrl.updateMe)
);

export default router;

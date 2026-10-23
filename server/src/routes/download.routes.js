import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { downloadLimiter } from '../middleware/rateLimit.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import * as ctrl from '../controllers/downloadController.js';

const router = Router();

router.get('/library', requireAuth, ctrl.library);
router.get('/downloads', requireAuth, ctrl.downloadHistory);

router.post(
  '/downloads/:productId',
  requireAuth,
  downloadLimiter,
  validateParams(z.object({ productId: z.coerce.number().int().positive() })),
  validateBody(z.object({ fileId: z.coerce.number().int().positive().optional() }).partial()),
  ctrl.createDownload
);

router.get(
  '/downloads/:downloadId/status',
  requireAuth,
  validateParams(z.object({ downloadId: z.coerce.number().int().positive() })),
  ctrl.downloadStatus
);

// ต้อง Login + token ถูกต้อง -> ค่อยส่งไฟล์จาก private storage
router.get(
  '/downloads/:downloadId/file',
  requireAuth,
  validateParams(z.object({ downloadId: z.coerce.number().int().positive() })),
  ctrl.streamFile
);

export default router;

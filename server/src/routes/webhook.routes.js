import { Router } from 'express';
import express from 'express';
import { asyncHandler, errors } from '../utils/errors.js';
import { webhookLimiter } from '../middleware/rateLimit.js';
import { handleWebhook } from '../services/webhookService.js';

/**
 * Webhook เส้นนี้mount ก่อน express.json() เพื่อให้ได้ raw body ไปตรวจสอบลายเซ็น
 * ไม่ต้องใช้ session/CSRF - คุ้มครองด้วยลายเซ็น HMAC ของ Gateway
 */
const router = Router();
router.use(express.raw({ type: () => true, limit: '1mb' }));

const ALLOWED = new Set(['test', 'opn']);

router.post(
  '/payments/:provider',
  webhookLimiter,
  asyncHandler(async (req, res) => {
    const provider = String(req.params.provider || '').toLowerCase();
    if (!ALLOWED.has(provider)) throw errors.notFound('ไม่รู้จักผู้ให้บริการชำระเงินนี้');

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));

    let result;
    try {
      result = await handleWebhook(provider, rawBody, req.headers);
    } catch (err) {
      // 403 = ลายเซ็นผิด (ปฏิเสธชัดเจน), อื่นๆ = transient -> ให้ gateway retry
      if (err.status === 403) {
        return res.status(403).json({ ok: false, error: { message: err.message } });
      }
      if (err.status && err.status < 500) {
        return res.status(err.status).json({ ok: false, error: { message: err.message } });
      }
      return res.status(502).json({ ok: false, error: { message: 'retry later' } });
    }

    // ตอบ 200 เสมอเมื่อประมวลผลแล้ว/ซ้ำ/ถูกปฏิเสธถาวร กัน retry ไม่รู้จบ
    res.json({ ok: true, data: result });
  })
);

export default router;

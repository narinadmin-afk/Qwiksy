import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/errors.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { checkoutLimiter } from '../middleware/rateLimit.js';
import * as ctrl from '../controllers/shopController.js';

const router = Router();

const itemsSchema = z.array(
  z.object({
    productId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().min(1).max(99).default(1),
  })
);

const cartSchema = z.object({
  items: itemsSchema.min(1, 'ตะกร้าสินค้าว่าง').max(50),
  couponCode: z.string().trim().max(40).optional(),
});

// ราคา/ส่วนลดทั้งหมดมาจาก Backend
router.post('/cart/quote', validateBody(cartSchema), ctrl.quoteCart);

router.post(
  '/checkout',
  requireAuth,
  checkoutLimiter,
  validateBody(cartSchema),
  ctrl.checkout
);

router.get('/orders', requireAuth, ctrl.myOrders);
router.get(
  '/orders/:orderNumber',
  requireAuth,
  validateParams(z.object({ orderNumber: z.string().min(3).max(24) })),
  ctrl.getOrder
);
router.get(
  '/orders/:orderNumber/status',
  requireAuth,
  validateParams(z.object({ orderNumber: z.string().min(3).max(24) })),
  ctrl.getOrderStatus
);
router.post(
  '/orders/:orderNumber/pay',
  requireAuth,
  checkoutLimiter,
  validateParams(z.object({ orderNumber: z.string().min(3).max(24) })),
  validateBody(
    z.object({
      method: z.enum(['promptpay', 'card']).default('promptpay'),
      sourceToken: z.string().min(1).max(200).optional(),
    })
  ),
  ctrl.payOrder
);

// โหมดทดสอบเท่านั้น (PAYMENT_MODE=test) - จำลองแล้วผ่าน pipeline webhook จริง
router.post(
  '/test-payments/simulate',
  requireAuth,
  validateBody(
    z.object({
      orderNumber: z.string().min(3).max(24),
      outcome: z.enum(['paid', 'failed']).default('paid'),
    })
  ),
  asyncHandler(ctrl.simulatePayment)
);

export default router;

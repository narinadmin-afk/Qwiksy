import { config } from '../config/index.js';
import { q, pool } from '../db/pool.js';
import { errors, asyncHandler } from '../utils/errors.js';
import { toCents, fromCents, discountedUnitCents } from '../utils/money.js';
import {
  createCheckout,
  getOwnedOrder,
  getOrderItems,
  getOrderPayments,
  publicOrder,
  retryPayment,
} from '../services/checkoutService.js';
import { previewCoupon } from '../services/couponService.js';
import { handleWebhook } from '../services/webhookService.js';
import { getPaymentProvider } from '../services/payments/provider.js';

/**
 * POST /api/cart/quote - คำนวณราคาฝั่ง Server จากสินค้าจริงใน DB
 * (หน้าตะกร้าส่งแค่ productId+quantity ราคาจาก Browser ไม่มีผลอะไรทั้งสิ้น)
 */
export const quoteCart = asyncHandler(async (req, res) => {
  const { items, couponCode } = req.valid.body;
  const ids = [...new Set(items.map((i) => i.productId))];
  const rows = ids.length
    ? await q(
        `SELECT id, title, slug, price, discount_percent, cover_image_url, status
         FROM products WHERE id IN (${ids.map(() => '?').join(',')}) AND deleted_at IS NULL`,
        ids
      )
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));

  const lines = [];
  const unavailable = [];
  let subtotalCents = 0;
  for (const it of items) {
    const p = byId.get(it.productId);
    if (!p || p.status !== 'published') {
      unavailable.push({ productId: it.productId, reason: 'สินค้าถูกปิดการขายหรือถูกลบออก' });
      continue;
    }
    const unitCents = discountedUnitCents(toCents(p.price), p.discount_percent);
    const lineCents = unitCents * it.quantity;
    subtotalCents += lineCents;
    lines.push({
      productId: p.id,
      title: p.title,
      slug: p.slug,
      coverImageUrl: p.cover_image_url,
      quantity: it.quantity,
      listPrice: fromCents(toCents(p.price)),
      unitPrice: fromCents(unitCents),
      lineTotal: fromCents(lineCents),
      discountPercent: Number(p.discount_percent).toFixed(2),
    });
  }

  let discountCents = 0;
  let coupon = null;
  let couponError = null;
  if (couponCode && subtotalCents > 0) {
    try {
      const r = await previewCoupon({ code: couponCode, userId: req.user?.id, subtotalCents });
      discountCents = r.discountCents;
      coupon = {
        code: r.coupon.code,
        type: r.coupon.type,
        value: Number(r.coupon.value).toFixed(2),
        discountAmount: fromCents(discountCents),
      };
    } catch (err) {
      couponError = err.message;
    }
  }

  res.json({
    ok: true,
    data: {
      items: lines,
      unavailable,
      subtotal: fromCents(subtotalCents),
      discountAmount: fromCents(discountCents),
      total: fromCents(Math.max(subtotalCents - discountCents, 0)),
      coupon,
      couponError,
    },
  });
});

/** POST /api/checkout - สร้าง Order + Payment จาก Backend เท่านั้น */
export const checkout = asyncHandler(async (req, res) => {
  const { items, couponCode } = req.valid.body;
  const { order, payment } = await createCheckout({
    userId: req.user.id,
    items,
    couponCode,
  });

  const itemsRows = await getOrderItems(order.id);
  const paymentRows = await getOrderPayments(order.id);
  const orderDto = publicOrder(
    {
      order_number: order.orderNumber,
      status: 'pending',
      currency: 'THB',
      subtotal: fromCents(order.subtotalCents),
      discount_amount: fromCents(order.discountCents),
      total: fromCents(order.totalCents),
      coupon_code: couponCode || null,
      created_at: new Date(),
      expires_at: order.expiresAt,
      paid_at: null,
      refunded_at: null,
    },
    itemsRows,
    paymentRows
  );

  res.status(201).json({
    ok: true,
    data: {
      order: orderDto,
      paymentMode: config.payments.mode,
      message: 'สร้างคำสั่งซื้อแล้ว กรุณาชำระเงินก่อนหมดอายุ',
    },
  });
});

/** GET /api/orders - รายการคำสั่งซื้อของฉัน */
export const myOrders = asyncHandler(async (req, res) => {
  const rows = await q(
    `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
    [req.user.id]
  );
  const out = [];
  for (const o of rows) {
    out.push(publicOrder(o, await getOrderItems(o.id), await getOrderPayments(o.id)));
  }
  res.json({ ok: true, data: { orders: out } });
});

/** GET /api/orders/:orderNumber - เฉพาะเจ้าของ (ไม่ใช่ -> 404 กันเดาเลข) */
export const getOrder = asyncHandler(async (req, res) => {
  const order = await getOwnedOrder(req.valid.params.orderNumber, req.user.id);
  res.json({
    ok: true,
    data: {
      order: publicOrder(order, await getOrderItems(order.id), await getOrderPayments(order.id)),
      paymentMode: config.payments.mode,
    },
  });
});

/** GET /api/orders/:orderNumber/status - ให้หน้า QR poll สถานะ */
export const getOrderStatus = asyncHandler(async (req, res) => {
  const order = await getOwnedOrder(req.valid.params.orderNumber, req.user.id);
  const payments = await getOrderPayments(order.id);
  const latest = payments[0] || null;
  res.json({
    ok: true,
    data: {
      orderStatus: order.status,
      paymentStatus: latest ? latest.status : null,
      paidAt: order.paid_at,
      expiresAt: order.expires_at,
    },
  });
});

/** POST /api/orders/:orderNumber/pay - retry สร้างรายการชำระเงินใหม่ */
export const payOrder = asyncHandler(async (req, res) => {
  const { method = 'promptpay', sourceToken } = req.valid.body;
  if (method === 'card' && !config.payments.cardEnabled) {
    throw errors.badRequest('ยังไม่เปิดใช้ชำระด้วยบัตรเครดิต');
  }
  const payment = await retryPayment({
    orderNumber: req.valid.params.orderNumber,
    userId: req.user.id,
    method,
    sourceToken,
  });
  res.json({ ok: true, data: { paymentId: payment.id, paymentMode: config.payments.mode } });
});

/**
 * POST /api/test-payments/simulate - โหมดทดสอบเท่านั้น
 * จำลองผลชำระเงินแล้วยิงเข้า "pipeline webhook จริง" (ลายเซ็น HMAC)
 * ปิดอัตโนมัติเมื่อ PAYMENT_MODE=live - ไม่มีทางปลดล็อกนอก webhook
 */
export const simulatePayment = asyncHandler(async (req, res) => {
  if (config.payments.mode !== 'test') {
    throw errors.notFound('Endpoint จำลองใช้ได้เฉพาะ PAYMENT_MODE=test เท่านั้น');
  }
  const { orderNumber, outcome = 'paid' } = req.valid.body;
  const order = await getOwnedOrder(orderNumber, req.user.id);

  // ใช้ payment ของ provider test ที่มี charge id ล่าสุด (สถานะ pending เท่านั้น)
  const [rows] = await pool.execute(
    `SELECT * FROM payments
     WHERE order_id = ? AND provider = 'test' AND provider_charge_id IS NOT NULL AND status = 'pending'
     ORDER BY id DESC LIMIT 1`,
    [order.id]
  );
  if (rows.length === 0) {
    throw errors.conflict('ยังไม่มี charge ทดสอบที่รอชำระเงินสำหรับคำสั่งซื้อนี้');
  }
  const chargeId = rows[0].provider_charge_id;

  const testProvider = getPaymentProvider('test');
  const status = outcome === 'failed' ? 'failed' : 'paid';
  const { rawBody, headers } = testProvider.buildSignedWebhook({
    chargeId,
    status,
    amountCents: Math.round(Number(rows[0].amount) * 100),
  });

  const result = await handleWebhook('test', Buffer.from(rawBody, 'utf8'), headers);
  const refreshed = await loadOrderDto(order.order_number, req.user.id);
  res.json({ ok: true, data: { simulateResult: result, order: refreshed } });
});

async function loadOrderDto(orderNumber, userId) {
  const order = await getOwnedOrder(orderNumber, userId);
  return publicOrder(order, await getOrderItems(order.id), await getOrderPayments(order.id));
}

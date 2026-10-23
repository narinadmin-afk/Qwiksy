import { pool, q, withTransaction } from '../db/pool.js';
import { config } from '../config/index.js';
import { errors, ApiError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { newOrderNumber, randomToken } from '../utils/crypto.js';
import { toCents, fromCents, discountedUnitCents } from '../utils/money.js';
import { getPaymentProvider } from './payments/provider.js';
import { lockCouponForRedemption, assertPerUserLimit } from './couponService.js';

/**
 * Checkout: ราคาทั้งหมดคำนวณจากฐานข้อมูลฝั่ง Server เท่านั้น
 * ไม่มีการรับราคา/ส่วนลดจาก Browser เด็ดขาด (กันแก้ราคาซื้อของถูก)
 */
export async function createCheckout({ userId, items, couponCode }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw errors.badRequest('ตะกร้าสินค้าว่าง');
  }

  // รวมรายการซ้ำ (product id เดียวกัน) และจำกัดจำนวน
  const merged = new Map();
  for (const it of items) {
    const pid = Number(it.productId);
    const qty = Math.min(Math.max(Number(it.quantity) || 1, 1), 99);
    if (!Number.isInteger(pid) || pid <= 0) throw errors.badRequest(' productId ไม่ถูกต้อง');
    merged.set(pid, (merged.get(pid) || 0) + qty);
  }

  const orderData = await withTransaction(async (conn) => {
    const ids = [...merged.keys()];
    const [prods] = await conn.execute(
      `SELECT id, title, slug, price, discount_percent, status, max_downloads, download_expires_days
       FROM products WHERE id IN (${ids.map(() => '?').join(',')}) AND deleted_at IS NULL
       FOR UPDATE`,
      ids
    );
    const byId = new Map(prods.map((p) => [p.id, p]));

    const lines = [];
    let subtotalCents = 0;
    for (const [pid, qty] of merged) {
      const p = byId.get(pid);
      if (!p) throw errors.badRequest(`ไม่พบสินค้ารหัส ${pid} (อาจถูกลบออกแล้ว)`);
      if (p.status !== 'published') {
        throw errors.conflict(`สินค้า "${p.title}" ไม่ได้เปิดขายอยู่ในขณะนี้`);
      }
      const unitCents = discountedUnitCents(toCents(p.price), p.discount_percent);
      const lineCents = unitCents * qty;
      subtotalCents += lineCents;
      lines.push({
        product: p,
        quantity: qty,
        unitCents,
        listCents: toCents(p.price),
        lineCents,
      });
    }

    // คูปอง (ล็อกแถวเพื่อกันใช้เกินจำนวนพร้อมกัน)
    let coupon = null;
    let discountCents = 0;
    if (couponCode) {
      const r = await lockCouponForRedemption(conn, {
        code: couponCode,
        userId,
        subtotalCents,
      });
      await assertPerUserLimit(conn, { coupon: r.coupon, userId });
      coupon = r.coupon;
      discountCents = r.discountCents;
    }
    const totalCents = Math.max(subtotalCents - discountCents, 0);

    const orderNumber = newOrderNumber();
    const expiresAt = new Date(Date.now() + config.payments.expiryMinutes * 60 * 1000);
    const [orderResult] = await conn.execute(
      `INSERT INTO orders (order_number, user_id, status, currency, subtotal, discount_amount,
                           total, coupon_code, coupon_id, expires_at)
       VALUES (?, ?, 'pending', 'THB', ?, ?, ?, ?, ?, ?)`,
      [
        orderNumber,
        userId,
        fromCents(subtotalCents),
        fromCents(discountCents),
        fromCents(totalCents),
        coupon ? coupon.code : null,
        coupon ? coupon.id : null,
        expiresAt,
      ]
    );
    const orderId = orderResult.insertId;

    for (const line of lines) {
      await conn.execute(
        `INSERT INTO order_items (order_id, product_id, product_title, product_slug,
                                  unit_price, list_price, quantity, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          line.product.id,
          line.product.title,
          line.product.slug,
          fromCents(line.unitCents),
          fromCents(line.listCents),
          line.quantity,
          fromCents(line.lineCents),
        ]
      );
    }

    if (coupon) {
      await conn.execute(
        'INSERT INTO coupon_redemptions (coupon_id, order_id, user_id, discount_amount) VALUES (?, ?, ?, ?)',
        [coupon.id, orderId, userId, fromCents(discountCents)]
      );
      await conn.execute('UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', [
        coupon.id,
      ]);
    }

    return {
      id: orderId,
      orderNumber,
      subtotalCents,
      discountCents,
      totalCents,
      expiresAt,
      userId,
    };
  });

  // สร้างการชำระเงินนอกธุรกรรม (เรียกภายนอก ไม่ควรถือ lock ไว้)
  const payment = await createPaymentForOrder(orderData);
  return { order: orderData, payment };
}

/**
 * สร้าง Payment + เรียก Gateway สร้าง charge
 * ถ้า gateway ล่ม: บันทึกประวัติ payment = failed แล้ว throw 502 (order ยังอยู่ retry ได้)
 */
export async function createPaymentForOrder(order, { method = 'promptpay', sourceToken } = {}) {
  const provider = getPaymentProvider();
  const paymentReference = `PAY-${order.orderNumber.replace(/^DM-/, '')}-${randomToken(3)
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 6)
    .toUpperCase()}`;

  const [result] = await pool.execute(
    `INSERT INTO payments (order_id, user_id, provider, payment_reference, amount, currency,
                           method, status, expires_at)
     VALUES (?, ?, ?, ?, ?, 'THB', ?, 'pending', ?)`,
    [
      order.id,
      order.userId,
      provider.name,
      paymentReference,
      fromCents(order.totalCents),
      method,
      order.expiresAt,
    ]
  );
  const paymentId = result.insertId;

  try {
    const charge = await provider.createCharge({
      amountCents: order.totalCents,
      currency: 'THB',
      orderNumber: order.orderNumber,
      method,
      sourceToken,
      expiresAt: order.expiresAt,
    });

    await pool.execute(
      `UPDATE payments
       SET provider_charge_id = ?, qr_type = ?, qr_payload = ?, provider_response = ?, status = ?
       WHERE id = ?`,
      [
        charge.chargeId,
        charge.qr?.type || null,
        charge.qr?.imageUrl || charge.qr?.payload || null,
        JSON.stringify(charge.raw || {}),
        charge.status === 'paid' ? 'pending' : charge.status === 'pending' ? 'pending' : charge.status,
        paymentId,
      ]
    );

    const payment = await getPaymentById(paymentId);

    // กรณี gateway ยืนยันชำระทันที (เช่น บัตรที่สำเร็จทันที) -> เข้าสู่ pipeline ยืนยันเดียวกับ webhook
    if (charge.status === 'paid') {
      const { confirmChargePayment } = await import('./webhookService.js');
      await confirmChargePayment({
        providerName: provider.name,
        event: { chargeId: charge.chargeId, amountCents: order.totalCents, currency: 'THB' },
        skipRemoteFetch: false,
      });
      return getPaymentById(paymentId);
    }

    return payment;
  } catch (err) {
    await pool.execute(
      `UPDATE payments SET status = 'failed', failure_reason = ? WHERE id = ?`,
      [String(err.message || 'gateway_error').slice(0, 250), paymentId]
    );
    logger.error('createCharge failed', { paymentId, err: err.message });
    const wrapped =
      err instanceof ApiError
        ? err
        : new ApiError(
            Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 503,
            err.message || 'เชื่อมต่อ Payment Gateway ไม่สำเร็จ กรุณาลองใหม่'
          );
    wrapped.details = { ...(wrapped.details || {}), orderNumber: order.orderNumber };
    throw wrapped;
  }
}

export async function getPaymentById(id) {
  const rows = await q('SELECT * FROM payments WHERE id = ?', [id]);
  return rows[0] || null;
}

/** ดึง order ตามเลขคำสั่งซื้อ - ตรวจสอบว่าเป็นของผู้ใช้นี้เท่านั้น (กันเดาเลขข้ามบัญชี) */
export async function getOwnedOrder(orderNumber, userId) {
  const rows = await q(
    `SELECT * FROM orders WHERE order_number = ? AND user_id = ? LIMIT 1`,
    [String(orderNumber), userId]
  );
  if (rows.length === 0) throw errors.notFound('ไม่พบคำสั่งซื้อนี้');
  return rows[0];
}

export async function getOrderItems(orderId) {
  return q(
    `SELECT id, product_id, product_title, product_slug, unit_price, list_price, quantity, line_total
     FROM order_items WHERE order_id = ? ORDER BY id ASC`,
    [orderId]
  );
}

export async function getOrderPayments(orderId) {
  return q(
    `SELECT id, provider, provider_charge_id, payment_reference, amount, currency, method,
            status, qr_type, qr_payload, failure_reason, created_at, paid_at, expires_at, refunded_at
     FROM payments WHERE order_id = ? ORDER BY id DESC`,
    [orderId]
  );
}

export function publicOrder(order, items = [], payments = []) {
  return {
    orderNumber: order.order_number,
    status: order.status,
    currency: order.currency,
    subtotal: Number(order.subtotal).toFixed(2),
    discountAmount: Number(order.discount_amount).toFixed(2),
    total: Number(order.total).toFixed(2),
    couponCode: order.coupon_code,
    createdAt: order.created_at,
    expiresAt: order.expires_at,
    paidAt: order.paid_at,
    refundedAt: order.refunded_at,
    items: items.map((i) => ({
      productId: i.product_id,
      title: i.product_title,
      slug: i.product_slug,
      unitPrice: Number(i.unit_price).toFixed(2),
      listPrice: Number(i.list_price).toFixed(2),
      quantity: i.quantity,
      lineTotal: Number(i.line_total).toFixed(2),
    })),
    payments: payments.map(publicPayment),
  };
}

export function publicPayment(p) {
  return {
    id: p.id,
    provider: p.provider,
    reference: p.payment_reference,
    chargeId: p.provider_charge_id, // ตัวอ้างอิง Gateway (ไม่ใช่ความลับ)
    amount: Number(p.amount).toFixed(2),
    currency: p.currency,
    method: p.method,
    status: p.status,
    qrType: p.qr_type,
    // qr_payload เป็น data URL รูป QR หรือ payload ทดสอบ -> แสดงผลเท่านั้น ไม่ใช่หลักฐานชำระเงิน
    qrPayload: ['pending'].includes(p.status) ? p.qr_payload : null,
    failureReason: p.failure_reason,
    createdAt: p.created_at,
    paidAt: p.paid_at,
    expiresAt: p.expires_at,
    refundedAt: p.refunded_at,
  };
}

/** Retry การชำระเงินสำหรับ order pending ที่ยังไม่สำเร็จ */
export async function retryPayment({ orderNumber, userId, method, sourceToken }) {
  const order = await getOwnedOrder(orderNumber, userId);
  if (order.status !== 'pending') {
    throw errors.conflict('คำสั่งซื้อนี้ไม่อยู่ในสถานะรอชำระเงิน');
  }
  if (order.expires_at && new Date(order.expires_at).getTime() < Date.now()) {
    throw errors.conflict('คำสั่งซื้อหมดอายุแล้ว กรุณาสั่งซื้อใหม่');
  }
  // ปิด payment เดิมที่ค้าง (มี charge แล้วแต่ยังไม่จ่าย)
  await pool.execute(
    `UPDATE payments SET status = 'expired', failure_reason = 'สร้างรายการชำระเงินใหม่'
     WHERE order_id = ? AND status = 'pending'`,
    [order.id]
  );
  return createPaymentForOrder(
    {
      id: order.id,
      orderNumber: order.order_number,
      userId: order.user_id,
      totalCents: toCents(order.total),
      expiresAt: new Date(order.expires_at),
    },
    { method, sourceToken }
  );
}

/** ประมวลผล order ที่หมดอายุ (เรียกเป็นระยะจาก server) */
export async function expireStaleOrders() {
  const [o] = await pool.execute(
    `UPDATE orders SET status = 'expired'
     WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW()`
  );
  const [p] = await pool.execute(
    `UPDATE payments SET status = 'expired'
     WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW()`
  );
  if (o.affectedRows || p.affectedRows) {
    logger.info('swept expired orders/payments', {
      orders: o.affectedRows,
      payments: p.affectedRows,
    });
  }
  return { orders: o.affectedRows, payments: p.affectedRows };
}

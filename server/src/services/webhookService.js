/**
 * Webhook Pipeline - หัวใจของการปลดล็อกสินค้า
 * กติกา:
 *  1. ตรวจลายเซ็น webhook จาก Gateway เท่านั้น (ไม่มีทางปลดล็อกจากหน้า Success/Query/Swift)
 *  2. Idempotency ด้วย unique (provider, event_id) กันประมวลผลซ้ำ
 *  3. ยืนยัน charge ซ้ำจาก API ของ Gateway (source ที่เชื่อถือได้) + ตรวจยอด/สกุลเงิน
 *  4. ปลดล็อก (order paid + user_library) ในธุรกรรม DB เดียว พร้อม lock แถว
 *  5. Webhook ช้า/มาหลังหมดอายุ: ถ้าเงินเข้าจริง -> ยินดีปลดล็อก (คืนเงินไม่ได้แล้ว)
 */
import { pool, withTransaction } from '../db/pool.js';
import { errors } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { sha256hex } from '../utils/crypto.js';
import { toCents } from '../utils/money.js';
import { getPaymentProvider } from './payments/provider.js';

/** บันทึกเหตุการณ์ webhook (คืน null ถ้าซ้ำ = เคยประมวลผลแล้ว) */
async function recordEvent({ provider, eventId, eventType, chargeId, signatureValid, payload, error }) {
  try {
    const [res] = await pool.execute(
      `INSERT INTO payment_webhook_events
         (provider, event_id, event_type, charge_id, payload, signature_valid, processed, processing_error)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        provider,
        eventId,
        eventType || 'unknown',
        chargeId || null,
        payload ? String(payload).slice(0, 60000) : null,
        signatureValid ? 1 : 0,
        error ? String(error).slice(0, 1000) : null,
      ]
    );
    return res.insertId;
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return null;
    throw err;
  }
}

async function markEventProcessed(eventId) {
  await pool.execute(
    'UPDATE payment_webhook_events SET processed = 1, processing_error = NULL WHERE event_id = ?',
    [eventId]
  );
}

async function markEventError(eventId, reason) {
  await pool.execute(
    'UPDATE payment_webhook_events SET processing_error = ? WHERE event_id = ?',
    [String(reason).slice(0, 1000), eventId]
  );
}

/**
 * จัดการ webhook ที่เข้ามา
 * คืน { ok, duplicate?, reason?, already? }
 * throw เมื่อเป็น transient error (ให้ gateway retry ใหม่)
 */
export async function handleWebhook(providerName, rawBody, headers) {
  const provider = getPaymentProvider(providerName); // 400/403 ถ้า provider ไม่ถูกต้อง/ปิด
  const rawStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);

  // 1) ลายเซ็นต้องมาก่อนเสมอ
  const verification = provider.verifyWebhook(rawBody, headers);
  if (!verification.valid) {
    await recordEvent({
      provider: providerName,
      eventId: `bad_${sha256hex(rawStr).slice(0, 32)}`,
      eventType: 'invalid_signature',
      signatureValid: false,
      payload: rawStr.slice(0, 4000),
      error: verification.reason,
    });
    logger.warn('webhook rejected: bad signature', { provider: providerName, reason: verification.reason });
    throw errors.forbidden('ลายเซ็น Webhook ไม่ถูกต้อง');
  }

  const event = verification.event;

  // 2) Idempotency - event ซ้ำ -> ไม่ประมวลผลซ้ำ
  const eventIdRow = await recordEvent({
    provider: providerName,
    eventId: event.eventId,
    eventType: event.type,
    chargeId: event.chargeId,
    signatureValid: true,
    payload: JSON.stringify(event.raw ?? {}),
  });
  if (eventIdRow === null) {
    logger.info('webhook duplicate ignored', { provider: providerName, eventId: event.eventId });
    return { ok: true, duplicate: true, eventId: event.eventId };
  }

  // 3) ยืนยันกับ gateway + ปลดล็อก
  try {
    const outcome = await confirmChargePayment({ providerName, event });
    if (outcome.ok) {
      await markEventProcessed(event.eventId);
    } else {
      // rejection ถาวร (ยอดไม่ตรง/ไม่พบ charge) -> บันทึกแล้วตอบ 200 กัน retry ไม่รู้จบ
      await markEventError(event.eventId, outcome.reason);
      logger.warn('webhook no-unlock', { provider: providerName, eventId: event.eventId, reason: outcome.reason });
    }
    return { ...outcome, eventId: event.eventId };
  } catch (err) {
    // transient (เช่น gateway ล่มระหว่างตรวจสอบ) -> บันทึกเหตุผลแล้ว throw ให้ retry
    await markEventError(event.eventId, err.message);
    throw err;
  }
}

/**
 * ยืนยันการชำระเงินของ charge หนึ่งแล้วปลดล็อกสินค้า (ธุรกรรมเดียว)
 * - remote fetch จาก provider (source ที่เชื่อถือได้) เว้นแต่ skipRemoteFetch
 * - ตรวจ amount/currency ทั้งจาก payload และจาก gateway
 */
export async function confirmChargePayment({ providerName, event, skipRemoteFetch = false }) {
  const provider = getPaymentProvider(providerName);
  const isTest = providerName === 'test';

  let remote;
  if (skipRemoteFetch) {
    remote = {
      chargeId: event.chargeId,
      status: event.status || 'paid',
      amountCents: event.amountCents,
      currency: event.currency || 'THB',
    };
  } else if (isTest) {
    // โหมดทดสอบ: ลายเซ็น HMAC ของ payload คือแหล่งความจริงของ "สถานะ"
    // แต่ยอดเงินจริงที่ต้องตรง ยังอ่านจากตาราง payments ของเราเสมอ (กัน payload ปลอมยอดผิด)
    if (event.status && event.status !== 'paid') {
      remote = {
        chargeId: event.chargeId,
        status: event.status,
        amountCents: event.amountCents,
        currency: event.currency || 'THB',
      };
    } else {
      const local = await provider.fetchCharge(event.chargeId);
      if (!local) return { ok: false, reason: 'charge_not_found_at_gateway' };
      remote = {
        chargeId: event.chargeId,
        status: 'paid',
        amountCents: local.amountCents,
        currency: local.currency || 'THB',
      };
    }
  } else {
    // โหมดจริง: ดึงจาก API ของ Gateway โดยตรง (source ที่เชื่อถือได้)
    remote = await provider.fetchCharge(event.chargeId);
  }

  if (!remote) return { ok: false, reason: 'charge_not_found_at_gateway' };
  if (remote.status === 'failed' || remote.status === 'expired') {
    // charge ไม่สำเร็จ: บันทึกสถานะ payment (ไม่ปลดล็อก)
    await recordChargeFailure(providerName, event.chargeId, remote.status);
    return { ok: false, reason: `charge_status_${remote.status}` };
  }
  if (remote.status !== 'paid') return { ok: false, reason: `charge_status_${remote.status}` };
  if (String(remote.currency || 'THB').toUpperCase() !== 'THB') {
    return { ok: false, reason: 'currency_mismatch' };
  }
  if (!Number.isFinite(remote.amountCents)) return { ok: false, reason: 'amount_unverifiable' };
  if (event.amountCents != null && event.amountCents !== remote.amountCents) {
    return { ok: false, reason: 'payload_amount_mismatch' };
  }

  // B. ปลดล็อกในธุรกรรมเดียว + lock แถว
  return withTransaction(async (conn) => {
    const [pays] = await conn.execute(
      `SELECT * FROM payments WHERE provider = ? AND provider_charge_id = ? LIMIT 1 FOR UPDATE`,
      [providerName, event.chargeId]
    );
    if (pays.length === 0) return { ok: false, reason: 'payment_not_found' };
    const payment = pays[0];

    if (payment.status === 'paid') return { ok: true, already: true, paymentId: payment.id };
    if (payment.status === 'refunded') return { ok: false, reason: 'already_refunded' };

    // ยอดเงินต้องตรงกับที่เรียกเก็บจริง
    if (toCents(payment.amount) !== remote.amountCents) {
      await conn.execute(
        `UPDATE payments SET status = 'failed', failure_reason = 'ยอดเงินไม่ตรงกับ Gateway' WHERE id = ?`,
        [payment.id]
      );
      const [ors] = await conn.execute('SELECT status FROM orders WHERE id = ?', [payment.order_id]);
      if (ors.length && ['pending', 'failed', 'expired'].includes(ors[0].status)) {
        await conn.execute(`UPDATE orders SET status = 'failed' WHERE id = ?`, [payment.order_id]);
      }
      return { ok: false, reason: 'amount_mismatch' };
    }

    const [orders] = await conn.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [
      payment.order_id,
    ]);
    if (orders.length === 0) return { ok: false, reason: 'order_not_found' };
    const order = orders[0];

    if (order.status === 'refunded') return { ok: false, reason: 'order_refunded' };
    if (order.status === 'cancelled') return { ok: false, reason: 'order_cancelled' };

    // payment.amount ต้องเท่ากับ order.total เสมอ (ฟันฝ่าการแก้ไขข้อมูล)
    if (toCents(payment.amount) !== toCents(order.total)) {
      return { ok: false, reason: 'payment_order_amount_mismatch' };
    }

    if (order.status === 'paid') {
      await conn.execute(
        `UPDATE payments SET status = 'paid', paid_at = COALESCE(paid_at, NOW()) WHERE id = ?`,
        [payment.id]
      );
      return { ok: true, already: true, orderNumber: order.order_number };
    }

    // *** จุดปลดล็อก: order -> paid + สร้างสิทธิ์ดาวน์โหลด ***
    await conn.execute(
      `UPDATE payments
       SET status = 'paid', paid_at = NOW(),
           provider_response = JSON_SET(COALESCE(provider_response, '{}'), '$.verified_from_gateway', TRUE)
       WHERE id = ?`,
      [payment.id]
    );
    await conn.execute(`UPDATE orders SET status = 'paid', paid_at = NOW() WHERE id = ?`, [order.id]);
    const granted = await grantEntitlements(conn, order);

    logger.info('payment confirmed & unlocked', {
      orderNumber: order.order_number,
      provider: providerName,
      granted,
    });
    return { ok: true, orderNumber: order.order_number, orderId: order.id, granted };
  });
}

/** บันทึก payment เป็น failed/expired เมื่อ Gateway รายงานว่า charge ไม่สำเร็จ */
async function recordChargeFailure(providerName, chargeId, status) {
  try {
    await withTransaction(async (conn) => {
      const [pays] = await conn.execute(
        `SELECT id, status FROM payments WHERE provider = ? AND provider_charge_id = ? LIMIT 1 FOR UPDATE`,
        [providerName, chargeId]
      );
      if (pays.length === 0 || pays[0].status !== 'pending') return;
      await conn.execute(
        `UPDATE payments SET status = ?, failure_reason = ? WHERE id = ?`,
        [status === 'expired' ? 'expired' : 'failed', `gateway:${status}`, pays[0].id]
      );
    });
  } catch (err) {
    logger.error('recordChargeFailure failed', { err: err.message });
  }
}

/**
 * สร้าง/รีเซ็ตสิทธิ์ดาวน์โหลดใน user_library (เรียกในธุรกรรมของคำสั่งซื้อเท่านั้น)
 * unique(user_id, product_id) กันสิทธิซ้ำจากการเรียกพร้อมกัน
 */
export async function grantEntitlements(conn, order) {
  const [items] = await conn.execute(
    'SELECT product_id, quantity FROM order_items WHERE order_id = ?',
    [order.id]
  );
  if (items.length === 0) return 0;

  const ids = items.map((i) => i.product_id);
  const [prods] = await conn.execute(
    `SELECT id, max_downloads, download_expires_days FROM products WHERE id IN (${ids
      .map(() => '?')
      .join(',')})`,
    ids
  );
  const prodMap = new Map(prods.map((p) => [p.id, p]));

  for (const item of items) {
    const p = prodMap.get(item.product_id);
    const maxDownloads = p ? p.max_downloads : null;
    const expiresDays = p ? p.download_expires_days : null;
    const expiresAt =
      expiresDays != null ? new Date(Date.now() + Number(expiresDays) * 86400000) : null;

    await conn.execute(
      `INSERT INTO user_library (user_id, product_id, order_id, source, max_downloads, expires_at)
       VALUES (?, ?, ?, 'purchase', ?, ?)
       ON DUPLICATE KEY UPDATE
         order_id = VALUES(order_id),
         source = 'purchase',
         max_downloads = VALUES(max_downloads),
         expires_at = VALUES(expires_at),
         granted_at = NOW(),
         revoked_at = NULL,
         revoked_reason = NULL,
         download_count = 0`,
      [order.user_id, item.product_id, order.id, maxDownloads, expiresAt]
    );

    // นับยอดขายเฉพาะตอนที่คำสั่งซื้อเปลี่ยนเป็น paid (ครั้งเดียว)
    await conn.execute('UPDATE products SET sales_count = sales_count + ? WHERE id = ?', [
      item.quantity,
      item.product_id,
    ]);
  }
  return items.length;
}

/** ถอนสิทธิ์ดาวน์โหลดของคำสั่งซื้อ (ตอนคืนเงิน) */
export async function revokeEntitlements(conn, orderId, reason) {
  const [res] = await conn.execute(
    `UPDATE user_library SET revoked_at = NOW(), revoked_reason = ?
     WHERE order_id = ? AND revoked_at IS NULL`,
    [String(reason || 'คืนเงิน').slice(0, 255), orderId]
  );
  return res.affectedRows;
}

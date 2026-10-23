/**
 * TEST MODE Payment Provider
 * ---------------------------------------------------------------
 * ระบบชำระเงินจำลองสำหรับพัฒนา/ทดสอบ E2E "ไม่มีเงินจริง"
 * - ทุก charge มี id ขึ้นต้นด้วย testch_ และ payload QR ขึ้นต้นด้วย TESTPAY:
 * - Endpoint จำลองการจ่ายเงินจะทำงานเฉพาะ PAYMENT_MODE=test เท่านั้น
 * - ผลการจ่ายเงินจริงถูกส่งเข้าสู่ pipeline Webhook จริง (ลายเซ็น HMAC) เหมือนกัน
 * - เมื่อตั้ง PAYMENT_MODE=live จะใช้ provider จริง (Opn) เท่านั้น
 */
import QRCode from 'qrcode';
import { config } from '../../config/index.js';
import { errors } from '../../utils/errors.js';
import { hmacHex, safeEqual, randomToken } from '../../utils/crypto.js';
import { q, pool } from '../../db/pool.js';

const SIGNATURE_TOLERANCE_SEC = 300;

export const testProvider = {
  name: 'test',

  async createCharge({ amountCents, orderNumber, expiresAt }) {
    const chargeId = `testch_${randomToken(9)}`;
    const payload = `TESTPAY:${chargeId}:${amountCents}:${orderNumber}`;
    const imageUrl = await QRCode.toDataURL(payload, { margin: 1, width: 320 });
    return {
      chargeId,
      status: 'pending',
      method: 'promptpay',
      qr: { type: 'test', payload, imageUrl },
      expiresAt,
      raw: { provider: 'test', note: 'TEST MODE - ไม่ใช่การชำระเงินจริง', chargeId },
    };
  },

  /**
   * ตรวจสอบลายเซ็น webhook โหมดทดสอบ: header x-test-signature: t=<unix>,v=<hmac>
   * v = HMAC-SHA256(TEST_WEBHOOK_SECRET, `${t}.${rawBody}`)
   */
  verifyWebhook(rawBody, headers) {
    const header =
      headers['x-test-signature'] || headers['X-Test-Signature'] || '';
    const match = /^t=(\d+),v=([0-9a-f]+)$/i.exec(String(header).trim());
    if (!match) return { valid: false, reason: 'missing_signature' };
    const [, ts, sig] = match;
    const age = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
    if (age > SIGNATURE_TOLERANCE_SEC) return { valid: false, reason: 'stale_timestamp' };

    const expected = hmacHex(config.payments.testWebhookSecret, `${ts}.${rawBody}`);
    if (!safeEqual(expected, sig.toLowerCase())) {
      return { valid: false, reason: 'bad_signature' };
    }

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return { valid: false, reason: 'invalid_json' };
    }
    if (!body?.data?.id) return { valid: false, reason: 'missing_charge_id' };

    const statusMap = {
      paid: 'paid',
      pending: 'pending',
      failed: 'failed',
      expired: 'expired',
      refunded: 'refunded',
    };
    return {
      valid: true,
      event: {
        // event_id คงที่สำหรับ payload เดียวกัน -> webhook ซ้ำถูก idempotency ดัก
        eventId: body.event_id || `evt_${body.data.id}_${body.type || 'unknown'}`,
        type: body.type || 'charge.unknown',
        chargeId: String(body.data.id),
        amountCents: Number.isFinite(body.data.amount) ? body.data.amount : null,
        currency: body.data.currency || 'THB',
        status: statusMap[body.data.status] || String(body.data.status || ''),
        raw: body,
      },
    };
  },

  /** แหล่งความจริงฝั่งทดสอบ: อ่านจากตาราง payments ของเราเอง */
  async fetchCharge(chargeId) {
    const rows = await q(
      'SELECT provider_charge_id, status, amount, currency, paid_at FROM payments WHERE provider = ? AND provider_charge_id = ? LIMIT 1',
      ['test', chargeId]
    );
    if (rows.length === 0) return null;
    const p = rows[0];
    return {
      chargeId,
      status: p.status,
      amountCents: Math.round(Number(p.amount) * 100),
      currency: p.currency,
      paidAt: p.paid_at,
      raw: { provider: 'test', source: 'db' },
    };
  },

  async refundCharge({ chargeId }) {
    return {
      refundId: `testrf_${randomToken(9)}`,
      status: 'refunded',
      raw: { provider: 'test', chargeId, note: 'TEST MODE refund (จำลอง)' },
    };
  },

  async cancelCharge() {
    return { status: 'expired', raw: { provider: 'test' } };
  },

  /**
   * สร้าง payload+ลายเซ็น webhook ให้ pipeline จริงประมวลผล
   * (ใช้โดย endpoint จำลองการจ่ายเงินในโหมดทดสอบเท่านั้น)
   */
  buildSignedWebhook({ chargeId, status, amountCents, type }) {
    const eventId = `evt_${chargeId}_${status}`;
    const body = JSON.stringify({
      event_id: eventId,
      type: type || `charge.${status}`,
      data: {
        id: chargeId,
        status,
        amount: amountCents,
        currency: 'THB',
        paid_at: status === 'paid' ? new Date().toISOString() : null,
      },
    });
    const ts = Math.floor(Date.now() / 1000);
    const sig = hmacHex(config.payments.testWebhookSecret, `${ts}.${body}`);
    return {
      rawBody: body,
      headers: { 'x-test-signature': `t=${ts},v=${sig}` },
      eventId,
    };
  },
};

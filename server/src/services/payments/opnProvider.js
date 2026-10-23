/**
 * Opn Payments (เดิมชื่อ Omise) Provider - เรียก API จริงด้วย fetch
 * อ้างอิง: https://docs.omise.co (Charges API, Webhooks, Refunds API)
 * - amount เป็นหน่วยย่อย (satang) เสมอ
 * - ตรวจสอบลายเซ็น: HMAC-SHA256(base64_decode(webhook_secret), `${timestamp}.${rawBody}`)
 *   จาก header omise-signature / omise-signature-timestamp
 * - ก่อนปลดล็อกสินค้าจะดึง charge จาก API ด้วย secret key อีกครั้ง ( trusted source )
 */
import crypto from 'node:crypto';
import { config } from '../../config/index.js';
import { errors } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

const SIGNATURE_TOLERANCE_SEC = 300;

/** gateway status -> สถานะภายใน */
function mapStatus(status, paid) {
  switch (status) {
    case 'successful':
      return 'paid';
    case 'pending':
      return 'pending';
    case 'failed':
      return 'failed';
    case 'expired':
      return 'expired';
    case 'reversed':
      return 'refunded';
    default:
      if (paid) return 'paid';
      return 'pending';
  }
}

async function opnRequest(path, { method = 'GET', body, secretKey } = {}) {
  const key = secretKey || config.payments.opn.secretKey;
  if (!key) throw errors.unavailable('ยังไม่ได้ตั้งค่า OPN_SECRET_KEY');
  let res;
  try {
    res = await fetch(`${config.payments.opn.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DigitalMarketplace/1.0',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    logger.error('Opn API unreachable', { path, err: err.message });
    throw errors.unavailable('เชื่อมต่อ Payment Gateway ไม่สำเร็จ กรุณาลองใหม่');
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const message = json?.message || json?.error_message || `HTTP ${res.status}`;
    logger.warn('Opn API error', { path, status: res.status, message });
    throw errors.unavailable(`Payment Gateway ปฏิเสธคำขอ (${message})`);
  }
  return json;
}

/** ดึงรูป QR จาก download_uri แล้วแปลงเป็น data URL (เก็บ base64 ไว้ใช้ได้แม่ gateway ล่ม) */
async function fetchQrImage(downloadUri) {
  if (!downloadUri) return null;
  try {
    const res = await fetch(downloadUri, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.payments.opn.secretKey}:`).toString('base64')}`,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type') || 'image/png';
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch (err) {
    logger.warn('QR image fetch failed', { err: err.message });
    return downloadUri; // fallback: เก็บ URI ไว้
  }
}

export const opnProvider = {
  name: 'opn',

  async createCharge({ amountCents, orderNumber, method = 'promptpay', sourceToken, expiresAt }) {
    const payload = {
      amount: Math.round(amountCents),
      currency: 'THB',
      description: `Order ${orderNumber}`,
      metadata: { order_number: String(orderNumber) },
    };
    if (method === 'card' && sourceToken) {
      payload.source = sourceToken; // token จาก Opn.js ฝั่ง Frontend (ไม่มีข้อมูลบัตรผ่านเซิร์ฟเวอร์)
    } else {
      payload.source = { type: 'promptpay' };
    }

    const charge = await opnRequest('/charges', { method: 'POST', body: payload });

    let qr = null;
    if (method !== 'card') {
      const scannable = charge.source?.scannable_code;
      const imageUrl = await fetchQrImage(scannable?.image?.download_uri);
      qr = {
        type: 'promptpay',
        imageUrl,
        payload: scannable?.raw_data || null,
      };
    }

    return {
      chargeId: charge.id,
      status: mapStatus(charge.status, charge.paid),
      method,
      qr,
      expiresAt,
      raw: { id: charge.id, status: charge.status, amount: charge.amount, currency: charge.currency },
    };
  },

  /** ตรวจสอบลายเซ็น webhook ตามสเปก Omise/Opn */
  verifyWebhook(rawBody, headers) {
    const sigHeader = headers['omise-signature'] || headers['Omise-Signature'];
    const ts = headers['omise-signature-timestamp'] || headers['Omise-Signature-Timestamp'];
    if (!sigHeader || !ts) return { valid: false, reason: 'missing_signature' };

    const age = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
    if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_SEC) {
      return { valid: false, reason: 'stale_timestamp' };
    }

    const secretB64 = config.payments.opn.webhookSecret;
    if (!secretB64) return { valid: false, reason: 'webhook_secret_not_configured' };
    const secret = Buffer.from(secretB64, 'base64');

    const expected = crypto
      .createHmac('sha256', secret)
      .update(Buffer.concat([Buffer.from(`${ts}.`, 'utf8'), rawBody]))
      .digest();

    const candidates = String(sigHeader).split(',');
    let matched = false;
    for (const value of candidates) {
      const candidate = Buffer.from(value.trim(), 'hex');
      if (candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected)) {
        matched = true;
        break;
      }
    }
    if (!matched) return { valid: false, reason: 'bad_signature' };

    let body;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { valid: false, reason: 'invalid_json' };
    }

    // payload แบบ event wrapper: { object:'event', id:'evnt_...', key:'charge.complete', data:{charge} }
    if (body?.object === 'event' && body.data?.id) {
      return {
        valid: true,
        event: {
          eventId: body.id,
          type: body.key || 'charge.unknown',
          chargeId: String(body.data.id),
          amountCents: Number.isFinite(body.data.amount) ? body.data.amount : null,
          currency: body.data.currency || 'THB',
          status: mapStatus(body.data.status, body.data.paid),
          raw: body,
        },
      };
    }
    // แบบ charge ตรงตัว (ป้องกันรูปแบบ payload เปลี่ยน)
    if (body?.object === 'charge' && body.id) {
      return {
        valid: true,
        event: {
          eventId: `${body.id}:${body.status || 'unknown'}`,
          type: 'charge.updated',
          chargeId: String(body.id),
          amountCents: Number.isFinite(body.amount) ? body.amount : null,
          currency: body.currency || 'THB',
          status: mapStatus(body.status, body.paid),
          raw: body,
        },
      };
    }
    return { valid: false, reason: 'unrecognized_payload' };
  },

  /** ดึงสถานะ charge จริงจาก Gateway ก่อนตัดสินใจปลดล็อกสินค้า */
  async fetchCharge(chargeId) {
    try {
      const charge = await opnRequest(`/charges/${encodeURIComponent(chargeId)}`);
      return {
        chargeId: charge.id,
        status: mapStatus(charge.status, charge.paid),
        amountCents: Number.isFinite(charge.amount) ? charge.amount : null,
        currency: charge.currency,
        paidAt: charge.paid_at || null,
        raw: charge,
      };
    } catch (err) {
      if (err.status === 503 || err.status === 502) throw err; // gateway ล่ม -> ให้ webhook retry
      return null; // 404/ไม่พบ -> null
    }
  },

  async refundCharge({ chargeId, amountCents, reason }) {
    const refund = await opnRequest(`/charges/${encodeURIComponent(chargeId)}/refunds`, {
      method: 'POST',
      body: { amount: Math.round(amountCents), reason: reason || 'Customer request' },
    });
    return {
      refundId: refund.id,
      status: refund.status === 'closed' ? 'refunded' : refund.status,
      raw: { id: refund.id, status: refund.status, amount: refund.amount },
    };
  },

  async cancelCharge() {
    return { status: 'pending', note: 'Opn: PromptPay charge หมดอายุเองตามเวลาในระบบ' };
  },
};

/**
 * Payment Provider Interface ที่ทุก provider ต้อง implement:
 *
 * createCharge({ amountCents, currency, orderNumber, method, sourceToken?, expiresAt })
 *   -> { chargeId, status, method, qr: { type, payload?, imageUrl? }, expiresAt, raw }
 *
 * verifyWebhook(rawBody, headers)
 *   -> { valid, reason?, event?: { eventId, type, chargeId, amountCents, currency, status } }
 *
 * fetchCharge(chargeId) -> { chargeId, status, amountCents, currency, paidAt?, raw } | null
 * refundCharge({ chargeId, amountCents, reason }) -> { refundId, status, raw }
 *
 * สถานะถูก map เป็น: pending | paid | failed | expired | refunded เสมอ
 * ห้ามนำสถานะ/ยอดเงินจาก Frontend มาใช้เด็ดขาด - ต้องยืนยันจากฝั่ง Server เท่านั้น
 */
import { config } from '../../config/index.js';
import { errors } from '../../utils/errors.js';
import { testProvider } from './testProvider.js';
import { opnProvider } from './opnProvider.js';

const providers = { test: testProvider, opn: opnProvider };

export function getPaymentProvider(name) {
  const provider = name || (config.payments.mode === 'live' ? 'opn' : 'test');
  if (provider === 'test' && config.payments.mode === 'live') {
    // กันไม่ให้ผู้ให้บริการทดสอบทำงานเงียบๆ ในโหมดชำระเงินจริง
    throw errors.forbidden('โหมดชำระเงินจริงไม่อนุญาตให้ใช้ผู้ให้บริการทดสอบ');
  }
  const p = providers[provider];
  if (!p) throw errors.badRequest('ไม่รองรับผู้ให้บริการชำระเงินนี้');
  return p;
}

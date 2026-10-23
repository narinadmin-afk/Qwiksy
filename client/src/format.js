/** ฟอร์แมตเงินบาทไทย + วันที่ภาษาไทย */

export function formatTHB(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '฿0.00';
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 2,
  }).format(n);
}

export function formatDate(iso) {
  if (!iso) return '-';
  try {
    return new Intl.DateTimeFormat('th-TH', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Bangkok',
    }).format(new Date(iso));
  } catch {
    return String(iso);
  }
}

export function formatDateShort(iso) {
  if (!iso) return '-';
  try {
    return new Intl.DateTimeFormat('th-TH', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Asia/Bangkok',
    }).format(new Date(iso));
  } catch {
    return String(iso);
  }
}

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export const ORDER_STATUS_TH = {
  pending: 'รอชำระเงิน',
  paid: 'ชำระเงินแล้ว',
  failed: 'ชำระเงินไม่สำเร็จ',
  expired: 'หมดอายุ',
  cancelled: 'ยกเลิกแล้ว',
  refunded: 'คืนเงินแล้ว',
};

export const PAYMENT_STATUS_TH = {
  pending: 'รอชำระเงิน',
  paid: 'ชำระเงินแล้ว',
  failed: 'ไม่สำเร็จ',
  expired: 'หมดอายุ',
  refunded: 'คืนเงินแล้ว',
};

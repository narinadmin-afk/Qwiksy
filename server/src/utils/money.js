/**
 * การคำนวณเงิน: ทำงานบน integer cents เสมอ เพื่อเลี่ยง floating point
 * ค่า DECIMAL จาก MySQL ถูกแปลงเป็น number (decimalNumbers) แล้วแปลงเป็น cents ทันที
 */

export function toCents(amount) {
  return Math.round(Number(amount) * 100);
}

export function fromCents(cents) {
  return (cents / 100).toFixed(2);
}

/** หาจำนวนบาทหลังส่วนลดเป็นร้อยละ (percent ทศนิยม 2 ตำแหน่ง) */
export function discountedUnitCents(priceCents, discountPercent) {
  const bp = Math.round(Number(discountPercent || 0) * 100); // basis points
  if (bp <= 0) return priceCents;
  return Math.round((priceCents * (10000 - bp)) / 10000);
}

/** จำนวนเงินเป็นข้อความ 2 ตำแหน่ง เช่น "1234.50" */
export function fmtAmount(cents) {
  return fromCents(cents);
}

/** format บาทไทยในฝั่ง client ก็ได้ แต่ API ส่งเป็น number/string เสมอ */
export function formatTHB(cents) {
  return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(
    cents / 100
  );
}

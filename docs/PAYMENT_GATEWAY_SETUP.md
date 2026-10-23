# ตั้งค่า Payment Gateway

ระบบรองรับ 2 โหมด (`PAYMENT_MODE`) และออกแบบให้ **ยืนยันการชำระเงินผ่าน Webhook เท่านั้น**

## 1. ภาพรวม 2 โหมด

| โหมด | `PAYMENT_MODE` | ผู้ให้บริการ | หมายเหตุ |
|------|---------------|-------------|---------|
| ทดสอบ | `test` (ค่าเริ่มต้น) | `testProvider` (จำลอง) | ไม่มีเงินจริง, มีป้าย TEST MODE ชัดเจน |
| จริง | `live` | `opnProvider` (Opn/Omise) | ยืนยันผ่าน Webhook + ตรวจลายเซ็น HMAC |

- โหมด `test` มี `POST /api/test-payments/simulate` เพื่อจำลองผลชำระ
  ซึ่งยัง **ผ่าน webhook pipeline ชุดเดียวกับโหมด live** เพื่อให้โค้ด path เดียวกัน
- เมื่อ `PAYMENT_MODE=live` ระบบจะ **บล็อกไม่ให้ใช้ testProvider** อัตโนมัติ
  (กันไม่ให้ระบบจำลองทำงานเงียบๆ ในโหมดชำระเงินจริง)

## 2. โหมด `test` (ค่าเริ่มต้น — พร้อมใช้ทันที)

ตั้งใน `.env`:

```env
PAYMENT_MODE=test
TEST_WEBHOOK_SECRET=change_me_test_webhook_secret
```

ทดลอง flow ครบวงจรได้ทันที (สร้างคำสั่งซื้อ → จ่าย → ได้สิทธิ์ดาวน์โหลด) โดยไม่ต้องตั้งค่าอะไรเพิ่ม

> เหมาะกับ development, demo และการทดสอบอัตโนมัติ — **ไม่มีการสร้างข้อมูลชำระเงินจริงปลอม**
> และบน UI จะแสดงป้าย "TEST MODE" ชัดเจนเสมอ

## 3. โหมด `live` — Opn Payments (เดิม Omise)

อ้างอิง: [docs.omise.co](https://docs.omise.co) (Charges API, Webhooks, Refunds)

### 3.1 สร้างบัญชีและเปิดใช้พร้อมเพย์

1. สมัคร [Opn Payments](https://opnpayments.com/) แล้วผ่านการยืนยันตัวตน
2. เปิดใช้ **PromptPay** (สำหรับ QR) และ/หรือ **บัตรเครดิต** ในแดชบอร์ด

### 3.2 สร้าง Webhook endpoint

1. ในแดชบอร์ด Opn สร้าง Webhook ชี้ไปที่:
   ```
   https://<โดเมน-production>/api/webhooks/payments/opn
   ```
2. ก๊อปปี้ **Webhook Secret** (base64) มาเก็บไว้

> Backend mount เส้น `/api/webhooks/payments/:provider` **ก่อน** body parser
> เพื่อให้ได้ raw body ไปตรวจลายเซ็น HMAC

### 3.3 ตั้งค่า `.env`

```env
PAYMENT_MODE=live
OPN_SECRET_KEY=secret_xxxxxxxx
OPN_PUBLIC_KEY=pk_xxxxxxxx
OPN_WEBHOOK_SECRET=<base64 webhook secret จากแดชบอร์ด>
OPN_API_BASE=https://api.opnpayments.com
# เปิดรับบัตรเครดิต (ต้องตั้ง Opn.js ฝั่ง Frontend ด้วย)
OPN_CARD_ENABLED=false
```

รีสตาร์ท Backend หลังแก้ `.env`

### 3.4 วิธีทำงานของ Provider

- **สร้าง charge:** Backend เรียก Opn `/charges` ด้วย `amount` (หน่วย satang) + `currency=THB`
  - PromptPay: ส่ง `source: { type: 'promptpay' }` → ได้ QR (เก็บเป็น data URL ใช้ซ้ำได้แม้ gateway ล่ม)
  - บัตร: ส่ง `source: <token จาก Opn.js ฝั่ง Frontend>` (ไม่มีข้อมูลบัตรผ่านเซิร์ฟเวอร์)
- **ยืนยันการชำระเงิน:** Webhook เท่านั้น → ตรวจลายเซ็น → **ดึง charge จาก API ด้วย secret key อีกครั้ง**
  (trusted source) ก่อนปลดล็อกสินค้า
- **คืนเงิน:** เรียก Opn refunds API (`/charges/:id/refunds`)

### 3.5 ตรวจลายเซ็น Webhook (ฝั่ง Backend ทำให้แล้ว)

Opn ส่ง header `Omise-Signature` + `Omise-Signature-Timestamp` Backend ตรวจ:

```
HMAC-SHA256(base64_decode(webhook_secret), `${timestamp}.${rawBody}`)
```

- ใช้ `timingSafeEqual` เทียบกับค่าใน header (กัน timing attack)
- ปฏิเสธถ้า timestamp เก่าเกิน 300 วินาที (กัน replay)
- ปฏิเสธถ้า webhook secret ยังไม่ได้ตั้งค่า

> หากลายเซ็นผิด Backend ตอบ `403` — กันไม่ให้ปลอมแปลงการยืนยันชำระเงินได้

## 4. การตั้งค่าบัตรเครดิต (ทางเลือก)

หากตั้ง `OPN_CARD_ENABLED=true`:
- ต้องติดตั้ง **Opn.js** ฝั่ง Frontend เพื่อสร้าง `sourceToken` จากข้อมูลบัตร
  (ข้อมูลบัตรไม่ผ่านเซิร์ฟเวอร์เราเลย)
- Frontend ส่ง `sourceToken` ไปกับ `POST /api/orders/:orderNumber/pay`
  `{ "method": "card", "sourceToken": "tok_xxx" }`
- Backend ใช้ token นั้นสร้าง charge กับ Opn

## 5. ขั้นตอนทดสอบก่อนเปิดรับเงินจริง

**อย่าเปิด `PAYMENT_MODE=live` ใน Production ก่อนผ่านขั้นตอนนี้:**

1. ตั้งค่า `.env` (live) + webhook ชี้ environment ทดสอบ
2. สร้างคำสั่งซื้อจริง → จ่ายด้วย PromptPay amount น้อยมาก (เช่น ฿5)
3. ยืนยันว่า:
   - Webhook เข้ามาที่ `/api/webhooks/payments/opn` และ **ผ่านลายเซ็น**
   - คำสั่งซื้อกลายเป็น `paid` อัตโนมัติ
   - `user_library` ถูก grant และดาวน์โหลดได้จริง
   - Webhook **ส่งซ้ำ** แล้วไม่สร้างผลซ้ำ (idempotency)
4. ทดสอบคืนเงิน (refund) → สิทธิ์ดาวน์โหลดถูกถอน (`REVOKE_DOWNLOADS_ON_REFUND=true`)
5. ทดสอบบัตรเครดิต (ถ้าเปิด) ผ่าน test card ของ Opn

## 6. หมายเหตุสำคัญ

- **ห้ามมาร์ก order เป็น `paid` จากฝั่ง Frontend/Client เด็ดขาด** —
  มีเพียง Webhook ที่ผ่านลายเซ็นเท่านั้นที่ยืนยันการชำระได้ในโหมด live
- Webhook ออกแบบให้ **idempotent**: ใช้ `payment_webhook_events` (UNIQUE provider+event_id)
  กันประมวลผลซ้ำเมื่อ gateway retry
- หาก gateway ขัดข้องชั่วคราว Backend ตอบ `502` เพื่อให้ gateway retry ได้
- Backend "ไม่ไว้ใจ" ข้อมูลจาก event อย่างเดียว — ก่อนปลดล็อกจะ **ดึง charge สถานะจริงจาก API อีกครั้ง**

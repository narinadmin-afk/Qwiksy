# API Reference

HTTP JSON API ทั้งหมดของ Backend (prefix `/api`)

## ข้อตกลงทั่วไป

- **Base URL (dev):** `http://localhost:4000/api`
- **รูปแบบตอบ:** สำเร็จ `{ "ok": true, "data": { ... } }` · ผิดพลาด `{ "ok": false, "error": { "message": "..." } }`
- **การยืนยันตัวตน:** cookie session (`dmp_sid`) ที่ Backend ตั้ง (httpOnly)
- **CSRF:** ทุกคำขอที่ไม่ใช่ GET ต้องส่ง header `X-CSRF-Token` ให้ตรงกับค่าใน cookie `csrf_token`
  (ดึง token ได้จาก `GET /api/csrf`) — ยกเว้นเส้น webhook ที่คุ้มครองด้วยลายเซ็น HMAC
- **Rate limit:** จำกัดต่อ IP (ทั่วไป/ล็อกอิน/checkout/ดาวน์โหลด) เมื่อเกินจะได้ `429`
- **สกุลเงิน:** ทุกจำนวนเงินเป็น THB (number ทศนิยม 2 ตำแหน่ง)

## สถานะข้อผิดพลาดที่พบบ่อย

| รหัส | ความหมาย |
|------|-----------|
| 400 | ข้อมูลไม่ผ่าน validation (zod) |
| 401 | ยังไม่ได้เข้าสู่ระบบ |
| 403 | ไม่มีสิทธิ์ / CSRF ไม่ถูกต้อง / ตรวจลายเซ็นไม่ผ่าน |
| 404 | ไม่พบทรัพยากร |
| 409 | ขัดแย้ง (เช่น ใช้คูปองซ้ำ/หมดโควตา) |
| 429 | เกิน rate limit |
| 502 | Payment gateway ขัดข้อง (retry ได้) |

---

## Auth

| เมธอด | path | ต้อง login | หมายเหตุ |
|-------|------|-----------|---------|
| GET | `/api/csrf` | ✗ | ดึง CSRF token (สร้าง session ถ้ายังไม่มี) |
| GET | `/api/auth/status` | ✗ | เช็คว่าตั้งค่า OAuth แล้ว/โหมดชำระเงิน |
| GET | `/api/auth/google` | ✗ | redirect ไป Google (rate limited) |
| GET | `/api/auth/google/callback` | ✗ | callback จาก Google → สร้าง/อัปเดต session |
| POST | `/api/auth/logout` | ✗ | ทำลาย session |
| GET | `/api/auth/me` | ✓ | โปรไฟล์ผู้ใช้ปัจจุบัน |
| PATCH | `/api/auth/me` | ✓ | แก้ `displayName` |

**ตัวอย่าง** `PATCH /api/auth/me`
```json
// request
{ "displayName": "ชื่อที่แสดงใหม่" }
// response 200
{ "ok": true, "data": { "user": { "id": 1, "email": "...", "displayName": "...", "role": "user" } } }
```

> การ login ด้วย Google: ไปที่ `GET /api/auth/google` ระบบจะ redirect ไป Google แล้วกลับมายัง
> callback → ตั้ง session → redirect กลับ Frontend (หน้า `/login?status=success`)

---

## Catalog (สินค้า/หมวดหมู่/รีวิว)

| เมธอด | path | ต้อง login | หมายเหตุ |
|-------|------|-----------|---------|
| GET | `/api/categories` | ✗ | รายการหมวดหมู่ |
| GET | `/api/products/home` | ✗ | สินค้าแนะนำ/ขายดี/ใหม่ สำหรับหน้าแรก |
| GET | `/api/products` | ✗ | รายการสินค้า + ค้นหา/กรอง/เรียง/เพจจิเนชัน |
| GET | `/api/products/:slug` | ✗ | รายละเอียดสินค้า + รีวิว |
| GET | `/api/products/:slug/reviews` | ✗ | รีวิวของสินค้า |
| POST | `/api/products/:slug/reviews` | ✓ | รีวิว (ต้องซื้อสินค้านี้แล้วเท่านั้น) |

**พารามิเตอร์ query ของ `GET /api/products`**

| ชื่อ | ชนิด | หมายเหตุ |
|------|------|---------|
| `category` | string | slug ของหมวดหมู่ |
| `q` | string | คำค้นหา |
| `sort` | `newest`\|`oldest`\|`price_asc`\|`price_desc`\|`bestseller`\|`discount` | การเรียง |
| `page` | int ≥1 | เพจ |
| `limit` | int 1–48 | จำนวนต่อเพจ |

**ตัวอย่าง** `POST /api/products/:slug/reviews`
```json
// request
{ "rating": 5, "comment": "ใช้งานดีมาก" }
// response 201
{ "ok": true, "data": { "review": { "id": 10, "rating": 5, "comment": "ใช้งานดีมาก" } } }
```

---

## Shop (ตะกร้า/checkout/คำสั่งซื้อ/ชำระเงิน)

| เมธอด | path | ต้อง login | หมายเหตุ |
|-------|------|-----------|---------|
| POST | `/api/cart/quote` | ✗ | คำนวณราคา/ส่วนลด (ยังไม่สร้าง order) |
| POST | `/api/checkout` | ✓ | สร้างคำสั่งซื้อ + payment (rate limited) |
| GET | `/api/orders` | ✓ | ประวัติการสั่งซื้อของฉัน |
| GET | `/api/orders/:orderNumber` | ✓ | รายละเอียดคำสั่งซื้อ |
| GET | `/api/orders/:orderNumber/status` | ✓ | สถานะการชำระเงิน (ใช้ poll หน้าจ่ายเงิน) |
| POST | `/api/orders/:orderNumber/pay` | ✓ | เริ่มสร้างการชำระเงิน (PromptPay QR / บัตร) |
| POST | `/api/test-payments/simulate` | ✓ | **โหมด test เท่านั้น** จำลองผลชำระ (ผ่าน webhook pipeline จริง) |

**รูปแบบ items (ใช้กับ quote และ checkout)**
```json
{
  "items": [ { "productId": 1, "quantity": 1 } ],
  "couponCode": "WELCOME10"
}
```

**ตัวอย่าง** `POST /api/checkout` → 201
```json
{
  "ok": true,
  "data": {
    "order": { "orderNumber": "DM-...","status": "pending","total": 239.20, "...": "..." },
    "payment": { "method": "promptpay","qrPayload": "...","expiresAt": "..." }
  }
}
```

**ตัวอย่าง** `POST /api/orders/:orderNumber/pay`
```json
// request
{ "method": "promptpay" }          // หรือ { "method": "card", "sourceToken": "..." }
// response → คืนข้อมูล QR/สถานะให้หน้าจ่ายเงินนำไปแสดง + poll สถานะต่อ
```

> โหมด test (`PAYMENT_MODE=test`): ใช้ `POST /api/test-payments/simulate`
> `{ "orderNumber": "DM-...", "outcome": "paid"|"failed" }` เพื่อจำลองผลชำระ
> ซึ่งยังผ่าน webhook pipeline ชุดเดียวกับโหมด live

---

## Download (คลังสินค้า/ดาวน์โหลด)

| เมธอด | path | ต้อง login | หมายเหตุ |
|-------|------|-----------|---------|
| GET | `/api/library` | ✓ | สินค้าที่ซื้อแล้วของฉัน (ไม่เผย storage_key) |
| GET | `/api/downloads` | ✓ | ประวัติดาวน์โหลดของฉัน |
| POST | `/api/downloads/:productId` | ✓ | ออก Signed URL ที่มีอายุ (rate limited) |
| GET | `/api/downloads/:downloadId/status` | ✓ | สถานะการดาวน์โหลด |
| GET | `/api/downloads/:downloadId/file?token=...` | ✓ | **ส่งไฟล์จริง** (ตรวจ session + token + สิทธิ์) |

**ตัวอย่าง** `POST /api/downloads/:productId` → 201
```json
{
  "ok": true,
  "data": {
    "downloadId": 123,
    "url": "/api/downloads/123/file?token=...",
    "token": "...",
    "expiresInSeconds": 300,
    "fileName": "ebook.pdf",
    "fileSize": 1048576
  }
}
```
> `url` เป็น **relative path** เพื่อให้บราวเซอร์เรียกผ่าน origin เดิม (ส่ง session cookie ได้)
> ต้องนำ `token` ไปเป็น query string และต้อง login อยู่จึงดาวน์โหลดได้

---

## Webhook (Payment Gateway → Backend)

| เมธอด | path | คุ้มครองด้วย |
|-------|------|-------------|
| POST | `/api/webhooks/payments/:provider` | ลายเซ็น HMAC ของ gateway (ไม่ใช้ session/CSRF) |

- `:provider` = `test` หรือ `opn`
- รับ raw body เพื่อตรวจลายเซ็น (`signature`) ก่อนดำเนินการ
- **idempotent**: webhook ซ้ำ (event เดิม) ไม่สร้างผลซ้ำ
- ตอบ `200` เมื่อประมวลผลแล้ว/ซ้ำ/ถูกปฏิเสธถาวร เพื่อกัน gateway retry ไม่รู้จบ
- ตอบ `403` เมื่อลายเซ็นผิด · `502` เมื่อชั่วคราว (ให้ gateway retry)

> เส้นนี้เป็น **หนทางเดียว** ที่ทำให้คำสั่งซื้อกลายเป็น `paid` และได้สิทธิ์ดาวน์โหลดในโหมด live

---

## Admin (ทุกเส้นต้อง `role=admin` จาก DB)

ทุกเส้นทางใต้ `/api/admin` ตรวจ `requireAdmin` — ผู้ใช้ทั่วไปได้ `403`

### Dashboard
| เมธอด | path | หมายเหตุ |
|-------|------|---------|
| GET | `/api/admin/dashboard/stats` | สถิติยอดขาย/คำสั่งซื้อ/สมาชิก |

### Categories & Products
| เมธอด | path | หมายเหตุ |
|-------|------|---------|
| POST | `/api/admin/categories` | สร้างหมวดหมู่ |
| GET | `/api/admin/products` | รายการสินค้า (กรอง/ค้นหา/เพจ) |
| POST | `/api/admin/products` | สร้างสินค้า |
| GET | `/api/admin/products/:id` | รายละเอียดสินค้า |
| PUT | `/api/admin/products/:id` | แก้ไขสินค้า |
| DELETE | `/api/admin/products/:id` | ลบสินค้า (soft delete) |
| POST | `/api/admin/products/:id/files` | อัปโหลดไฟล์สินค้า → **Private Storage** (multipart `files`, ≤5 ไฟล์/1GB) |
| DELETE | `/api/admin/products/:id/files/:fileId` | ลบไฟล์สินค้า |
| POST | `/api/admin/products/:id/cover` | อัปโหลดภาพปก → Public Storage (multipart `cover`) |
| POST | `/api/admin/products/:id/previews` | อัปโหลดภาพตัวอย่าง (multipart `previews`, ≤8) |

### Orders
| เมธอด | path | หมายเหตุ |
|-------|------|---------|
| GET | `/api/admin/orders` | รายการคำสั่งซื้อ (กรองสถานะ/วันที่/ค้นหา) |
| GET | `/api/admin/orders/:id` | รายละเอียดคำสั่งซื้อ |
| POST | `/api/admin/orders/:id/refund` | คืนเงิน (ต้อง `reason`) → ถอนสิทธิ์ดาวน์โหลด |
| POST | `/api/admin/orders/:id/mark-paid` | มาร์กชำระเอง (ต้อง `reason`  ≥10 ตัวอักษร พร้อมหลักฐาน) |

### Users
| เมธอด | path | หมายเหตุ |
|-------|------|---------|
| GET | `/api/admin/users` | รายการสมาชิก |
| GET | `/api/admin/users/:id` | รายละเอียดสมาชิก |
| POST | `/api/admin/users/:id/status` | ตั้งสถานะ `active`/`suspended` |

### Coupons
| เมธอด | path | หมายเหตุ |
|-------|------|---------|
| GET | `/api/admin/coupons` | รายการคูปอง |
| POST | `/api/admin/coupons` | สร้างคูปอง (`percent`/`fixed`) |
| PATCH | `/api/admin/coupons/:id` | เปิด/ปิดใช้งานคูปอง |

### Reviews & Audit
| เมธอด | path | หมายเหตุ |
|-------|------|---------|
| GET | `/api/admin/reviews` | รายการรีวิวทั้งหมด |
| DELETE | `/api/admin/reviews/:reviewId` | ลบรีวิว |
| GET | `/api/admin/audit-logs` | Audit log (กรอง action/เพจ) |

**ตัวอย่าง** `POST /api/admin/orders/:id/refund`
```json
// request
{ "reason": "ลูกค้าขอคืนเงินภายใน 7 วัน" }
// response 200 → order = refunded + สิทธิ์ดาวน์โหลดถูกถอน
```

---

## ตัวอย่างการเรียกจาก Frontend

Frontend ใช้ `client/src/api.js` ซึ่งจัดการ CSRF + credentials ให้อัตโนมัติ:

```js
import { apiGet, apiPost } from './api';

// ดึง CSRF token ก่อน POST/PATCH/DELETE
const { token } = await apiGet('/api/csrf');

// สร้างคำสั่งซื้อ
const data = await apiPost('/api/checkout', {
  items: [{ productId: 1, quantity: 1 }],
});
```

> ทุกคำขอแนบ `credentials` (cookie session) และ `X-CSRF-Token` ให้อัตโนมัติ
> จึงไม่ต้องจัดการเองในแต่ละหน้า

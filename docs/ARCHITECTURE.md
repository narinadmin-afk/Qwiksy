# สถาปัตยกรรมระบบ (Architecture)

ภาพรวมชั้นระบบ, การไหลของข้อมูล และการตัดสินใจเชิงออกแบบของเว็บแอปขายสินค้าดิจิทัล

## 1. หลักการออกแบบ

| หลัก | ผลที่ได้ |
|------|-----------|
| **แยกชั้นระบบชัดเจน** | Frontend (React) ไม่รู้ Database/Storage โดยตรง — คุยกับ Backend ผ่าน `/api` เท่านั้น |
| **ชำระเงินก่อนดาวน์โหลด** | สิทธิ์ดาวน์โหลดถูกสร้างจาก Webhook ยืนยันการชำระเงิน **เท่านั้น** ไม่มีทางลัด |
| **ไม่มี secret ใน Frontend** | OAuth/Payment secret อยู่ฝั่ง Backend เท่านั้น (env) ฝั่ง browser ไม่มีวันเห็น |
| **ตรวจทุกอย่างฝั่งเซิร์ฟเวอร์** | ราคา/ส่วนลด/สิทธิ์คำนวณจาก Backend เสมอ ห้ามเชื่อค่าจาก client |
| **ไฟล์ลับไม่เปิดเผยที่อยู่จริง** | ดาวน์โหลดผ่าน signed URL ชั่วคราวเท่านั้น ไม่มี static mount ของ private storage |

## 2. ชั้นระบบ (System Layers)

### Frontend — `client/` (React + Vite, port 5173)
- SPA พูดคุยกับ Backend ผ่าน `/api` (มี dev proxy ในโหมดพัฒนา)
- เก็บตะกร้าสินค้าใน `localStorage` (ยังไม่ผูกกับบัญชี)
- คงสถานะการล็อกอินไว้ใน cookie session (`dmp_sid`) ที่ Backend เป็นคนตั้ง (httpOnly)
- จัดการ CSRF token จาก cookie `csrf_token` แนบไปทุกคำขอที่ไม่ใช่ GET

### Backend — `server/` (Express, port 4000)
โครงสร้างภายในแบบ MVC หลวมๆ:

```
routes/         → จับ HTTP path/method + validation (zod) + middleware (auth/rate-limit/csrf)
controllers/    → แปลง request → เรียก service → สร้าง response (บางเส้นเรียก service ตรงๆ)
services/       → ตรรกะธุรกิจทั้งหมด (checkout, payment, webhook, download, catalog, admin, storage)
middleware/     → auth (session→user), csrf, rateLimit, validate, security (helmet/cors)
db/             → MySQL pool (mysql2), migrate, seed
config/         → อ่าน + validate environment variables
storage/        → public/ (ภาพปก) และ private/ (ไฟล์สินค้า ดาวน์โหลดผ่าน signed URL เท่านั้น)
```

### Database — MySQL
- เก็บทั้งข้อมูลธุรกิจและ **session** (ตาราง `sessions` ผ่าน `express-mysql-session`)
- ธุรกรรมสำคัญ (checkout, webhook) ใช้ transaction เพื่อให้ข้อมูลสอดคล้องกัน
- รายละเอียดผังตาราง: [DATABASE.md](DATABASE.md)

### File Storage
- **Public (`storage/public/`)**: ภาพปก/ภาพตัวอย่างสินค้า เสิร์ฟผ่าน `/uploads/...`
- **Private (`storage/private/`)**: ไฟล์สินค้าที่ซื้อแล้วเท่านั้นที่เข้าถึงได้
  - ไม่มี static mount → เข้าถึงได้ผ่าน `streamFile` ที่ตรวจ session + signed token เท่านั้น
  - path traversal ถูกบล็อกโดย `storageService` (resolve แล้วขึ้นต้นด้วย private dir เท่านั้น)

## 3. การไหลของข้อมูลที่สำคัญ

### 3.1 Checkout → ชำระเงิน → ได้สิทธิ์ดาวน์โหลด

```
ผู้ใช้             Frontend            Backend                Payment Gateway
  │  เลือกซื้อ →  POST /api/checkout →  สร้าง order (pending)
  │                              │     สร้าง payment (pending)
  │                              │     เรียก gateway สร้าง charge/QR
  │  ← หน้าจ่ายเงิน (QR/สถานะ)   ←     ← ข้อมูล QR + สถานะ
  │                                    ...
  │                              │     ◀── Webhook (ลายเซ็น HMAC) ──  ยืนยันชำระเงิน
  │                              │        ตรวจลายเซ็น → mark paid (transaction)
  │                              │        สร้างสิทธิ์ดาวน์โหลด (user_library)
  │  ← หน้าสำเร็จ               ←
  │  ไปคลังสินค้า → ดาวน์โหลดได้
```

**จุดสำคัญ:** การยืนยันว่า "ชำระเงินแล้ว" เกิดจาก **Webhook ที่ตรวจสอบลายเซ็นถูกต้องเท่านั้น**
ไม่มีเส้นทางใดที่ client สั่ง "มาร์กว่าจ่ายแล้ว" ได้โดยตรง (ในโหมด live)
(โหมด test มี `/api/test-payments/simulate` สำหรับสาธิต/ทดสอบ ซึ่งยังผ่าน
pipeline webhook จริงของระบบเพื่อไม่ให้โค้ด paths ต่างกัน)

### 3.2 การดาวน์โหลดไฟล์ที่ซื้อแล้ว

```
ผู้ใช้        Frontend                         Backend                    Private Storage
  │  กดดาวน์โหลด → POST /api/downloads/:productId
  │                              │  ตรวจสิทธิ์ (user_library: active + ยังไม่ครบโควตา)
  │                              │  สร้าง signed token (HMAC + exp) + บันทึก download_logs
  │                              │  นับจำนวนครั้ง (กันยิงซ้ำพร้อมกัน)
  │  ← ได้ URL ที่มีอายุ {url, token, exp}  ←
  │  GET {url}?token=...  →      │  ตรวจ token (ลายเซ็น + exp) + session + สิทธิ์อีกครั้ง
  │                              │  ── stream ──►  อ่านไฟล์จาก private dir → ส่งให้ผู้ใช้
  │                              │  บันทึก bytes_sent + completed
```

- Signed URL **หมดอายุ** (ค่าเริ่มต้น 300 วินาที) และผูกกับ downloadId/userId/fileId
- ตรวจสิทธิ์ซ้ำอีกครั้งตอนส่งไฟล์ (กัน token ที่ยังไม่หมดอายุแต่สิทธิ์ถูกถอนไปแล้ว)
- ทุกครั้ง (ทั้งสำเร็จ/ถูกปฏิเสธ) บันทึกลง `download_logs` เพื่อ audit

### 3.3 การคืนเงิน (Refund)
- แอดมินสั่งคืนเงิน → Backend mark order = refunded → **ถอนสิทธิ์ดาวน์โหลด** (`revokeEntitlements`)
  (นโยบาย `REVOKE_DOWNLOADS_ON_REFUND`) เพื่อไม่ให้ดาวน์โหลดได้ต่อหลังคืนเงิน

## 4. โมเดลความปลอดภัย

| ภัยคุกคาม | วิธีป้องกัน |
|-----------|-------------|
| ** CSRF ** | คู่ cookie session + `X-CSRF-Token` ที่ต้องตรงกับ session (Double Submit) |
| ** Session fixation ** | regenerate session ใหม่ทุกครั้งที่ login สำเร็จ |
| ** XSS ** | httpOnly cookie (JS อ่าน session ไม่ได้), output encoding ฝั่ง React |
| ** brute-force ** | rate limit ราย IP (login, checkout, download, ทั่วไป) |
| ** path traversal ** | resolve ทุก path แล้วบังคับขึ้นต้นด้วย allowed root เท่านั้น |
| ** payment tampering ** | ตรวจลายเซ็น HMAC ของ webhook, ไม่ไว้ใจข้อมูลจาก client |
| ** hotlink/ขโมยไฟล์ ** | signed URL อายุจำกัด + ตรวจ session + ตรวจสิทธิ์ซ้ำ + ไม่มี static mount |
| ** secret รั่วฝั่ง browser ** | secret ทั้งหมดอยู่ env ฝั่ง Backend เท่านั้น |
| ** clickjacking / MIME ** | security headers (X-Frame-Options, X-Content-Type-Options: nosniff) |

## 5. การตัดสินใจเชิงออกแบบ (Design Decisions)

### ทำไมยืนยันการชำระเงินผ่าน Webhook เท่านั้น
การให้ Frontend ยืนยัน "จ่ายแล้ว" จะเปิดช่องให้ปลอมแปลงได้ (เปิด DevTools แล้วยิง POST)
Gateway ที่เชื่อถือได้จะยืนยันผ่าน server-to-server webhook พร้อมลายเซ็น HMAC
Backend จึงตรวจสอบลายเซ็นก่อนดำเนินการเสมอ และออกแบบให้ **idempotent** (webhook ซ้ำไม่สร้างผลซ้ำ)
เพราะ gateways มักส่งซ้ำเมื่อไม่ได้รับ response ทันเวลา

### ทำไมใช้ session (cookie) แทน JWT ฝั่ง client
- สินค้าดิจิทัลต้องการเพิกถอนสิทธิ์ได้ทันที (คืนเงิน/ระงับบัญชี) → session ฝั่งเซิร์ฟเวอร์เพิกถอนได้ทันที
- ลดพื้นที่ attack surface (ไม่มี token ยาวๆ ใน localStorage ที่ XSS ขโมยได้)
- cookie เป็น `httpOnly` จึงป้องกันการขโมย session ด้วย script

### ทำไมราคา/ส่วนลดคำนวณที่ Backend เท่านั้น
การให้ Frontend ส่ง "ราคาที่คำนวณเอง" มาจะถูกดัดแปลงได้ (แก้ตัวเลขใน request)
Backend จึงดึงราคาสินค้า + คำนวณส่วนลด/คูปองใหม่ทุกครั้งตอน checkout และ quote

### ทำไมแยก private/public storage
ไฟล์ที่ผู้ใช้จ่ายเงินซื้อต้องไม่เข้าถึงได้ก่อนชำระ → ห้ามอยู่ใต้ public mount
ภาพปกสินค้าต้องแสดงแก่ทุกคน → อยู่ใต้ public mount เพื่อเสิร์ฟตรงด้วย static

### ทำไมโหมด test ยังผ่าน webhook pipeline จริง
`/api/test-payments/simulate` ไม่ได้มาร์ก order ตรงๆ แต่สร้าง event แล้วส่งผ่าน
`webhookService.handleWebhook` ชุดเดียวกับโหมด live เพื่อให้:
- โค้ด path เดียว ลดความเสี่ยงที่ live มี bug ที่ test ไม่พบ
- ทดสอบ idempotency/การยืนยันได้จริงใน dev และ CI

## 6. ไดเรกทอรีเซอร์วิส

| องค์ประกอบ | ที่อยู่ | หมายเหตุ |
|-----------|--------|---------|
| Frontend | `client/` | React + Vite |
| Backend | `server/` | Express |
| Database | MySQL | `DB_*` ใน `.env` |
| Public storage | `server/storage/public/` | ภาพปก/ตัวอย่าง |
| Private storage | `server/storage/private/` | ไฟล์สินค้า (ดาวน์โหลดผ่าน signed URL เท่านั้น) |

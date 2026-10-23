# ดิจิสโตร์ — เว็บแอปขายสินค้าดิจิทัล (Digital Products E-Commerce)

เว็บแอปขายสินค้าดิจิทัล (eBook, เทมเพลต, ไฟล์กราฟิก, เสียง/วิดีโอ, คอร์สเรียน, ไฟล์ ZIP)
ที่ **ชำระเงินก่อนดาวน์โหลดได้เท่านั้น** รองรับมือถือ ภาษาไทย + สกุลเงิน THB
และแยกชั้นระบบ Frontend / Backend / Database / File Storage อย่างชัดเจน

## ภาพรวมสถาปัตยกรรม

```
┌────────────────┐     HTTPS/HTTP      ┌─────────────────┐      ┌──────────────┐
│   Frontend     │  ─────────────────► │    Backend      │ ───► │    MySQL     │
│ React + Vite   │   /api  (JSON)      │  Express (Node) │      │  (sessions,  │
│ (port 5173)    │ ◄─────────────────  │   (port 4000)   │      │   ตารางธุรกิจ) │
└────────────────┘    cookie session   └────────┬────────┘      └──────────────┘
                                                │
                          ┌─────────────────────┼─────────────────────┐
                          ▼                     ▼                     ▼
                  ┌───────────────┐     ┌───────────────┐     ┌───────────────┐
                  │ Private       │     │ Public        │     │ Payment       │
                  │ Storage       │     │ Storage       │     │ Gateway       │
                  │ (ไฟล์สินค้าที่  │     │ (ภาพปก,       │     │ (Webhook →    │
                  │  ดาวน์โหลด    │     │  ภาพตัวอย่าง)  │     │  ยืนยันการ    │
                  │  ผ่าน signed  │     │               │     │  ชำระเงิน)    │
                  │  URL เท่านั้น) │     │               │     │               │
                  └───────────────┘     └───────────────┘     └───────────────┘
```

- **Frontend:** React 18 + Vite + React Router พูดคุยกับ Backend ผ่าน `/api` (JSON + cookie session)
- **Backend:** Express (Node.js) จัดการ auth, checkout, payment, webhook, download, admin
- **Database:** MySQL เก็บทั้งข้อมูลธุรกิจ (products, orders, …) และ sessions
- **Private Storage:** ไฟล์สินค้าที่ซื้อแล้วเท่านั้นที่ดาวน์โหลดได้ ผ่าน **signed URL ที่มีอายุจำกัด**
- **Payment:** โหมด `test` (ระบบจำลอง ไม่มีเงินจริง) หรือ `live` (Opn Payments ผ่าน webhook)

> รายละเอียดทั้งหมด: [Architecture](docs/ARCHITECTURE.md) · [Database](docs/DATABASE.md) · [API](docs/API.md)

## คุณสมบัติหลัก

| กลุ่ม | รายละเอียด |
|------|-----------|
| **หน้าร้าน** | หน้าแรก (แนะนำ/ขายดี/ใหม่), รายการสินค้า + ค้นหา/กรอง/เรียง/เพจจิเนชัน, หน้าสินค้า + รีวิว |
| **ตะกร้า & Checkout** | ตะกร้า localStorage, คำนวณราคาจาก Backend เท่านั้น, คูปองส่วนลด |
| **ชำระเงิน** | PromptPay QR / บัตร (โหมด test จำลอง, โหมด live ใช้ Opn), ยืนยันผ่าน **Webhook เท่านั้น** |
| **ดาวน์โหลด** | ได้สิทธิ์เมื่อชำระสำเร็จ, signed URL หมดอายุ, จำกัดจำนวนครั้ง/วันหมดอายุ, ถอนสิทธิ์เมื่อคืนเงิน |
| **บัญชี** | สมัคร/เข้าสู่ระบบด้วย Google OAuth, โปรไฟล์, ประวัติการสั่งซื้อ, คลังสินค้าของฉัน |
| **แอดมิน** | Dashboard สถิติ, จัดการสินค้า/ไฟล์/ภาพปก, คำสั่งซื้อ (คืนเงิน/มาร์กชำระ), สมาชิก, คูปอง, รีวิว, Audit log |
| **ความปลอดภัย** | CSRF, rate limit, path-traversal guard, ตรวจลายเซ็น webhook, ไม่มี secret ใน Frontend |

## เริ่มต้นอย่างรวดเร็ว (Local)

```bash
# 1) ติดตั้ง dependency (workspace root)
npm install

# 2) ตั้งค่า environment
cp .env.example .env         # แล้วแก้ค่า DB / SESSION_SECRET / GOOGLE_* ตามต้องการ

# 3) migrate + seed ฐานข้อมูล
npm run migrate -w server
npm run seed -w server

# 4) รัน Backend (port 4000) และ Frontend (port 5173) พร้อมกัน
npm run dev
```

เปิด `http://localhost:5173` — โหมดชำระเงินเริ่มต้นเป็น `test` (มีป้าย TEST MODE, ไม่ใช้เงินจริง)

> ขั้นตอนละเอียด รวมถึงการตั้งค่า Google OAuth, Payment Gateway และ Private Storage:
> ดู [docs/SETUP.md](docs/SETUP.md) · Deploy ขึ้น Production: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## โครงสร้างไดเรกทอรี

```
.
├── client/                 # Frontend (React + Vite)
│   ├── src/
│   │   ├── pages/          # หน้าร้าน (home, product, cart, checkout, pay, account, library)
│   │   ├── admin/          # หน้าแอดมิน
│   │   ├── components/     # Layout, การ์ดสินค้า, สถานะ
│   │   ├── api.js          # ตัวเรียก API (จัดการ session + CSRF)
│   │   └── cart.js         # ตะกร้า (localStorage)
│   └── vite.config.js      # proxy /api → Backend
├── server/
│   ├── src/
│   │   ├── app.js          # ประกอบ Express app (middleware + routes)
│   │   ├── server.js       # เริ่ม server + connect DB
│   │   ├── config/         # อ่าน env + validate
│   │   ├── db/             # pool, migrate, seed
│   │   ├── middleware/     # auth, session, csrf, rateLimit, validate, security
│   │   ├── routes/         # auth, catalog, shop, download, webhook, admin
│   │   ├── controllers/    # จับ request → เรียก service
│   │   ├── services/       # ตรรกะธุรกิจ (checkout, payment, webhook, download, admin…)
│   │   ├── storage/        # public/ + private/ (ไฟล์สินค้า)
│   │   └── utils/          # errors, crypto, money
│   └── tests/              # ชุดทดสอบ (node --test)
├── docs/                   # เอกสารประกอบ
└── .env.example            # แม่แบบ environment variables
```

## โหมดการชำระเงิน

- **`PAYMENT_MODE=test`** (ค่าเริ่มต้น) — ใช้ Payment Provider แบบจำลอง ไม่มีเงินจริง
  หน้าจ่ายเงินมีป้าย "TEST MODE" ชัดเจน และ endpoint `/api/test-payments/simulate`
  จำลองผลชำระเพื่อให้ทดลอง flow ครบทั้งหมด (สำหรับ dev/สาธิต/ทดสอบอัตโนมัติ)
- **`PAYMENT_MODE=live`** — เชื่อม **Opn Payments** (พร้อมเพย์/บัตร) ยืนยันการชำระเงิน
  **ผ่าน Webhook ที่ตรวจสอบลายเซ็นเท่านั้น** ไม่มีการสร้างข้อมูลชำระเงินจริงปลอมในโหมดนี้

## ชุดทดสอบ

```bash
npm test -w server          # รันทดสอบทั้งหมด (node --test)
```

ครอบคลุม: auth (Google OAuth + session), checkout/ราคา/คูปอง, webhook (ลายเซ็น + idempotency),
download (signed URL + จำกัดครั้ง + path traversal), การแยกสิทธิ์ระหว่างผู้ใช้, และ admin

> ผลการทดสอบและ test case ทั้งหมด: [docs/TESTING.md](docs/TESTING.md)

## สิ่งที่ยังต้องตั้งค่า Credential / ทดสอบกับผู้ให้บริการจริง

ระบบทำงานได้ทันทีในโหมด `test` แต่ก่อนใช้งานจริงต้องตั้งค่า:

1. **Google OAuth** — สร้าง OAuth Client แล้วใส่ `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
   (ดู [docs/GOOGLE_OAUTH_SETUP.md](docs/GOOGLE_OAUTH_SETUP.md)) ยังไม่ตั้งจะยัง Login ด้วย Google ไม่ได้
2. **Payment Gateway (live)** — ใส่ `OPN_SECRET_KEY` / `OPN_PUBLIC_KEY` / `OPN_WEBHOOK_SECRET`
   แล้วตั้ง `PAYMENT_MODE=live` (ดู [docs/PAYMENT_GATEWAY_SETUP.md](docs/PAYMENT_GATEWAY_SETUP.md))
   **ต้องทดสอบ webhook กับผู้ให้บริการจริงก่อนเปิดรับเงินจริง**
3. **Private Storage จริง** — ปัจจุบันเก็บไฟล์บนดิสก์เซิร์ฟเวอร์ หากมีปริมาณไฟล์มากควรย้ายไป
   object storage (S3/R2) และปรับ `storageService` (ดู [docs/SETUP.md](docs/SETUP.md#private-storage))

> รายการฟังก์ชันที่ยังไม่ได้ทดสอบกับผู้ให้บริการจริง: [docs/TESTING.md](docs/TESTING.md#สิ่งที่ยังต้องทดสอบกับผู้ให้บริการจริง)

## เอกสารทั้งหมด

| เอกสาร | เนื้อหา |
|--------|---------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | สถาปัตยกรรม, การไหลของข้อมูล, การตัดสินใจเชิงออกแบบ |
| [DATABASE.md](docs/DATABASE.md) | ผังฐานข้อมูล, ความสัมพันธ์, indexes |
| [API.md](docs/API.md) | Endpoint ทั้งหมด (ร้องขอ/ตอบ/ข้อผิดพลาด) |
| [SETUP.md](docs/SETUP.md) | ตั้งค่า Google OAuth, Payment Gateway, Private Storage, Local |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deploy ขึ้น Production |
| [TESTING.md](docs/TESTING.md) | Test cases และผลการทดสอบ |

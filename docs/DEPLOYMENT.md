# Deploy ขึ้น Production

ภาพรวมการนำระบบขึ้นใช้งานจริง: build, environment, reverse proxy/HTTPS,
การจัดการ process และสิ่งที่ต้องตรวจสอบก่อนเปิดรับเงินจริง

> Backend เสิร์ฟ Frontend build (`client/dist`) บน origin เดียวกันในโหมด production
> จึง deploy ได้ด้วย process เดียว (ดูหัวข้อ 3)

## 1. สิ่งที่ต้องเตรียม

- MySQL 8+ (utf8mb4) พร้อมฐานข้อมูลและผู้ใช้สำหรับแอป
- Node.js 20+ และ npm
- โดเมน + HTTPS (ผ่าน reverse proxy เช่น Nginx/Caddy หรือระบบ hosting)
- พื้นที่เก็บไฟล์ (`server/storage/`) ที่ persist ได้ (มิฉะนั้นใช้ object storage — ดู [SETUP.md](SETUP.md#5-private-storage))

## 2. Build

```bash
# ติดตั้ง dependency
npm install

# ตั้งค่า production environment
cp .env.example .env        # แล้วแก้ทุกค่าตามหัวข้อ 3

# build Frontend -> client/dist
npm run build -w client

# migrate schema (production: รันเอง ไม่ auto-migrate)
npm run migrate -w server
```

> ใน production ระบบ **ไม่ auto-migrate** (ป้องกันไม่ให้ schema เปลี่ยนเองตอน deploy)
> ให้รัน `npm run migrate -w server` เป็นขั้นตอนชัดเจนตอน deploy

## 3. ตั้งค่า Production Environment

`NODE_ENV=production` จะเปิดพฤติกรรมเหล่านี้:
- บังคับ `SESSION_SECRET` ยาว ≥32 ตัวอักษร (ไม่งั้น server ไม่เริ่ม)
- `trust proxy` เพื่ออ่าน IP จริงหลัง reverse proxy
- เสิร์ฟ `client/dist` เป็น SPA (fallback ไป `index.html`)

```env
NODE_ENV=production
PORT=4000
APP_URL=https://example.com
API_URL=https://example.com
CORS_ORIGINS=https://example.com

DB_HOST=...
DB_PORT=3306
DB_USER=...
DB_PASSWORD=...
DB_NAME=digital_marketplace

SESSION_SECRET=<ค่าสุ่มยาวอย่างน้อย 32 ตัวอักษร>
COOKIE_SECURE=true
SESSION_TTL_DAYS=7

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=https://example.com/api/auth/google/callback
ADMIN_EMAILS=admin@example.com

PAYMENT_MODE=live
OPN_SECRET_KEY=...
OPN_PUBLIC_KEY=...
OPN_WEBHOOK_SECRET=...
OPN_CARD_ENABLED=false

DOWNLOAD_URL_TTL_SECONDS=300
REVOKE_DOWNLOADS_ON_REFUND=true
```

> จัดการ secret ผ่าน environment/secret manager ของ platform **ห้าม commit ไฟล์ `.env` จริง**

## 4. รัน Backend

```bash
npm run start -w server     # node src/server.js
```

ใช้ process manager (systemd / PM2 / platform process) เพื่อ:
- เริ่มใหม่อัตโนมัติเมื่อ crash หรือรีสตาร์ทเครื่อง
- จัดการ logs และ graceful shutdown (`SIGTERM` → ระบบปิดตัวเอง)

**ตัวอย่าง PM2:**
```bash
npm run start -w server --  # หรือกำหนด entry ตรงๆ
pm2 start server/src/server.js --name digistore
pm2 save && pm2 startup
```

## 5. Reverse Proxy + HTTPS

ตั้ง reverse proxy ชี้มาที่ Backend (`http://127.0.0.1:4000`) พร้อมเปิด HTTPS

**ข้อกำหนดสำคัญ:**
- **ส่ง `X-Forwarded-For` / `X-Forwarded-Proto`** เพื่อให้ rate limit อ่าน IP จริงและ cookie `secure` ทำงานถูกต้อง (Backend เปิด `trust proxy` ในโหมด production แล้ว)
- **Webhook ต้องไม่ผ่าน cache/ buffering ที่เปลี่ยน raw body** — ลายเซ็น HMAC คำนวณจาก raw body ต้นฉบับ ห้ามมีการ re-encode
- เพิ่ม `APP_URL` / `API_URL` / `CORS_ORIGINS` ให้เป็นโดเมน HTTPS จริง

## 6. ตั้งค่า Webhook (จำเป็นสำหรับโหมด live)

ที่ Opn dashboard สร้าง webhook ชี้ไป:
```
https://example.com/api/webhooks/payments/opn
```
แล้วนำ secret มาใส่ `OPN_WEBHOOK_SECRET`

> **ทดสอบ webhook กับผู้ให้บริการจริงก่อนเปิดรับเงินจริง** — ดูขั้นตอนที่
> [PAYMENT_GATEWAY_SETUP.md](PAYMENT_GATEWAY_SETUP.md#5-ขั้นตอนทดสอบก่อนเปิดรับเงินจริง)

## 7. พื้นที่เก็บไฟล์ (Storage)

- `server/storage/public/` (ภาพปก) และ `server/storage/private/` (ไฟล์สินค้า) ต้องเป็น
  path ที่ **persist** ข้ามการ deploy (mounted volume หรือ object storage)
- **ห้าม** mount `storage/private` เป็น static เด็ดขาด
- หากใช้ object storage (S3/R2) ให้ปรับ `storageService` ให้คืน signed URL แต่คงหลัก
  "Backend ตรวจสิทธิ์ก่อนออก URL" เหมือนเดิม

## 8. Health Check & ก่อนเปิดใช้

- เช็ค `GET /api/health` → ต้องตอบ `{ ok: true }` (ตอบ 503 ถ้า DB ล่ม)
- เข้า `https://example.com/login` → ปุ่ม Google login ต้องใช้งานได้
- ทดสอบซื้อจริงด้วยจำนวนเงินน้อยมากในโหมด live แล้วยืนยันว่า:
  - webhook เข้าและผ่านลายเซ็น
  - คำสั่งซื้อกลายเป็น `paid` อัตโนมัติ
  - ดาวน์โหลดไฟล์ได้จริง
  - คืนเงินแล้วสิทธิ์ถูกถอน

> รายการตรวจสอบครบทั้งหมด: [TESTING.md](TESTING.md)

## 9. เช็กลิสต์ก่อน Deploy

- [ ] `NODE_ENV=production` และ `SESSION_SECRET` สุ่มยาว ≥32 ตัวอักษร
- [ ] `COOKIE_SECURE=true` (อยู่หลัง HTTPS แล้ว)
- [ ] `APP_URL` / `API_URL` / `CORS_ORIGINS` ชี้โดเมน HTTPS จริง
- [ ] `npm run build -w client` แล้ว (`client/dist` มี `index.html`)
- [ ] `npm run migrate -w server` รันแล้ว
- [ ] Google OAuth redirect URI ตรงกับโดเมนจริง
- [ ] Payment webhook ชี้ production และทดสอบกับ gateway จริงแล้ว
- [ ] พื้นที่ `storage/` persist ข้าม deploy (หรือย้ายไป object storage แล้ว)
- [ ] มี process manager + logging + backup plan สำหรับ DB และไฟล์
- [ ] ตั้ง `ADMIN_EMAILS` และทดสอบเข้า `/admin` ได้

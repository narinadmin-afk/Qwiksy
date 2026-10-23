# คู่มือตั้งค่า (Setup)

ขั้นตอนตั้ค่าใช้งานครบทั้งระบบ: environment, การรัน Local, Google OAuth,
Payment Gateway และ Private Storage

## 1. Environment Variables

คัดลอกแม่แบบแล้วแก้ค่า:

```bash
cp .env.example .env
```

| ตัวแปร | จำเป็น | ค่าเริ่มต้น | หมายเหตุ |
|--------|--------|-----------|---------|
| `NODE_ENV` | – | `development` | `production` เมื่อขึ้นจริง |
| `PORT` | – | `4000` | พอร์ต Backend |
| `APP_URL` | ✓ prod | `http://localhost:5173` | ที่อยู่ Frontend (CORS + redirect หลัง login) |
| `API_URL` | ✓ prod | `http://localhost:4000` | ที่อยู่ Backend (สร้าง OAuth callback) |
| `CORS_ORIGINS` | ✓ | `http://localhost:5173` | Origin ที่อนุญาต (คั่นด้วย `,`) |
| `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME` | ✓ | ดู `.env.example` | การเชื่อมต่อ MySQL |
| `SESSION_SECRET` | ✓ prod | – | ค่าสุ่มยาว ≥32 ตัวอักษร |
| `COOKIE_SECURE` | prod | `false` | ตั้ง `true` เมื่ออยู่หลัง HTTPS |
| `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` | สำหรับ login | – | ดูหัวข้อ 3 |
| `ADMIN_EMAILS` | – | – | อีเมลที่ได้สิทธิ์ admin อัตโนมัติ (คั่นด้วย `,`) |
| `PAYMENT_MODE` | – | `test` | `test` (ระบบจำลอง) หรือ `live` (Opn) |
| `TEST_WEBHOOK_SECRET` | test | – | คีย์ตรวจลายเซ็น webhook ของโหมด test |
| `OPN_SECRET_KEY`/`OPN_PUBLIC_KEY`/`OPN_WEBHOOK_SECRET` | live | – | ดูหัวข้อ 4 |
| `DOWNLOAD_URL_TTL_SECONDS` | – | `300` | อายุ signed download URL |
| `REVOKE_DOWNLOADS_ON_REFUND` | – | `true` | ถอนสิทธิ์ดาวน์โหลดเมื่อคืนเงิน |
| `REVIEW_ENABLED` | – | `true` | เปิดระบบรีวิว |

> **ห้าม commit ไฟล์ `.env`** (อยู่ใน `.gitignore` แล้ว) — secret ต้องอยู่ฝั่ง Backend เท่านั้น

## 2. รันบนเครื่อง Local

```bash
# ติดตั้ง dependency (workspace root)
npm install

# ตั้งค่าฐานข้อมูล + session ใน MySQL ให้เรียบร้อยก่อน (ดูหัวข้อ 2.1)

# migrate schema + เติมข้อมูลตัวอย่าง
npm run migrate -w server
npm run seed -w server

# รัน Backend (4000) และ Frontend (5173) พร้อมกัน
npm run dev
```

เปิด `http://localhost:5173` — เริ่มต้นเป็นโหมด `test` (มีป้าย TEST MODE ไม่ใช้เงินจริง)

### 2.1 เตรียม MySQL

```sql
CREATE DATABASE digital_marketplace CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'marketplace'@'localhost' IDENTIFIED BY 'password_ของคุณ';
GRANT ALL PRIVILEGES ON digital_marketplace.* TO 'marketplace'@'localhost';
FLUSH PRIVILEGES;
```

> ตาราง `sessions` จะถูกสร้างอัตโนมัติโดย `express-mysql-session` ตอน runtime

### 2.2 บทบาท Admin

ผู้ใช้ที่ email อยู่ใน `ADMIN_EMAILS` จะได้ `role=admin` อัตโนมัติตอน login สำเร็จ
(หากยังไม่ได้ตั้ง Google OAuth ให้ insert user พร้อม `role='admin'` ตรงๆ ใน DB เพื่อเข้า `/admin` ทดสอบ)

---

## 3. ตั้งค่า Google OAuth

หน้า Login จะยังใช้ไม่ได้จนกว่าจะตั้งค่า OAuth Client — ดูรายละเอียดเต็มที่
[GOOGLE_OAUTH_SETUP.md](GOOGLE_OAUTH_SETUP.md)

**สรุปขั้นตอน:**

1. ไปที่ [Google Cloud Console](https://console.cloud.google.com/) → สร้างโปรเจกต์
2. เปิด **APIs & Services → OAuth consent screen** → ตั้ง External + เพิ่ม scope `email`, `profile`
3. ไปที่ **Credentials → Create Credentials → OAuth client ID** → ประเภท **Web application**
4. ตั้ง **Authorized redirect URIs** ให้ตรงกับ:
   - `http://localhost:4000/api/auth/google/callback` (dev)
   - `https://<โดเมน production>/api/auth/google/callback` (prod)
5. คัดลอก **Client ID** / **Client Secret** ใส่ `.env`:
   ```env
   GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-xxxx
   GOOGLE_CALLBACK_URL=http://localhost:4000/api/auth/google/callback
   ```
6. รีสตาร์ท Backend — ปุ่ม "เข้าสู่ระบบด้วย Google" จะถูกเปิดใช้งาน

> Backend ยืนยันตัวตนกับ Google **โดยตรง** (server-to-server) — ไม่มี secret ฝั่ง Frontend

---

## 4. ตั้งค่า Payment Gateway (Opn Payments)

ระบบมี 2 โหมด (`PAYMENT_MODE`):

- **`test`** (ค่าเริ่มต้น): ใช้ Payment Provider แบบจำลอง ไม่มีเงินจริง
  เหมาะกับ dev/สาธิต/ทดสอบ — มี `/api/test-payments/simulate` ให้ลอง flow ครบวงจร
- **`live`**: เชื่อม **Opn Payments** จริง ยืนยันผ่าน Webhook ที่ตรวจสอบลายเซ็น

> ขั้นตอนละเอียด: [PAYMENT_GATEWAY_SETUP.md](PAYMENT_GATEWAY_SETUP.md)

**สรุปขั้นตอน (live):**

1. สร้างบัญชี [Opn Payments](https://opnpayments.com/) แล้วเปิดใช้พร้อมเพย์/บัตร
2. สร้าง **Webhook endpoint** ชี้ไปที่ `https://<โดเมน production>/api/webhooks/payments/opn`
   แล้วนำ **Webhook Secret** มาใส่ `.env`
3. นำ **Secret key** / **Public key** จากแดชบอร์ด Opn มาใส่:
   ```env
   PAYMENT_MODE=live
   OPN_SECRET_KEY=secret_xxx
   OPN_PUBLIC_KEY=pk_xxx
   OPN_WEBHOOK_SECRET=whsec_xxx
   ```
4. ตั้ง `OPN_CARD_ENABLED=true` หากต้องการรับบัตรเครดิต (ต้องตั้ง Opn.js ฝั่ง Frontend)
5. รีสตาร์ท Backend แล้ว **ทดสอบ webhook กับผู้ให้บริการจริงก่อนเปิดรับเงินจริง**

> **สำคัญ:** ห้ามเปิด `PAYMENT_MODE=live` ใน Production ก่อนที่จะทดสอบ end-to-end กับ
> gateway จริงเรียบร้อยแล้ว การยืนยันการชำระเงินในโหมด live เกิดจาก **Webhook เท่านั้น**

---

## 5. Private Storage

ระบบแยกพื้นที่เก็บไฟล์ชัดเจน:

| ชนิด | ที่อยู่ | เข้าถึง |
|------|--------|--------|
| **Public** | `server/storage/public/` | ภาพปก/ภาพตัวอย่าง ผ่าน `/uploads/...` |
| **Private** | `server/storage/private/` | ไฟล์สินค้า — **ดาวน์โหลดผ่าน signed URL ที่ Backend ตรวจสิทธิ์เท่านั้น** |

**หลักสำคัญ:**
- ห้าม mount `private/` เป็น static เด็ดขาด — ต้องผ่าน `streamFile` ที่ตรวจ
  session + signed token + สิทธิ์ดาวน์โหลดเท่านั้น
- ทุก path ถูก resolve แล้วบังคับขึ้นต้นด้วย private dir (กัน path traversal)
- นามสกุลไฟล์ถูก whitelist (`ALLOWED_PRODUCT_EXTS` / `ALLOWED_IMAGE_EXTS`)

**สำหรับ Production หรือปริมาณไฟล์มาก:** พิจารณาย้ายไฟล์ไป object storage (เช่น S3 หรือ Cloudflare R2)
แล้วปรับ `storageService` ให้คืน signed URL จาก object storage แทนการ stream จากดิสก์
โดยยังคงหลัก "ตรวจสิทธิ์ที่ Backend ก่อนออก URL" เหมือนเดิม

---

## 6. ตัวแปร Rate Limit

| ตัวแปร | ค่าเริ่มต้น | หมายเหตุ |
|--------|-----------|---------|
| `RATE_LOGIN_MAX` | 10 | ครั้ง/15 นาที ต่อ IP (ล็อกอิน) |
| `RATE_CHECKOUT_MAX` | 30 | checkout + pay |
| `RATE_DOWNLOAD_MAX` | 30 | ออก signed URL |
| `RATE_GENERAL_MAX` | 300 | ทั่วไปใต้ `/api` |

---

## 7. เช็กลิสต์ก่อนใช้งานจริง

- [ ] `SESSION_SECRET` เป็นค่าสุ่มยาว ≥32 ตัวอักษร (production จะ fail ถ้าสั้นเกินไป)
- [ ] `COOKIE_SECURE=true` เมื่ออยู่หลัง HTTPS
- [ ] `CORS_ORIGINS` / `APP_URL` / `API_URL` ชี้โดเมน production ที่ถูกต้อง
- [ ] Google OAuth redirect URI ตรงกับโดเมนจริง
- [ ] Payment webhook ตั้งชี้ production และ **ทดสอบกับ gateway จริงแล้ว**
- [ ] `ADMIN_EMAILS` ตั้งอีเมลแอดมินแล้ว
- [ ] สำรอง/วางแผน DB และพื้นที่เก็บไฟล์

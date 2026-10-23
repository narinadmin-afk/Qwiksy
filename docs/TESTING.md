# การทดสอบ (Testing)

ผลการทดสอบจริงของระบบและรายการ test case ที่ครอบคลุม

## 1. วิธีรันชุดทดสอบ

```bash
npm test -w server      # node --test --test-concurrency=1 --test-force-exit "tests/*.test.js"
```

ชุดทดสอบรันบน **test database แยกต่างหาก** (ไม่แตะข้อมูลจริง) และใช้ **provider แบบจำลอง** —
ไม่มีการสร้างข้อมูลชำระเงินจริงปลอม และไม่เรียก gateway จริงใดๆ

## 2. ผลการทดสอบ (ผลลัพธ์จริงล่าสุด)

```
▶ Google OAuth login
▶ Cart & Checkout (server-side pricing)
▶ Webhook security & payment confirmation
▶ Secure downloads
▶ Cross-user isolation
▶ Admin dashboard & moderation

ℹ tests 51
ℹ suites 6
ℹ pass 51
ℹ fail 0
ℹ duration_ms ~4900
```

**ผ่านทั้งหมด 51/51**

## 3. ครอบคลุม Test Case ตามข้อกำหนด

| กลุ่ม | ไฟล์ | จำนวน | ครอบคลุม |
|-------|------|-------|----------|
| Auth / OAuth | `01-auth.test.js` | 8 | login สำเร็จ, admin จาก `ADMIN_EMAILS`, state ผิดถูกปฏิเสธ (login CSRF), อีเมลไม่ยืนยันถูกปฏิเสธ, logout ทำลาย session, บัญชีถูกระงับ, 401 เมื่อไม่ login, POST ไม่มี CSRF ถูกปฏิเสธ |
| Checkout / ราคา | `02-checkout.test.js` | 7 | quote คำนวณจาก DB ไม่เชื่อ client, order มี snapshot ราคา, เลขคำสั่งซื้อไม่ซ้ำ, คูปอง percent ถูกต้อง + redemptions, คูปองผิด/หมดอายุรายงาน couponError, สินค้าไม่เปิดขายถูกปฏิเสธ, เดาเลขข้ามผู้ใช้ 404 |
| Webhook / ชำระเงิน | `03-webhook.test.js` | 9 | ชำระสำเร็จผ่าน webhook จริง, **webhook ซ้ำไม่สร้างผลซ้ำ (idempotency)**, ลายเซ็นปลอม 403, ยอดเงินไม่ตรงไม่ปลดล็อก, charge ปลอมไม่ปลดล็อก, gateway ล่มตอน checkout → retry ได้, webhook มาช้าหลังหมดอายุ, provider ผิด → 404, โหมด live บล็อก test provider |
| Secure Downloads | `04-downloads.test.js` | 8 | ยังไม่ชำระ → 403 + log, ไม่ login → ห้ามออก URL/อ่านไฟล์, **ชำระแล้ว → signed URL ใช้ได้จริง (5 นาที)**, แก้ URL/token ทุกรูปแบบถูกปฏิเสธ (รวม path traversal), เปลี่ยน downloadId ข้ามคน 403/404, **คืนเงิน → ดาวน์โหลดไม่ได้ + สิทธิ์ถูกถอน**, จำกัดจำนวนครั้ง (max_downloads=2), library เฉพาะของตัวเอง |
| Cross-user Isolation | `05-isolation.test.js` | 8 | เดาเลขคำสั่งซื้อข้ามคน 404, simulate จ่ายเงินข้ามคน 404, ใช้ signed URL ข้ามคนถูกปฏิเสธ, ยังไม่ซื้อขอลิงก์ถูกปฏิเสธ, My Library แยกกัน, แก้โปรไฟล์ยัด role/email ไม่ได้, ไม่เห็นคำสั่งซื้อข้ามคน, รีวิวเฉพาะผู้ซื้อ + 1 ครั้ง |
| Admin | `06-admin.test.js` | 11 | ผู้ใช้ธรรมดา/ไม่ login เข้า admin ไม่ได้ (403/401), เพิ่มสินค้า + อัปโหลดเข้า Private Storage, อัปโหลดนามสกุลผิด 400, dashboard สถิติถูกต้อง, mark-paid ต้องมีเหตุผล + audit log, คืนเงินเรียกผ่าน provider + ถอนสิทธิ์ + audit, คืนเงิน order ไม่ใช่ paid → 409, ระงับผู้ใช้ → ใช้ API ต่อไม่ได้ + audit, คูปองสร้าง/ปิด/ใช้ได้, ลบสินค้า = soft delete (order เดิมอยู่ดี), audit log ย้อนหลัง |

### จุดสำคัญที่ได้รับการยืนยัน

- **ชำระเงินก่อนดาวน์โหลด**: ดาวน์โหลดได้เฉพาะเมื่อ webhook ยืนยันชำระสำเร็จเท่านั้น
- **Webhook idempotent**: การส่งซ้ำไม่สร้างสิทธิ์/ธุรกรรมซ้ำ
- **ลายเซ็น/ยอดเงิน**: ลายเซ็นปลอมและยอดไม่ตรงถูกปฏิเสธ ไม่ปลดล็อก
- **Signed URL (มีอายุ) + path traversal**: URL มีอายุจำกัด, แก้ไขถูกปฏิเสธทุกกรณี, ไม่มี static mount ของ private storage
- **คืนเงิน**: ถอนสิทธิ์ดาวน์โหลดทันที
- **การแยกสิทธิ์**: ผู้ใช้หนึ่งคนเข้าถึงข้อมูล/ไฟล์ของอีกคนไม่ได้ทุกช่องทาง
- **CSRF / OAuth state**: คุ้มครอง CSRF และ login CSRF ครบทุกเส้น

> หมายเลข "เทสต์เคส N" ในชื่อ test อ้างอิง test case ในข้อกำหนดโครงการ

## 4. การทดสอบผ่าน Browser (Manual QA)

ตรวจสอบด้วยเบราว์เซอร์จริงบน Frontend (dev: Vite proxy → Backend):

- [x] หน้าแรก: hero, หมวดหมู่, สินค้าแนะนำ/ขายดี/ใหม่, ค้นหา
- [x] รายการสินค้า: กรองตามหมวด, เรียง, เพจจิเนชัน
- [x] หน้าสินค้า: รายละเอียด, ราคา/ส่วนลด, รีวิว, ปุ่ม "ซื้อเลย"/"เพิ่มลงตะกร้า"
- [x] ตะกร้า: แก้จำนวน, คำนวณราคาจากเซิร์ฟเวอร์, ใช้คูปอง
- [x] Checkout → หน้าจ่ายเงิน (PromptPay QR + ป้าย TEST MODE)
- [x] จ่ายเงินสำเร็จ (จำลอง) → หน้าสำเร็จ → ไปคลังสินค้า
- [x] คลังสินค้า (My Library): ดาวน์โหลดไฟล์ได้จริง (ไฟล์เปิดได้)
- [x] บัญชี: โปรไฟล์, ประวัติการสั่งซื้อ
- [x] Login หน้า: สถานะ "ยังไม่ได้ตั้งค่า Google OAuth" แสดงถูกต้องเมื่อยังไม่ได้ตั้งค่า
- [x] Responsive: ทดสอบความกว้างมือถือ (≈375px) ถึง desktop — การ์ดสินค้า, เมนู, checkout ใช้งานได้
- [x] แอดมิน: Dashboard สถิติ, เพิ่มสินค้า+อัปโหลดไฟล์/ภาพปก, คืนเงิน, มาร์กชำระ, ระงับผู้ใช้, คูปอง, audit log

> **ข้อสังเกตที่แก้แล้ว:** ระหว่าง QA พบว่า signed download URL แบบ absolute
> (`http://localhost:4000/...`) ทำให้ cookie session ไม่ถูกส่งข้าม host → ดาวน์โหลดไม่ได้
> แก้เป็น **relative URL** เพื่อให้เรียกผ่าน origin เดิม (ผ่าน proxy ใน dev / โดเมนเดียวกันใน prod)

## 5. สิ่งที่ยังต้องทดสอบกับผู้ให้บริการจริง

ระบบทำงานครบในโหมด `test` แล้ว แต่ก่อนเปิดรับเงินจริงต้องทดสอบกับ gateway จริง:

| รายการ | เหตุผล |
|--------|--------|
| **Webhook จาก Opn จริง** | ต้องยืนยันลายเซ็น + ยอดเงินกับ payload จริงของผู้ให้บริการ |
| **PromptPay QR จริง** | สแกนจ่ายจริงแล้วได้สิทธิ์ดาวน์โหลดอัตโนมัติ |
| **บัตรเครดิต (ถ้าเปิด)** | tokenization ผ่าน Opn.js + 3DS (ถ้ามี) + ผลชำระจริง |
| **Refund จริง** | คืนเงินผ่าน Opn แล้วถอนสิทธิ์ + เช็คยอดคืน |
| **Google OAuth จริง** | Login ด้วยบัญชี Google จริง (redirect URI, scopes, email verified) |
| **Webhook retry จริง** | ยืนยัน idempotency เมื่อผู้ให้บริการส่งซ้ำจริง |

> วิธีตั้งค่าและขั้นตอนทดสอบ: [PAYMENT_GATEWAY_SETUP.md](PAYMENT_GATEWAY_SETUP.md) · [GOOGLE_OAUTH_SETUP.md](GOOGLE_OAUTH_SETUP.md)

## 6. ข้อจำกัดของการทดสอบปัจจุบัน

- ชุดทดสอบอัตโนมัติใช้ **provider แบบจำลอง** — ยังไม่ได้ทดสอบกับ Opn/Google จริง (ดูหัวข้อ 5)
- ยังไม่มีการทดสอบ load/ performance และยังไม่มี E2E ด้วยเครื่องมืออย่าง Playwright/Cypress
  (ปัจจุบัน manual QA ผ่าน browser แทน)
- ยังไม่ได้ทดสอบการปรับขนาด object storage (S3/R2) — ปัจจุบันไฟล์อยู่บนดิสก์เซิร์ฟเวอร์

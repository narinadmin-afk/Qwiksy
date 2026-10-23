# ฐานข้อมูล (Database — MySQL)

ผังฐานข้อมูลทั้งหมด (utf8mb4 / InnoDB) และความสัมพันธ์ระหว่างตาราง
ไฟล์ migration จริง: [`server/src/db/migrations/001_init.sql`](../server/src/db/migrations/001_init.sql)

## 1. ภาพรวมตาราง

| ตาราง | หน้าที่ |
|-------|---------|
| `users` | บัญชีผู้ใช้ (สร้างจาก Google OAuth เท่านั้น ไม่มีรหัสผ่าน) |
| `product_categories` | หมวดหมู่สินค้า |
| `products` | สินค้าดิจิทัล (ราคา, ส่วนลด, สถานะ, นโยบายดาวน์โหลด) |
| `product_files` | ไฟล์ของสินค้า (ชี้ไป private storage — ห้ามเปิดเผย `storage_key` ทาง API) |
| `orders` | คำสั่งซื้อ (สแนปชอตราคา คำนวณจาก Backend เท่านั้น) |
| `order_items` | รายการสินค้าในคำสั่งซื้อ (เก็บ snapshot ชื่อ+ราคา ณ เวลาซื้อ) |
| `payments` | การชำระเงิน (สร้างจาก Backend เท่านั้น) |
| `payment_webhook_events` | Webhook ที่เคยได้รับ (idempotency กันประมวลผลซ้ำ) |
| `user_library` | สิทธิ์การใช้งาน/ดาวน์โหลด (My Library) |
| `download_logs` | ประวัติการดาวน์โหลด (ทุกครั้ง ทั้งสำเร็จและถูกปฏิเสธ) |
| `coupons` | คูปองส่วนลด |
| `coupon_redemptions` | การใช้คูปองต่อคำสั่งซื้อ |
| `reviews` | รีวิวสินค้า (เฉพาะผู้ที่ซื้อแล้ว) |
| `admin_audit_logs` | Audit log ของการกระทำสำคัญฝั่งแอดมิน |
| `sessions` | session ของผู้ใช้ (สร้างโดย `express-mysql-session`) |

## 2. ไดอะแกรมความสัมพันธ์

```
users ──┬──< orders ────────< order_items >──── products >── product_categories
        │      │                  │                 │
        │      ├──< payments      │                 └──< product_files
        │      ├──< coupon_redemptions >── coupons
        │      ├──< user_library >────────┘
        │      ├──< download_logs
        │      ├──< reviews
        │      └──< admin_audit_logs
        └──< (google_sub UNIQUE)
```

สัญลักษณ์: `──<` = one-to-many, `>────` = many-to-one

## 3. รายละเอียดตารางสำคัญ

### users
บัญชีมาจาก Google OAuth เท่านั้น (`google_sub` UNIQUE) — ไม่มีคอลัมน์รหัสผ่าน

| คอลัมน์ | หมายเหตุ |
|---------|---------|
| `google_sub` | รหัส Google (unique) ใช้ระบุตัวตน |
| `email_verified` | ต้องยืนยันอีเมลจาก Google แล้วเท่านั้นจึง login ได้ |
| `role` | `user` / `admin` (_ADMIN_EMAILS_ ใน env ได้สิทธิ์ admin อัตโนมัติ) |
| `status` | `active` / `suspended` (ระงับบัญชี = เข้าสู่ระบบไม่ได้) |

### products
| คอลัมน์ | หมายเหตุ |
|---------|---------|
| `price` / `discount_percent` | ราคาและส่วนลด — **Backend คำนวณตอน checkout เท่านั้น** |
| `status` | `draft` / `published` / `closed` |
| `max_downloads` | โควตาดาวน์โหลดต่อสิทธิ์ (NULL = ไม่จำกัด) |
| `download_expires_days` | อายุสิทธิ์หลังซื้อ (NULL = ไม่หมดอายุ) |
| `sales_count` / `rating_avg` / `rating_count` | ตัวนับ denormalized สำหรับจัดเรียง/แสดงผล |
| `deleted_at` | soft delete (ลบจริงไม่กระทบคำสั่งซื้อเดิม) |

### product_files
เก็บ metadata ไฟล์ที่ดาวน์โหลดได้ **`storage_key` เป็นข้อมูลภายในห้ามส่งออกทาง API**
(แสดงชื่อไฟล์/ขนาดได้ แต่ไม่เผย path จริง)

### orders + order_items
- `orders` เก็บยอดรวม (`subtotal`, `discount_amount`, `total`) ที่ Backend คำนวณ
- `order_items` เก็บ **snapshot** `product_title` / `unit_price` / `list_price` ณ เวลาซื้อ
  เพื่อให้ประวัติการซื้อ/ใบเสร็จคงที่แม้สินค้าจะแก้ราคาหรือชื่อภายหลัง
- `status`: `pending` → `paid` / `failed` / `expired` / `cancelled` / `refunded`

### payments + payment_webhook_events
- `payments` ถูกสร้างโดย Backend เท่านั้น (ไม่มีเส้นทาง client สร้างเอง)
- `payment_webhook_events` มี `UNIQUE(provider, event_id)` เพื่อ **idempotency**:
  webhook ซ้ำ (gateway ส่งซ้ำ) ไม่ทำให้เกิดผลซ้ำ
- `signature_valid` บันทึกว่า webhook ผ่านการตรวจลายเซ็นหรือไม่

### user_library (สิทธิ์ดาวน์โหลด)
- `UNIQUE(user_id, product_id)` กัน grant ซ้ำ
- เก็บ **snapshot** `max_downloads` / `expires_at` ณ เวลาซื้อ
  เพื่อให้นโยบายดาวน์โหลดคงที่แม้สินค้าจะเปลี่ยนนโยบายภายหลัง
- `revoked_at` / `revoked_reason`: ใช้ตอนคืนเงินเพื่อถอนสิทธิ์

### download_logs
บันทึก **ทุก** ความพยายามดาวน์โหลด (ทั้ง `issued`, `completed`, `denied`, `expired`, `failed`)
พร้อม `reason`, `ip`, `user_agent`, `bytes_sent` สำหรับ audit และตรวจสอบการละเมิด

### reviews
- `UNIQUE(product_id, user_id)` รีวิวได้ 1 ครั้งต่อสินค้าต่อผู้ซื้อ
- `CHECK (rating BETWEEN 1 AND 5)`
- ระบบอนุญาตให้รีวิวได้เฉพาะผู้ที่ซื้อสินค้านั้นแล้ว (ตรวจสอบฝั่ง Backend)

### admin_audit_logs
ทุกการกระทำสำคัญของแอดมิน (คืนเงิน, มาร์กชำระ, แก้/ลบสินค้า, ระงับผู้ใช้, คูปอง…)
เก็บ `before_data` / `after_data` (JSON) + `reason` + `ip` ย้อนหลังได้

## 4. การใช้ Transaction

ธุรกรรมที่ต้องการความสอดคล้องกัน (atomic) ได้แก่:
- **Checkout**: สร้าง order + order_items + payments พร้อมกัน ( rollback ถ้าข้อมูลไม่ครบ )
- **Webhook ยืนยันชำระเงิน**: mark order/paid + upsert payment + grant user_library + เพิ่ม sales_count
  ภายใน transaction เดียว และ guard ด้วย idempotency key
- **คืนเงิน**: mark refunded + revoke สิทธิ์ดาวน์โหลด

## 5. Index ที่สำคัญ

| ตาราง | Index | เพื่อ |
|-------|-------|------|
| `products` | `(status, deleted_at, published_at)` | กรองสินค้าที่เผยแพร่แล้ว |
| `products` | `(status, deleted_at, featured)` | สินค้าแนะนำหน้าแรก |
| `orders` | `(user_id, created_at)` | ประวัติการสั่งซื้อของผู้ใช้ |
| `orders` | `(status, expires_at)` | ค้นหา/หมดอายุคำสั่งซื้อ pending |
| `user_library` | `(user_id, granted_at)` | คลังสินค้าของฉัน |
| `download_logs` | `(user_id, product_id, created_at)` | นับ/ตรวจประวัติดาวน์โหลด |
| `payment_webhook_events` | `UNIQUE(provider, event_id)` | idempotency ของ webhook |

## 6. Charset / Collation

ทุกตารางใช้ `utf8mb4_unicode_ci` เพื่อรองรับข้อความไทยและอีโมจิอย่างครบถ้วน

## 7. หมายเหตุการ migrate

```bash
npm run migrate -w server     # รัน migration ทั้งหมด (idempotent — ใช้ CREATE TABLE IF NOT EXISTS)
npm run seed -w server        # เติมข้อมูลตัวอย่าง (หมวดหมู่/สินค้า/คูปอง) สำหรับ dev
```

> ตาราง `sessions` ถูกสร้างโดย `express-mysql-session` อัตโนมัติตอน runtime
> (ไม่อยู่ในไฟล์ migration หลัก)

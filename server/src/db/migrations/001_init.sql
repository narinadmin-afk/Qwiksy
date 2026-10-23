-- ============================================================
-- Digital Products Marketplace - MySQL Schema (utf8mb4)
-- ตารางทั้งหมด: users, product_categories, products, product_files,
-- orders, order_items, payments, payment_webhook_events, user_library,
-- download_logs, coupons, coupon_redemptions, admin_audit_logs, reviews
-- ============================================================

-- ---- ผู้ใช้ (สร้างจาก Google OAuth เท่านั้น ไม่มีรหัสผ่านในระบบ) ----
CREATE TABLE IF NOT EXISTS users (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  google_sub      VARCHAR(64)  NOT NULL,
  email           VARCHAR(255) NOT NULL,
  email_verified  TINYINT(1)   NOT NULL DEFAULT 0,
  display_name    VARCHAR(120) NOT NULL DEFAULT '',
  avatar_url      VARCHAR(512) NULL,
  role            ENUM('user','admin') NOT NULL DEFAULT 'user',
  status          ENUM('active','suspended') NOT NULL DEFAULT 'active',
  last_login_at   DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_google_sub (google_sub),
  KEY idx_users_email (email),
  KEY idx_users_role (status, role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- หมวดหมู่สินค้า ----
CREATE TABLE IF NOT EXISTS product_categories (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL,
  slug        VARCHAR(100) NOT NULL,
  description VARCHAR(255) NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_slug (slug),
  KEY idx_categories_sort (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- สินค้าดิจิทัล ----
CREATE TABLE IF NOT EXISTS products (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  category_id          BIGINT UNSIGNED NOT NULL,
  slug                 VARCHAR(160) NOT NULL,
  title                VARCHAR(200) NOT NULL,
  description          TEXT NULL,
  license_terms        TEXT NULL,
  price                DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  discount_percent     DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
  cover_image_url      VARCHAR(512) NULL,
  preview_images       JSON NULL,
  status               ENUM('draft','published','closed') NOT NULL DEFAULT 'draft',
  featured             TINYINT(1) NOT NULL DEFAULT 0,
  max_downloads        INT UNSIGNED NULL,  -- NULL = ไม่จำกัดจำนวนครั้ง
  download_expires_days INT UNSIGNED NULL, -- NULL = ไม่หมดอายุ
  sales_count          INT UNSIGNED NOT NULL DEFAULT 0,
  rating_avg           DECIMAL(3,2) NOT NULL DEFAULT 0.00,
  rating_count         INT UNSIGNED NOT NULL DEFAULT 0,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  published_at         DATETIME NULL,
  deleted_at           DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_slug (slug),
  KEY idx_products_cat (category_id),
  KEY idx_products_list (status, deleted_at, published_at),
  KEY idx_products_featured (status, deleted_at, featured),
  CONSTRAINT fk_products_category FOREIGN KEY (category_id)
    REFERENCES product_categories (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- ไฟล์สินค้า (เก็บใน Private Storage - ห้ามเปิดเผย storage_key ออก API) ----
CREATE TABLE IF NOT EXISTS product_files (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id    BIGINT UNSIGNED NOT NULL,
  storage_key   VARCHAR(255) NOT NULL, -- path สัมพัทธ์ใน private storage (ข้อมูลภายใน)
  original_name VARCHAR(255) NOT NULL,
  mime_type     VARCHAR(120) NOT NULL DEFAULT 'application/octet-stream',
  file_size     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  sort_order    INT NOT NULL DEFAULT 0,
  is_primary    TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_files_product (product_id, sort_order),
  CONSTRAINT fk_files_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- คูปอง ----
CREATE TABLE IF NOT EXISTS coupons (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code              VARCHAR(40) NOT NULL,
  type              ENUM('percent','fixed') NOT NULL DEFAULT 'percent',
  value             DECIMAL(10,2) NOT NULL,
  min_order_amount  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  max_uses          INT UNSIGNED NULL,       -- NULL = ไม่จำกัด
  max_uses_per_user INT UNSIGNED NULL,       -- NULL = ไม่จำกัด
  used_count        INT UNSIGNED NOT NULL DEFAULT 0,
  starts_at         DATETIME NULL,
  ends_at           DATETIME NULL,
  is_active         TINYINT(1) NOT NULL DEFAULT 1,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_coupons_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- คำสั่งซื้อ (สแนปชอตราคาถูกคำนวณจาก Backend เท่านั้น) ----
CREATE TABLE IF NOT EXISTS orders (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_number    VARCHAR(24) NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  status          ENUM('pending','paid','failed','expired','cancelled','refunded')
                    NOT NULL DEFAULT 'pending',
  currency        CHAR(3) NOT NULL DEFAULT 'THB',
  subtotal        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  total           DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  coupon_code     VARCHAR(40) NULL,
  coupon_id       BIGINT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  expires_at      DATETIME NULL,
  paid_at         DATETIME NULL,
  refunded_at     DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_number (order_number),
  KEY idx_orders_user (user_id, created_at),
  KEY idx_orders_status (status, expires_at),
  KEY idx_orders_created (created_at),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- รายการสินค้าในคำสั่งซื้อ (เก็บ snapshot ชื่อ+ราคา ณ เวลาซื้อ) ----
CREATE TABLE IF NOT EXISTS order_items (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id       BIGINT UNSIGNED NOT NULL,
  product_id     BIGINT UNSIGNED NOT NULL,
  product_title  VARCHAR(200) NOT NULL,   -- snapshot
  product_slug   VARCHAR(160) NOT NULL,   -- snapshot
  unit_price     DECIMAL(10,2) NOT NULL,  -- ราคาต่อหน่วยหลังส่วนลด ณ เวลาซื้อ
  list_price     DECIMAL(10,2) NOT NULL,  -- ราคาราก ณ เวลาซื้อ
  quantity       INT UNSIGNED NOT NULL DEFAULT 1,
  line_total     DECIMAL(12,2) NOT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_product (order_id, product_id),
  KEY idx_items_product (product_id),
  CONSTRAINT fk_items_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_items_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- การชำระเงิน (สร้างจาก Backend เท่านั้น) ----
CREATE TABLE IF NOT EXISTS payments (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id          BIGINT UNSIGNED NOT NULL,
  user_id           BIGINT UNSIGNED NOT NULL,
  provider          ENUM('test','opn') NOT NULL,
  provider_charge_id VARCHAR(191) NULL,     -- Gateway Transaction ID
  payment_reference VARCHAR(64) NOT NULL,   -- ตัวอ้างอิงภายใน
  amount            DECIMAL(12,2) NOT NULL,
  currency          CHAR(3) NOT NULL DEFAULT 'THB',
  method            VARCHAR(32) NULL,       -- promptpay / card
  status            ENUM('pending','paid','failed','expired','refunded')
                      NOT NULL DEFAULT 'pending',
  qr_type           VARCHAR(32) NULL,
  qr_payload        TEXT NULL,              -- ข้อมูล QR (ไม่ใช่ไฟล์ลับ)
  provider_response JSON NULL,
  failure_reason    VARCHAR(255) NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  paid_at           DATETIME NULL,
  expires_at        DATETIME NULL,
  refunded_at       DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_charge (provider, provider_charge_id),
  KEY idx_payments_order (order_id),
  KEY idx_payments_user (user_id, status),
  KEY idx_payments_status (status, expires_at),
  CONSTRAINT fk_payments_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE RESTRICT,
  CONSTRAINT fk_payments_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- Webhook ที่เคยได้รับ (Idempotency กันประมวลผลซ้ำ) ----
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider         VARCHAR(16)  NOT NULL,
  event_id         VARCHAR(191) NOT NULL,   -- unique กัน webhook ซ้ำ
  event_type       VARCHAR(80)  NOT NULL,
  charge_id        VARCHAR(191) NULL,
  payload          JSON NULL,
  signature_valid  TINYINT(1) NOT NULL DEFAULT 0,
  processed        TINYINT(1) NOT NULL DEFAULT 0,
  processing_error TEXT NULL,
  received_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_webhook_event (provider, event_id),
  KEY idx_webhook_received (received_at),
  KEY idx_webhook_charge (charge_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- สิทธิ์การใช้งาน (My Library) - กันซ้ำด้วย unique(user_id, product_id) ----
CREATE TABLE IF NOT EXISTS user_library (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        BIGINT UNSIGNED NOT NULL,
  product_id     BIGINT UNSIGNED NOT NULL,
  order_id       BIGINT UNSIGNED NOT NULL,
  source         ENUM('purchase','grant') NOT NULL DEFAULT 'purchase',
  download_count INT UNSIGNED NOT NULL DEFAULT 0,
  max_downloads  INT UNSIGNED NULL,   -- snapshot จากสินค้า ณ เวลาซื้อ (NULL=ไม่จำกัด)
  expires_at     DATETIME NULL,       -- snapshot วันหมดอายุสิทธิ์ (NULL=ไม่หมดอายุ)
  granted_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at     DATETIME NULL,
  revoked_reason VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_library_user_product (user_id, product_id),
  KEY idx_library_user (user_id, granted_at),
  KEY idx_library_order (order_id),
  KEY idx_library_product (product_id),
  CONSTRAINT fk_library_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_library_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE RESTRICT,
  CONSTRAINT fk_library_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- ประวัติการดาวน์โหลด (ทุกครั้ง ทั้งสำเร็จและถูกปฏิเสธ) ----
CREATE TABLE IF NOT EXISTS download_logs (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id          BIGINT UNSIGNED NOT NULL,
  product_id       BIGINT UNSIGNED NOT NULL,
  order_id         BIGINT UNSIGNED NULL,
  entitlement_id   BIGINT UNSIGNED NULL,
  status           ENUM('issued','completed','denied','expired','failed')
                     NOT NULL DEFAULT 'issued',
  reason           VARCHAR(255) NULL,
  token_expires_at DATETIME NULL,
  ip               VARCHAR(45) NULL,
  user_agent       VARCHAR(255) NULL,
  bytes_sent       BIGINT UNSIGNED NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at     DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_dl_user (user_id, product_id, created_at),
  KEY idx_dl_created (created_at),
  KEY idx_dl_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- รีวิวสินค้า (เฉพาะผู้ที่ซื้อแล้ว) ----
CREATE TABLE IF NOT EXISTS reviews (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  rating     TINYINT UNSIGNED NOT NULL,
  comment    TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_review_user_product (product_id, user_id),
  KEY idx_reviews_product (product_id, created_at),
  CONSTRAINT chk_review_rating CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT fk_reviews_product FOREIGN KEY (product_id)
    REFERENCES products (id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- การใช้คูปองต่อคำสั่งซื้อ ----
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  coupon_id       BIGINT UNSIGNED NOT NULL,
  order_id        BIGINT UNSIGNED NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  discount_amount DECIMAL(12,2) NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_redemption_coupon_order (coupon_id, order_id),
  KEY idx_redemption_user (user_id),
  CONSTRAINT fk_redemption_coupon FOREIGN KEY (coupon_id)
    REFERENCES coupons (id) ON DELETE RESTRICT,
  CONSTRAINT fk_redemption_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE RESTRICT,
  CONSTRAINT fk_redemption_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---- Audit Log ของ Admin (ทุกการกระทำสำคัญต้องบันทึกที่นี่) ----
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_user_id BIGINT UNSIGNED NULL,
  admin_email   VARCHAR(255) NOT NULL DEFAULT '',
  action        VARCHAR(60)  NOT NULL,   -- เช่น order.mark_paid, order.refund, product.create
  entity_type   VARCHAR(40)  NOT NULL,
  entity_id     VARCHAR(64)  NOT NULL,
  before_data   JSON NULL,
  after_data    JSON NULL,
  reason        VARCHAR(255) NULL,
  ip            VARCHAR(45) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_created (created_at),
  KEY idx_audit_admin (admin_user_id, created_at),
  KEY idx_audit_action (action, entity_type),
  CONSTRAINT fk_audit_admin FOREIGN KEY (admin_user_id)
    REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

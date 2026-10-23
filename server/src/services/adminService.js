import path from 'node:path';
import fs from 'node:fs';
import { pool, q, withTransaction } from '../db/pool.js';
import { config } from '../config/index.js';
import { errors } from '../utils/errors.js';
import { toCents, fromCents, discountedUnitCents } from '../utils/money.js';
import { slugify, randomToken } from '../utils/crypto.js';
import { getPaymentProvider } from './payments/provider.js';
import { grantEntitlements, revokeEntitlements } from './webhookService.js';
import { writeAudit } from './auditService.js';
import { resolvePrivatePath, removeFile } from './storageService.js';
import { toProductDTO } from './catalogService.js';

// ---------------- Dashboard ----------------

export async function getDashboardStats() {
  const [sales] = await q(
    `SELECT
       COALESCE(SUM(CASE WHEN DATE(paid_at) = CURDATE() THEN total END), 0) AS today_sales,
       COALESCE(SUM(CASE WHEN YEAR(paid_at) = YEAR(CURDATE()) AND MONTH(paid_at) = MONTH(CURDATE()) THEN total END), 0) AS month_sales,
       COALESCE(SUM(CASE WHEN status = 'paid' THEN total END), 0) AS total_revenue,
       SUM(status = 'paid') AS paid_count
     FROM orders`
  );
  const [counts] = await q(
    `SELECT
       COUNT(*) AS total_orders,
       SUM(status = 'pending') AS pending_orders,
       SUM(status = 'paid') AS paid_orders,
       SUM(status = 'refunded') AS refunded_orders,
       SUM(status IN ('failed','expired')) AS failed_orders
     FROM orders`
  );
  const [members] = await q(
    `SELECT COUNT(*) AS total_members,
            SUM(created_at >= CURDATE() - INTERVAL 7 DAY) AS new_members_7d
     FROM users`
  );
  const topProducts = await q(
    `SELECT p.id, p.title, p.slug, p.cover_image_url, p.sales_count,
            COALESCE(SUM(CASE WHEN o.status = 'paid' THEN oi.line_total END), 0) AS revenue
     FROM products p
     LEFT JOIN order_items oi ON oi.product_id = p.id
     LEFT JOIN orders o ON o.id = oi.order_id
     WHERE p.deleted_at IS NULL
     GROUP BY p.id
     ORDER BY revenue DESC, p.sales_count DESC
     LIMIT 5`
  );
  const pendingList = await q(
    `SELECT o.order_number, o.total, o.created_at, o.expires_at, u.email
     FROM orders o JOIN users u ON u.id = o.user_id
     WHERE o.status = 'pending'
     ORDER BY o.created_at ASC LIMIT 10`
  );

  return {
    todaySales: Number(sales.today_sales).toFixed(2),
    monthSales: Number(sales.month_sales).toFixed(2),
    totalRevenue: Number(sales.total_revenue).toFixed(2),
    paidCount: Number(sales.paid_count) || 0,
    totalOrders: Number(counts.total_orders) || 0,
    pendingOrders: Number(counts.pending_orders) || 0,
    paidOrders: Number(counts.paid_orders) || 0,
    refundedOrders: Number(counts.refunded_orders) || 0,
    failedOrders: Number(counts.failed_orders) || 0,
    totalMembers: Number(members.total_members) || 0,
    newMembers7d: Number(members.new_members_7d) || 0,
    topProducts: topProducts.map((p) => ({
      id: p.id,
      title: p.title,
      slug: p.slug,
      coverImageUrl: p.cover_image_url,
      salesCount: p.sales_count,
      revenue: Number(p.revenue).toFixed(2),
    })),
    pendingOrdersList: pendingList.map((o) => ({
      orderNumber: o.order_number,
      email: o.email,
      total: Number(o.total).toFixed(2),
      createdAt: o.created_at,
      expiresAt: o.expires_at,
    })),
  };
}

// ---------------- Products ----------------

export async function adminListProducts({ page = 1, limit = 20, status, q: search } = {}) {
  const where = ['p.deleted_at IS NULL'];
  const params = [];
  if (status) {
    where.push('p.status = ?');
    params.push(status);
  }
  if (search) {
    where.push('(p.title LIKE ? OR p.slug LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like);
  }
  const safeLimit = Math.min(Math.max(Number(limit), 1), 100);
  const offset = (Math.max(Number(page), 1) - 1) * safeLimit;

  const rows = await q(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug,
            (SELECT COUNT(*) FROM product_files f WHERE f.product_id = p.id) AS file_count
     FROM products p JOIN product_categories c ON c.id = p.category_id
     WHERE ${where.join(' AND ')}
     ORDER BY p.created_at DESC LIMIT ${safeLimit} OFFSET ${offset}`,
    params
  );
  const [{ total }] = await q(
    `SELECT COUNT(*) AS total FROM products p WHERE ${where.join(' AND ')}`,
    params
  );
  return { items: rows, total, page: Number(page), limit: safeLimit };
}

export async function adminGetProduct(productId) {
  const rows = await q(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug
     FROM products p JOIN product_categories c ON c.id = p.category_id
     WHERE p.id = ? AND p.deleted_at IS NULL`,
    [productId]
  );
  if (rows.length === 0) throw errors.notFound('ไม่พบสินค้านี้');
  const files = await q(
    `SELECT id, original_name, mime_type, file_size, sort_order, is_primary, created_at
     FROM product_files WHERE product_id = ? ORDER BY sort_order ASC, id ASC`,
    [productId]
  );
  let previews = [];
  try {
    previews = rows[0].preview_images ? JSON.parse(rows[0].preview_images) : [];
  } catch {
    previews = [];
  }
  return { ...rows[0], previews, files };
}

function sanitizeProductInput(input) {
  const out = {};
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  if (input.title !== undefined) out.title = str(input.title, 200);
  if (input.slug !== undefined && input.slug !== '') out.slug = slugify(input.slug, 'p');
  if (input.description !== undefined) out.description = String(input.description ?? '');
  if (input.licenseTerms !== undefined) out.licenseTerms = String(input.licenseTerms ?? '');
  if (input.categoryId !== undefined) out.categoryId = Number(input.categoryId);
  if (input.price !== undefined) out.price = Number(input.price);
  if (input.discountPercent !== undefined) out.discountPercent = Number(input.discountPercent);
  if (input.status !== undefined) out.status = input.status;
  if (input.featured !== undefined) out.featured = input.featured ? 1 : 0;
  if (input.maxDownloads !== undefined)
    out.maxDownloads = input.maxDownloads === null ? null : Number(input.maxDownloads);
  if (input.downloadExpiresDays !== undefined)
    out.downloadExpiresDays =
      input.downloadExpiresDays === null ? null : Number(input.downloadExpiresDays);
  return out;
}

function assertProductValues(v) {
  if (v.title !== undefined && !v.title) throw errors.badRequest('ต้องระบุชื่อสินค้า');
  if (v.price !== undefined && (!Number.isFinite(v.price) || v.price < 0 || v.price > 99999999)) {
    throw errors.badRequest('ราคาไม่ถูกต้อง');
  }
  if (
    v.discountPercent !== undefined &&
    (!Number.isFinite(v.discountPercent) || v.discountPercent < 0 || v.discountPercent > 100)
  ) {
    throw errors.badRequest('ส่วนลดต้องอยู่ระหว่าง 0-100');
  }
  if (v.status && !['draft', 'published', 'closed'].includes(v.status)) {
    throw errors.badRequest('สถานะไม่ถูกต้อง');
  }
}

export async function adminCreateProduct(input, admin, ip) {
  const v = sanitizeProductInput(input);
  assertProductValues(v);
  if (!v.title) throw errors.badRequest('ต้องระบุชื่อสินค้า');
  if (v.price === undefined) throw errors.badRequest('ต้องระบุราคา');
  if (v.categoryId === undefined) throw errors.badRequest('ต้องระบุหมวดหมู่');

  const [cats] = await pool.execute('SELECT id FROM product_categories WHERE id = ?', [v.categoryId]);
  if (cats.length === 0) throw errors.badRequest('หมวดหมู่ไม่ถูกต้อง');

  let slug = v.slug || slugify(v.title, 'p');
  // กัน slug ซ้ำ
  for (let i = 0; i < 5; i++) {
    const [dup] = await pool.execute('SELECT id FROM products WHERE slug = ?', [slug]);
    if (dup.length === 0) break;
    slug = `${slug.slice(0, 140)}-${randomToken(3).replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}`;
  }

  const [res] = await pool.execute(
    `INSERT INTO products (category_id, slug, title, description, license_terms, price,
                           discount_percent, status, featured, max_downloads, download_expires_days,
                           published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      v.categoryId,
      slug,
      v.title,
      v.description || null,
      v.licenseTerms || null,
      Number(v.price).toFixed(2),
      Number(v.discountPercent || 0).toFixed(2),
      v.status || 'draft',
      v.featured || 0,
      v.maxDownloads ?? null,
      v.downloadExpiresDays ?? null,
      v.status === 'published' ? new Date() : null,
    ]
  );
  const productId = res.insertId;
  await writeAudit({
    admin,
    action: 'product.create',
    entityType: 'product',
    entityId: String(productId),
    after: { title: v.title, price: v.price, status: v.status || 'draft' },
    ip,
  });
  return adminGetProduct(productId);
}

export async function adminUpdateProduct(productId, input, admin, ip) {
  const before = await adminGetProduct(productId);
  const v = sanitizeProductInput(input);
  assertProductValues(v);

  const allowed = [
    'title',
    'slug',
    'description',
    'licenseTerms',
    'categoryId',
    'price',
    'discountPercent',
    'status',
    'featured',
    'maxDownloads',
    'downloadExpiresDays',
  ];
  const sets = [];
  const params = [];
  const colOf = {
    title: 'title',
    slug: 'slug',
    description: 'description',
    licenseTerms: 'license_terms',
    categoryId: 'category_id',
    price: 'price',
    discountPercent: 'discount_percent',
    status: 'status',
    featured: 'featured',
    maxDownloads: 'max_downloads',
    downloadExpiresDays: 'download_expires_days',
  };
  for (const key of allowed) {
    if (v[key] === undefined) continue;
    sets.push(`${colOf[key]} = ?`);
    params.push(key === 'price' || key === 'discountPercent' ? Number(v[key]).toFixed(2) : v[key]);
  }
  if (v.status === 'published' && before.status !== 'published') {
    sets.push('published_at = COALESCE(published_at, NOW())');
  }
  if (sets.length === 0) return before;

  params.push(productId);
  await pool.execute(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, params);

  await writeAudit({
    admin,
    action: 'product.update',
    entityType: 'product',
    entityId: String(productId),
    before: { status: before.status, price: before.price, discount: before.discount_percent, title: before.title },
    after: { status: v.status ?? before.status, price: v.price ?? before.price, discount: v.discountPercent ?? before.discount_percent, title: v.title ?? before.title },
    ip,
  });
  return adminGetProduct(productId);
}

/** ลบสินค้า = soft delete (ไม่ทำลาย order/สิทธิ์ที่ขายไปแล้ว) */
export async function adminDeleteProduct(productId, admin, ip) {
  const before = await adminGetProduct(productId);
  const newSlug = `${before.slug}--deleted-${productId}`.slice(0, 160);
  await pool.execute(
    `UPDATE products SET deleted_at = NOW(), status = 'closed', slug = ? WHERE id = ?`,
    [newSlug, productId]
  );
  await writeAudit({
    admin,
    action: 'product.delete',
    entityType: 'product',
    entityId: String(productId),
    before: { title: before.title, status: before.status },
    after: { deleted: true },
    ip,
  });
  return { deleted: true, productId };
}

/** บันทึกไฟล์สินค้าที่อัปโหลดแล้วลง Private Storage */
export async function recordProductFile({ productId, file, admin, ip }) {
  const product = await q('SELECT id, title FROM products WHERE id = ? AND deleted_at IS NULL', [
    productId,
  ]);
  if (product.length === 0) {
    removeFile(file.path);
    throw errors.notFound('ไม่พบสินค้านี้');
  }
  const relKey = path
    .relative(config.storage.privateDir, file.path)
    .split(path.sep)
    .join('/');

  const [countRow] = await pool.execute(
    'SELECT COUNT(*) AS c FROM product_files WHERE product_id = ?',
    [productId]
  );
  const isPrimary = Number(countRow[0].c) === 0 ? 1 : 0;

  const [res] = await pool.execute(
    `INSERT INTO product_files (product_id, storage_key, original_name, mime_type, file_size, sort_order, is_primary)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      productId,
      relKey,
      String(file.originalname || 'file').slice(0, 255),
      file.mimetype || 'application/octet-stream',
      file.size || 0,
      0,
      isPrimary,
    ]
  );
  await writeAudit({
    admin,
    action: 'product.file_upload',
    entityType: 'product',
    entityId: String(productId),
    after: { fileName: file.originalname, size: file.size },
    ip,
  });
  return {
    id: res.insertId,
    productId: Number(productId),
    originalName: file.originalname,
    mimeType: file.mimetype,
    fileSize: file.size,
    isPrimary: Boolean(isPrimary),
  };
}

export async function adminDeleteProductFile({ productId, fileId, admin, ip }) {
  const rows = await q('SELECT * FROM product_files WHERE id = ? AND product_id = ?', [
    fileId,
    productId,
  ]);
  if (rows.length === 0) throw errors.notFound('ไม่พบไฟล์นี้');
  const rec = rows[0];
  removeFile(resolvePrivatePath(rec.storage_key));
  await pool.execute('DELETE FROM product_files WHERE id = ?', [fileId]);
  // ถ้าลบไฟล์ primary ไฟล์ใหม่ -> ตั้ง primary ใหม่
  if (rec.is_primary) {
    await pool.execute(
      `UPDATE product_files SET is_primary = 1
       WHERE product_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1`,
      [productId]
    );
  }
  await writeAudit({
    admin,
    action: 'product.file_delete',
    entityType: 'product',
    entityId: String(productId),
    before: { fileName: rec.original_name, size: rec.file_size },
    ip,
  });
  return { deleted: true };
}

export async function saveProductImage({ productId, file, kind }) {
  // file.path = uploads/covers|previews/... คืนเป็น URL สัมพัทธ์
  const publicUrl = '/' + path.relative(config.storage.publicDir, file.path).split(path.sep).join('/');
  if (kind === 'cover') {
    await pool.execute('UPDATE products SET cover_image_url = ? WHERE id = ?', [publicUrl, productId]);
  } else {
    const rows = await q('SELECT preview_images FROM products WHERE id = ?', [productId]);
    let arr = [];
    try {
      arr = rows[0]?.preview_images ? JSON.parse(rows[0].preview_images) : [];
    } catch {
      arr = [];
    }
    arr.push(publicUrl);
    arr = arr.slice(0, 8);
    await pool.execute('UPDATE products SET preview_images = ? WHERE id = ?', [
      JSON.stringify(arr),
      productId,
    ]);
  }
  return { url: publicUrl };
}

// ---------------- Orders / Payments ----------------

export async function adminListOrders({ page = 1, limit = 20, status, search, dateFrom, dateTo } = {}) {
  const where = ['1=1'];
  const params = [];
  if (status) {
    where.push('o.status = ?');
    params.push(status);
  }
  if (search) {
    where.push('(o.order_number LIKE ? OR u.email LIKE ? OR u.display_name LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (dateFrom) {
    where.push('o.created_at >= ?');
    params.push(dateFrom);
  }
  if (dateTo) {
    where.push('o.created_at <= ?');
    params.push(`${dateTo} 23:59:59`);
  }
  const safeLimit = Math.min(Math.max(Number(limit), 1), 100);
  const offset = (Math.max(Number(page), 1) - 1) * safeLimit;

  const rows = await q(
    `SELECT o.*, u.email, u.display_name,
            (SELECT provider_charge_id FROM payments p WHERE p.order_id = o.id ORDER BY p.id DESC LIMIT 1) AS last_charge_id,
            (SELECT status FROM payments p WHERE p.order_id = o.id ORDER BY p.id DESC LIMIT 1) AS last_payment_status
     FROM orders o JOIN users u ON u.id = o.user_id
     WHERE ${where.join(' AND ')}
     ORDER BY o.created_at DESC LIMIT ${safeLimit} OFFSET ${offset}`,
    params
  );
  const [{ total }] = await q(
    `SELECT COUNT(*) AS total FROM orders o JOIN users u ON u.id = o.user_id
     WHERE ${where.join(' AND ')}`,
    params
  );
  return {
    items: rows.map((o) => ({
      id: o.id,
      orderNumber: o.order_number,
      email: o.email,
      displayName: o.display_name,
      status: o.status,
      total: Number(o.total).toFixed(2),
      currency: o.currency,
      createdAt: o.created_at,
      paidAt: o.paid_at,
      refundedAt: o.refunded_at,
      lastChargeId: o.last_charge_id,
      lastPaymentStatus: o.last_payment_status,
    })),
    total,
    page: Number(page),
    limit: safeLimit,
  };
}

export async function adminGetOrder(orderId) {
  const rows = await q(
    `SELECT o.*, u.email, u.display_name, u.id AS uid
     FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?`,
    [orderId]
  );
  if (rows.length === 0) throw errors.notFound('ไม่พบคำสั่งซื้อนี้');
  const o = rows[0];
  const items = await q('SELECT * FROM order_items WHERE order_id = ?', [orderId]);
  const payments = await q('SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC', [orderId]);
  const events = await q(
    `SELECT e.id, e.provider, e.event_id, e.event_type, e.charge_id, e.signature_valid,
            e.processed, e.processing_error, e.received_at
     FROM payment_webhook_events e
     WHERE e.charge_id IN (SELECT provider_charge_id FROM payments WHERE order_id = ? AND provider_charge_id IS NOT NULL)
     ORDER BY e.received_at DESC LIMIT 20`,
    [orderId]
  );
  return {
    order: o,
    items,
    payments,
    webhookEvents: events,
  };
}

/**
 * คืนเงินผ่านกระบวนการของ Gateway (ไม่ใช่การแก้ DB ตรงๆ)
 * ทำทุกอย่างในธุรกรรมเดียว + audit log
 */
export async function refundOrder({ orderId, admin, reason, ip }) {
  if (!reason || String(reason).trim().length < 5) {
    throw errors.badRequest('ต้องระบุเหตุผลการคืนเงินอย่างน้อย 5 ตัวอักษร');
  }
  return withTransaction(async (conn) => {
    const [ors] = await conn.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
    if (ors.length === 0) throw errors.notFound('ไม่พบคำสั่งซื้อนี้');
    const order = ors[0];
    if (order.status !== 'paid') {
      throw errors.conflict('คืนเงินได้เฉพาะคำสั่งซื้อที่ชำระเงินสำเร็จเท่านั้น');
    }

    const [pays] = await conn.execute(
      `SELECT * FROM payments WHERE order_id = ? AND status = 'paid' AND provider_charge_id IS NOT NULL
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [orderId]
    );
    if (pays.length === 0) throw errors.conflict('ไม่พบรายการชำระเงินที่ผ่านเกณฑ์การคืนเงิน');
    const payment = pays[0];

    // เรียก gateway คืนเงิน (test = จำลอง, opn = API จริง)
    const provider = getPaymentProvider(payment.provider);
    const refund = await provider.refundCharge({
      chargeId: payment.provider_charge_id,
      amountCents: toCents(order.total),
      reason: String(reason).slice(0, 255),
    });

    await conn.execute(
      `UPDATE payments SET status = 'refunded', refunded_at = NOW(),
              provider_response = JSON_SET(COALESCE(provider_response, '{}'), '$.refund', ?)
       WHERE id = ?`,
      [JSON.stringify(refund.raw || refund).slice(0, 4000), payment.id]
    );
    await conn.execute(`UPDATE orders SET status = 'refunded', refunded_at = NOW() WHERE id = ?`, [
      orderId,
    ]);

    let revoked = 0;
    if (config.flags.revokeOnRefund) {
      revoked = await revokeEntitlements(conn, orderId, `คืนเงิน: ${String(reason).slice(0, 200)}`);
    }

    await writeAudit(
      {
        admin,
        action: 'order.refund',
        entityType: 'order',
        entityId: String(order.order_number),
        before: { status: 'paid', total: order.total },
        after: { status: 'refunded', refundId: refund.refundId, entitlementsRevoked: revoked },
        reason,
        ip,
      },
      conn
    );
    return { orderNumber: order.order_number, refundId: refund.refundId, revoked };
  });
}

/**
 * ยืนยันชำระเงินด้วยมือ (เฉพาะ Admin) - ผ่านการตรวจสอบ + เหตุผล + Audit Log เสมอ
 * ห้ามเปลี่ยนเป็น paid แบบไม่มีบันทึกเด็ดขาด
 */
export async function adminMarkPaid({ orderId, admin, reason, ip }) {
  if (!reason || String(reason).trim().length < 10) {
    throw errors.badRequest('ต้องระบุเหตุผลอย่างน้อย 10 ตัวอักษร (เช่น แนบสลิปยืนยันจากลูกค้า)');
  }
  return withTransaction(async (conn) => {
    const [ors] = await conn.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
    if (ors.length === 0) throw errors.notFound('ไม่พบคำสั่งซื้อนี้');
    const order = ors[0];
    if (!['pending', 'failed', 'expired'].includes(order.status)) {
      throw errors.conflict(`เปลี่ยนสถานะนี้ไม่ได้ (สถานะปัจจุบัน: ${order.status})`);
    }

    // ถ้ามี payment ค้าง -> ปรับสถานะให้สอดคล้องด้วย
    await conn.execute(
      `UPDATE payments SET status = 'paid', paid_at = COALESCE(paid_at, NOW()), failure_reason = NULL
       WHERE order_id = ? AND status = 'pending'`,
      [orderId]
    );
    await conn.execute(`UPDATE orders SET status = 'paid', paid_at = NOW() WHERE id = ?`, [orderId]);
    const granted = await grantEntitlements(conn, order);

    await writeAudit(
      {
        admin,
        action: 'order.mark_paid',
        entityType: 'order',
        entityId: String(order.order_number),
        before: { status: order.status, total: order.total },
        after: { status: 'paid', entitlementsGranted: granted },
        reason,
        ip,
      },
      conn
    );
    return { orderNumber: order.order_number, granted };
  });
}

// ---------------- Users ----------------

export async function adminListUsers({ page = 1, limit = 20, search } = {}) {
  const where = ['1=1'];
  const params = [];
  if (search) {
    where.push('(u.email LIKE ? OR u.display_name LIKE ? OR u.google_sub LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  const safeLimit = Math.min(Math.max(Number(limit), 1), 100);
  const offset = (Math.max(Number(page), 1) - 1) * safeLimit;
  const rows = await q(
    `SELECT u.id, u.email, u.display_name, u.avatar_url, u.role, u.status, u.created_at, u.last_login_at,
            (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid') AS paid_orders,
            (SELECT COALESCE(SUM(o.total),0) FROM orders o WHERE o.user_id = u.id AND o.status = 'paid') AS total_spent,
            (SELECT COUNT(*) FROM download_logs d WHERE d.user_id = u.id) AS download_count
     FROM users u WHERE ${where.join(' AND ')}
     ORDER BY u.created_at DESC LIMIT ${safeLimit} OFFSET ${offset}`,
    params
  );
  const [{ total }] = await q(`SELECT COUNT(*) AS total FROM users u WHERE ${where.join(' AND ')}`, params);
  return { items: rows, total, page: Number(page), limit: safeLimit };
}

export async function adminGetUser(userId) {
  const rows = await q(
    `SELECT id, email, display_name, avatar_url, role, status, created_at, last_login_at, email_verified
     FROM users WHERE id = ?`,
    [userId]
  );
  if (rows.length === 0) throw errors.notFound('ไม่พบผู้ใช้นี้');
  const orders = await q(
    'SELECT id, order_number, status, total, created_at, paid_at FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
    [userId]
  );
  const downloads = await q(
    `SELECT d.id, d.status, d.reason, d.created_at, p.title
     FROM download_logs d JOIN products p ON p.id = d.product_id
     WHERE d.user_id = ? ORDER BY d.created_at DESC LIMIT 50`,
    [userId]
  );
  return { user: rows[0], orders, downloads };
}

export async function adminSetUserStatus({ userId, status, admin, ip }) {
  if (!['active', 'suspended'].includes(status)) throw errors.badRequest('สถานะไม่ถูกต้อง');
  const rows = await q('SELECT id, email, role, status FROM users WHERE id = ?', [userId]);
  if (rows.length === 0) throw errors.notFound('ไม่พบผู้ใช้นี้');
  const user = rows[0];
  if (user.id === admin.id) throw errors.badRequest('ไม่สามารถระงับ/ปลดบัญชีของตัวเองได้');

  await pool.execute('UPDATE users SET status = ? WHERE id = ?', [status, userId]);
  // ระงับ -> เตะ session ออกทั้งหมด
  if (status === 'suspended') {
    await pool.execute('DELETE FROM sessions WHERE JSON_UNQUOTE(JSON_EXTRACT(data, "$.userId")) = ?', [
      String(userId),
    ]);
  }
  await writeAudit({
    admin,
    action: status === 'suspended' ? 'user.suspend' : 'user.activate',
    entityType: 'user',
    entityId: String(userId),
    before: { status: user.status },
    after: { status },
    ip,
  });
  return { userId, status };
}

// ---------------- Coupons ----------------

export async function adminListCoupons() {
  return q('SELECT * FROM coupons ORDER BY created_at DESC LIMIT 200');
}

export async function adminCreateCoupon(input, admin, ip) {
  const code = String(input.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
    throw errors.badRequest('รหัสคูปองใช้ A-Z 0-9 _ - ความยาว 3-40 ตัวอักษร');
  }
  if (input.type === 'percent' && (input.value <= 0 || input.value > 100)) {
    throw errors.badRequest('ส่วนลดเป็นเปอร์เซ็นต์ต้องอยู่ระหว่าง 0-100');
  }
  if (input.type === 'fixed' && input.value <= 0) throw errors.badRequest('ส่วนลดต้องมากกว่า 0');
  try {
    const [res] = await pool.execute(
      `INSERT INTO coupons (code, type, value, min_order_amount, max_uses, max_uses_per_user, starts_at, ends_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        code,
        input.type,
        Number(input.value).toFixed(2),
        Number(input.minOrderAmount || 0).toFixed(2),
        input.maxUses ?? null,
        input.maxUsesPerUser ?? null,
        input.startsAt || null,
        input.endsAt || null,
      ]
    );
    await writeAudit({
      admin,
      action: 'coupon.create',
      entityType: 'coupon',
      entityId: code,
      after: { type: input.type, value: input.value },
      ip,
    });
    const rows = await q('SELECT * FROM coupons WHERE id = ?', [res.insertId]);
    return rows[0];
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw errors.conflict('มีรหัสคูปองนี้อยู่แล้ว');
    throw err;
  }
}

export async function adminSetCouponActive({ couponId, isActive, admin, ip }) {
  const rows = await q('SELECT * FROM coupons WHERE id = ?', [couponId]);
  if (rows.length === 0) throw errors.notFound('ไม่พบคูปองนี้');
  await pool.execute('UPDATE coupons SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, couponId]);
  await writeAudit({
    admin,
    action: isActive ? 'coupon.activate' : 'coupon.deactivate',
    entityType: 'coupon',
    entityId: rows[0].code,
    before: { is_active: rows[0].is_active },
    after: { is_active: isActive ? 1 : 0 },
    ip,
  });
  return { couponId, isActive: Boolean(isActive) };
}

// ---------------- Categories & Audit & Reviews ----------------

export async function adminCreateCategory({ name, slug, description, sortOrder }) {
  const s = slugify(slug || name, 'cat');
  try {
    const [res] = await pool.execute(
      'INSERT INTO product_categories (name, slug, description, sort_order) VALUES (?, ?, ?, ?)',
      [String(name).slice(0, 100), s, description || null, Number(sortOrder) || 0]
    );
    const rows = await q('SELECT * FROM product_categories WHERE id = ?', [res.insertId]);
    return rows[0];
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw errors.conflict('มีหมวดหมู่นี้อยู่แล้ว');
    throw err;
  }
}

export async function adminListAuditLogs({ page = 1, limit = 50, action } = {}) {
  const where = action ? 'action = ?' : '1=1';
  const params = action ? [action] : [];
  const safeLimit = Math.min(Math.max(Number(limit), 1), 200);
  const offset = (Math.max(Number(page), 1) - 1) * safeLimit;
  const rows = await q(
    `SELECT * FROM admin_audit_logs WHERE ${where} ORDER BY created_at DESC LIMIT ${safeLimit} OFFSET ${offset}`,
    params
  );
  const [{ total }] = await q(`SELECT COUNT(*) AS total FROM admin_audit_logs WHERE ${where}`, params);
  return { items: rows, total, page: Number(page), limit: safeLimit };
}

export async function adminDeleteReview({ reviewId, admin, ip }) {
  const rows = await q('SELECT * FROM reviews WHERE id = ?', [reviewId]);
  if (rows.length === 0) throw errors.notFound('ไม่พบรีวิวนี้');
  await pool.execute('DELETE FROM reviews WHERE id = ?', [reviewId]);
  await pool.execute(
    `UPDATE products p
     SET p.rating_avg = COALESCE((SELECT ROUND(AVG(rating),2) FROM reviews WHERE product_id = p.id), 0),
         p.rating_count = (SELECT COUNT(*) FROM reviews WHERE product_id = p.id)
     WHERE p.id = ?`,
    [rows[0].product_id]
  );
  await writeAudit({
    admin,
    action: 'review.delete',
    entityType: 'review',
    entityId: String(reviewId),
    before: { rating: rows[0].rating, productId: rows[0].product_id },
    ip,
  });
  return { deleted: true };
}

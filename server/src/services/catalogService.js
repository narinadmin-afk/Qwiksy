import { q } from '../db/pool.js';
import { discountedUnitCents, toCents, fromCents } from '../utils/money.js';
import { errors } from '../utils/errors.js';

/** แปลงแถวสินค้า -> DTO สาธารณะ (ไม่มี storage_key เด็ดขาด) */
export function toProductDTO(row) {
  const saleCents = discountedUnitCents(toCents(row.price), row.discount_percent);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category_name
      ? { name: row.category_name, slug: row.category_slug }
      : undefined,
    price: Number(row.price).toFixed(2),
    discountPercent: Number(row.discount_percent).toFixed(2),
    salePrice: fromCents(saleCents),
    onSale: Number(row.discount_percent) > 0,
    coverImageUrl: row.cover_image_url,
    ratingAvg: Number(row.rating_avg),
    ratingCount: row.rating_count,
    salesCount: row.sales_count,
    featured: Boolean(row.featured),
    status: row.status,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  };
}

const PUBLISHED = `p.deleted_at IS NULL AND p.status = 'published'`;
const SELECT_LIST = `
  SELECT p.id, p.slug, p.title, p.price, p.discount_percent, p.cover_image_url,
         p.rating_avg, p.rating_count, p.sales_count, p.featured, p.status,
         p.published_at, p.created_at,
         c.name AS category_name, c.slug AS category_slug
  FROM products p
  JOIN product_categories c ON c.id = p.category_id`;

export async function listCategories() {
  return q(
    `SELECT c.id, c.name, c.slug, c.description,
            (SELECT COUNT(*) FROM products p
              WHERE p.category_id = c.id AND ${PUBLISHED}) AS product_count
     FROM product_categories c
     ORDER BY c.sort_order ASC, c.name ASC`
  );
}

/** รายการสินค้า (ใช้หน้าแรก + หน้ารายการสินค้า + ค้นหา) */
export async function listProducts({
  categorySlug,
  q: search,
  sort = 'newest',
  page = 1,
  limit = 12,
  featured,
} = {}) {
  const where = [PUBLISHED];
  const params = [];
  if (categorySlug) {
    where.push('c.slug = ?');
    params.push(categorySlug);
  }
  if (search) {
    where.push('(p.title LIKE ? OR p.description LIKE ?)');
    const like = `%${String(search).replace(/[%_]/g, (m) => `\\${m}`)}%`;
    params.push(like, like);
  }
  if (featured) where.push('p.featured = 1');

  const orderMap = {
    newest: 'p.published_at DESC, p.id DESC',
    oldest: 'p.published_at ASC, p.id ASC',
    price_asc: 'p.price ASC, p.id DESC',
    price_desc: 'p.price DESC, p.id DESC',
    bestseller: 'p.sales_count DESC, p.id DESC',
    discount: 'p.discount_percent DESC, p.id DESC',
  };
  const orderBy = orderMap[sort] || orderMap.newest;

  const safeLimit = Math.min(Math.max(Number(limit) || 12, 1), 48);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const countSql = `
    SELECT COUNT(*) AS total FROM products p
    JOIN product_categories c ON c.id = p.category_id
    WHERE ${where.join(' AND ')}`;
  const rows = await q(
    `${SELECT_LIST} WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT ${safeLimit} OFFSET ${offset}`,
    params
  );
  const [{ total }] = await q(countSql, params);

  return {
    items: rows.map(toProductDTO),
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.max(Math.ceil(total / safeLimit), 1),
  };
}

/** รายละเอียดสินค้าตาม slug (ของ public ไม่มีข้อมูลไฟล์ภายใน) */
export async function getProductDetail(slug) {
  const rows = await q(`${SELECT_LIST} WHERE p.slug = ? AND ${PUBLISHED} LIMIT 1`, [slug]);
  if (rows.length === 0) throw errors.notFound('ไม่พบสินค้านี้');
  const product = rows[0];

  const files = await q(
    `SELECT mime_type, file_size FROM product_files WHERE product_id = ? ORDER BY sort_order ASC`,
    [product.id]
  );
  const detail = await q(
    `SELECT description, license_terms, preview_images, download_expires_days, max_downloads
     FROM products WHERE id = ?`,
    [product.id]
  );

  const totalSize = files.reduce((sum, f) => sum + Number(f.file_size), 0);
  const types = [...new Set(files.map((f) => f.mime_type))];

  let previews = [];
  try {
    previews = detail[0]?.preview_images ? JSON.parse(detail[0].preview_images) : [];
  } catch {
    previews = [];
  }

  return {
    ...toProductDTO(product),
    description: detail[0]?.description || '',
    licenseTerms: detail[0]?.license_terms || '',
    previewImages: Array.isArray(previews) ? previews : [],
    files: {
      count: files.length,
      totalBytes: totalSize,
      mimeTypes: types,
    },
    downloadPolicy: {
      maxDownloads: detail[0]?.max_downloads ?? null,
      expiresDays: detail[0]?.download_expires_days ?? null,
    },
  };
}

/** รายการสินค้าสำหรับหน้าแรก: แนะนำ, ขายดี, ใหม่ */
export async function getHomeSections() {
  const pick = (orderBy, limit = 8) =>
    q(`${SELECT_LIST} WHERE ${PUBLISHED} ORDER BY ${orderBy} LIMIT ${limit}`);

  const [featured, bestsellers, newest] = await Promise.all([
    pick('p.featured DESC, p.published_at DESC'),
    pick('p.sales_count DESC, p.published_at DESC'),
    pick('p.published_at DESC'),
  ]);
  return {
    featured: featured.map(toProductDTO),
    bestsellers: bestsellers.map(toProductDTO),
    newest: newest.map(toProductDTO),
  };
}

/** สรุปไฟล์ของสินค้า (ใช้ตอนซื้อแล้วแสดงใน My Library) */
export async function getProductFileSummary(productId) {
  const rows = await q(
    `SELECT mime_type, file_size, original_name FROM product_files WHERE product_id = ?`,
    [productId]
  );
  return {
    count: rows.length,
    totalBytes: rows.reduce((s, f) => s + Number(f.file_size), 0),
    names: rows.map((f) => f.original_name),
    mimeTypes: [...new Set(rows.map((f) => f.mime_type))],
  };
}

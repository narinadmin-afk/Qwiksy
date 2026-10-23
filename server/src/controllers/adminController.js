import { asyncHandler, errors } from '../utils/errors.js';
import * as svc from '../services/adminService.js';

const ipOf = (req) => req.ip;

// ---------------- Dashboard ----------------
export const dashboard = asyncHandler(async (req, res) => {
  res.json({ ok: true, data: { stats: await svc.getDashboardStats() } });
});

// ---------------- Products ----------------
export const listProducts = asyncHandler(async (req, res) => {
  const { page, limit, status, q } = req.valid.query;
  res.json({ ok: true, data: await svc.adminListProducts({ page, limit, status, q }) });
});

export const getProduct = asyncHandler(async (req, res) => {
  res.json({ ok: true, data: { product: await svc.adminGetProduct(Number(req.valid.params.id)) } });
});

export const createProduct = asyncHandler(async (req, res) => {
  const product = await svc.adminCreateProduct(req.valid.body, req.user, ipOf(req));
  res.status(201).json({ ok: true, data: { product } });
});

export const updateProduct = asyncHandler(async (req, res) => {
  const product = await svc.adminUpdateProduct(
    Number(req.valid.params.id),
    req.valid.body,
    req.user,
    ipOf(req)
  );
  res.json({ ok: true, data: { product } });
});

export const deleteProduct = asyncHandler(async (req, res) => {
  res.json({
    ok: true,
    data: await svc.adminDeleteProduct(Number(req.valid.params.id), req.user, ipOf(req)),
  });
});

export const uploadFiles = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) throw errors.badRequest('ไม่พบไฟล์ที่อัปโหลด');
  const productId = Number(req.params.id);
  const saved = [];
  for (const f of req.files) {
    saved.push(await svc.recordProductFile({ productId, file: f, admin: req.user, ip: ipOf(req) }));
  }
  res.status(201).json({ ok: true, data: { files: saved } });
});

export const deleteFile = asyncHandler(async (req, res) => {
  res.json({
    ok: true,
    data: await svc.adminDeleteProductFile({
      productId: Number(req.params.id),
      fileId: Number(req.params.fileId),
      admin: req.user,
      ip: ipOf(req),
    }),
  });
});

export const uploadCover = asyncHandler(async (req, res) => {
  if (!req.file) throw errors.badRequest('ไม่พบไฟล์ภาพปก');
  const result = await svc.saveProductImage({
    productId: Number(req.params.id),
    file: req.file,
    kind: 'cover',
  });
  res.status(201).json({ ok: true, data: result });
});

export const uploadPreviews = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) throw errors.badRequest('ไม่พบไฟล์ภาพตัวอย่าง');
  const urls = [];
  for (const f of req.files) {
    const r = await svc.saveProductImage({
      productId: Number(req.params.id),
      file: f,
      kind: 'preview',
    });
    urls.push(r.url);
  }
  res.status(201).json({ ok: true, data: { urls } });
});

// ---------------- Orders ----------------
export const listOrders = asyncHandler(async (req, res) => {
  const { page, limit, status, search, dateFrom, dateTo } = req.valid.query;
  res.json({ ok: true, data: await svc.adminListOrders({ page, limit, status, search, dateFrom, dateTo }) });
});

export const getOrder = asyncHandler(async (req, res) => {
  res.json({ ok: true, data: await svc.adminGetOrder(Number(req.valid.params.id)) });
});

export const refundOrder = asyncHandler(async (req, res) => {
  const result = await svc.refundOrder({
    orderId: Number(req.valid.params.id),
    admin: req.user,
    reason: req.valid.body.reason,
    ip: ipOf(req),
  });
  res.json({ ok: true, data: result });
});

export const markPaid = asyncHandler(async (req, res) => {
  const result = await svc.adminMarkPaid({
    orderId: Number(req.valid.params.id),
    admin: req.user,
    reason: req.valid.body.reason,
    ip: ipOf(req),
  });
  res.json({ ok: true, data: result });
});

// ---------------- Users ----------------
export const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, search } = req.valid.query;
  res.json({ ok: true, data: await svc.adminListUsers({ page, limit, search }) });
});

export const getUser = asyncHandler(async (req, res) => {
  res.json({ ok: true, data: await svc.adminGetUser(Number(req.valid.params.id)) });
});

export const setUserStatus = asyncHandler(async (req, res) => {
  const result = await svc.adminSetUserStatus({
    userId: Number(req.valid.params.id),
    status: req.valid.body.status,
    admin: req.user,
    ip: ipOf(req),
  });
  res.json({ ok: true, data: result });
});

// ---------------- Coupons ----------------
export const listCoupons = asyncHandler(async (req, res) => {
  res.json({ ok: true, data: { coupons: await svc.adminListCoupons() } });
});

export const createCoupon = asyncHandler(async (req, res) => {
  const coupon = await svc.adminCreateCoupon(req.valid.body, req.user, ipOf(req));
  res.status(201).json({ ok: true, data: { coupon } });
});

export const setCouponActive = asyncHandler(async (req, res) => {
  res.json({
    ok: true,
    data: await svc.adminSetCouponActive({
      couponId: Number(req.valid.params.id),
      isActive: req.valid.body.isActive,
      admin: req.user,
      ip: ipOf(req),
    }),
  });
});

// ---------------- Categories / Audit / Reviews ----------------
export const createCategory = asyncHandler(async (req, res) => {
  const category = await svc.adminCreateCategory(req.valid.body);
  res.status(201).json({ ok: true, data: { category } });
});

export const listAuditLogs = asyncHandler(async (req, res) => {
  const { page, limit, action } = req.valid.query;
  res.json({ ok: true, data: await svc.adminListAuditLogs({ page, limit, action }) });
});

export const listReviews = asyncHandler(async (req, res) => {
  const { q } = await import('../db/pool.js');
  const rows = await q(
    `SELECT r.id, r.rating, r.comment, r.created_at, p.title AS product_title,
            u.display_name AS user_name, u.email AS user_email
     FROM reviews r
     JOIN products p ON p.id = r.product_id
     JOIN users u ON u.id = r.user_id
     ORDER BY r.created_at DESC LIMIT 100`
  );
  res.json({ ok: true, data: { reviews: rows } });
});

export const deleteReview = asyncHandler(async (req, res) => {
  res.json({
    ok: true,
    data: await svc.adminDeleteReview({
      reviewId: Number(req.valid.params.reviewId),
      admin: req.user,
      ip: ipOf(req),
    }),
  });
});

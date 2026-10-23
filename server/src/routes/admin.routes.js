import { Router } from 'express';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { requireAdmin } from '../middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import { errors, asyncHandler } from '../utils/errors.js';
import { config } from '../config/index.js';
import { randomToken } from '../utils/crypto.js';
import {
  assertProductExt,
  assertImageExt,
  productPrivateDir,
} from '../services/storageService.js';
import { adminGetProduct } from '../services/adminService.js';
import * as ctrl from '../controllers/adminController.js';

const router = Router();
// ทุกเส้นทาง admin ต้องเป็น role=admin จาก DB เท่านั้น
router.use(requireAdmin);

const idParams = z.object({ id: z.coerce.number().int().positive() });

// ---------------- multer: ไฟล์สินค้า (Private Storage) ----------------
const privateUpload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      try {
        assertProductExt(file.originalname);
        cb(null, productPrivateDir(Number(req.params.id)));
      } catch (err) {
        cb(err);
      }
    },
    filename(req, file, cb) {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}_${randomToken(8).replace(/[^a-zA-Z0-9]/g, '')}${ext}`);
    },
  }),
  limits: { fileSize: 1024 * 1024 * 1024, files: 5 }, // 1GB / ไฟล์, 5 ไฟล์/คำขอ
  fileFilter(req, file, cb) {
    try {
      assertProductExt(file.originalname);
      cb(null, true);
    } catch (err) {
      cb(err);
    }
  },
});

// ---------------- multer: ภาพปก/ภาพตัวอย่าง (Public Storage) ----------------
const makeImageUpload = (subdir) =>
  multer({
    storage: multer.diskStorage({
      destination(req, file, cb) {
        cb(null, path.join(config.storage.publicDir, 'uploads', subdir));
      },
      filename(req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${Date.now()}_${randomToken(8).replace(/[^a-zA-Z0-9]/g, '')}${ext}`);
      },
    }),
    limits: { fileSize: 8 * 1024 * 1024, files: 8 },
    fileFilter(req, file, cb) {
      try {
        assertImageExt(file.originalname);
        cb(null, true);
      } catch (err) {
        cb(err);
      }
    },
  });

// เช็คสินค้าก่อนรับไฟล์ (กันขยะตกค้างเมื่อสินค้าไม่มีอยู่)
const assertProductExists = asyncHandler(async (req, res, next) => {
  await adminGetProduct(Number(req.params.id));
  next();
});

// ---------------- Dashboard ----------------
router.get('/dashboard/stats', ctrl.dashboard);

// ---------------- Categories ----------------
router.post(
  '/categories',
  validateBody(
    z.object({
      name: z.string().trim().min(1).max(100),
      slug: z.string().trim().max(100).optional(),
      description: z.string().max(255).optional(),
      sortOrder: z.coerce.number().int().optional(),
    })
  ),
  ctrl.createCategory
);

// ---------------- Products ----------------
router.get(
  '/products',
  validateQuery(
    z.object({
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      status: z.enum(['draft', 'published', 'closed']).optional(),
      q: z.string().max(200).optional(),
    })
  ),
  ctrl.listProducts
);
router.post(
  '/products',
  validateBody(
    z.object({
      title: z.string().trim().min(1, 'ต้องระบุชื่อสินค้า').max(200),
      slug: z.string().trim().max(160).optional(),
      description: z.string().max(20000).optional(),
      licenseTerms: z.string().max(20000).optional(),
      categoryId: z.coerce.number().int().positive(),
      price: z.coerce.number().min(0).max(99999999),
      discountPercent: z.coerce.number().min(0).max(100).default(0),
      status: z.enum(['draft', 'published', 'closed']).default('draft'),
      featured: z.coerce.boolean().default(false),
      maxDownloads: z.coerce.number().int().min(1).nullable().optional(),
      downloadExpiresDays: z.coerce.number().int().min(1).nullable().optional(),
    })
  ),
  ctrl.createProduct
);
router.get('/products/:id', validateParams(idParams), ctrl.getProduct);
router.put(
  '/products/:id',
  validateParams(idParams),
  validateBody(
    z.object({
      title: z.string().trim().min(1).max(200).optional(),
      slug: z.string().trim().max(160).optional(),
      description: z.string().max(20000).optional(),
      licenseTerms: z.string().max(20000).optional(),
      categoryId: z.coerce.number().int().positive().optional(),
      price: z.coerce.number().min(0).max(99999999).optional(),
      discountPercent: z.coerce.number().min(0).max(100).optional(),
      status: z.enum(['draft', 'published', 'closed']).optional(),
      featured: z.coerce.boolean().optional(),
      maxDownloads: z.coerce.number().int().min(1).nullable().optional(),
      downloadExpiresDays: z.coerce.number().int().min(1).nullable().optional(),
    })
  ),
  ctrl.updateProduct
);
router.delete('/products/:id', validateParams(idParams), ctrl.deleteProduct);

// อัปโหลดไฟล์สินค้า -> Private Storage (ไม่ใช่ public)
router.post(
  '/products/:id/files',
  validateParams(idParams),
  assertProductExists,
  privateUpload.array('files', 5),
  ctrl.uploadFiles
);
router.delete('/products/:id/files/:fileId', validateParams(z.object({
  id: z.coerce.number().int().positive(),
  fileId: z.coerce.number().int().positive(),
})), ctrl.deleteFile);

// ภาพปก/ภาพตัวอย่าง -> Public Storage (/uploads)
router.post(
  '/products/:id/cover',
  validateParams(idParams),
  assertProductExists,
  makeImageUpload('covers').single('cover'),
  ctrl.uploadCover
);
router.post(
  '/products/:id/previews',
  validateParams(idParams),
  assertProductExists,
  makeImageUpload('previews').array('previews', 8),
  ctrl.uploadPreviews
);

// ---------------- Orders ----------------
router.get(
  '/orders',
  validateQuery(
    z.object({
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      status: z
        .enum(['pending', 'paid', 'failed', 'expired', 'cancelled', 'refunded'])
        .optional(),
      search: z.string().max(200).optional(),
      dateFrom: z.string().max(20).optional(),
      dateTo: z.string().max(20).optional(),
    })
  ),
  ctrl.listOrders
);
router.get('/orders/:id', validateParams(idParams), ctrl.getOrder);
router.post(
  '/orders/:id/refund',
  validateParams(idParams),
  validateBody(z.object({ reason: z.string().trim().min(5, 'ต้องระบุเหตุผลอย่างน้อย 5 ตัวอักษร').max(255) })),
  ctrl.refundOrder
);
router.post(
  '/orders/:id/mark-paid',
  validateParams(idParams),
  validateBody(
    z.object({
      reason: z.string().trim().min(10, 'ต้องระบุเหตุผลอย่างน้อย 10 ตัวอักษรพร้อมหลักฐาน').max(255),
    })
  ),
  ctrl.markPaid
);

// ---------------- Users ----------------
router.get(
  '/users',
  validateQuery(
    z.object({
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      search: z.string().max(200).optional(),
    })
  ),
  ctrl.listUsers
);
router.get('/users/:id', validateParams(idParams), ctrl.getUser);
router.post(
  '/users/:id/status',
  validateParams(idParams),
  validateBody(z.object({ status: z.enum(['active', 'suspended']) })),
  ctrl.setUserStatus
);

// ---------------- Coupons ----------------
router.get('/coupons', ctrl.listCoupons);
router.post(
  '/coupons',
  validateBody(
    z.object({
      code: z.string().trim().min(3).max(40),
      type: z.enum(['percent', 'fixed']),
      value: z.coerce.number().positive(),
      minOrderAmount: z.coerce.number().min(0).default(0),
      maxUses: z.coerce.number().int().min(1).nullable().optional(),
      maxUsesPerUser: z.coerce.number().int().min(1).nullable().optional(),
      startsAt: z.string().max(30).nullable().optional(),
      endsAt: z.string().max(30).nullable().optional(),
    })
  ),
  ctrl.createCoupon
);
router.patch(
  '/coupons/:id',
  validateParams(idParams),
  validateBody(z.object({ isActive: z.coerce.boolean() })),
  ctrl.setCouponActive
);

// ---------------- Audit / Reviews ----------------
router.get(
  '/audit-logs',
  validateQuery(
    z.object({
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
      action: z.string().max(60).optional(),
    })
  ),
  ctrl.listAuditLogs
);
router.get('/reviews', ctrl.listReviews);
router.delete('/reviews/:reviewId', validateParams(
  z.object({ reviewId: z.coerce.number().int().positive() })
), ctrl.deleteReview);

export default router;

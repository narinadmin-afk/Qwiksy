import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/errors.js';
import { validateQuery, validateBody, validateParams } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config/index.js';
import * as catalog from '../services/catalogService.js';
import * as reviews from '../services/reviewService.js';

const router = Router();

/** GET /api/categories */
router.get(
  '/categories',
  asyncHandler(async (req, res) => {
    res.json({ ok: true, data: { categories: await catalog.listCategories() } });
  })
);

/** GET /api/products/home - แนะนำ/ขายดี/ใหม่ สำหรับหน้าแรก */
router.get(
  '/products/home',
  asyncHandler(async (req, res) => {
    res.json({ ok: true, data: await catalog.getHomeSections() });
  })
);

/** GET /api/products?category=&q=&sort=&page=&limit= */
router.get(
  '/products',
  validateQuery(
    z.object({
      category: z.string().max(100).optional(),
      q: z.string().max(200).optional(),
      sort: z
        .enum(['newest', 'oldest', 'price_asc', 'price_desc', 'bestseller', 'discount'])
        .optional(),
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(48).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const { category, q, sort, page, limit } = req.valid.query;
    res.json({
      ok: true,
      data: await catalog.listProducts({
        categorySlug: category,
        q,
        sort,
        page,
        limit,
      }),
    });
  })
);

/** GET /api/products/:slug */
router.get(
  '/products/:slug',
  validateParams(z.object({ slug: z.string().min(1).max(160) })),
  asyncHandler(async (req, res) => {
    const product = await catalog.getProductDetail(req.valid.params.slug);
    const reviewList = config.flags.reviewEnabled
      ? await reviews.listReviews(product.id)
      : [];
    res.json({ ok: true, data: { product, reviews: reviewList } });
  })
);

// ---------------- Reviews (ต้องซื้อสินค้าแล้วเท่านั้น) ----------------

router.get(
  '/products/:slug/reviews',
  validateParams(z.object({ slug: z.string().min(1).max(160) })),
  asyncHandler(async (req, res) => {
    const product = await catalog.getProductDetail(req.valid.params.slug);
    res.json({ ok: true, data: { reviews: await reviews.listReviews(product.id) } });
  })
);

router.post(
  '/products/:slug/reviews',
  requireAuth,
  validateParams(z.object({ slug: z.string().min(1).max(160) })),
  validateBody(
    z.object({
      rating: z.number().int().min(1).max(5),
      comment: z.string().trim().max(2000).optional().default(''),
    })
  ),
  asyncHandler(async (req, res) => {
    if (!config.flags.reviewEnabled) {
      return res.status(404).json({ ok: false, error: { message: 'ปิดระบบรีวิวอยู่' } });
    }
    const product = await catalog.getProductDetail(req.valid.params.slug);
    const review = await reviews.createReview({
      productId: product.id,
      userId: req.user.id,
      rating: req.valid.body.rating,
      comment: req.valid.body.comment,
    });
    res.status(201).json({ ok: true, data: { review } });
  })
);

export default router;

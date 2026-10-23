import { ApiError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ ok: false, error: { message: 'ไม่พบ endpoint ที่เรียกใช้' } });
}

/** map error ของ library ภายนอก -> ข้อความที่ปลอดภัย */
function normalize(err) {
  if (err instanceof ApiError) return err;

  // body-parser: JSON ผิดรูปแบบ
  if (err.type === 'entity.parse.failed') {
    return new ApiError(400, 'รูปแบบ JSON ไม่ถูกต้อง');
  }
  if (err.type === 'entity.too.large') {
    return new ApiError(413, 'ข้อมูลที่ส่งมามีขนาดใหญ่เกินไป');
  }
  // MySQL constraint
  if (err.code === 'ER_DUP_ENTRY') {
    return new ApiError(409, 'ข้อมูลซ้ำ (duplicate entry)');
  }
  if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_ROW_IS_REFERENCED_2') {
    return new ApiError(409, 'ข้อมูลอ้างอิงไม่ถูกต้อง');
  }
  if (err.code === 'ER_NO_SUCH_TABLE') {
    return new ApiError(500, 'ฐานข้อมูลยังไม่พร้อม (รัน npm run migrate)');
  }
  // multer
  if (err.code === 'LIMIT_FILE_SIZE') {
    return new ApiError(413, 'ไฟล์มีขนาดใหญ่เกินกำหนด');
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return new ApiError(400, 'อัปโหลดไฟล์ผิดฟิลด์');
  }
  // CORS ที่เราปฏิเสธ
  if (err.status === 403 && /Origin ไม่ได้รับอนุญาต/.test(err.message || '')) {
    return new ApiError(403, err.message);
  }
  if (typeof err.status === 'number' && err.expose) {
    return new ApiError(err.status, err.message);
  }
  return null;
}

export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const safe = normalize(err);
  if (safe) {
    if (safe.status >= 500) logger.error(`[${req.method}] ${req.path}`, err);
    return res.status(safe.status).json({
      ok: false,
      error: { message: safe.message, details: safe.details },
    });
  }

  // ไม่เปิดเผย stack trace / secret ต่อผู้ใช้
  logger.error(`[${req.method}] ${req.path} unexpected error`, err);
  res.status(500).json({
    ok: false,
    error: {
      message: 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่',
      ...(config.isProd ? {} : { dev: err.message }),
    },
  });
}

import fs from 'node:fs';
import { asyncHandler, errors } from '../utils/errors.js';
import {
  getLibrary,
  requestDownload,
  verifyDownloadRequest,
  markDownloadCompleted,
  getDownloadStatus,
  getMyDownloadHistory,
} from '../services/downloadService.js';

/** GET /api/library - สินค้าที่ซื้อแล้วของฉัน */
export const library = asyncHandler(async (req, res) => {
  res.json({ ok: true, data: { items: await getLibrary(req.user.id) } });
});

/** GET /api/downloads - ประวัติดาวน์โหลดของฉัน */
export const downloadHistory = asyncHandler(async (req, res) => {
  res.json({ ok: true, data: { downloads: await getMyDownloadHistory(req.user.id) } });
});

/**
 * POST /api/downloads/:productId - ออก Signed URL (หมดอายุ 5 นาที)
 * ผ่านทุกเงื่อนไขสิทธิ์เท่านั้น ไม่งั้น 403 + บันทึก log
 */
export const createDownload = asyncHandler(async (req, res) => {
  const productId = Number(req.valid.params.productId);
  const fileId = req.valid.body?.fileId ?? null;
  const result = await requestDownload({
    user: req.user,
    productId,
    fileId,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  res.status(201).json({
    ok: true,
    data: { ...result, message: `ลิงก์ดาวน์โหลดมีอายุ ${Math.floor(result.expiresInSeconds / 60)} นาที` },
  });
});

/** GET /api/downloads/:downloadId/status */
export const downloadStatus = asyncHandler(async (req, res) => {
  const status = await getDownloadStatus(Number(req.valid.params.downloadId), req.user.id);
  res.json({ ok: true, data: { download: status } });
});

/**
 * GET /api/downloads/:downloadId/file?token=...
 * ต้อง Login (session) + token HMAC ถูกต้อง + สิทธิ์ยังใช้ได้ -> จึงจะส่งไฟล์
 * ตำแหน่งไฟล์จริงไม่ถูกเปิดเผยใน URL หรือ response เด็ดขาด
 */
export const streamFile = asyncHandler(async (req, res) => {
  const downloadId = Number(req.params.downloadId);
  const token = String(req.query.token || '');
  if (!Number.isInteger(downloadId) || downloadId <= 0 || !token) {
    throw errors.forbidden('ลิงก์ดาวน์โหลดไม่ถูกต้อง');
  }

  const ctx = await verifyDownloadRequest({
    downloadId,
    token,
    user: req.user,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });

  const { originalName, mimeType, size } = ctx.file;
  const asciiName = originalName.replace(/[^\x20-\x7e]/g, '_');
  const encoded = encodeURIComponent(originalName);

  res.setHeader('Content-Type', mimeType || 'application/octet-stream');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`
  );
  res.setHeader('Content-Length', String(size));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');

  const stream = fs.createReadStream(ctx.absPath);
  let bytes = 0;
  stream.on('data', (chunk) => {
    bytes += chunk.length;
  });
  stream.on('error', async (err) => {
    // eslint-disable-next-line no-console
    console.error('[download] stream error', err.message);
    await markDownloadCompleted({ logId: ctx.logId, bytes });
    if (!res.headersSent) res.status(500).json({ ok: false, error: { message: 'อ่านไฟล์ไม่สำเร็จ' } });
    else res.destroy();
  });
  res.on('finish', () => markDownloadCompleted({ logId: ctx.logId, bytes }));
  stream.pipe(res);
});

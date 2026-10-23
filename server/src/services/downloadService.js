/**
 * Download Service - จุดที่สำคัญที่สุดของระบบ
 * กติกา:
 *  1. ต้อง Login และมีสิทธิ์ (user_library ที่ยังใช้งานได้) เท่านั้น
 *  2. Order ต้อง paid และไม่ถูกคืนเงิน/ยกเลิก
 *  3. Signed URL สร้างจาก Backend ด้วย HMAC + หมดอายุ (default 300 วินาที)
 *  4. ทุกครั้ง (ทั้งสำเร็จและถูกปฏิเสธ) บันทึก download_logs
 *  5. ทุก query ผูกกับ user_id ของผู้เรียกเสมอ -> เดา ID ข้ามบัญชีไม่ได้
 */
import path from 'node:path';
import fs from 'node:fs';
import { pool, q } from '../db/pool.js';
import { config } from '../config/index.js';
import { errors } from '../utils/errors.js';
import { hmacHex, safeEqual } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import { resolvePrivatePath } from './storageService.js';

const TOKEN_CONTEXT = 'signed_download_v1';

function signToken(downloadId, userId, fileId, exp) {
  return hmacHex(`${config.session.secret}|${TOKEN_CONTEXT}`, `${downloadId}.${userId}.${fileId}.${exp}`);
}

function buildToken(downloadId, userId, fileId) {
  const exp = Math.floor(Date.now() / 1000) + config.downloads.ttlSeconds;
  return { token: `${downloadId}.${userId}.${fileId}.${exp}.${signToken(downloadId, userId, fileId, exp)}`, exp };
}

async function insertLog(fields) {
  try {
    const [res] = await pool.execute(
      `INSERT INTO download_logs (user_id, product_id, order_id, entitlement_id, status, reason,
                                  token_expires_at, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fields.userId,
        fields.productId,
        fields.orderId ?? null,
        fields.entitlementId ?? null,
        fields.status,
        fields.reason ?? null,
        fields.tokenExpiresAt ?? null,
        (fields.ip || '').slice(0, 45) || null,
        (fields.userAgent || '').slice(0, 255) || null,
      ]
    );
    return res.insertId;
  } catch (err) {
    logger.error('download log insert failed', err);
    return null;
  }
}

const DENY_MESSAGES = {
  no_entitlement: 'คุณยังไม่มีสิทธิ์ดาวน์โหลดสินค้านี้',
  order_not_paid: 'คำสั่งซื้อยังไม่ได้ชำระเงิน จึงดาวน์โหลดไม่ได้',
  order_refunded: 'คำสั่งซื้อนี้ถูกคืนเงินแล้ว จึงดาวน์โหลดไม่ได้',
  order_cancelled: 'คำสั่งซื้อนี้ถูกยกเลิก จึงดาวน์โหลดไม่ได้',
  entitlement_revoked: 'สิทธิ์ดาวน์โหลดถูกถอนออกแล้ว',
  entitlement_expired: 'สิทธิ์ดาวน์โหลดหมดอายุแล้ว',
  download_limit_reached: 'ใช้จำนวนครั้งในการดาวน์โหลดครบแล้ว',
  no_files: 'สินค้านี้ยังไม่มีไฟล์สำหรับดาวน์โหลด',
  invalid_token: 'ลิงก์ดาวน์โหลดไม่ถูกต้อง',
  expired_token: 'ลิงก์ดาวน์โหลดหมดอายุแล้ว กรุณาขอใหม่',
  user_mismatch: 'ลิงก์ดาวน์โหลดไม่ตรงกับบัญชีของคุณ',
  log_not_found: 'ไม่พบคำขอดาวน์โหลดนี้',
};

/**
 * ออก Signed Download URL ให้ผู้ใช้ที่มีสิทธิ์
 * POST /api/downloads/:productId
 */
export async function requestDownload({ user, productId, fileId, ip, userAgent }) {
  const deny = async (reason, status = 'denied') => {
    await insertLog({
      userId: user.id,
      productId,
      status,
      reason,
      ip,
      userAgent,
    });
    throw errors.forbidden(DENY_MESSAGES[reason] || 'ไม่มีสิทธิ์ดาวน์โหลด');
  };

  // 1. สิทธิ์ในคลัง
  const [ents] = await pool.execute(
    `SELECT * FROM user_library WHERE user_id = ? AND product_id = ? LIMIT 1`,
    [user.id, productId]
  );
  if (ents.length === 0) await deny('no_entitlement');
  const ent = ents[0];
  if (ent.revoked_at) await deny('entitlement_revoked');

  // 2. คำสั่งซื้อต้อง paid และไม่ถูกคืนเงิน
  const [ords] = await pool.execute('SELECT * FROM orders WHERE id = ? LIMIT 1', [ent.order_id]);
  if (ords.length === 0) await deny('order_not_paid');
  const order = ords[0];
  if (order.status === 'refunded') await deny('order_refunded', 'denied');
  if (order.status === 'cancelled') await deny('order_cancelled');
  if (order.status !== 'paid') await deny('order_not_paid');

  // 3. หมดอายุ / จำกัดจำนวน
  if (ent.expires_at && new Date(ent.expires_at).getTime() < Date.now()) {
    await deny('entitlement_expired', 'expired');
  }
  if (ent.max_downloads != null && ent.download_count >= ent.max_downloads) {
    await deny('download_limit_reached');
  }

  // 4. เลือกไฟล์ (ต้องเป็นไฟล์ของสินค้านี้เท่านั้น)
  let fileRows;
  if (fileId) {
    const [rows] = await pool.execute(
      'SELECT * FROM product_files WHERE id = ? AND product_id = ? LIMIT 1',
      [fileId, productId]
    );
    if (rows.length === 0) await deny('no_files');
    fileRows = rows;
  } else {
    const [rows] = await pool.execute(
      'SELECT * FROM product_files WHERE product_id = ? ORDER BY is_primary DESC, sort_order ASC, id ASC LIMIT 1',
      [productId]
    );
    if (rows.length === 0) await deny('no_files');
    fileRows = rows;
  }
  const file = fileRows[0];

  // 5. ออก token + บันทึก log + นับจำนวนครั้ง (นับตอนออกสิทธิ์ กันยิงซ้ำพร้อมกัน)
  const expiresAt = new Date(Date.now() + config.downloads.ttlSeconds * 1000);
  const logId = await insertLog({
    userId: user.id,
    productId,
    orderId: order.id,
    entitlementId: ent.id,
    status: 'issued',
    reason: null,
    tokenExpiresAt: expiresAt,
    ip,
    userAgent,
  });
  if (logId == null) throw errors.internal('บันทึกประวัติดาวน์โหลดไม่สำเร็จ');

  await pool.execute('UPDATE user_library SET download_count = download_count + 1 WHERE id = ?', [
    ent.id,
  ]);

  const { token, exp } = buildToken(logId, user.id, file.id);
  const remaining =
    ent.max_downloads == null ? null : Math.max(ent.max_downloads - (ent.download_count + 1), 0);

  return {
    downloadId: logId,
    token,
    // คืน URL สัมพัทธ์ เพื่อให้บราวเซอร์เรียกผ่าน origin เดิม (ส่ง session cookie ได้)
    // dev: ผ่าน Vite proxy / prod: เสิร์ฟจากโดเมนเดียวกัน
    url: `/api/downloads/${logId}/file?token=${encodeURIComponent(token)}`,
    expiresAt: expiresAt.toISOString(),
    expiresInSeconds: config.downloads.ttlSeconds,
    fileName: file.original_name,
    fileSize: Number(file.file_size),
    remainingDownloads: remaining,
    maxDownloads: ent.max_downloads,
  };
}

/**
 * ตรวจสอบ token ก่อนส่งไฟล์ (เรียกโดย controller ที่จะ stream ไฟล์)
 * ปฏิเสธทุกกรณีพร้อมบันทึก log และข้อความไทย
 */
export async function verifyDownloadRequest({ downloadId, token, user, ip, userAgent }) {
  const deny = async (reason, status = 'denied', extra = {}) => {
    await insertLog({
      userId: extra.logUserId ?? user.id,
      productId: extra.logProductId ?? 0,
      status,
      reason,
      ip,
      userAgent,
    });
    const err = new Error(DENY_MESSAGES[reason] || 'ไม่มีสิทธิ์ดาวน์โหลด');
    err.status = reason === 'expired_token' || reason === 'invalid_token' ? 403 : 403;
    err.expose = true;
    throw err;
  };

  // parse + ตรวจ HMAC + อายุ
  const parts = String(token || '').split('.');
  if (parts.length !== 5) return deny('invalid_token');
  const [tokId, tokUid, tokFid, tokExp, tokSig] = parts;
  if (!safeEqual(tokId, String(downloadId)) || !safeEqual(tokUid, String(user.id))) {
    return deny('user_mismatch');
  }
  const exp = Number(tokExp);
  if (!Number.isFinite(exp) || Math.floor(Date.now() / 1000) > exp) {
    return deny('expired_token', 'expired');
  }
  const expected = signToken(Number(tokId), user.id, Number(tokFid), exp);
  if (!safeEqual(expected, tokSig)) return deny('invalid_token');

  // log row ต้องมี + ต้องเป็นของผู้ใช้นี้เท่านั้น (กันเดา downloadId)
  const [logs] = await pool.execute(
    'SELECT * FROM download_logs WHERE id = ? LIMIT 1',
    [Number(tokId)]
  );
  if (logs.length === 0) return deny('log_not_found');
  const log = logs[0];
  if (log.user_id !== user.id) return deny('user_mismatch', 'denied', { logUserId: user.id, logProductId: log.product_id });
  if (!['issued', 'completed'].includes(log.status)) return deny('log_not_found', 'denied', { logProductId: log.product_id });
  if (log.token_expires_at && new Date(log.token_expires_at).getTime() < Date.now()) {
    return deny('expired_token', 'expired', { logProductId: log.product_id });
  }

  // re-check สิทธิ์สด (อาจถูกคืนเงิน/ถอนหลังออก token)
  const [ents] = await pool.execute(
    'SELECT * FROM user_library WHERE user_id = ? AND product_id = ? LIMIT 1',
    [user.id, log.product_id]
  );
  if (ents.length === 0) return deny('no_entitlement', 'denied', { logProductId: log.product_id });
  const ent = ents[0];
  if (ent.revoked_at) return deny('entitlement_revoked', 'denied', { logProductId: log.product_id });
  if (ent.expires_at && new Date(ent.expires_at).getTime() < Date.now()) {
    return deny('entitlement_expired', 'expired', { logProductId: log.product_id });
  }
  const [ords] = await pool.execute('SELECT status FROM orders WHERE id = ?', [ent.order_id]);
  if (ords.length === 0 || ords[0].status !== 'paid') {
    return deny(ords[0]?.status === 'refunded' ? 'order_refunded' : 'order_not_paid', 'denied', {
      logProductId: log.product_id,
    });
  }

  // โหลดไฟล์ + resolve path ปลอดภัย
  const [files] = await pool.execute('SELECT * FROM product_files WHERE id = ? LIMIT 1', [
    Number(tokFid),
  ]);
  if (files.length === 0 || files[0].product_id !== log.product_id) {
    return deny('no_files', 'failed', { logProductId: log.product_id });
  }
  const file = files[0];
  const absPath = resolvePrivatePath(file.storage_key);
  if (!fs.existsSync(absPath)) {
    await insertLog({
      userId: user.id,
      productId: log.product_id,
      status: 'failed',
      reason: 'file_missing_on_disk',
      ip,
      userAgent,
    });
    throw errors.notFound('ไม่พบไฟล์สินค้าบนเซิร์ฟเวอร์ (แจ้งผู้ดูแลระบบ)');
  }

  return {
    logId: log.id,
    productId: log.product_id,
    orderId: ent.order_id,
    entitlementId: ent.id,
    absPath,
    file: {
      originalName: file.original_name,
      mimeType: file.mime_type,
      size: Number(file.file_size),
    },
  };
}

/** ทำเครื่องหมายดาวน์โหลดสำเร็จ */
export async function markDownloadCompleted({ logId, bytes }) {
  await pool.execute(
    `UPDATE download_logs SET status = 'completed', bytes_sent = ?, completed_at = NOW() WHERE id = ?`,
    [bytes, logId]
  );
}

/** สถานะการดาวน์โหลด: GET /api/downloads/:downloadId/status (เจ้าของเท่านั้น) */
export async function getDownloadStatus(downloadId, userId) {
  const [rows] = await pool.execute(
    `SELECT d.id, d.status, d.reason, d.created_at, d.completed_at, d.token_expires_at, d.bytes_sent,
            p.title AS product_title, p.slug AS product_slug
     FROM download_logs d
     JOIN products p ON p.id = d.product_id
     WHERE d.id = ? AND d.user_id = ? LIMIT 1`,
    [Number(downloadId), userId]
  );
  if (rows.length === 0) throw errors.notFound('ไม่พบประวัติการดาวน์โหลดนี้');
  const r = rows[0];
  return {
    downloadId: r.id,
    status: r.status,
    reason: r.reason,
    productTitle: r.product_title,
    createdAt: r.created_at,
    completedAt: r.completed_at,
    tokenExpiresAt: r.token_expires_at,
    bytesSent: r.bytes_sent != null ? Number(r.bytes_sent) : null,
  };
}

/** My Library: GET /api/library */
export async function getLibrary(userId) {
  const rows = await q(
    `SELECT l.id, l.product_id, l.order_id, l.download_count, l.max_downloads, l.expires_at,
            l.granted_at, l.revoked_at, l.revoked_reason,
            p.title, p.slug, p.cover_image_url, p.status AS product_status,
            o.order_number, o.paid_at,
            (SELECT COUNT(*) FROM product_files f WHERE f.product_id = l.product_id) AS file_count
     FROM user_library l
     JOIN products p ON p.id = l.product_id
     JOIN orders o ON o.id = l.order_id
     WHERE l.user_id = ?
     ORDER BY l.granted_at DESC`,
    [userId]
  );
  return rows.map((r) => ({
    entitlementId: r.id,
    productId: r.product_id,
    title: r.title,
    slug: r.slug,
    coverImageUrl: r.cover_image_url,
    orderNumber: r.order_number,
    grantedAt: r.granted_at,
    paidAt: r.paid_at,
    expiresAt: r.expires_at,
    maxDownloads: r.max_downloads,
    downloadCount: r.download_count,
    remainingDownloads:
      r.max_downloads == null ? null : Math.max(r.max_downloads - r.download_count, 0),
    fileCount: r.file_count,
    revoked: Boolean(r.revoked_at),
    revokedReason: r.revoked_reason,
    active: !r.revoked_at && (!r.expires_at || new Date(r.expires_at).getTime() > Date.now()),
  }));
}

/** ประวัติดาวน์โหลดของผู้ใช้ตัวเอง: GET /api/downloads */
export async function getMyDownloadHistory(userId, limit = 50) {
  const rows = await q(
    `SELECT d.id, d.status, d.reason, d.created_at, d.completed_at, d.bytes_sent,
            p.title AS product_title
     FROM download_logs d JOIN products p ON p.id = d.product_id
     WHERE d.user_id = ? ORDER BY d.created_at DESC LIMIT ?`,
    [userId, Math.min(Number(limit) || 50, 200)]
  );
  return rows.map((r) => ({
    downloadId: r.id,
    status: r.status,
    reason: r.reason,
    productTitle: r.product_title,
    createdAt: r.created_at,
    completedAt: r.completed_at,
    bytesSent: r.bytes_sent != null ? Number(r.bytes_sent) : null,
  }));
}

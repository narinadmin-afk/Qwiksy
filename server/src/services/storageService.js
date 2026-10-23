/**
 * Storage Service - แยกการจัดเก็บไฟล์ชัดเจน
 * - publicDir  : ภาพปก/ภาพตัวอย่าง (เข้าถึงได้ผ่าน /uploads เท่านั้น)
 * - privateDir : ไฟล์สินค้าต้นฉบับ ห้าม mount เป็น static เด็ดขาด
 *                การดาวน์โหลดต้องผ่าน backend ตรวจสิทธิ์เท่านั้น
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { errors } from '../utils/errors.js';

/** นามสกุลไฟล์ที่อนุญาตให้เป็น "ไฟล์สินค้า" (private) */
export const ALLOWED_PRODUCT_EXTS = new Set([
  '.pdf', '.epub', '.zip', '.rar', '.7z', '.txt', '.md',
  '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
  '.psd', '.ai', '.sketch', '.fig', '.xd',
  '.mp4', '.mov', '.webm', '.mkv',
  '.mp3', '.wav', '.flac', '.m4a', '.ogg',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.csv', '.json',
]);

/** นามสกุลที่อนุญาตเป็นรูปภาพสาธารณะ (ปก/ตัวอย่าง) */
export const ALLOWED_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

export function ensureStorageDirs() {
  for (const dir of [
    config.storage.publicDir,
    path.join(config.storage.publicDir, 'uploads', 'covers'),
    path.join(config.storage.publicDir, 'uploads', 'previews'),
    config.storage.privateDir,
    path.join(config.storage.privateDir, 'products'),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** resolve path ภายใน privateDir เท่านั้น (กัน path traversal) */
export function resolvePrivatePath(storageKey) {
  const base = path.resolve(config.storage.privateDir);
  const abs = path.resolve(base, String(storageKey));
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    loggerErrorTraversal(storageKey);
    throw errors.internal('path ไฟล์ไม่ถูกต้อง');
  }
  return abs;
}

function loggerErrorTraversal(key) {
  // eslint-disable-next-line no-console
  console.error('[storage] TRAVERSAL BLOCKED key=', String(key).slice(0, 200));
}

/** ตรวจสอบนามสกุลไฟล์สินค้า */
export function assertProductExt(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  if (!ALLOWED_PRODUCT_EXTS.has(ext)) {
    throw errors.badRequest(`ไฟล์นามสกุล ${ext || '(ไม่มี)'} ไม่ได้รับอนุญาตให้อัปโหลด`);
  }
  return ext;
}

export function assertImageExt(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  if (!ALLOWED_IMAGE_EXTS.has(ext)) {
    throw errors.badRequest(`ไฟล์รูปภาพต้องเป็น ${[...ALLOWED_IMAGE_EXTS].join(' / ')}`);
  }
  return ext;
}

/** โฟลเดอร์สินค้าใน private storage */
export function productPrivateDir(productId) {
  const dir = path.join(config.storage.privateDir, 'products', `p${Number(productId)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** ลบไฟล์ (เงียบๆ ถ้าไม่พบ) */
export function removeFile(absPath) {
  try {
    if (absPath && fs.existsSync(absPath)) fs.unlinkSync(absPath);
  } catch {
    /* ignore */
  }
}

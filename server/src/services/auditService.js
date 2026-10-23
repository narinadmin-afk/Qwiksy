import { pool } from '../db/pool.js';
import { logger } from '../utils/logger.js';

/**
 * บันทึก Audit Log ของ Admin - ทุกการกระทำสำคัญต้องผ่านฟังก์ชันนี้
 * รองรับเรียกภายในธุรกรรม (conn) หรือแยกเดี่ยว
 */
export async function writeAudit({ admin, action, entityType, entityId, before, after, reason, ip }, conn) {
  const exec = conn ? (...a) => conn.execute(...a) : (...a) => pool.execute(...a);
  try {
    await exec(
      `INSERT INTO admin_audit_logs
         (admin_user_id, admin_email, action, entity_type, entity_id, before_data, after_data, reason, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        admin?.id ?? null,
        String(admin?.email || '').slice(0, 255),
        String(action).slice(0, 60),
        String(entityType).slice(0, 40),
        String(entityId).slice(0, 64),
        before ? JSON.stringify(before).slice(0, 20000) : null,
        after ? JSON.stringify(after).slice(0, 20000) : null,
        reason ? String(reason).slice(0, 255) : null,
        ip ? String(ip).slice(0, 45) : null,
      ]
    );
  } catch (err) {
    // audit ห้ามทำให้ธุรกรรมหลักพัง แต่ต้องรายงาน
    logger.error('audit log failed', { action, err: err.message });
  }
}

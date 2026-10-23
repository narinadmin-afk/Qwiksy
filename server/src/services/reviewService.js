import { pool, q, withTransaction } from '../db/pool.js';
import { errors } from '../utils/errors.js';

/** รายการรีวิว (แสดงเฉพาะชื่อที่แสดง ไม่เปิดเผยอีเมล) */
export async function listReviews(productId) {
  return q(
    `SELECT r.id, r.rating, r.comment, r.created_at,
            u.display_name AS user_name, u.avatar_url AS user_avatar
     FROM reviews r
     JOIN users u ON u.id = r.user_id
     WHERE r.product_id = ?
     ORDER BY r.created_at DESC
     LIMIT 100`,
    [productId]
  );
}

/**
 * สร้างรีวิว - เฉพาะผู้ที่มีสิทธิ์ดาวน์โหลด (ซื้อแล้ว) เท่านั้น
 * 1 คน / 1 สินค้า และอัปเดตค่าเฉลี่ยคะแนนครั้งเดียวในธุรกรรมเดียว
 */
export async function createReview({ productId, userId, rating, comment }) {
  return withTransaction(async (conn) => {
    const [ent] = await conn.execute(
      `SELECT id FROM user_library
       WHERE user_id = ? AND product_id = ? AND revoked_at IS NULL
       LIMIT 1`,
      [userId, productId]
    );
    if (ent.length === 0) {
      throw errors.forbidden('ต้องซื้อสินค้านี้ก่อนจึงจะรีวิวได้');
    }

    const [existing] = await conn.execute(
      'SELECT id FROM reviews WHERE product_id = ? AND user_id = ? LIMIT 1',
      [productId, userId]
    );
    if (existing.length > 0) {
      throw errors.conflict('คุณได้รีวิวสินค้านี้ไปแล้ว');
    }

    await conn.execute(
      'INSERT INTO reviews (product_id, user_id, rating, comment) VALUES (?, ?, ?, ?)',
      [productId, userId, rating, comment || null]
    );

    // อัปเดต aggregate จากฐานข้อมูลจริง (กันค่าเพี้ยน)
    await conn.execute(
      `UPDATE products p
       SET p.rating_avg = (SELECT ROUND(AVG(rating), 2) FROM reviews WHERE product_id = ?),
           p.rating_count = (SELECT COUNT(*) FROM reviews WHERE product_id = ?)
       WHERE p.id = ?`,
      [productId, productId, productId]
    );

    const [rows] = await conn.execute(
      `SELECT r.id, r.rating, r.comment, r.created_at,
              u.display_name AS user_name, u.avatar_url AS user_avatar
       FROM reviews r JOIN users u ON u.id = r.user_id
       WHERE r.product_id = ? AND r.user_id = ?`,
      [productId, userId]
    );
    return rows[0];
  });
}

/** Admin ลบรายงานรีวิว (มี audit log เรียกจาก caller) */
export async function deleteReview(reviewId) {
  const [rows] = await pool.execute('SELECT * FROM reviews WHERE id = ?', [reviewId]);
  if (rows.length === 0) throw errors.notFound('ไม่พบรีวิวนี้');
  await pool.execute('DELETE FROM reviews WHERE id = ?', [reviewId]);
  await pool.execute(
    `UPDATE products p
     SET p.rating_avg = COALESCE((SELECT ROUND(AVG(rating),2) FROM reviews WHERE product_id = p.id), 0),
         p.rating_count = (SELECT COUNT(*) FROM reviews WHERE product_id = p.id)
     WHERE p.id = ?`,
    [rows[0].product_id]
  );
  return rows[0];
}

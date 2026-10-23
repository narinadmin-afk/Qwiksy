import mysql from 'mysql2/promise';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  connectionLimit: config.db.connectionLimit,
  waitForConnections: true,
  charset: 'utf8mb4',
  timezone: '+00:00',
  decimalNumbers: true, // DECIMAL -> number (คำนวณฝั่ง server เสมอด้วย integer cents)
  namedPlaceholders: false,
});

// ให้ timestamp ของ MySQL (NOW()/CURDATE()) เป็น UTC ตรงกับ Date ที่ JS ใส่เข้าไป
// กันสับสนเวลาระหว่าง DB กับ ฝั่งโค้ด (ทุกตารางเก็บเวลาเป็น UTC)
pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00'");
});

/** query แบบคืน rows อย่างเดียว */
export async function q(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/** query แบบคืน [rows, fields] */
export async function qi(sql, params = []) {
  return pool.execute(sql, params);
}

/** query ที่รองรับหลาย statements (ใช้เฉพาะ migration) */
export async function qMulti(sql) {
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    multipleStatements: true,
    charset: 'utf8mb4',
    timezone: '+00:00',
  });
  try {
    return await conn.query(sql);
  } finally {
    await conn.end();
  }
}

/**
 * รันธุรกรรม: commit เมื่อสำเร็จ, rollback เมื่อ error
 * fn ได้รับ connection ที่ถือ transaction อยู่ (ห้ามใช้ pool แทน)
 */
export async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch (rbErr) {
      logger.error('rollback failed', rbErr);
    }
    throw err;
  } finally {
    conn.release();
  }
}

export async function pingDb() {
  await pool.query('SELECT 1');
}

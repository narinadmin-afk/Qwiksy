import session from 'express-session';
import MySQLStore from 'express-mysql-session';
import { config } from '../config/index.js';

const MySQLSessionStore = MySQLStore(session);

const store = new MySQLSessionStore({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  table: 'sessions',
  createDatabaseTable: true,
  checkPeriod: 86400000,
  expires: config.session.ttlMs,
  schema: {
    tableName: 'sessions',
    columnNames: {
      session_id: 'session_id',
      expires: 'expires',
      data: 'data',
    },
  },
});

export const sessionMiddleware = session({
  name: 'dmp_sid',
  secret: config.session.secret,
  store,
  resave: false,
  saveUninitialized: false,
  rolling: false,
  cookie: {
    httpOnly: true,      // JS อ่านไม่ได้ ป้องกัน XSS ขโมย session
    sameSite: 'lax',     // ป้องกัน CSRF ขั้นพื้นฐาน + ให้ OAuth callback ทำงาน
    secure: config.session.cookieSecure, // true หลัง HTTPS เท่านั้น
    maxAge: config.session.ttlMs,
    path: '/',
  },
});

/** ทำลาย session ของผู้ใช้ (logout) */
export function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session?.destroy((err) => (err ? reject(err) : resolve()));
  });
}

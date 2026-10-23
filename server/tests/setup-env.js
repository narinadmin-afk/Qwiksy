/**
 * สภาพแวดล้อมสำหรับทดสอบ - ต้องถูก import "ก่อน" โมดูลฝั่ง src ทุกครั้ง
 * (ESM hoist imports ตามลำดับที่เขียน ไฟล์นี้จึงแยกต่างหาก)
 */
process.env.NODE_ENV = 'test';
process.env.DB_NAME = 'digital_marketplace_test';
process.env.PAYMENT_MODE = 'test';
process.env.AUTO_MIGRATE = 'false';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.TEST_WEBHOOK_SECRET = 'test_webhook_secret_for_tests';
process.env.SESSION_SECRET = 'test_session_secret_at_least_32_chars_long';
process.env.ADMIN_EMAILS = 'admin@demo.test';
process.env.APP_URL = 'http://localhost:5173';
// ผ่อน rate limit สำหรับชุดทดสอบ (middleware ยังทำงานอยู่ แต่ไม่ขัดจังหวะชุดทดสอบ)
process.env.RATE_LOGIN_MAX = '1000';
process.env.RATE_GENERAL_MAX = '100000';
process.env.RATE_DOWNLOAD_MAX = '10000';
process.env.RATE_CHECKOUT_MAX = '10000';

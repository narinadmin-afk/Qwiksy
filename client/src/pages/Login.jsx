import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

/** ข้อความไทยสำหรับ error code จาก OAuth callback */
const ERROR_MESSAGES = {
  not_configured: 'ระบบยังไม่ได้ตั้งค่า Google OAuth - กรุณาตั้งค่า GOOGLE_CLIENT_ID/SECRET ตามคู่มือ docs/GOOGLE_OAUTH_SETUP.md',
  state_mismatch: 'การเข้าสู่ระบบไม่ถูกต้อง (หมดอายุหรือถูกขัดจังหวะ) กรุณาลองใหม่อีกครั้ง',
  denied: 'คุณยกเลิกการเข้าสู่ระบบกับ Google',
  exchange_failed: 'Google ปฏิเสธการเข้าสู่ระบบ กรุณาลองใหม่',
  email_not_verified: 'ต้องใช้อีเมลที่ Google ยืนยันแล้วเท่านั้น',
  suspended: 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ',
  bad_request: 'ลิงก์เข้าสู่ระบบไม่ถูกต้อง กรุณาลองใหม่',
};

export default function Login() {
  const { user, loading, loginWithGoogle, authStatus } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useState(() => new URLSearchParams(location.search));
  const status = params.get('status');
  const error = params.get('error');
  const next = location.state?.next || '/';

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (!loading && user) navigate(next, { replace: true });
  }, [user, loading, navigate, next]);

  useEffect(() => {
    if (status === 'success') {
      // ล้าง query string
      navigate('/login', { replace: true, state: location.state });
    }
  }, [status, navigate, location.state]);

  return (
    <div className="container">
      <div className="auth-wrap">
        <div className="auth-card">
          <img
            src="/logo.jpg"
            alt="Qwiksy"
            style={{ width: 52, height: 52, borderRadius: 14, margin: '0 auto 14px', objectFit: 'cover', display: 'block' }}
          />
          <h1 style={{ fontSize: 24, margin: '0 0 6px' }}>เข้าสู่ระบบ</h1>
          <p style={{ color: 'var(--text-2)', fontSize: 15, marginTop: 0 }}>
            ซื้อ ดาวน์โหลด และจัดการสินค้าดิจิทัลของคุณ
          </p>

          {status === 'success' && !user && (
            <div className="success-box">✓ เข้าสู่ระบบสำเร็จ กำลังพาคุณไป...</div>
          )}
          {error && (
            <div className="error-box">{ERROR_MESSAGES[error] || 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่'}</div>
          )}

          {!authStatus.configured && (
            <div className="warning-box">
              ⚙️ ยังไม่ได้ตั้งค่า Google OAuth
              <br />
              <span style={{ fontSize: 13.5 }}>
                สร้าง OAuth Client จาก Google Cloud Console แล้วใส่ค่าในไฟล์ .env
                (ดูขั้นตอนใน <strong>docs/GOOGLE_OAUTH_SETUP.md</strong>) เพื่อเปิดใช้ปุ่มนี้
              </span>
            </div>
          )}

          <button
            className="google-btn"
            onClick={loginWithGoogle}
            disabled={!authStatus.configured || loading}
            style={{ marginTop: 14 }}
          >
            <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/>
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
              <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
              <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.3 5.2C36.9 40.2 44 35 44 24c0-1.3-.1-2.6-.4-3.9z"/>
            </svg>
            เข้าสู่ระบบด้วย Google
          </button>

          <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 18, marginBottom: 0 }}>
            การเข้าสู่ระบบจะตรวจสอบตัวตนจากฝั่งเซิร์ฟเวอร์กับ Google โดยตรง
            <br />
            เราไม่เก็บรหัสผ่านของคุณ และจะเชื่อมบัญชีกับอีเมลที่ Google ยืนยันแล้วเท่านั้น
          </p>
        </div>

        <p style={{ fontSize: 14, marginTop: 18 }}>
          <Link to="/" style={{ color: 'var(--primary)' }}>
            ← กลับหน้าแรก
          </Link>
        </p>
      </div>
    </div>
  );
}

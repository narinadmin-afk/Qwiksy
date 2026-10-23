import { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { apiGet } from '../api.js';
import { useCart } from '../cart.js';
import { formatTHB, formatDate } from '../format.js';
import { EmptyState } from '../components/States.jsx';

/** หน้ายืนยันคำสั่งซื้อ: แสดงสรุป + ไปหน้าชำระเงิน */
export default function Checkout() {
  const cart = useCart();
  const navigate = useNavigate();
  const location = useLocation();
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);

  useEffect(() => {
    if (cart.items.length === 0) {
      setLoading(false);
      return;
    }
    apiPostQuote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function apiPostQuote() {
    setLoading(true);
    try {
      const { apiPost } = await import('../api.js');
      const data = await apiPost('/api/cart/quote', { items: cart.items });
      setQuote(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const placeOrder = async () => {
    setPlacing(true);
    setError(null);
    try {
      const { apiPost } = await import('../api.js');
      const data = await apiPost('/api/checkout', { items: cart.items });
      cart.clear();
      navigate(`/pay/${data.order.orderNumber}`, { replace: true });
    } catch (err) {
      setError(err.message);
      apiPostQuote();
    } finally {
      setPlacing(false);
    }
  };

  if (cart.items.length === 0 && !loading) {
    return (
      <div className="container">
        <EmptyState
          icon="🛒"
          title="ไม่มีสินค้าสำหรับชำระเงิน"
          description="ตะกร้าของคุณว่าง - เลือกสินค้าก่อนดำเนินการชำระเงิน"
          action={
            <Link to="/products" className="btn">
              เลือกซื้อสินค้า
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: 720 }}>
      <div className="crumbs">
        <Link to="/cart">ตะกร้า</Link> / <span>ยืนยันคำสั่งซื้อ</span>
      </div>
      <h1 style={{ fontSize: 26 }}>ยืนยันคำสั่งซื้อ</h1>

      {error && <div className="error-box">{error}</div>}

      <div className="panel" style={{ marginBottom: 18 }}>
        <h3>รายการสินค้า</h3>
        {(quote?.items || []).map((line) => (
          <div
            key={line.productId}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 0',
              borderBottom: '1px dashed var(--border)',
              fontSize: 14.5,
            }}
          >
            <span>
              {line.title} <span style={{ color: 'var(--text-3)' }}>× {line.quantity}</span>
            </span>
            <strong>{formatTHB(line.lineTotal)}</strong>
          </div>
        ))}
        {loading && <div className="skeleton" style={{ height: 80 }} />}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 800, paddingTop: 12 }}>
          <span>ยอดสุทธิ</span>
          <span>{formatTHB(quote?.total || 0)}</span>
        </div>
      </div>

      <div className="warning-box">
        💡 หลังกดยืนยัน ระบบจะสร้างคำสั่งซื้อและแสดง QR สำหรับชำระเงิน (อายุคำสั่งซื้อ 30 นาที)
        สินค้าจะปลดล็อกใน My Library ก็ต่อเมื่อระบบยืนยันการชำระเงินสำเร็จเท่านั้น
      </div>

      <button className="btn btn-lg btn-block" onClick={placeOrder} disabled={placing || loading || !quote}>
        {placing ? 'กำลังสร้างคำสั่งซื้อ...' : `ยืนยันและชำระเงิน ${formatTHB(quote?.total || 0)}`}
      </button>
      <p style={{ textAlign: 'center', fontSize: 13.5, color: 'var(--text-3)', marginTop: 12 }}>
        ราคาถูกคำนวณและยืนยันจากเซิร์ฟเวอร์ทุกครั้ง ไม่สามารถแก้ไขจากหน้าเว็บได้
      </p>
    </div>
  );
}

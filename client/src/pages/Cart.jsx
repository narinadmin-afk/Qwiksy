import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiPost } from '../api.js';
import { useCart } from '../cart.js';
import { useAuth } from '../auth.jsx';
import { formatTHB } from '../format.js';
import { LoadingGrid, EmptyState, ErrorState } from '../components/States.jsx';

export default function Cart() {
  const cart = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [quote, setQuote] = useState(null);
  const [couponInput, setCouponInput] = useState('');
  const [coupon, setCoupon] = useState(null); // รหัสที่ใช้งานได้
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [placing, setPlacing] = useState(false);

  const itemsKey = JSON.stringify(cart.items);

  const loadQuote = async (code) => {
    if (cart.items.length === 0) {
      setQuote(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const body = { items: cart.items };
      if (code) body.couponCode = code;
      const data = await apiPost('/api/cart/quote', body);
      setQuote(data);
      if (code) {
        if (data.coupon) setCoupon(code);
        else setCoupon(null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQuote(coupon);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey]);

  const applyCoupon = async () => {
    await loadQuote(couponInput.trim().toUpperCase() || null);
  };

  const checkout = async () => {
    if (!user) {
      navigate('/login', { state: { next: '/cart' } });
      return;
    }
    setPlacing(true);
    setError(null);
    try {
      const body = { items: cart.items };
      if (coupon) body.couponCode = coupon;
      const data = await apiPost('/api/checkout', body);
      cart.clear();
      navigate(`/pay/${data.order.orderNumber}`);
    } catch (err) {
      // สินค้าปิดขาย/คูปองมีปัญหา -> รีเฟรช quote ใหม่
      setError(err.message);
      loadQuote(coupon);
    } finally {
      setPlacing(false);
    }
  };

  if (cart.items.length === 0 && !loading) {
    return (
      <div className="container">
        <EmptyState
          icon="🛒"
          title="ตะกร้าสินค้าว่าง"
          description="เลือกสินค้าดิจิทัลที่ชอบแล้วเพิ่มลงตะกร้าได้เลย"
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
    <div className="container">
      <div className="crumbs">
        <Link to="/">หน้าแรก</Link> / <span>ตะกร้าสินค้า</span>
      </div>
      <h1 style={{ fontSize: 26 }}>ตะกร้าสินค้า</h1>

      {error && <div className="error-box">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 24, alignItems: 'start' }} className="cart-grid">
        <div className="panel" style={{ padding: 0 }}>
          <div className="table-wrap" style={{ border: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>สินค้า</th>
                  <th style={{ textAlign: 'center' }}>จำนวน</th>
                  <th className="num">ราคารวม</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(quote?.items || []).map((line) => (
                  <tr key={line.productId}>
                    <td>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        {line.coverImageUrl ? (
                          <img
                            src={line.coverImageUrl}
                            alt=""
                            style={{ width: 64, height: 44, objectFit: 'cover', borderRadius: 8 }}
                          />
                        ) : (
                          <div style={{ width: 64, height: 44, background: 'var(--surface-2)', borderRadius: 8, display: 'grid', placeItems: 'center' }}>
                            🛍️
                          </div>
                        )}
                        <div>
                          <Link to={`/products/${line.slug}`} style={{ fontWeight: 600, fontSize: 14.5 }}>
                            {line.title}
                          </Link>
                          <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
                            {formatTHB(line.unitPrice)}/ชิ้น
                            {Number(line.discountPercent) > 0 && ` (ลด ${line.discountPercent}%)`}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div className="qty" style={{ margin: '0 auto' }}>
                        <button onClick={() => cart.setQuantity(line.productId, line.quantity - 1)} aria-label="ลด">
                          −
                        </button>
                        <span>{line.quantity}</span>
                        <button onClick={() => cart.setQuantity(line.productId, line.quantity + 1)} aria-label="เพิ่ม">
                          +
                        </button>
                      </div>
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {formatTHB(line.lineTotal)}
                    </td>
                    <td className="num">
                      <button className="btn btn-ghost btn-sm" onClick={() => cart.remove(line.productId)}>
                        🗑
                      </button>
                    </td>
                  </tr>
                ))}
                {loading && (
                  <tr>
                    <td colSpan={4}>
                      <div className="skeleton" style={{ height: 60 }} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {(quote?.unavailable || []).length > 0 && (
            <div className="warning-box" style={{ margin: 14 }}>
              ⚠️ สินค้าบางรายการถูกปิดการขายและถูกนำออกจากตะกร้าโดยอัตโนมัติ
            </div>
          )}
        </div>

        <div className="panel">
          <h3>สรุปยอดชำระ</h3>

          <div className="field">
            <label>คูปองส่วนลด</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                placeholder="เช่น WELCOME10"
                disabled={loading}
              />
              <button className="btn btn-outline" onClick={applyCoupon} disabled={loading} type="button">
                ใช้
              </button>
            </div>
            {quote?.couponError && <span className="err">{quote.couponError}</span>}
            {quote?.coupon && (
              <span className="hint" style={{ color: 'var(--success)' }}>
                ✓ ใช้คูปอง {quote.coupon.code} แล้ว (ลด {formatTHB(quote.coupon.discountAmount)})
              </span>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, fontSize: 14.5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: 'var(--text-2)' }}>ยอดสินค้า</span>
              <strong>{formatTHB(quote?.subtotal || 0)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: 'var(--text-2)' }}>ส่วนลด</span>
              <strong style={{ color: 'var(--danger)' }}>-{formatTHB(quote?.discountAmount || 0)}</strong>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 19,
                fontWeight: 800,
                borderTop: '1px dashed var(--border)',
                paddingTop: 10,
              }}
            >
              <span>ยอดสุทธิ</span>
              <span>{formatTHB(quote?.total || 0)}</span>
            </div>
          </div>

          <button
            className="btn btn-lg btn-block"
            style={{ marginTop: 16 }}
            onClick={checkout}
            disabled={placing || loading || !quote || quote.items?.length === 0}
          >
            {placing ? 'กำลังสร้างคำสั่งซื้อ...' : 'ดำเนินการชำระเงิน →'}
          </button>
          <p style={{ fontSize: 12.5, color: 'var(--text-3)', textAlign: 'center', marginTop: 10, marginBottom: 0 }}>
            ราคาและส่วนลดทั้งหมดคำนวณจากเซิร์ฟเวอร์
          </p>
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .cart-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

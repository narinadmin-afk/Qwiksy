import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiGet } from '../api.js';
import { formatTHB, formatDate } from '../format.js';
import { ErrorState } from '../components/States.jsx';

export default function Success() {
  const { orderNumber } = useParams();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet(`/api/orders/${encodeURIComponent(orderNumber)}`)
      .then((d) => setOrder(d.order))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    window.scrollTo(0, 0);
  }, [orderNumber]);

  if (loading) {
    return (
      <div className="container">
        <div className="skeleton" style={{ height: 300, marginTop: 30, maxWidth: 560, marginInline: 'auto' }} />
      </div>
    );
  }
  if (error) return <div className="container"><ErrorState message={error} /></div>;
  if (!order) return null;

  const paid = order.status === 'paid';

  return (
    <div className="container" style={{ maxWidth: 640 }}>
      <div className="panel" style={{ textAlign: 'center', marginTop: 30 }}>
        <div style={{ fontSize: 60 }}>{paid ? '🎉' : '⏳'}</div>
        <h1 style={{ fontSize: 26, margin: '8px 0' }}>
          {paid ? 'สั่งซื้อสำเร็จ!' : 'ได้รับคำสั่งซื้อแล้ว'}
        </h1>
        <p style={{ color: 'var(--text-2)', margin: '0 0 4px' }}>
          คำสั่งซื้อ <strong>{order.orderNumber}</strong>
        </p>
        <p style={{ color: 'var(--text-3)', fontSize: 14, margin: 0 }}>
          {paid && order.paidAt && `ชำระเงินเมื่อ ${formatDate(order.paidAt)}`}
        </p>

        <div className="panel" style={{ marginTop: 20, textAlign: 'left', background: 'var(--surface-2)', border: 0 }}>
          {(order.items || []).map((i) => (
            <div
              key={i.productId}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 0', fontSize: 14.5 }}
            >
              <span>
                {i.title} × {i.quantity}
              </span>
              <strong>{formatTHB(i.lineTotal)}</strong>
            </div>
          ))}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 17,
              fontWeight: 800,
              borderTop: '1px dashed var(--border)',
              paddingTop: 10,
              marginTop: 6,
            }}
          >
            <span>ยอดรวม</span>
            <span>{formatTHB(order.total)}</span>
          </div>
        </div>

        {paid ? (
          <div className="success-box" style={{ textAlign: 'left' }}>
            ✓ การชำระเงินได้รับการยืนยันแล้ว สินค้าถูกเพิ่มลงคลังของคุณเรียบร้อย กดดาวน์โหลดได้ทันที
          </div>
        ) : (
          <div className="warning-box" style={{ textAlign: 'left' }}>
            ยังไม่ได้รับการยืนยันชำระเงิน - สินค้าจะเข้าคลังเมื่อระบบยืนยันการชำระเงินผ่าน Webhook เท่านั้น
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 16 }}>
          <Link to="/library" className="btn btn-lg">
            📚 ไปที่คลังสินค้าของฉัน
          </Link>
          <Link to="/account" className="btn btn-outline">
            ประวัติคำสั่งซื้อ
          </Link>
          <Link to="/products" className="btn btn-ghost">
            เลือกซื้อต่อ
          </Link>
        </div>
      </div>
    </div>
  );
}

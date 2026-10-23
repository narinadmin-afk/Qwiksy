import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPatch } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../components/Toast.jsx';
import { formatTHB, formatDate, ORDER_STATUS_TH, PAYMENT_STATUS_TH } from '../format.js';
import { EmptyState, ErrorState } from '../components/States.jsx';

export default function Account() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet('/api/orders');
      setOrders(data.orders);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiPatch('/api/auth/me', { displayName });
      await refresh();
      toast('บันทึกโปรไฟล์แล้ว', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: 860 }}>
      <div className="crumbs">
        <Link to="/">หน้าแรก</Link> / <span>บัญชีของฉัน</span>
      </div>
      <h1 style={{ fontSize: 26 }}>บัญชีของฉัน</h1>

      <div className="panel" style={{ marginBottom: 22 }}>
        <h3>👤 โปรไฟล์</h3>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="avatar" style={{ width: 56, height: 56 }} referrerPolicy="no-referrer" />
          ) : (
            <span className="avatar" style={{ width: 56, height: 56, display: 'grid', placeItems: 'center', fontSize: 22 }}>
              {(user?.displayName || user?.email || '?').slice(0, 1).toUpperCase()}
            </span>
          )}
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 700 }}>{user?.displayName || '-'}</div>
            <div style={{ fontSize: 14, color: 'var(--text-2)' }}>
              {user?.email} {user?.emailVerified && '✓ (ยืนยันแล้ว)'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
              บทบาท: {user?.role === 'admin' ? 'ผู้ดูแลระบบ' : 'สมาชิก'} | เข้าร่วมเมื่อ {formatDate(user?.createdAt)}
            </div>
          </div>
        </div>

        <form onSubmit={saveProfile} style={{ marginTop: 18, maxWidth: 400 }}>
          <div className="field">
            <label>ชื่อที่แสดง</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={80}
              required
            />
            <span className="hint">อีเมลมาจากบัญชี Google และเปลี่ยนจากหน้านี้ไม่ได้</span>
          </div>
          <button className="btn" disabled={saving || displayName.trim() === (user?.displayName || '')}>
            {saving ? 'กำลังบันทึก...' : 'บันทึกการเปลี่ยนแปลง'}
          </button>
        </form>
      </div>

      <div className="panel">
        <h3>🧾 ประวัติการสั่งซื้อ</h3>
        {loading && <div className="skeleton" style={{ height: 140 }} />}
        {error && <ErrorState message={error} onRetry={load} />}
        {!loading && !error && orders.length === 0 && (
          <EmptyState
            icon="🧾"
            title="ยังไม่มีคำสั่งซื้อ"
            description="เมื่อซื้อสินค้า รายการคำสั่งซื้อจะแสดงที่นี่"
            action={
              <Link to="/products" className="btn">
                เลือกซื้อสินค้า
              </Link>
            }
          />
        )}
        {!loading &&
          orders.map((o) => (
            <div
              key={o.orderNumber}
              style={{ borderBottom: '1px solid var(--border)', padding: '14px 0' }}
            >
              <div
                style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}
              >
                <div>
                  <strong>{o.orderNumber}</strong>
                  <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
                    {formatDate(o.createdAt)} | {o.items.length} รายการ
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span className={`status ${o.status}`}>{ORDER_STATUS_TH[o.status] || o.status}</span>
                  <strong>{formatTHB(o.total)}</strong>
                  <button className="btn btn-outline btn-sm" onClick={() => setExpanded(expanded === o.orderNumber ? null : o.orderNumber)}>
                    {expanded === o.orderNumber ? 'ซ่อน' : 'รายละเอียด'}
                  </button>
                </div>
              </div>

              {expanded === o.orderNumber && (
                <div style={{ marginTop: 12, background: 'var(--surface-2)', borderRadius: 10, padding: 14, fontSize: 14 }}>
                  {o.items.map((i) => (
                    <div key={i.productId} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                      <Link to={`/products/${i.slug}`}>{i.title}</Link>
                      <span>
                        {i.quantity} × {formatTHB(i.unitPrice)} = <strong>{formatTHB(i.lineTotal)}</strong>
                      </span>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dashed var(--border)', marginTop: 8, paddingTop: 8 }}>
                    <span>ส่วนลด {o.couponCode ? `(คูปอง ${o.couponCode})` : ''}</span>
                    <span>-{formatTHB(o.discountAmount)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}>
                    <span>ยอดสุทธิ</span>
                    <span>{formatTHB(o.total)}</span>
                  </div>

                  {(o.payments || []).length > 0 && (
                    <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text-2)' }}>
                      <strong>การชำระเงิน:</strong>
                      {o.payments.map((p) => (
                        <div key={p.id} style={{ marginTop: 4 }}>
                          <span className={`status ${p.status}`} style={{ fontSize: 12 }}>
                            {PAYMENT_STATUS_TH[p.status] || p.status}
                          </span>{' '}
                          {p.reference} {p.chargeId && <>| Gateway: {p.chargeId}</>}
                          {p.paidAt && <> | ชำระแล้ว {formatDate(p.paidAt)}</>}
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                    {o.status === 'paid' && (
                      <Link to="/library" className="btn btn-sm">
                        📚 ไปดาวน์โหลด
                      </Link>
                    )}
                    {o.status === 'pending' && (
                      <Link to={`/pay/${o.orderNumber}`} className="btn btn-sm">
                        ชำระเงินต่อ
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}

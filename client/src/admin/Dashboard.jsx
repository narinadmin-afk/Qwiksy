import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../api.js';
import { formatTHB, formatDateShort } from '../format.js';
import { ErrorState } from '../components/States.jsx';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet('/api/admin/dashboard/stats');
      setStats(data.stats);
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

  if (loading) {
    return <div className="skeleton" style={{ height: 320 }} />;
  }
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!stats) return null;

  return (
    <>
      <h1 className="admin-title">
        📊 ภาพรวมร้านค้า
        <button className="btn btn-outline btn-sm" onClick={load}>
          รีเฟรช
        </button>
      </h1>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="label">💰 ยอดขายวันนี้</div>
          <div className="value" style={{ color: 'var(--success)' }}>
            {formatTHB(stats.todaySales)}
          </div>
          <div className="sub">UTC (ระบบเวลาเซิร์ฟเวอร์)</div>
        </div>
        <div className="stat-card">
          <div className="label">📅 ยอดขายเดือนนี้</div>
          <div className="value">{formatTHB(stats.monthSales)}</div>
        </div>
        <div className="stat-card">
          <div className="label">💎 รายได้รวม (ชำระสำเร็จ)</div>
          <div className="value">{formatTHB(stats.totalRevenue)}</div>
          <div className="sub">{stats.paidCount} รายการชำระเงิน</div>
        </div>
        <div className="stat-card">
          <div className="label">🧾 คำสั่งซื้อทั้งหมด</div>
          <div className="value">{stats.totalOrders}</div>
          <div className="sub">รอชำระ {stats.pendingOrders} | คืนเงิน {stats.refundedOrders}</div>
        </div>
        <div className="stat-card">
          <div className="label">👥 สมาชิก</div>
          <div className="value">{stats.totalMembers}</div>
          <div className="sub">ใหม่ 7 วัน: {stats.newMembers7d}</div>
        </div>
        <div className="stat-card">
          <div className="label">⏳ รอชำระเงิน</div>
          <div className="value" style={{ color: 'var(--warning)' }}>
            {stats.pendingOrders}
          </div>
          <div className="sub">ตรวจสอบที่หน้าคำสั่งซื้อ</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 20 }} className="admin-cols">
        <div className="panel">
          <h3>🏆 สินค้าขายดี (เรียงตามรายได้)</h3>
          <div className="table-wrap" style={{ border: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>สินค้า</th>
                  <th className="num">ขายได้</th>
                  <th className="num">รายได้</th>
                </tr>
              </thead>
              <tbody>
                {stats.topProducts.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/products/${p.slug}`} style={{ fontWeight: 600 }}>
                        {p.title}
                      </Link>
                    </td>
                    <td className="num">{p.salesCount}</td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {formatTHB(p.revenue)}
                    </td>
                  </tr>
                ))}
                {stats.topProducts.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-3)' }}>
                      ยังไม่มีขาย
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <h3>⏳ คำสั่งซื้อรอชำระเงิน</h3>
          {stats.pendingOrdersList.length === 0 && (
            <p style={{ color: 'var(--text-3)', fontSize: 14.5 }}>ไม่มีคำสั่งซื้อค้างชำระ 🎉</p>
          )}
          {stats.pendingOrdersList.map((o) => (
            <div
              key={o.orderNumber}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderBottom: '1px dashed var(--border)', fontSize: 14 }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{o.orderNumber}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                  {o.email} | {formatDateShort(o.createdAt)}
                </div>
              </div>
              <strong>{formatTHB(o.total)}</strong>
            </div>
          ))}
          <Link to="/admin/orders?status=pending" className="btn btn-outline btn-sm" style={{ marginTop: 12 }}>
            ดูทั้งหมด →
          </Link>
        </div>
      </div>

      <style>{`@media (max-width: 900px) { .admin-cols { grid-template-columns: 1fr !important; } }`}</style>
    </>
  );
}

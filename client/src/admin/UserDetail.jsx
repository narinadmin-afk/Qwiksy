import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiGet } from '../api.js';
import { formatTHB, formatDate, ORDER_STATUS_TH } from '../format.js';
import { ErrorState } from '../components/States.jsx';

export default function UserDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet(`/api/admin/users/${id}`)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    window.scrollTo(0, 0);
  }, [id]);

  if (loading) return <div className="skeleton" style={{ height: 380 }} />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  const { user, orders, downloads } = data;

  return (
    <>
      <h1 className="admin-title">
        👤 {user.display_name || user.email}
        <Link to="/admin/users" className="btn btn-outline btn-sm">
          ← กลับ
        </Link>
      </h1>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <div className="stat-card">
          <div className="label">อีเมล</div>
          <div className="value" style={{ fontSize: 15, wordBreak: 'break-all' }}>{user.email}</div>
          <div className="sub">{user.email_verified ? '✓ ยืนยันแล้ว' : 'ยังไม่ยืนยัน'}</div>
        </div>
        <div className="stat-card">
          <div className="label">บทบาท / สถานะ</div>
          <div className="value" style={{ fontSize: 18 }}>
            {user.role === 'admin' ? 'Admin' : 'สมาชิก'}
          </div>
          <div className="sub">
            <span className={`status ${user.status === 'active' ? 'paid' : 'failed'}`}>
              {user.status === 'active' ? 'ปกติ' : 'ถูกระงับ'}
            </span>
          </div>
        </div>
        <div className="stat-card">
          <div className="label">เข้าร่วม</div>
          <div className="value" style={{ fontSize: 15 }}>{formatDate(user.created_at)}</div>
          <div className="sub">เข้าสู่ระบบล่าสุด: {user.last_login_at ? formatDate(user.last_login_at) : '-'}</div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 18 }}>
        <h3>🧾 คำสั่งซื้อ ({orders.length})</h3>
        {orders.length === 0 && <p style={{ color: 'var(--text-3)' }}>ยังไม่มีคำสั่งซื้อ</p>}
        {orders.length > 0 && (
          <div className="table-wrap" style={{ border: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>เลขคำสั่งซื้อ</th>
                  <th className="num">ยอด</th>
                  <th>สถานะ</th>
                  <th>วันที่</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td><strong>{o.order_number}</strong></td>
                    <td className="num">{formatTHB(o.total)}</td>
                    <td><span className={`status ${o.status}`}>{ORDER_STATUS_TH[o.status]}</span></td>
                    <td style={{ fontSize: 13 }}>{formatDate(o.created_at)}</td>
                    <td>
                      <Link to={`/admin/orders/${o.id}`} className="btn btn-outline btn-sm">เปิด</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h3>⬇️ ประวัติดาวน์โหลด ({downloads.length})</h3>
        {downloads.length === 0 && <p style={{ color: 'var(--text-3)' }}>ยังไม่มีการดาวน์โหลด</p>}
        {downloads.length > 0 && (
          <div className="table-wrap" style={{ border: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>สินค้า</th>
                  <th>สถานะ</th>
                  <th>เหตุผล/รายละเอียด</th>
                  <th>เวลา</th>
                </tr>
              </thead>
              <tbody>
                {downloads.map((d) => (
                  <tr key={d.id}>
                    <td>{d.title}</td>
                    <td>
                      <span className={`status ${d.status === 'completed' ? 'paid' : d.status === 'denied' || d.status === 'failed' ? 'failed' : 'pending'}`}>
                        {d.status}
                      </span>
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--text-3)' }}>{d.reason || '-'}</td>
                    <td style={{ fontSize: 13 }}>{formatDate(d.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

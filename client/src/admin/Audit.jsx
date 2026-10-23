import { useEffect, useState } from 'react';
import { apiGet } from '../api.js';
import { formatDate } from '../format.js';
import { EmptyState, ErrorState } from '../components/States.jsx';

const ACTION_LABELS = {
  'product.create': 'สร้างสินค้า',
  'product.update': 'แก้ไขสินค้า',
  'product.delete': 'ลบสินค้า',
  'product.file_upload': 'อัปโหลดไฟล์สินค้า',
  'product.file_delete': 'ลบไฟล์สินค้า',
  'order.mark_paid': 'ยืนยันชำระเงิน (manual)',
  'order.refund': 'คืนเงิน',
  'user.suspend': 'ระงับผู้ใช้',
  'user.activate': 'ปลดระงับผู้ใช้',
  'coupon.create': 'สร้างคูปอง',
  'coupon.activate': 'เปิดคูปอง',
  'coupon.deactivate': 'ปิดคูปอง',
  'review.delete': 'ลบรีวิว',
};

export default function Audit() {
  const [data, setData] = useState(null);
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ page: String(page), limit: '50' });
      if (action) query.set('action', action);
      setData(await apiGet(`/api/admin/audit-logs?${query}`));
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
  }, [page, action]);

  const pretty = (obj) => {
    if (!obj) return null;
    try {
      const parsed = typeof obj === 'string' ? JSON.parse(obj) : obj;
      return JSON.stringify(parsed);
    } catch {
      return String(obj);
    }
  };

  return (
    <>
      <h1 className="admin-title">📜 Audit Log (การกระทำสำคัญของ Admin)</h1>

      <div className="toolbar">
        <select value={action} onChange={(e) => { setPage(1); setAction(e.target.value); }}>
          <option value="">ทุกการกระทำ</option>
          {Object.entries(ACTION_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 13.5, color: 'var(--text-3)' }}>
          {data ? `${data.total} รายการ` : ''}
        </span>
      </div>

      {loading && <div className="skeleton" style={{ height: 300 }} />}
      {error && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && data && data.items.length === 0 && (
        <EmptyState icon="📜" title="ยังไม่มี audit log" description="ทุกการกระทำสำคัญ (ยืนยันชำระเงิน คืนเงิน ระงับผู้ใช้ ฯลฯ) จะถูกบันทึกที่นี่" />
      )}

      {!loading && !error && data && data.items.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>เวลา</th>
                  <th>Admin</th>
                  <th>การกระทำ</th>
                  <th>วัตถุ</th>
                  <th>เหตุผล</th>
                  <th>ก่อน → หลัง</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((log) => (
                  <tr key={log.id}>
                    <td style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{formatDate(log.created_at)}</td>
                    <td style={{ fontSize: 13 }}>
                      <div>{log.admin_email || '-'}</div>
                      <div style={{ color: 'var(--text-3)', fontSize: 11.5 }}>IP: {log.ip || '-'}</div>
                    </td>
                    <td>
                      <span className="tag info">{ACTION_LABELS[log.action] || log.action}</span>
                    </td>
                    <td style={{ fontSize: 13 }}>
                      <div>{log.entity_type}</div>
                      <code style={{ fontSize: 11.5 }}>{log.entity_id}</code>
                    </td>
                    <td style={{ fontSize: 13, maxWidth: 200 }}>{log.reason || '-'}</td>
                    <td style={{ fontSize: 11.5, maxWidth: 260, wordBreak: 'break-all', color: 'var(--text-3)' }}>
                      {pretty(log.before_data) || '-'} → {pretty(log.after_data) || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.totalPages > 1 && (
            <div className="pager">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
              {Array.from({ length: data.totalPages }).map((_, i) => (
                <button key={i} className={page === i + 1 ? 'active' : ''} onClick={() => setPage(i + 1)}>
                  {i + 1}
                </button>
              ))}
              <button disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>›</button>
            </div>
          )}
        </>
      )}
    </>
  );
}

import { useEffect, useState } from 'react';
import { apiGet, apiDelete } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { formatDate } from '../format.js';
import { EmptyState, ErrorState } from '../components/States.jsx';

export default function Reviews() {
  const toast = useToast();
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet('/api/admin/reviews');
      setReviews(data.reviews);
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

  const remove = async (r) => {
    if (!window.confirm(`ลบรีวิวของ ${r.user_name} บนสินค้า "${r.product_title}"? (บันทึก Audit Log)`)) return;
    try {
      await apiDelete(`/api/admin/reviews/${r.id}`);
      toast('ลบรีวิวแล้ว', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <>
      <h1 className="admin-title">⭐ จัดการรีวิว</h1>
      {loading && <div className="skeleton" style={{ height: 200 }} />}
      {error && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && reviews.length === 0 && (
        <EmptyState icon="⭐" title="ยังไม่มีรีวิว" description="รีวิวจากผู้ซื้อจะแสดงที่นี่" />
      )}
      {!loading && !error && reviews.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>สินค้า</th>
                <th>ผู้รีวิว</th>
                <th>คะแนน</th>
                <th>ความคิดเห็น</th>
                <th>เวลา</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {reviews.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600, fontSize: 14 }}>{r.product_title}</td>
                  <td>
                    <div style={{ fontSize: 14 }}>{r.user_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{r.user_email}</div>
                  </td>
                  <td style={{ color: '#f59e0b' }}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</td>
                  <td style={{ maxWidth: 300, fontSize: 13.5 }}>{r.comment || '-'}</td>
                  <td style={{ fontSize: 13 }}>{formatDate(r.created_at)}</td>
                  <td className="num">
                    <button className="btn btn-danger btn-sm" onClick={() => remove(r)}>
                      ลบ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

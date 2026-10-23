import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiDelete } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { formatTHB, formatDateShort } from '../format.js';
import { EmptyState, ErrorState } from '../components/States.jsx';

const STATUS_TH = { draft: 'แบบร่าง', published: 'เผยแพร่', closed: 'ปิดการขาย' };

export default function Products() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ page: String(page), limit: '20' });
      if (q) query.set('q', q);
      if (status) query.set('status', status);
      const data = await apiGet(`/api/admin/products?${query}`);
      setData(data);
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
  }, [page, status]);

  const search = (e) => {
    e.preventDefault();
    setPage(1);
    load();
  };

  const remove = async (p) => {
    if (!window.confirm(`ลบสินค้า "${p.title}"?\n\nจะถูกซ่อนออกจากร้านทันที (ผู้ที่ซื้อไปแล้วยังเข้าถึงได้ตามสิทธิ์)`)) return;
    setDeleting(p.id);
    try {
      await apiDelete(`/api/admin/products/${p.id}`);
      toast('ลบสินค้าแล้ว', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <>
      <h1 className="admin-title">
        📦 จัดการสินค้า
        <Link to="/admin/products/new" className="btn">
          + เพิ่มสินค้าใหม่
        </Link>
      </h1>

      <div className="toolbar">
        <form onSubmit={search} style={{ display: 'flex', gap: 8, flex: 1 }}>
          <input
            className="grow"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาชื่อหรือ slug สินค้า..."
          />
          <button className="btn btn-outline btn-sm" type="submit">
            ค้นหา
          </button>
        </form>
        <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
          <option value="">ทุกสถานะ</option>
          <option value="published">เผยแพร่</option>
          <option value="draft">แบบร่าง</option>
          <option value="closed">ปิดการขาย</option>
        </select>
      </div>

      {loading && <div className="skeleton" style={{ height: 300 }} />}
      {error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && data && data.items.length === 0 && (
        <EmptyState icon="📦" title="ไม่พบสินค้า" description="เพิ่มสินค้าแรกของคุณได้เลย" />
      )}

      {!loading && !error && data && data.items.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>สินค้า</th>
                  <th>หมวดหมู่</th>
                  <th className="num">ราคา</th>
                  <th className="num">ไฟล์</th>
                  <th>สถานะ</th>
                  <th>ขายได้</th>
                  <th>อัปเดต</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        {p.cover_image_url ? (
                          <img src={p.cover_image_url} alt="" style={{ width: 52, height: 36, objectFit: 'cover', borderRadius: 6 }} />
                        ) : (
                          <div style={{ width: 52, height: 36, background: 'var(--surface-2)', borderRadius: 6, display: 'grid', placeItems: 'center' }}>
                            🛍️
                          </div>
                        )}
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{p.title}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>/{p.slug}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: 13.5 }}>{p.category_name}</td>
                    <td className="num">
                      {formatTHB(p.price)}
                      {Number(p.discount_percent) > 0 && (
                        <div style={{ fontSize: 12, color: 'var(--danger)' }}>-{p.discount_percent}%</div>
                      )}
                    </td>
                    <td className="num">{p.file_count}</td>
                    <td>
                      <span className={`status ${p.status}`}>{STATUS_TH[p.status]}</span>
                      {p.featured === 1 && (
                        <div style={{ fontSize: 11.5, color: 'var(--warning)', fontWeight: 700 }}>⭐ แนะนำ</div>
                      )}
                    </td>
                    <td className="num">{p.sales_count}</td>
                    <td style={{ fontSize: 13 }}>{formatDateShort(p.updated_at)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <Link to={`/admin/products/${p.id}`} className="btn btn-outline btn-sm">
                          แก้ไข
                        </Link>
                        <button
                          className="btn btn-danger btn-sm"
                          disabled={deleting === p.id}
                          onClick={() => remove(p)}
                        >
                          ลบ
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.totalPages > 1 && (
            <div className="pager">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                ‹
              </button>
              {Array.from({ length: data.totalPages }).map((_, i) => (
                <button key={i} className={page === i + 1 ? 'active' : ''} onClick={() => setPage(i + 1)}>
                  {i + 1}
                </button>
              ))}
              <button disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>
                ›
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

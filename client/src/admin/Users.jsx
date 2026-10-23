import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiGet, apiPost } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { formatTHB, formatDateShort } from '../format.js';
import { EmptyState, ErrorState } from '../components/States.jsx';

export default function Users() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [search, setSearch] = useState(params.get('search') || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const page = Number(params.get('page') || 1);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ page: String(page), limit: '20' });
      if (search) query.set('search', search);
      setData(await apiGet(`/api/admin/users?${query}`));
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
  }, [page]);

  const toggleStatus = async (u) => {
    const suspend = u.status === 'active';
    const msg = suspend
      ? `ระงับบัญชี ${u.email}? ผู้ใช้จะถูกเด้งออกจากระบบทันทีและใช้งานไม่ได้จนกว่าจะปลดระงับ (มี Audit Log)`
      : `ปลดระงับบัญชี ${u.email}?`;
    if (!window.confirm(msg)) return;
    try {
      await apiPost(`/api/admin/users/${u.id}/status`, {
        status: suspend ? 'suspended' : 'active',
      });
      toast(suspend ? 'ระงับบัญชีแล้ว' : 'ปลดระงับแล้ว', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <>
      <h1 className="admin-title">👥 สมาชิก</h1>

      <div className="toolbar">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const next = new URLSearchParams(params);
            if (search.trim()) next.set('search', search.trim());
            else next.delete('search');
            next.delete('page');
            setParams(next, { replace: true });
            load();
          }}
          style={{ display: 'flex', gap: 8, flex: 1 }}
        >
          <input
            className="grow"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาอีเมล / ชื่อ / google sub..."
          />
          <button className="btn btn-outline btn-sm" type="submit">
            ค้นหา
          </button>
        </form>
      </div>

      {loading && <div className="skeleton" style={{ height: 300 }} />}
      {error && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && data && data.items.length === 0 && (
        <EmptyState icon="👥" title="ไม่พบสมาชิก" />
      )}

      {!loading && !error && data && data.items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>สมาชิก</th>
                <th>บทบาท</th>
                <th className="num">คำสั่งซื้อ</th>
                <th className="num">ยอดใช้จ่าย</th>
                <th className="num">ดาวน์โหลด</th>
                <th>สถานะ</th>
                <th>เข้าร่วม</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      {u.avatar_url ? (
                        <img src={u.avatar_url} alt="" className="avatar" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="avatar" style={{ display: 'grid', placeItems: 'center', fontSize: 14 }}>
                          {(u.display_name || u.email || '?').slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{u.display_name || '-'}</div>
                        <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`tag ${u.role === 'admin' ? 'info' : ''}`}>
                      {u.role === 'admin' ? 'Admin' : 'สมาชิก'}
                    </span>
                  </td>
                  <td className="num">{u.paid_orders}</td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {formatTHB(u.total_spent)}
                  </td>
                  <td className="num">{u.download_count}</td>
                  <td>
                    <span className={`status ${u.status === 'active' ? 'paid' : 'failed'}`}>
                      {u.status === 'active' ? 'ปกติ' : 'ถูกระงับ'}
                    </span>
                  </td>
                  <td style={{ fontSize: 13 }}>{formatDateShort(u.created_at)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <Link to={`/admin/users/${u.id}`} className="btn btn-outline btn-sm">
                        เปิด
                      </Link>
                      <button
                        className={`btn btn-sm ${u.status === 'active' ? 'btn-danger' : 'btn-success'}`}
                        onClick={() => toggleStatus(u)}
                      >
                        {u.status === 'active' ? 'ระงับ' : 'ปลด'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.totalPages > 1 && (
        <div className="pager">
          <button disabled={page <= 1} onClick={() => setParams((p) => ({ ...p, page: String(page - 1) }))}>
            ‹
          </button>
          {Array.from({ length: data.totalPages }).map((_, i) => (
            <button
              key={i}
              className={page === i + 1 ? 'active' : ''}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set('page', String(i + 1));
                setParams(next);
              }}
            >
              {i + 1}
            </button>
          ))}
          <button disabled={page >= data.totalPages} onClick={() => setParams((p) => ({ ...p, page: String(page + 1) }))}>
            ›
          </button>
        </div>
      )}
    </>
  );
}

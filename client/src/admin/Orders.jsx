import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiGet } from '../api.js';
import { formatTHB, formatDateShort, ORDER_STATUS_TH } from '../format.js';
import { EmptyState, ErrorState } from '../components/States.jsx';

const STATUS_OPTIONS = [
  { value: '', label: 'ทุกสถานะ' },
  { value: 'pending', label: 'รอชำระเงิน' },
  { value: 'paid', label: 'ชำระเงินแล้ว' },
  { value: 'failed', label: 'ไม่สำเร็จ' },
  { value: 'expired', label: 'หมดอายุ' },
  { value: 'refunded', label: 'คืนเงินแล้ว' },
];

export default function Orders() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [search, setSearch] = useState(params.get('search') || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const page = Number(params.get('page') || 1);
  const status = params.get('status') || '';

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ page: String(page), limit: '20' });
      if (status) query.set('status', status);
      if (search) query.set('search', search);
      const d = await apiGet(`/api/admin/orders?${query}`);
      setData(d);
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

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <>
      <h1 className="admin-title">🧾 คำสั่งซื้อ & การชำระเงิน</h1>

      <div className="toolbar">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setParam('search', search.trim());
            setParam('page', '1');
            load();
          }}
          style={{ display: 'flex', gap: 8, flex: 1 }}
        >
          <input
            className="grow"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาด้วยเลขคำสั่งซื้อ / อีเมล / ชื่อ..."
          />
          <button className="btn btn-outline btn-sm" type="submit">
            ค้นหา
          </button>
        </form>
        <select value={status} onChange={(e) => setParam('status', e.target.value)}>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={params.get('dateFrom') || ''}
          onChange={(e) => setParam('dateFrom', e.target.value)}
          title="จากวันที่"
        />
      </div>

      {loading && <div className="skeleton" style={{ height: 300 }} />}
      {error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && data && data.items.length === 0 && (
        <EmptyState icon="🧾" title="ไม่พบคำสั่งซื้อ" description="ลองเปลี่ยนตัวกรองหรือคำค้นหา" />
      )}

      {!loading && !error && data && data.items.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>เลขคำสั่งซื้อ</th>
                  <th>ลูกค้า</th>
                  <th className="num">ยอด</th>
                  <th>สถานะ</th>
                  <th>การชำระเงินล่าสุด</th>
                  <th>วันที่</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <strong>{o.orderNumber}</strong>
                    </td>
                    <td>
                      <div style={{ fontSize: 14 }}>{o.displayName || '-'}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{o.email}</div>
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>
                      {formatTHB(o.total)}
                    </td>
                    <td>
                      <span className={`status ${o.status}`}>{ORDER_STATUS_TH[o.status]}</span>
                    </td>
                    <td style={{ fontSize: 12.5 }}>
                      {o.lastPaymentStatus ? (
                        <>
                          <span className={`status ${o.lastPaymentStatus}`} style={{ fontSize: 11.5 }}>
                            {o.lastPaymentStatus}
                          </span>
                          {o.lastChargeId && <div style={{ color: 'var(--text-3)' }}>{o.lastChargeId}</div>}
                        </>
                      ) : (
                        <span style={{ color: 'var(--text-3)' }}>-</span>
                      )}
                    </td>
                    <td style={{ fontSize: 13 }}>{formatDateShort(o.createdAt)}</td>
                    <td>
                      <Link to={`/admin/orders/${o.id}`} className="btn btn-outline btn-sm">
                        เปิด
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.totalPages > 1 && (
            <div className="pager">
              <button disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>
                ‹
              </button>
              {Array.from({ length: data.totalPages }).map((_, i) => (
                <button key={i} className={page === i + 1 ? 'active' : ''} onClick={() => setParam('page', String(i + 1))}>
                  {i + 1}
                </button>
              ))}
              <button disabled={page >= data.totalPages} onClick={() => setParam('page', String(page + 1))}>
                ›
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

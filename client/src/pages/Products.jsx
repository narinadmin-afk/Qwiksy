import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { apiGet } from '../api.js';
import ProductCard from '../components/ProductCard.jsx';
import { LoadingGrid, ErrorState, EmptyState } from '../components/States.jsx';

const SORTS = [
  { key: 'newest', label: 'ใหม่ล่าสุด' },
  { key: 'bestseller', label: 'ขายดีที่สุด' },
  { key: 'price_asc', label: 'ราคาต่ำ → สูง' },
  { key: 'price_desc', label: 'ราคาสูง → ต่ำ' },
  { key: 'discount', label: 'ส่วนลดมาก' },
];

export default function Products() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [cats, setCats] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const category = params.get('category') || '';
  const q = params.get('q') || '';
  const sort = params.get('sort') || 'newest';
  const page = Number(params.get('page') || 1);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      if (category) query.set('category', category);
      if (q) query.set('q', q);
      query.set('sort', sort);
      query.set('page', String(page));
      const [list, c] = await Promise.all([
        apiGet(`/api/products?${query}`),
        cats.length ? Promise.resolve({ categories: cats }) : apiGet('/api/categories'),
      ]);
      setData(list);
      setCats(c.categories || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    window.scrollTo(0, 0);
  }, [category, q, sort, page]);

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <div className="container">
      <div className="crumbs">
        <Link to="/">หน้าแรก</Link> / <span>สินค้าทั้งหมด</span>
      </div>
      <h1 style={{ fontSize: 26, margin: '4px 0 16px' }}>
        {q ? `ผลค้นหา: "${q}"` : cats.find((c) => c.slug === category)?.name || 'สินค้าทั้งหมด'}
      </h1>

      <div className="chips" style={{ marginBottom: 14 }}>
        <button className={`chip ${!category ? 'active' : ''}`} onClick={() => setParam('category', '')}>
          ทั้งหมด
        </button>
        {cats.map((c) => (
          <button
            key={c.id}
            className={`chip ${category === c.slug ? 'active' : ''}`}
            onClick={() => setParam('category', c.slug)}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <span style={{ fontSize: 14.5, color: 'var(--text-2)' }}>เรียงตาม:</span>
        {SORTS.map((s) => (
          <button
            key={s.key}
            className={`chip ${sort === s.key ? 'active' : ''}`}
            onClick={() => setParam('sort', s.key)}
          >
            {s.label}
          </button>
        ))}
        {data && (
          <span style={{ marginLeft: 'auto', fontSize: 14, color: 'var(--text-3)' }}>
            {data.total} รายการ
          </span>
        )}
      </div>

      {loading && <LoadingGrid />}
      {error && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && data && data.items.length === 0 && (
        <EmptyState
          icon="🔍"
          title="ไม่พบสินค้า"
          description={q ? 'ลองค้นหาด้วยคำอื่น หรือเลือกหมวดหมู่อื่นดูได้เลย' : 'ยังไม่มีสินค้าในหมวดนี้'}
          action={
            <button className="btn" onClick={() => navigate('/products')}>
              ดูสินค้าทั้งหมด
            </button>
          }
        />
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="grid">
            {data.items.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
          {data.totalPages > 1 && (
            <div className="pager">
              <button disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>
                ‹
              </button>
              {Array.from({ length: data.totalPages }).map((_, i) => (
                <button
                  key={i}
                  className={page === i + 1 ? 'active' : ''}
                  onClick={() => setParam('page', String(i + 1))}
                >
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
    </div>
  );
}

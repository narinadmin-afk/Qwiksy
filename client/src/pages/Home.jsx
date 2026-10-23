import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../api.js';
import ProductCard from '../components/ProductCard.jsx';
import { LoadingGrid, ErrorState } from '../components/States.jsx';

function Section({ title, items, moreLink }) {
  if (!items || items.length === 0) return null;
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
        {moreLink && <Link to={moreLink}>ดูทั้งหมด →</Link>}
      </div>
      <div className="grid">
        {items.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  const [data, setData] = useState(null);
  const [coupons, setCoupons] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [home, cats] = await Promise.all([
        apiGet('/api/products/home'),
        apiGet('/api/categories'),
      ]);
      setData(home);
      setCats(cats.categories || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const [cats, setCats] = useState([]);
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="container">
      <section className="hero">
        <span className="promo-chip">🎉 ยินดีต้อนรับสู่ Qwiksy</span>
        <h1>ตลาดสินค้าดิจิทัล ครบจบในที่เดียว</h1>
        <p>
          eBooks, เทมเพลต, ไฟล์กราฟิก, เสียง-วิดีโอ และคอร์สเรียน ชำระเงินปลอดภัย
          ดาวน์โหลดได้ทันทีหลังระบบยืนยันชำระเงินสำเร็จ
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link to="/products" className="btn btn-lg" style={{ background: '#fff', color: '#4338ca' }}>
            เลือกซื้อสินค้า
          </Link>
          <Link
            to="/products?sort=discount"
            className="btn btn-lg btn-outline"
            style={{ background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,.5)' }}
          >
            ดูโปรโมชั่น
          </Link>
        </div>
      </section>

      {cats.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>หมวดหมู่สินค้า</h2>
          </div>
          <div className="chips">
            {cats.map((c) => (
              <Link key={c.id} to={`/products?category=${c.slug}`} className="chip">
                {c.name} ({c.product_count})
              </Link>
            ))}
          </div>
        </section>
      )}

      {loading && (
        <>
          <div className="section-head">
            <h2>กำลังโหลดสินค้า</h2>
          </div>
          <LoadingGrid />
        </>
      )}
      {error && <ErrorState message={error} onRetry={load} />}

      {data && (
        <>
          <Section title="⭐ สินค้าแนะนำ" items={data.featured} moreLink="/products?sort=bestseller" />
          <Section title="🔥 สินค้าขายดี" items={data.bestsellers} moreLink="/products?sort=bestseller" />
          <Section title="🆕 สินค้าใหม่" items={data.newest} moreLink="/products" />
          {data.featured?.length === 0 && data.newest?.length === 0 && !loading && (
            <div className="state-box">
              <div className="ico">🛍️</div>
              <h3>ยังไม่มีสินค้า</h3>
              <p>สินค้าจะแสดงที่นี่เมื่อผู้ดูแลเพิ่มสินค้าและเผยแพร่แล้ว</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

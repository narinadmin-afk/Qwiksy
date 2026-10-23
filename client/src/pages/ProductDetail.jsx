import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../api.js';
import { useCart } from '../cart.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../components/Toast.jsx';
import { formatTHB, formatBytes, formatDate } from '../format.js';
import { ErrorState, EmptyState } from '../components/States.jsx';

const FILE_TYPE_LABEL = {
  'application/pdf': 'PDF',
  'application/zip': 'ZIP',
  'application/x-zip-compressed': 'ZIP',
  'text/plain': 'TXT',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
  'video/mp4': 'MP4',
  'audio/mpeg': 'MP3',
};

export default function ProductDetail() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const cart = useCart();
  const toast = useToast();
  const { user } = useAuth();
  const [product, setProduct] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeImg, setActiveImg] = useState(0);
  const [buying, setBuying] = useState(false);
  const [reviewForm, setReviewForm] = useState({ rating: 5, comment: '' });
  const [submittingReview, setSubmittingReview] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet(`/api/products/${encodeURIComponent(slug)}`);
      setProduct(data.product);
      setReviews(data.reviews || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    window.scrollTo(0, 0);
  }, [slug]);

  if (loading) {
    return (
      <div className="container">
        <div className="skeleton" style={{ height: 360, marginTop: 24 }} />
        <div className="skeleton" style={{ height: 120, marginTop: 18 }} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="container">
        <ErrorState
          message={error}
          onRetry={() => navigate('/products')}
        />
      </div>
    );
  }
  if (!product) return null;

  const images = [product.coverImageUrl, ...(product.previewImages || [])].filter(Boolean);
  const shown = images[activeImg] || null;

  const addToCart = () => {
    cart.add(product.id, 1);
    toast('เพิ่มลงตะกร้าแล้ว', 'success');
  };

  const buyNow = async () => {
    setBuying(true);
    try {
      cart.add(product.id, 1);
      if (!user) {
        navigate('/login', { state: { next: '/cart' } });
        return;
      }
      navigate('/cart');
    } finally {
      setBuying(false);
    }
  };

  const submitReview = async (e) => {
    e.preventDefault();
    setSubmittingReview(true);
    try {
      const r = await apiPost(`/api/products/${encodeURIComponent(slug)}/reviews`, {
        rating: Number(reviewForm.rating),
        comment: reviewForm.comment,
      });
      setReviews((prev) => [
        { ...r.review, user_name: user.displayName || user.email, is_mine: true },
        ...prev,
      ]);
      setReviewForm({ rating: 5, comment: '' });
      toast('ขอบคุณสำหรับรีวิว!', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSubmittingReview(false);
    }
  };

  const typeLabels = (product.files?.mimeTypes || []).map(
    (m) => FILE_TYPE_LABEL[m] || m.split('/').pop().toUpperCase()
  );

  return (
    <div className="container">
      <div className="crumbs">
        <Link to="/">หน้าแรก</Link> / <Link to="/products">สินค้า</Link> /{' '}
        {product.category && (
          <>
            <Link to={`/products?category=${product.category.slug}`}>{product.category.name}</Link> /{' '}
          </>
        )}
        <span>{product.title}</span>
      </div>

      <div className="detail">
        {/* รูปตัวอย่างสินค้า */}
        <div>
          <div className="gallery-main">
            {shown ? <img src={shown} alt={product.title} /> : <span>🛍️</span>}
          </div>
          {images.length > 1 && (
            <div className="gallery-thumbs">
              {images.map((img, i) => (
                <button
                  key={img}
                  className={i === activeImg ? 'active' : ''}
                  onClick={() => setActiveImg(i)}
                  aria-label={`ภาพที่ ${i + 1}`}
                >
                  <img src={img} alt="" />
                </button>
              ))}
            </div>
          )}

          <div className="panel" style={{ marginTop: 20 }}>
            <h3>รายละเอียดสินค้า</h3>
            <p style={{ whiteSpace: 'pre-wrap', color: 'var(--text-2)', margin: 0 }}>
              {product.description || 'ไม่มีรายละเอียดเพิ่มเติม'}
            </p>
            {product.licenseTerms && (
              <>
                <h3 style={{ marginTop: 22 }}>📄 เงื่อนไขสิทธิการใช้งาน</h3>
                <p style={{ whiteSpace: 'pre-wrap', color: 'var(--text-2)', margin: 0 }}>
                  {product.licenseTerms}
                </p>
              </>
            )}
          </div>
        </div>

        {/* กล่องซื้อ */}
        <div>
          <div className="buy-box">
            {product.category && <span className="card-cat">{product.category.name}</span>}
            <h1 style={{ fontSize: 24, margin: '6px 0 4px', lineHeight: 1.4 }}>{product.title}</h1>
            <div className="card-meta" style={{ marginBottom: 6 }}>
              <span>⭐ {Number(product.ratingAvg || 0).toFixed(1)} ({product.ratingCount || 0} รีวิว)</span>
              <span>•</span>
              <span>ขายแล้ว {product.salesCount || 0}</span>
            </div>

            <div className="price-big">
              {formatTHB(product.salePrice)}
              {product.onSale && (
                <>
                  <span className="old">{formatTHB(product.price)}</span>
                  <span className="off" style={{ display: 'block', fontSize: 14, color: 'var(--danger)' }}>
                    ลด {Number(product.discountPercent)}%
                  </span>
                </>
              )}
            </div>

            <ul className="spec-list">
              <li>
                <span>ประเภทไฟล์</span>
                <strong>{typeLabels.length ? typeLabels.join(', ') : '-'}</strong>
              </li>
              <li>
                <span>ขนาดไฟล์รวม</span>
                <strong>{formatBytes(product.files?.totalBytes)}</strong>
              </li>
              <li>
                <span>จำนวนไฟล์</span>
                <strong>{product.files?.count || 0} ไฟล์</strong>
              </li>
              <li>
                <span>จำกัดดาวน์โหลด</span>
                <strong>
                  {product.downloadPolicy?.maxDownloads
                    ? `${product.downloadPolicy.maxDownloads} ครั้ง`
                    : 'ไม่จำกัด'}
                </strong>
              </li>
              <li>
                <span>อายุสิทธิ์</span>
                <strong>
                  {product.downloadPolicy?.expiresDays
                    ? `${product.downloadPolicy.expiresDays} วันหลังซื้อ`
                    : 'ไม่หมดอายุ'}
                </strong>
              </li>
            </ul>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button className="btn btn-lg btn-block" onClick={buyNow} disabled={buying}>
                ซื้อสินค้าเลย
              </button>
              <button className="btn btn-lg btn-outline btn-block" onClick={addToCart}>
                เพิ่มลงตะกร้า
              </button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 14, marginBottom: 0, textAlign: 'center' }}>
              🔒 ดาวน์โหลดได้ทันทีหลังยืนยันชำระเงินสำเร็จ
            </p>
          </div>
        </div>
      </div>

      {/* รีวิว */}
      <section className="section panel" style={{ marginTop: 32 }}>
        <div className="section-head">
          <h2>⭐ รีวิวสินค้า ({reviews.length})</h2>
        </div>
        {reviews.length === 0 && (
          <EmptyState icon="💬" title="ยังไม่มีรีวิว" description="เป็นคนแรกที่รีวิวสินค้านี้หลังซื้อ" />
        )}
        {reviews.map((r) => (
          <div className="review" key={r.id}>
            <div className="review-head">
              <span className="name">{r.user_name}</span>
              <span className="stars">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
              <time style={{ marginLeft: 'auto' }}>{formatDate(r.created_at)}</time>
            </div>
            {r.comment && <p>{r.comment}</p>}
          </div>
        ))}

        {user && (
          <form onSubmit={submitReview} style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 18 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>เขียนรีวิวของคุณ (ต้องซื้อสินค้าแล้ว)</h3>
            <div className="field">
              <label>คะแนน</label>
              <div style={{ display: 'flex', gap: 6, fontSize: 26, cursor: 'pointer' }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <span
                    key={n}
                    onClick={() => setReviewForm((f) => ({ ...f, rating: n }))}
                    style={{ color: n <= reviewForm.rating ? '#f59e0b' : '#d1d5db' }}
                  >
                    ★
                  </span>
                ))}
              </div>
            </div>
            <div className="field">
              <label>ความคิดเห็น</label>
              <textarea
                value={reviewForm.comment}
                onChange={(e) => setReviewForm((f) => ({ ...f, comment: e.target.value }))}
                placeholder="บอกเล่าประสบการณ์ใช้งานสินค้า..."
                maxLength={2000}
              />
            </div>
            <button className="btn" disabled={submittingReview}>
              {submittingReview ? 'กำลังส่ง...' : 'ส่งรีวิว'}
            </button>
          </form>
        )}
        {!user && (
          <p style={{ color: 'var(--text-3)', fontSize: 14 }}>
            <Link to="/login" style={{ color: 'var(--primary)' }}>เข้าสู่ระบบ</Link> เพื่อเขียนรีวิว (เฉพาะผู้ซื้อ)
          </p>
        )}
      </section>
    </div>
  );
}

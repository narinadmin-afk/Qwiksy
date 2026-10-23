import { Link, useNavigate } from 'react-router-dom';
import { formatTHB } from '../format.js';
import { useCart } from '../cart.js';
import { useToast } from './Toast.jsx';

export default function ProductCard({ product }) {
  const cart = useCart();
  const toast = useToast();
  const navigate = useNavigate();

  const onAdd = (e) => {
    e.preventDefault();
    e.stopPropagation();
    cart.add(product.id, 1);
    toast(`เพิ่ม "${product.title}" ลงตะกร้าแล้ว`, 'success');
  };

  return (
    <Link to={`/products/${product.slug}`} className="card">
      <div className="card-cover">
        {product.coverImageUrl ? (
          <img src={product.coverImageUrl} alt={product.title} loading="lazy" />
        ) : (
          <div className="placeholder">🛍️</div>
        )}
        {product.onSale && <span className="badge">-{Number(product.discountPercent)}%</span>}
        {product.featured && <span className="badge featured">แนะนำ</span>}
      </div>
      <div className="card-body">
        {product.category && <span className="card-cat">{product.category.name}</span>}
        <h3 className="card-title">{product.title}</h3>
        <div className="card-meta">
          <span>⭐ {Number(product.ratingAvg || 0).toFixed(1)}</span>
          <span>•</span>
          <span>ขายแล้ว {product.salesCount || 0}</span>
        </div>
        <div className="card-footer">
          <div className="price">
            {formatTHB(product.salePrice ?? product.price)}
            {product.onSale && (
              <span className="old">{formatTHB(product.price)}</span>
            )}
          </div>
          <button className="btn btn-sm" onClick={onAdd} title="เพิ่มลงตะกร้า">
            + ตะกร้า
          </button>
        </div>
      </div>
    </Link>
  );
}

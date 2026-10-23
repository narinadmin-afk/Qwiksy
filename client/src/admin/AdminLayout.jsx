import { Routes, Route, NavLink, Link } from 'react-router-dom';
import Dashboard from './Dashboard.jsx';
import Products from './Products.jsx';
import ProductForm from './ProductForm.jsx';
import Orders from './Orders.jsx';
import OrderDetail from './OrderDetail.jsx';
import Users from './Users.jsx';
import UserDetail from './UserDetail.jsx';
import Coupons from './Coupons.jsx';
import Audit from './Audit.jsx';
import Reviews from './Reviews.jsx';

const NAV = [
  { to: '/admin', end: true, icon: '📊', label: 'ภาพรวม' },
  { to: '/admin/products', icon: '📦', label: 'จัดการสินค้า' },
  { to: '/admin/orders', icon: '🧾', label: 'คำสั่งซื้อ' },
  { to: '/admin/users', icon: '👥', label: 'สมาชิก' },
  { to: '/admin/coupons', icon: '🏷️', label: 'คูปอง' },
  { to: '/admin/reviews', icon: '⭐', label: 'รีวิว' },
  { to: '/admin/audit', icon: '📜', label: 'Audit Log' },
];

export default function AdminLayout() {
  return (
    <div className="admin-layout">
      <aside className="admin-side">
        <div style={{ padding: '4px 14px 12px', fontSize: 13, fontWeight: 700, color: 'var(--text-3)' }}>
          แผงควบคุมผู้ดูแล
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end}>
            <span>{n.icon}</span> {n.label}
          </NavLink>
        ))}
        <div style={{ height: 1, background: 'var(--border)', margin: '10px 6px' }} />
        <Link to="/">
          <span>🏠</span> กลับหน้าร้าน
        </Link>
      </aside>
      <div className="admin-main">
        <Routes>
          <Route index element={<Dashboard />} />
          <Route path="products" element={<Products />} />
          <Route path="products/new" element={<ProductForm />} />
          <Route path="products/:id" element={<ProductForm />} />
          <Route path="orders" element={<Orders />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="users" element={<Users />} />
          <Route path="users/:id" element={<UserDetail />} />
          <Route path="coupons" element={<Coupons />} />
          <Route path="reviews" element={<Reviews />} />
          <Route path="audit" element={<Audit />} />
          <Route path="*" element={<Dashboard />} />
        </Routes>
      </div>
    </div>
  );
}

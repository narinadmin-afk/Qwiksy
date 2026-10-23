import { useEffect, useState, useRef } from 'react';
import { Link, NavLink, Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useCart } from '../cart.js';

/**  Navbar: โลโก้+ชื่อร้าน, เมนูหมวดหมู่, ค้นหา, ตะกร้า, Login/บัญชี */
function Navbar() {
  const { user, logout } = useAuth();
  const cart = useCart();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [cats, setCats] = useState([]);
  const userRef = useRef(null);

  useEffect(() => {
    fetch('/api/categories', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCats(d?.data?.categories || []))
      .catch(() => setCats([]));
  }, []);

  useEffect(() => setQ(searchParams.get('q') || ''), [searchParams]);

  useEffect(() => {
    const onClick = (e) => {
      if (userRef.current && !userRef.current.contains(e.target)) setUserOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  const submitSearch = (e) => {
    e.preventDefault();
    navigate(`/products?q=${encodeURIComponent(q.trim())}`);
    setSearchOpen(false);
    setMenuOpen(false);
  };

  return (
    <header className="navbar">
      <div className="container navbar-inner">
        <Link to="/" className="logo">
          <img src="/logo.jpg" alt="Qwiksy" className="logo-img" />
          <span>Qwiksy</span>
        </Link>

        <nav className={`nav-links ${menuOpen ? 'open' : ''}`}>
          <NavLink to="/" end onClick={() => setMenuOpen(false)}>
            หน้าแรก
          </NavLink>
          <NavLink to="/products" onClick={() => setMenuOpen(false)}>
            สินค้าทั้งหมด
          </NavLink>
          {cats.slice(0, 4).map((c) => (
            <NavLink
              key={c.id}
              to={`/products?category=${c.slug}`}
              onClick={() => setMenuOpen(false)}
            >
              {c.name}
            </NavLink>
          ))}
          <NavLink to="/library" onClick={() => setMenuOpen(false)}>
            คลังของฉัน
          </NavLink>
        </nav>

        <form className={`nav-search ${searchOpen ? 'open' : ''}`} onSubmit={submitSearch}>
          <span className="search-ico">🔍</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาสินค้าดิจิทัล..."
            aria-label="ค้นหาสินค้า"
          />
        </form>

        <div className="nav-actions">
          <button
            className="btn btn-ghost btn-sm menu-toggle"
            onClick={() => setSearchOpen((s) => !s)}
            aria-label="ค้นหา"
          >
            🔍
          </button>
          <Link to="/cart" className="btn btn-outline btn-sm cart-btn" aria-label="ตะกร้า">
            🛒
            {cart.count > 0 && <span className="cart-badge">{cart.count}</span>}
          </Link>
          <button
            className="btn btn-ghost btn-sm menu-toggle"
            onClick={() => setMenuOpen((s) => !s)}
            aria-label="เมนู"
          >
            ☰
          </button>

          {user ? (
            <div className="user-menu" ref={userRef}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setUserOpen((o) => !o)}
                style={{ gap: 8 }}
              >
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" className="avatar" referrerPolicy="no-referrer" />
                ) : (
                  <span className="avatar" style={{ display: 'grid', placeItems: 'center', fontSize: 13 }}>
                    {(user.displayName || user.email || '?').slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user.displayName || user.email}
                </span>
              </button>
              {userOpen && (
                <div className="user-menu-pop" onClick={() => setUserOpen(false)}>
                  <Link to="/account">👤 โปรไฟล์ & คำสั่งซื้อ</Link>
                  <Link to="/library">📚 คลังสินค้าของฉัน</Link>
                  {user.role === 'admin' && <Link to="/admin">🛠 แผงควบคุม Admin</Link>}
                  <div className="divider" />
                  <button onClick={logout}>🔓 ออกจากระบบ</button>
                </div>
              )}
            </div>
          ) : (
            <Link to="/login" className="btn btn-sm">
              เข้าสู่ระบบ
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function Footer() {
  const [cats, setCats] = useState([]);
  useEffect(() => {
    fetch('/api/categories', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCats(d?.data?.categories || []))
      .catch(() => {});
  }, []);
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <div className="logo" style={{ marginBottom: 12 }}>
              <img src="/logo.jpg" alt="Qwiksy" className="logo-img" />
              <span>Qwiksy</span>
            </div>
            <p>ตลาดสินค้าดิจิทัลครบวงจร eBooks เทมเพลต ไฟล์กราฟิก เสียง วิดีโอ และคอร์สเรียน ชำระเงินปลอดภัย ดาวน์โหลดได้ทันทีหลังยืนยันชำระเงิน</p>
            <p>📧 support@qwiksy.example (ฝ่ายบริการลูกค้า)</p>
            <p>🕐 บริการลูกค้า จันทร์–ศุกร์ 09:00–18:00 น.</p>
          </div>
          <div>
            <h4>หมวดหมู่สินค้า</h4>
            {cats.map((c) => (
              <Link key={c.id} to={`/products?category=${c.slug}`}>
                {c.name}
              </Link>
            ))}
          </div>
          <div>
            <h4>ข้อมูลร้านค้า</h4>
            <Link to="/terms">เงื่อนไขการใช้บริการ</Link>
            <Link to="/privacy">นโยบายความเป็นส่วนตัว</Link>
            <Link to="/library">คลังสินค้าของฉัน</Link>
            <Link to="/account">ประวัติการสั่งซื้อ</Link>
          </div>
        </div>
        <div className="footer-bottom">
          © {new Date().getFullYear()} Qwiksy - สินค้าดิจิทัลคุณภาพ | ราคาหน่วยเป็นเงินบาท (THB)
        </div>
      </div>
    </footer>
  );
}

export default function Layout() {
  return (
    <>
      <Navbar />
      <main style={{ minHeight: '60vh' }}>
        <Outlet />
      </main>
      <Footer />
    </>
  );
}

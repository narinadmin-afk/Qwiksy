import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import Home from './pages/Home.jsx';
import Products from './pages/Products.jsx';
import ProductDetail from './pages/ProductDetail.jsx';
import Cart from './pages/Cart.jsx';
import Checkout from './pages/Checkout.jsx';
import Pay from './pages/Pay.jsx';
import Success from './pages/Success.jsx';
import Login from './pages/Login.jsx';
import Account from './pages/Account.jsx';
import Library from './pages/Library.jsx';
import Terms from './pages/Terms.jsx';
import Privacy from './pages/Privacy.jsx';
import AdminLayout from './admin/AdminLayout.jsx';

function LoadingPage() {
  return (
    <div className="state-box">
      <div className="spinner" />
      <p style={{ marginTop: 14 }}>กำลังโหลด...</p>
    </div>
  );
}

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingPage />;
  if (!user) {
    return <Navigate to="/login" replace state={{ next: location.pathname + location.search }} />;
  }
  return children;
}

function RequireAdmin({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingPage />;
  if (!user) return <Navigate to="/login" replace state={{ next: '/admin' }} />;
  if (user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/products" element={<Products />} />
        <Route path="/products/:slug" element={<ProductDetail />} />
        <Route path="/cart" element={<Cart />} />
        <Route path="/login" element={<Login />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route
          path="/checkout"
          element={
            <RequireAuth>
              <Checkout />
            </RequireAuth>
          }
        />
        <Route
          path="/pay/:orderNumber"
          element={
            <RequireAuth>
              <Pay />
            </RequireAuth>
          }
        />
        <Route
          path="/success/:orderNumber"
          element={
            <RequireAuth>
              <Success />
            </RequireAuth>
          }
        />
        <Route
          path="/account"
          element={
            <RequireAuth>
              <Account />
            </RequireAuth>
          }
        />
        <Route
          path="/library"
          element={
            <RequireAuth>
              <Library />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/*"
          element={
            <RequireAdmin>
              <AdminLayout />
            </RequireAdmin>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

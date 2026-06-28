// filepath: coffee-app/merchant-web/src/App.tsx
import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import LoginPage from './pages/login/LoginPage';
import ProductsPage from './pages/products/ProductsPage';
import OrdersPage from './pages/orders/OrdersPage';
import { auth } from './api/auth';
import { ToastContainer } from './components/Toast';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('merchant_token');
  const navigate = useNavigate();
  useEffect(() => {
    if (!token) navigate('/login', { replace: true });
  }, [token, navigate]);
  if (!token) return null;
  return <>{children}</>;
}

function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const logout = () => {
    auth.logout();
    navigate('/login');
  };

  return (
    <div className="layout">
      <header className="topbar">
        <div className="brand">☕ 咖啡店管理</div>
        <nav className="nav">
          <NavLink to="/orders" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            订单管理
          </NavLink>
          <NavLink to="/products" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            商品管理
          </NavLink>
          <button onClick={logout} className="btn btn-ghost">退出</button>
        </nav>
      </header>
      <main className="main">{children}</main>
    </div>
  );
}

function App() {
  // Initialize auth (sets default password on first run)
  useEffect(() => {
    auth.init();
  }, []);

  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/orders"
          element={
            <RequireAuth>
              <Layout>
                <OrdersPage />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/products"
          element={
            <RequireAuth>
              <Layout>
                <ProductsPage />
              </Layout>
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/orders" replace />} />
      </Routes>
      <ToastContainer />
    </>
  );
}

export default App;

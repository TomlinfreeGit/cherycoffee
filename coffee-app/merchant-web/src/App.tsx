// filepath: coffee-app/merchant-web/src/App.tsx
import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import LoginPage from './pages/login/LoginPage';
import ProductsPage from './pages/products/ProductsPage';
import OrdersPage from './pages/orders/OrdersPage';
import UsersPage from './pages/users/UsersPage';
import CategoriesPage from './pages/categories/CategoriesPage';
import BannersPage from './pages/banners/BannersPage';
import SettingsPage from './pages/settings/SettingsPage';
import { auth, MerchantUser } from './api/auth';
import { onUnauthorized } from './api/client';
import { ToastContainer } from './components/Toast';
import { showToast } from './components/Toast';

function RequireAuth({ children }: { children: React.ReactNode }) {
  // 用 auth.isLoggedIn() 检查更可靠: 会顺带做 token 过期判断。
  const logged = auth.isLoggedIn();
  const navigate = useNavigate();
  useEffect(() => {
    if (!logged) navigate('/login', { replace: true });
  }, [logged, navigate]);
  if (!logged) return null;
  return <>{children}</>;
}

function Layout({ children, onLogout }: { children: React.ReactNode; onLogout: () => void }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<MerchantUser | null>(auth.getUser());

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
          <NavLink to="/users" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            用户管理
          </NavLink>
          <NavLink to="/categories" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            菜单分类
          </NavLink>
          <NavLink to="/banners" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            轮播图
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            等级设置
          </NavLink>
          {user && <span style={{ color: 'var(--muted)', fontSize: 13, alignSelf: 'center' }}>{user.username}</span>}
          <button
            onClick={async () => {
              await auth.logout(true);
              onLogout();
              navigate('/login');
            }}
            className="btn btn-ghost"
          >
            退出
          </button>
        </nav>
      </header>
      <main className="main">{children}</main>
    </div>
  );
}

function App() {
  // 订阅 401: 任何 request.js 收到 401 → 自动 logout + 跳 /login + 提示
  useEffect(() => {
    const off = onUnauthorized(() => {
      showToast('登录已过期,请重新登录', 'error');
      // 用 hash 路由跳转避免循环依赖 (auth 已经清完本地,这里只是 UI)
      window.location.hash = '#/login';
      window.location.reload();
    });
    return off;
  }, []);

  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/orders"
          element={
            <RequireAuth>
              <Layout onLogout={() => {}}>
                <OrdersPage />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/products"
          element={
            <RequireAuth>
              <Layout onLogout={() => {}}>
                <ProductsPage />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/users"
          element={
            <RequireAuth>
              <Layout onLogout={() => {}}>
                <UsersPage />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/categories"
          element={
            <RequireAuth>
              <Layout onLogout={() => {}}>
                <CategoriesPage />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/banners"
          element={
            <RequireAuth>
              <Layout onLogout={() => {}}>
                <BannersPage />
              </Layout>
            </RequireAuth>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAuth>
              <Layout onLogout={() => {}}>
                <SettingsPage />
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

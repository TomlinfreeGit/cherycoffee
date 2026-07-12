// filepath: coffee-app/merchant-web/src/pages/login/LoginPage.tsx
// 商家后台登录页: 用户名 + 密码 → /api/merchant-auth/login → 写 token 到 localStorage。
// 之前的纯前端 mock 已废弃 (密码明文存 localStorage 极其危险)。

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../api/auth';
import { showToast } from '../../components/Toast';

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError('请输入用户名和密码');
      return;
    }
    setSubmitting(true);
    try {
      await auth.login(username, password);
      showToast('登录成功', 'success');
      navigate('/orders', { replace: true });
    } catch (e: any) {
      if (e.status === 429) {
        const sec = e.retryAfterMs ? Math.ceil(e.retryAfterMs / 1000) : 900;
        setError(`登录失败次数过多,请 ${sec} 秒后再试`);
      } else {
        setError(e.message || '登录失败');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-container">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>☕ 咖啡店管理</h1>
        <p>请输入商家管理员账号</p>
        {error && <div className="error">{error}</div>}
        <div className="form-group">
          <input
            type="text"
            placeholder="用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
            spellCheck={false}
          />
        </div>
        <div className="form-group">
          <input
            type="password"
            placeholder="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={submitting}>
          {submitting ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  );
}

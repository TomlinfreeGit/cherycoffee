// filepath: coffee-app/merchant-web/src/pages/login/LoginPage.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../api/auth';

export default function LoginPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (auth.login(password)) {
      navigate('/orders');
    } else {
      setError('密码错误');
    }
  };

  return (
    <div className="login-container">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>☕ 咖啡店管理</h1>
        <p>请输入管理员密码</p>
        {error && <div className="error">{error}</div>}
        <div className="form-group">
          <input
            type="password"
            placeholder="管理员密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
        <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
          登录
        </button>
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
          默认密码：admin123（首次登录后可修改）
        </div>
      </form>
    </div>
  );
}

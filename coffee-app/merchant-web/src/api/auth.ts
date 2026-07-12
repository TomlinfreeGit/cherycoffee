// filepath: coffee-app/merchant-web/src/api/auth.ts
// 商家后台鉴权: 通过后端 /api/merchant-auth/login 拿服务端签发的 token。
//
// 设计要点:
//   • 不再在 localStorage 存密码 (旧实现是明文存)
//   • 仅存服务端返回的随机 token (64 字节熵),从 localStorage 读写
//   • 401 自动清理 (client.ts 拦截 401 → 清 token + 跳登录)

const TOKEN_KEY = 'merchant_token';
const USER_KEY = 'merchant_user';
const TOKEN_TTL_KEY = 'merchant_token_expires_at';

export interface MerchantUser {
  id: number;
  username: string;
  role: string;
}

export const auth = {
  /** 同步拿到当前缓存的 token / 用户 / 过期时间 */
  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },
  getUser(): MerchantUser | null {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as MerchantUser;
    } catch (_) {
      return null;
    }
  },
  getExpiresAt(): string | null {
    return localStorage.getItem(TOKEN_TTL_KEY);
  },
  isLoggedIn(): boolean {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) return false;
    const exp = localStorage.getItem(TOKEN_TTL_KEY);
    if (exp) {
      const expMs = Date.parse(exp);
      if (Number.isFinite(expMs) && expMs <= Date.now()) {
        this.logout(true);
        return false;
      }
    }
    return true;
  },

  /**
   * 调后端登录。成功: token + 用户信息写入 localStorage;失败: throw Error。
   */
  async login(username: string, password: string): Promise<MerchantUser> {
    if (!username.trim() || !password) {
      throw new Error('用户名和密码不能为空');
    }
    const res = await fetch(`${API_BASE}/merchant-auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `登录失败 ${res.status}`);
      (err as any).status = res.status;
      (err as any).retryAfterMs = data.retryAfterMs;
      throw err;
    }
    const { token, username: name, role, expiresAt } = data.data;
    if (!token) throw new Error('登录失败: 服务端未返回 token');
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(
      USER_KEY,
      JSON.stringify({ id: 0, username: name, role } satisfies MerchantUser)
    );
    if (expiresAt) localStorage.setItem(TOKEN_TTL_KEY, expiresAt);
    return { id: 0, username: name, role };
  },

  /**
   * 退出登录。serverCall=false 表示仅清本地 (用于 401 自动登出时不再请求后端,避免死循环)
   */
  async logout(serverCall = true): Promise<void> {
    if (serverCall) {
      const token = this.getToken();
      if (token) {
        try {
          await fetch(`${API_BASE}/merchant-auth/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
          });
        } catch (_) {
          /* 即便后端 401,本地也要清 */
        }
      }
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(TOKEN_TTL_KEY);
  },

  /**
   * 改密。成功后 token 失效 → 强制重新登录。
   */
  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    const token = this.getToken();
    if (!token) throw new Error('未登录');
    const res = await fetch(`${API_BASE}/merchant-auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ oldPassword, newPassword })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `改密失败 ${res.status}`);
    }
    await this.logout(true);
  }
};

// 为了避免循环引用,这里直接读 config.ts 导入 API_BASE
// (顶部 import 会被静态解析,但需注意:之前 client.ts 也 import 'auth',
// 这里不反过来 import 任何 client.ts 模块,避免循环)
import { API_BASE } from './config';


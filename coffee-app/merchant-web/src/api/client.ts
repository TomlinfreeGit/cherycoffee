// filepath: coffee-app/merchant-web/src/api/client.ts
import { API_BASE } from './config';
import { auth } from './auth';

const BASE = API_BASE;

// 401 自动登出回调: 业务侧可以监听这个回调做跳转到 /login 等动作。
// 这样 client.ts 不强依赖于 react-router,在 App.tsx 里 subscribe 这个事件。
type UnauthorizedHandler = () => void;
const unauthorizedHandlers: UnauthorizedHandler[] = [];
export function onUnauthorized(handler: UnauthorizedHandler): () => void {
  unauthorizedHandlers.push(handler);
  return () => {
    const i = unauthorizedHandlers.indexOf(handler);
    if (i >= 0) unauthorizedHandlers.splice(i, 1);
  };
}
function emitUnauthorized() {
  for (const h of unauthorizedHandlers) {
    try { h(); } catch (_) { /* 隔离每个 handler 的异常 */ }
  }
}

/**
 * 拿到当前有效的 Bearer token。
 * 仅从 localStorage 读,绝不在前端固化任何 token。
 */
function getBearer(): string | null {
  return auth.getToken();
}

async function request<T>(method: string, path: string, body?: unknown, opts: { noAuth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // noAuth=true: 用于登录、调不需要鉴权的接口
  if (!opts.noAuth) {
    const token = getBearer();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401 && !opts.noAuth) {
    // 清理本地 token,通知监听器(跳登录页)
    await auth.logout(false);
    emitUnauthorized();
    const err = new Error('Unauthorized');
    (err as any).status = 401;
    throw err;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const e = new Error(err.error || 'Request failed');
    (e as any).status = res.status;
    throw e;
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json();
}

export interface Product {
  id: number;
  name: string;
  category: string;
  price: number;
  description: string | null;
  image_url: string | null;
  available: number;
  sort_order: number;
  // 1 = 顾客加购前必须选冷/热;0 = 无需选项 (默认)
  support_temperature: number;
}

export interface OrderItem {
  id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  // 顾客选择的选项,如 '热' / '冷' (后端在商品支持时才填,否则为 null)
  options: string | null;
}

export interface Order {
  id: number;
  pickup_number: string;
  status: 'pending' | 'paid' | 'preparing' | 'ready' | 'completed' | 'cancelled' | 'failed';
  total_amount: number;
  customer_note: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_phone_masked: string | null;
  transaction_id: string | null;
  created_at: string;
  updated_at: string;
  items?: OrderItem[];
}

export interface User {
  openid: string;
  nickname: string | null;
  avatar_url: string | null;
  phone: string | null;
  has_phone: boolean;
  phone_verified: boolean;
  order_count: number;
  last_order_at: string | null;
  total_spent?: number;
  // 会员等级相关
  level?: number;
  completed_orders?: number;
  discount?: number; // 0.80–1.00
  created_at: string;
  updated_at: string;
}

export interface LevelSettings {
  level_orders_required: number;
  level_discount_increment: number;
  min_discount: number;
  // 商家后台订单列表自动刷新间隔 (毫秒)。默认 10000 = 10 秒。
  order_auto_refresh_ms?: number;
}

export interface UserListResult {
  data: User[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface PagedOrderResult {
  data: Order[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface OrderStats {
  active: number;     // pending|paid|preparing|ready
  preparing: number;
  ready: number;
  today: number;
}

export interface Category {
  id: number;
  name: string;
  name_en: string | null;
  sort_order: number;
  product_count: number;
  created_at: string;
  updated_at: string;
}

export const api = {
  // Products
  listProducts: (params?: { category?: string; availableOnly?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.category) q.set('category', params.category);
    if (params?.availableOnly) q.set('availableOnly', 'true');
    const qs = q.toString();
    return request<{ data: Product[] }>('GET', `/products${qs ? `?${qs}` : ''}`);
  },
  getProduct: (id: number) => request<{ data: Product }>('GET', `/products/${id}`),
  createProduct: (data: Partial<Product>) => request<{ data: Product }>('POST', '/products', data),
  updateProduct: (id: number, data: Partial<Product>) =>
    request<{ data: Product }>('PATCH', `/products/${id}`, data),
  deleteProduct: (id: number) => request<void>('DELETE', `/products/${id}`),

  // Orders (merchant endpoints - sees all orders)
  // params.status 可以是单个订单状态 (pending/paid/...),
  // 也可以传 'active' 表示“进行中”,后端会翻译成 SQL IN (...)。
  // params.limit + params.offset 为可选:不传时后端走“返全部”的旧逻辑。
  listOrders: (params?: { status?: string; search?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.search) q.set('search', params.search);
    if (params?.limit !== undefined) q.set('limit', String(params.limit));
    if (params?.offset !== undefined) q.set('offset', String(params.offset));
    const qs = q.toString();
    return request<PagedOrderResult | { data: Order[] }>('GET', `/merchant/orders${qs ? `?${qs}` : ''}`);
  },
  // 顶部 KPI 卡片的订单统计(独立接口,不受分页/过滤影响)
  getOrderStats: () => request<{ data: OrderStats }>('GET', '/merchant/orders/stats'),
  getOrder: (id: number) => request<{ data: Order }>('GET', `/merchant/orders/${id}`),
  updateOrderStatus: (id: number, status: Order['status']) =>
    request<{ data: Order }>('PATCH', `/merchant/orders/${id}/status`, { status }),

  revealFullPhone: async (id: number): Promise<string> => {
    const token = getBearer();
    const res = await fetch(`${BASE}/merchant/orders/${id}/full-phone`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (res.status === 401) {
      await auth.logout(false);
      emitUnauthorized();
      throw new Error('Unauthorized');
    }
    if (!res.ok) throw new Error('Failed to reveal phone');
    const data = await res.json();
    return data.data.customer_phone;
  },

  // Users (merchant management)
  listUsers: (params?: { search?: string; has_phone?: boolean; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.has_phone !== undefined) q.set('has_phone', String(params.has_phone));
    if (params?.limit !== undefined) q.set('limit', String(params.limit));
    if (params?.offset !== undefined) q.set('offset', String(params.offset));
    const qs = q.toString();
    return request<UserListResult>('GET', `/merchant/users${qs ? `?${qs}` : ''}`);
  },
  getUser: (openid: string) => request<{ data: User }>('GET', `/merchant/users/${encodeURIComponent(openid)}`),
  deleteUser: (openid: string) =>
    request<{ data: { openid: string; deleted_user: boolean; anonymized_orders: number; deleted_sessions: number } }>(
      'DELETE',
      `/merchant/users/${encodeURIComponent(openid)}`
    ),

  // Categories
  listCategories: () => request<{ data: Category[] }>('GET', '/categories'),
  createCategory: (data: { name: string; name_en?: string | null; sort_order?: number }) =>
    request<{ data: Category }>('POST', '/categories', data),
  updateCategory: (
    id: number,
    data: { name?: string; name_en?: string | null; sort_order?: number }
  ) => request<{ data: Category }>('PATCH', `/categories/${id}`, data),
  deleteCategory: (id: number) =>
    request<{ data: { id: number; name: string; deleted: boolean; detached_products: number } }>(
      'DELETE',
      `/categories/${id}`
    ),

  // Settings (level + discount config)
  getSettings: () => request<{ data: LevelSettings }>('GET', '/merchant/settings'),
  updateSettings: (data: Partial<LevelSettings>) =>
    request<{ data: LevelSettings }>('PATCH', '/merchant/settings', data)
};

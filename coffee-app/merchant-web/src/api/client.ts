// filepath: coffee-app/merchant-web/src/api/client.ts
import { API_BASE } from './config';

const BASE = API_BASE;

// Merchant token for local development. In production this should be obtained
// from a real login flow with proper credential storage.
const MERCHANT_TOKEN = 'merchant-local-token';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${MERCHANT_TOKEN}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
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
}

export interface OrderItem {
  id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
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
  created_at: string;
  updated_at: string;
}

export interface UserListResult {
  data: User[];
  total: number;
  limit: number;
  offset: number;
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
  listOrders: (params?: { status?: string; search?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.search) q.set('search', params.search);
    const qs = q.toString();
    return request<{ data: Order[] }>('GET', `/merchant/orders${qs ? `?${qs}` : ''}`);
  },
  getOrder: (id: number) => request<{ data: Order }>('GET', `/merchant/orders/${id}`),
  updateOrderStatus: (id: number, status: Order['status']) =>
    request<{ data: Order }>('PATCH', `/merchant/orders/${id}/status`, { status }),

  revealFullPhone: async (id: number): Promise<string> => {
    const res = await fetch(`${BASE}/merchant/orders/${id}/full-phone`, {
      headers: { Authorization: `Bearer ${MERCHANT_TOKEN}` }
    });
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
    )
};

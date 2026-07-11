// filepath: coffee-app/server/src/db/schema.js
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL,
  description TEXT,
  image_url TEXT,
  available INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_available ON products(available);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pickup_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  total_amount REAL NOT NULL,
  customer_note TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  transaction_id TEXT,
  openid TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_openid ON orders(openid);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(customer_phone);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  product_image_url TEXT,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  subtotal REAL NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

CREATE TABLE IF NOT EXISTS daily_counter (
  date TEXT PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0
);

-- 用户会话表：小程序登录后创建的会话
-- 每个 session 绑定一个 openid（用户的微信唯一标识）
-- session_key 用于解密手机号等敏感数据（来自 jscode2session）
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  openid TEXT NOT NULL,
  session_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_openid ON sessions(openid);

-- 用户档案表：缓存从微信拿到的昵称/头像/手机号
-- 与 sessions 不同，openid 是稳定的，不会随登录过期
CREATE TABLE IF NOT EXISTS users (
  openid TEXT PRIMARY KEY,
  nickname TEXT,
  avatar_url TEXT,
  phone TEXT,
  phone_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

-- 菜单分类表
-- 与 products.category 字段冗余存储：分类本身有自己的元数据（icon、排序），
-- 但 product.category 仍是字符串（保证兼容性）。
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  icon TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_categories_sort ON categories(sort_order);

-- 种子分类：如果表为空，插入默认三类
`;

module.exports = { SCHEMA_SQL };

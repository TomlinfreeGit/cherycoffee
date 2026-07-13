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
  -- 会员等级: 初始 1，每完成 N 单自动升 1 级
  level INTEGER NOT NULL DEFAULT 1,
  -- 已完成订单数 (仅 status='completed' 的订单计入)
  completed_orders INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
-- Note: idx_users_level is created in the migration step (after the
-- column is added to pre-existing DBs). Putting it here would fail with
-- "no such column: level" when the schema is re-applied to an old DB.

-- 商家可配置的系统设置 (key-value 存储)
-- 用于会员等级、折扣等可调参数
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 菜单分类表
-- 与 products.category 字段冗余存储：分类本身有自己的元数据（英文名、排序），
-- 但 product.category 仍是字符串（保证兼容性）。
-- icon 列保留为 nullable 以兼容历史数据库，但前端/后端 API 已不再使用。
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  name_en TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  icon TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_categories_sort ON categories(sort_order);

-- 管理员表 (商家后台登录账号)
-- password_hash: scrypt 派生,格式 'scrypt$N$r$p$saltB64$hashB64'
-- role: 'owner' = 超级管理员 (唯一);其他值 = 具备同级别权限但可扩展为更细粒度
CREATE TABLE IF NOT EXISTS merchants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  disabled INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 管理员 session 表 (代替硬编码 bearer token)
-- token: 服务端生成的不可预测随机串,32 字节 hex
-- expires_at: 绝对过期时间 (12h 可配置)
-- last_seen_at: 用于滑动续期 (每次成功鉴权后更新)
-- ip / user_agent: 可选审计字段
CREATE TABLE IF NOT EXISTS merchant_sessions (
  token TEXT PRIMARY KEY,
  merchant_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_merchant_sessions_merchant ON merchant_sessions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_sessions_expires ON merchant_sessions(expires_at);

-- 种子分类：如果表为空，插入默认三类
`;

module.exports = { SCHEMA_SQL };

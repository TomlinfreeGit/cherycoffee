// filepath: coffee-app/server/src/db/index.js
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { SCHEMA_SQL } = require('./schema');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'coffee.db');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Open database (creates file if not exists)
const db = new DatabaseSync(DB_PATH);

// Enable WAL mode for better concurrency
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

/**
 * Idempotent column additions for schema evolution.
 * Each entry: { table, column, type, default? }
 */
const MIGRATIONS = [
  { table: 'order_items', column: 'product_image_url', type: 'TEXT' },
  { table: 'orders', column: 'customer_name', type: 'TEXT' },
  { table: 'orders', column: 'customer_phone', type: 'TEXT' },
  { table: 'sessions', column: 'session_key', type: 'TEXT' },
  // Make products.category nullable so categories can be deleted without
  // violating NOT NULL (products get their category set to NULL = detached).
  { table: 'products', column: 'category', type: 'TEXT', allowNull: true },
  { table: 'users', column: 'level', type: 'INTEGER', default: '1' },
  { table: 'users', column: 'completed_orders', type: 'INTEGER', default: '0' }
];

function runMigrations() {
  for (const m of MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${m.table})`).all();
    const exists = cols.some((c) => c.name === m.column);
    if (!exists) {
      try {
        const defaultClause = m.default !== undefined ? ` DEFAULT ${m.default}` : '';
        db.exec(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.type}${defaultClause}`);
        console.log(`✓ Migration: added ${m.table}.${m.column}`);
      } catch (e) {
        // Column already exists with different definition - try a no-op
        console.warn(`Migration skipped ${m.table}.${m.column}: ${e.message}`);
      }
    }
  }

  // Create supporting indexes that depend on columns potentially added
  // by the migrations above. We do this AFTER the column additions so
  // existing DBs without `level` won't fail at CREATE INDEX time.
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_level ON users(level)');

  // SQL-level migrations: relax constraints (SQLite doesn't support ALTER COLUMN).
  // We use a "shadow table" approach: create new table → copy → rename.
  // FK checks are temporarily disabled because order_items references products.id.
  const productsCols = db.prepare(`PRAGMA table_info(products)`).all();
  const catCol = productsCols.find((c) => c.name === 'category');

  // Clean up any leftover shadow table from a previous failed migration
  db.exec('DROP TABLE IF EXISTS products_new');

  if (catCol && catCol.notnull === 1) {
    try {
      console.log('Migration: relaxing products.category NOT NULL → NULL...');
      db.exec('PRAGMA foreign_keys = OFF');
      db.exec(`
        CREATE TABLE products_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          category TEXT,
          price REAL NOT NULL,
          description TEXT,
          image_url TEXT,
          available INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        );
        INSERT INTO products_new (id, name, category, price, description, image_url, available, sort_order, created_at, updated_at)
          SELECT id, name, category, price, description, image_url, available, sort_order, created_at, updated_at FROM products;
        DROP TABLE products;
        ALTER TABLE products_new RENAME TO products;
        CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
        CREATE INDEX IF NOT EXISTS idx_products_available ON products(available);
      `);
      db.exec('PRAGMA foreign_keys = ON');
      console.log('✓ Migration: products.category is now nullable');
    } catch (e) {
      db.exec('PRAGMA foreign_keys = ON');
      console.warn('Migration: relax products.category failed:', e.message);
    }
  }
}

// Initialize schema (creates tables if they don't exist)
db.exec(SCHEMA_SQL);

// Run migrations to add columns that may be missing in existing DBs
runMigrations();

// Seed initial data if products table is empty
function seedInitialData() {
  const count = db.prepare('SELECT COUNT(*) as cnt FROM products').get();
  if (count.cnt > 0) return;

  const insertProduct = db.prepare(`
    INSERT INTO products (name, category, price, description, image_url, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const seedProducts = [
    // 意式咖啡
    ['美式咖啡', '意式咖啡', 20, '意式拼配【中深烘】/坚果、黑巧、焦糖', '', 1],
    ['拿铁咖啡', '意式咖啡', 24, '意式拼配浓缩咖啡 + 鲜奶', '', 2],
    ['澳白咖啡', '意式咖啡', 24, '小热杯 220ml', '', 3],
    ['燕麦拿铁', '意式咖啡', 26, '燕麦奶 + 意式浓缩', '', 4],
    ['橙皮拿铁', '意式咖啡', 26, '橙皮 + 拿铁', '', 5],
    ['香草籽拿铁', '意式咖啡', 28, '香草籽 + 拿铁', '', 6],
    ['Dirty 脏咖啡', '意式咖啡', 28, '浓缩咖啡 + 冰鲜奶', '', 7],
    // 其他饮品
    ['可可鲜奶', '其他饮品', 28, '浓郁可可 + 鲜奶', '', 8],
    ['热恋阳光气泡水', '其他饮品', 30, '菠萝・芒果・百香果・香茅', '', 9],
    ['白日梦气泡水', '其他饮品', 30, '日本柚子・油柑・茉莉绿茶・白糖', '', 10],
    // 创意特调
    ['深秋', '创意特调', 35, '热饮｜橙皮・鲜奶・拼配浓缩咖啡・肉桂・红糖', '', 11],
    ['暖冬', '创意特调', 35, '热饮｜香草籽・红茶・鲜奶・黑巧克力・拼配浓缩咖啡', '', 12],
    ['慕斯蛋糕', '创意特调', 38, '冰｜低因｜哈马修日晒奶萃・芝士稀奶油・青柠皮', '', 13],
    ['热恋阳光', '创意特调', 38, '冰｜低因｜菠萝・芒果・百香果・香茅・哈马修水洗冲煮咖啡', '', 14],
    ['白日梦', '创意特调', 38, '冰｜低因｜日本柚子・油柑・茉莉绿茶・白糖・哈马修水洗冲煮咖啡', '', 15]
  ];

  db.exec('BEGIN');
  try {
    for (const item of seedProducts) {
      insertProduct.run(...item);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  console.log(`✓ Seeded ${seedProducts.length} products`);
}

// Seed default categories if the table is empty
function seedCategories() {
  const count = db.prepare('SELECT COUNT(*) as cnt FROM categories').get();
  if (count.cnt > 0) return;

  const insertCategory = db.prepare(`
    INSERT INTO categories (name, sort_order, icon) VALUES (?, ?, ?)
  `);
  const seedCats = [
    ['意式咖啡', 1, '☕'],
    ['其他饮品', 2, '🥤'],
    ['创意特调', 3, '🍹']
  ];
  try {
    db.exec('BEGIN');
    for (const c of seedCats) insertCategory.run(...c);
    db.exec('COMMIT');
    console.log(`✓ Seeded ${seedCats.length} categories`);
  } catch (e) {
    db.exec('ROLLBACK');
    console.warn('Category seed failed:', e.message);
  }
}

seedInitialData();
seedCategories();

// Seed default settings on first run
function seedSettings() {
  const count = db.prepare('SELECT COUNT(*) as cnt FROM settings').get();
  if (count.cnt > 0) return;
  const defaults = [
    ['level_orders_required', '10'],     // 每 10 单升一级
    ['level_discount_increment', '0.01'], // 每级递减 0.01
    ['min_discount', '0.80']              // 最低折扣 (不能低于原价的 80%)
  ];
  const ins = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  try {
    db.exec('BEGIN');
    for (const [k, v] of defaults) ins.run(k, v);
    db.exec('COMMIT');
    console.log(`✓ Seeded ${defaults.length} settings`);
  } catch (e) {
    db.exec('ROLLBACK');
    console.warn('Settings seed failed:', e.message);
  }
}
seedSettings();

module.exports = { db };

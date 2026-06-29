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
  { table: 'sessions', column: 'session_key', type: 'TEXT' }
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
        console.warn(`Migration failed for ${m.table}.${m.column}:`, e.message);
      }
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

seedInitialData();

module.exports = { db };

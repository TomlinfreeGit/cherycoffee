// filepath: coffee-app/server/reset-data.js
// Helper: clear all data and re-seed products
const { db } = require('./src/db');

db.prepare('DELETE FROM order_items').run();
db.prepare('DELETE FROM orders').run();
db.prepare('DELETE FROM daily_counter').run();
db.prepare('DELETE FROM products').run();
db.prepare('DELETE FROM sessions').run();
db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('products', 'orders', 'order_items')").run();

// Re-seed products
const { execSync } = require('node:child_process');
db.exec('BEGIN');
const insertProduct = db.prepare(`
  INSERT INTO products (name, category, price, description, image_url, sort_order)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const seedProducts = [
  ['美式咖啡', '意式咖啡', 20, '意式拼配【中深烘】/坚果、黑巧、焦糖', '', 1],
  ['拿铁咖啡', '意式咖啡', 24, '意式拼配浓缩咖啡 + 鲜奶', '', 2],
  ['澳白咖啡', '意式咖啡', 24, '小热杯 220ml', '', 3],
  ['燕麦拿铁', '意式咖啡', 26, '燕麦奶 + 意式浓缩', '', 4],
  ['橙皮拿铁', '意式咖啡', 26, '橙皮 + 拿铁', '', 5],
  ['香草籽拿铁', '意式咖啡', 28, '香草籽 + 拿铁', '', 6],
  ['Dirty 脏咖啡', '意式咖啡', 28, '浓缩咖啡 + 冰鲜奶', '', 7],
  ['可可鲜奶', '其他饮品', 28, '浓郁可可 + 鲜奶', '', 8],
  ['热恋阳光气泡水', '其他饮品', 30, '菠萝・芒果・百香果・香茅', '', 9],
  ['白日梦气泡水', '其他饮品', 30, '日本柚子・油柑・茉莉绿茶・白糖', '', 10],
  ['深秋', '创意特调', 35, '热饮｜橙皮・鲜奶・拼配浓缩咖啡・肉桂・红糖', '', 11],
  ['暖冬', '创意特调', 35, '热饮｜香草籽・红茶・鲜奶・黑巧克力・拼配浓缩咖啡', '', 12],
  ['慕斯蛋糕', '创意特调', 38, '冰｜低因｜哈马修日晒奶萃・芝士稀奶油・青柠皮', '', 13],
  ['热恋阳光', '创意特调', 38, '冰｜低因｜菠萝・芒果・百香果・香茅・哈马修水洗冲煮咖啡', '', 14],
  ['白日梦', '创意特调', 38, '冰｜低因｜日本柚子・油柑・茉莉绿茶・白糖・哈马修水洗冲煮咖啡', '', 15]
];
try {
  for (const item of seedProducts) {
    insertProduct.run(...item);
  }
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}
console.log(`✓ Data reset complete (${seedProducts.length} products reseeded)`);

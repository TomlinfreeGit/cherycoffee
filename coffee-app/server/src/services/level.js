// filepath: coffee-app/server/src/services/level.js
// Customer level + discount service.
//
// Rules (configurable via /api/merchant/settings):
//   - level_orders_required (default 10):
//       How many *completed* orders a user needs to level up by 1.
//   - level_discount_increment (default 0.01):
//       Discount per level. Level 1 = 1.00 (no discount), level 2 = 0.99, ...
//   - min_discount (default 0.80):
//       Floor. Once the formula goes below this, we clamp.
//
// Examples (with defaults):
//   level 1  → 1.00 - 0 * 0.01 = 1.00
//   level 2  → 1.00 - 1 * 0.01 = 0.99
//   level 21 → 1.00 - 20 * 0.01 = 0.80 (floor)
//   level 22+ → 0.80 (capped)

const { db } = require('../db');

const DEFAULTS = Object.freeze({
  level_orders_required: 10,
  level_discount_increment: 0.01,
  min_discount: 0.80,
  // 商家后台订单列表自动刷新间隔 (毫秒)。范围 5s~10min。
  // 商家可在"系统设置"里调整这个值,不需要重启服务。
  order_auto_refresh_ms: 10000
});

/**
 * Read a setting by key, with default fallback.
 */
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return DEFAULTS[key];
  const num = Number(row.value);
  return Number.isFinite(num) ? num : DEFAULTS[key];
}

/**
 * Get all level/discount settings as an object.
 * 现在也包含前端可调的非会员类设置 (如自动刷新间隔),
 * 这样 /api/merchant/settings 一次性把全部可配置项推给前端。
 */
function getLevelSettings() {
  return {
    level_orders_required: getSetting('level_orders_required'),
    level_discount_increment: getSetting('level_discount_increment'),
    min_discount: getSetting('min_discount'),
    order_auto_refresh_ms: getSetting('order_auto_refresh_ms')
  };
}

/**
 * Compute the level from completed order count.
 * Level 1 if completedOrders <= 0; otherwise floor(completedOrders / ordersPerLevel) + 1.
 */
function computeLevel(completedOrders, ordersPerLevel = DEFAULTS.level_orders_required) {
  if (!Number.isFinite(completedOrders) || completedOrders <= 0) return 1;
  return Math.floor(completedOrders / ordersPerLevel) + 1;
}

/**
 * Compute the discount multiplier for a level.
 * Always returns a number in [min_discount, 1.0].
 */
function computeDiscount(level, settings = getLevelSettings()) {
  const lvl = Math.max(1, Number(level) || 1);
  const inc = settings.level_discount_increment;
  const floor = settings.min_discount;
  // Level 1 = 1.00, Level 2 = 1.00 - 1*inc, ...
  const raw = 1.0 - (lvl - 1) * inc;
  // Round to 4 decimal places to avoid floating-point ugliness.
  const clamped = Math.max(floor, Math.min(1.0, raw));
  return Math.round(clamped * 10000) / 10000;
}

/**
 * Apply the level discount to a price.
 * Returns the *raw* (uncapped) discounted price for caller use, plus
 * the effective price after clamping to min_discount.
 *
 * @param {number} originalPrice
 * @param {number} level
 * @returns {{ original: number, discount: number, effective: number, saved: number }}
 */
function applyDiscount(originalPrice, level) {
  const settings = getLevelSettings();
  const raw = originalPrice * computeDiscount(level, settings);
  const effective = Math.max(originalPrice * settings.min_discount, raw);
  // Always round to 2 decimal places for display
  const round2 = (n) => Math.round(n * 100) / 100;
  return {
    original: round2(originalPrice),
    discount: round2(1 - effective / originalPrice), // 0.00–0.20
    effective: round2(effective),
    saved: round2(originalPrice - effective),
    settings
  };
}

/**
 * Compute and update the user's level based on their completed order count.
 * Call after incrementing completed_orders.
 * Returns the new (potentially-updated) user row.
 */
function refreshUserLevel(openid) {
  const user = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
  if (!user) return null;
  const settings = getLevelSettings();
  const newLevel = computeLevel(user.completed_orders, settings.level_orders_required);
  if (newLevel !== user.level) {
    db.prepare('UPDATE users SET level = ?, updated_at = datetime(\'now\', \'localtime\') WHERE openid = ?')
      .run(newLevel, openid);
  }
  return db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
}

/**
 * Increment user's completed_orders counter and update level if needed.
 * Called when an order transitions to 'completed'.
 */
function incrementCompletedOrders(openid) {
  // Ensure user exists
  const user = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
  if (!user) {
    db.prepare('INSERT INTO users (openid) VALUES (?)').run(openid);
  }
  db.prepare(`
    UPDATE users
    SET completed_orders = completed_orders + 1,
        updated_at = datetime('now', 'localtime')
    WHERE openid = ?
  `).run(openid);
  return refreshUserLevel(openid);
}

module.exports = {
  DEFAULTS,
  getSetting,
  getLevelSettings,
  computeLevel,
  computeDiscount,
  applyDiscount,
  refreshUserLevel,
  incrementCompletedOrders
};
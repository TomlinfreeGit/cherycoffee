// filepath: coffee-app/server/src/routes/settings.js
// System settings (level + discount config).
//
// IMPORTANT — 这个文件在 index.js 里被挂载在 /api,同时还挂着其他路由
// (例如 /api/banners、/api/categories 等)。早期代码里用 `router.use(merchantAuth)`
// 不带路径,会导致所有走到该路由器的请求都被拦截 (例如其他挂载点
// fallthrough 进来的请求也会被拒)。所以这里拆成两个独立的 Express Router:
//   - publicRouter    → 挂载在 /api  下,仅含 GET /settings (公开)
//   - merchantRouter  → 挂载在 /api/merchant/settings 下,含 GET / PATCH /
//     两个 router 互不干扰,merchantAuth 不会污染其他挂载点的请求。
//
// Endpoints:
//   GET    /api/settings                - public
//   GET    /api/merchant/settings       - merchant (full settings)
//   PATCH  /api/merchant/settings       - merchant (update)

const express = require('express');
const { db } = require('../db');
const { merchantAuth } = require('../middleware/merchantAuth');
const { getLevelSettings, DEFAULTS } = require('../services/level');

// Whitelist of editable settings (anything else is rejected)
const EDITABLE_KEYS = new Set([
  'level_orders_required',
  'level_discount_increment',
  'min_discount',
  // 商家后台订单列表自动刷新间隔 (毫秒)
  'order_auto_refresh_ms',
  // auto-cancel-unpaid-orders: 未支付订单自动取消阈值 (秒)
  'order_auto_cancel_seconds',
  // auto-cancel-unpaid-orders: 自动取消定时器扫描间隔 (秒)
  'auto_cancel_scan_interval_seconds'
]);

// Numeric ranges (bounds to prevent silly values)
const RANGES = {
  level_orders_required: { min: 1, max: 10000, integer: true },
  level_discount_increment: { min: 0.001, max: 0.5 },
  min_discount: { min: 0.1, max: 1.0 },
  // 5 秒 ~ 10 分钟 (防止瞬秒高频或后端僵死的极端值)
  order_auto_refresh_ms: { min: 5000, max: 600000, integer: true },
  // auto-cancel-unpaid-orders:
  //   阈值下限 30s (避免误伤),上限 24h (避免订单永远挂着)
  //   间隔固定 [10, 3600] 与服务层 getAutoCancelScanIntervalSeconds 一致
  order_auto_cancel_seconds: { min: 30, max: 86400, integer: true },
  auto_cancel_scan_interval_seconds: { min: 10, max: 3600, integer: true }
};

// ─── Public router (mounted at /api) ────────────────────────
// 仅含 GET /settings (无任何中间件)。Express 不会把这个 router 的请求
// fall-through 到其他挂载点,除非在这个 router 里都没有匹配的 handler。
const publicRouter = express.Router();

// GET /api/settings - public read of customer-relevant settings.
publicRouter.get('/settings', (_req, res) => {
  res.json({ data: getLevelSettings() });
});

// GET /api/merchant/settings - full settings (merchant only).
// 已存在,不再重复定义。

// ─── Merchant router (mounted at /api/merchant/settings) ──
const merchantRouter = express.Router();

// All merchant routes require auth
merchantRouter.use(merchantAuth);

// GET /api/merchant/settings - full settings
merchantRouter.get('/', (_req, res) => {
  try {
    const rows = db.prepare('SELECT key, value, updated_at FROM settings').all();
    // Merge with defaults so clients always have a complete config
    const merged = { ...DEFAULTS };
    for (const r of rows) merged[r.key] = r.value;
    res.json({ data: merged });
  } catch (e) {
    console.error('GET /api/merchant/settings error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/merchant/settings - update one or more settings
// body: { level_orders_required?, level_discount_increment?, min_discount? }
merchantRouter.patch('/', (req, res) => {
  try {
    const updates = req.body || {};
    const keys = Object.keys(updates);
    if (keys.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const upsert = db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, datetime('now', 'localtime'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now', 'localtime')
    `);

    db.exec('BEGIN');
    try {
      for (const key of keys) {
        if (!EDITABLE_KEYS.has(key)) {
          db.exec('ROLLBACK');
          return res.status(400).json({ error: `Key '${key}' is not editable` });
        }
        let val = updates[key];
        const range = RANGES[key];
        const num = Number(val);
        if (!Number.isFinite(num)) {
          db.exec('ROLLBACK');
          return res.status(400).json({ error: `${key} must be a number` });
        }
        if (range) {
          if (num < range.min || num > range.max) {
            db.exec('ROLLBACK');
            return res.status(400).json({
              error: `${key} must be between ${range.min} and ${range.max}`
            });
          }
          if (range.integer && !Number.isInteger(num)) {
            db.exec('ROLLBACK');
            return res.status(400).json({ error: `${key} must be an integer` });
          }
        }
        upsert.run(key, String(num));
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    res.json({ data: getLevelSettings() });
  } catch (e) {
    console.error('PATCH /api/merchant/settings error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = publicRouter;
module.exports.merchantRouter = merchantRouter;
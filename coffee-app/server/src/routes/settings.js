// filepath: coffee-app/server/src/routes/settings.js
// System settings (level + discount config).
//   GET  /api/settings                - public (returns a sanitized subset for clients)
//   GET  /api/merchant/settings       - full settings (merchant)
//   PATCH /api/merchant/settings      - merchant updates one or more settings

const express = require('express');
const { db } = require('../db');
const { merchantAuth } = require('../middleware/merchantAuth');
const { getLevelSettings, DEFAULTS } = require('../services/level');

const router = express.Router();

// Whitelist of editable settings (anything else is rejected)
const EDITABLE_KEYS = new Set([
  'level_orders_required',
  'level_discount_increment',
  'min_discount',
  // 商家后台订单列表自动刷新间隔 (毫秒)
  'order_auto_refresh_ms'
]);

// Numeric ranges (bounds to prevent silly values)
const RANGES = {
  level_orders_required: { min: 1, max: 10000, integer: true },
  level_discount_increment: { min: 0.001, max: 0.5 },
  min_discount: { min: 0.1, max: 1.0 },
  // 5 秒 ~ 10 分钟 (防止瞬秒高频或后端僵死的极端值)
  order_auto_refresh_ms: { min: 5000, max: 600000, integer: true }
};

// GET /api/settings - public read of customer-relevant settings.
// Mounted at /api in index.js, so this resolves to /api/settings.
// IMPORTANT: must be declared BEFORE the merchantAuth middleware below
// (otherwise the auth gate would also protect the public endpoint).
router.get('/settings', (_req, res) => {
  res.json({ data: getLevelSettings() });
});

// All routes below require merchant auth
router.use(merchantAuth);

// GET /api/merchant/settings - full settings
router.get('/merchant/settings', (_req, res) => {
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
router.patch('/merchant/settings', (req, res) => {
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

module.exports = router;
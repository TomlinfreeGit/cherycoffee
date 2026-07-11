// filepath: coffee-app/server/src/routes/merchant.js
// Merchant-only endpoints (sees all orders, can update any status)
const express = require('express');
const { db } = require('../db');
const { merchantAuth } = require('../middleware/merchantAuth');
const { incrementCompletedOrders } = require('../services/level');

const router = express.Router();

const VALID_STATUSES = ['pending', 'paid', 'preparing', 'ready', 'completed', 'cancelled', 'failed'];

const VALID_TRANSITIONS = {
  pending: ['paid', 'cancelled', 'failed'],
  paid: ['preparing', 'cancelled', 'refunded'],
  preparing: ['ready', 'cancelled'],
  ready: ['completed'],
  completed: [],
  cancelled: [],
  failed: ['paid', 'cancelled']
};

/**
 * Mask a phone number for display: 138****8888
 * In a real production system, the full phone would only be revealed
 * via a separate "reveal" action with audit logging.
 */
function maskPhone(phone) {
  if (!phone) return null;
  if (phone.length < 7) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

/**
 * Attach a masked phone to each order for safe merchant display.
 */
function maskOrders(orders) {
  return orders.map((o) => ({ ...o, customer_phone_masked: maskPhone(o.customer_phone) }));
}

// All merchant routes require auth
router.use(merchantAuth);

// GET /api/merchant/orders - list ALL orders
router.get('/orders', (req, res) => {
  try {
    const { status, limit, search } = req.query;
    let sql = 'SELECT * FROM orders WHERE 1=1';
    const params = [];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    if (search) {
      // Search by phone (exact) or name (LIKE)
      const trimmed = String(search).trim();
      if (/^\d+$/.test(trimmed)) {
        sql += ' AND customer_phone LIKE ?';
        params.push(`%${trimmed}%`);
      } else {
        sql += ' AND customer_name LIKE ?';
        params.push(`%${trimmed}%`);
      }
    }

    sql += ' ORDER BY created_at DESC';

    if (limit) {
      sql += ' LIMIT ?';
      params.push(parseInt(limit, 10));
    }

    const rows = db.prepare(sql).all(...params);
    res.json({ data: maskOrders(rows) });
  } catch (err) {
    console.error('GET /api/merchant/orders error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/merchant/orders/:id - any order (full phone visible to merchant)
router.get('/orders/:id', (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    res.json({
      data: { ...order, customer_phone_masked: maskPhone(order.customer_phone), items }
    });
  } catch (err) {
    console.error('GET /api/merchant/orders/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/merchant/orders/:id/full-phone - reveal full phone (with audit log)
router.get('/orders/:id/full-phone', (req, res) => {
  try {
    const order = db.prepare('SELECT id, customer_phone, customer_name FROM orders WHERE id = ?').get(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // In production: write to an audit_log table here
    console.log(`[AUDIT] Merchant ${req.merchantId || 'unknown'} revealed phone for order ${order.id} at ${new Date().toISOString()}`);

    res.json({ data: { customer_phone: order.customer_phone } });
  } catch (err) {
    console.error('GET /api/merchant/orders/:id/full-phone error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/merchant/orders/:id/status - update any order's status
router.patch('/orders/:id/status', (req, res) => {
  try {
    const { status, transaction_id } = req.body;
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const allowed = VALID_TRANSITIONS[order.status] || [];
    if (order.status !== status && !allowed.includes(status)) {
      return res.status(400).json({
        error: `Invalid status transition from ${order.status} to ${status}`
      });
    }

    const updates = ['status = ?', `updated_at = datetime('now', 'localtime')`];
    const params = [status];

    if (transaction_id !== undefined) {
      updates.push('transaction_id = ?');
      params.push(transaction_id);
    }

    params.push(req.params.id);
    db.prepare(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // If transitioning to 'completed' (the only terminal "done" state), increment
    // the user's completed_orders counter and refresh their level.
    let levelInfo = null;
    if (status === 'completed' && order.openid) {
      const updatedUser = incrementCompletedOrders(order.openid);
      if (updatedUser) {
        levelInfo = {
          level: updatedUser.level,
          completed_orders: updatedUser.completed_orders
        };
        console.log(`[LEVEL] openid=${order.openid.slice(0, 16)}... → level ${levelInfo.level} (${levelInfo.completed_orders} orders)`);
      }
    }

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    res.json({
      data: {
        ...updated,
        customer_phone_masked: maskPhone(updated.customer_phone),
        items,
        user_level: levelInfo
      }
    });
  } catch (err) {
    console.error('PATCH /api/merchant/orders/:id/status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── 用户管理 ────────────────────────────────────────────

/**
 * Mask a phone for the user list page (the merchant sees the same mask
 * we use elsewhere - revealing requires a separate /full-phone action).
 */
function maskUserPhone(phone) {
  if (!phone) return null;
  if (phone.length < 7) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

// GET /api/merchant/users - list all customer users
// Query: search (nickname/phone), has_phone (true|false), limit, offset
router.get('/users', (req, res) => {
  try {
    const { search, has_phone, limit, offset } = req.query;

    let sql = 'SELECT * FROM users WHERE 1=1';
    const params = [];
    const countParams = [];

    if (search) {
      const trimmed = String(search).trim();
      if (trimmed.length === 0) {
        // skip
      } else if (/^\d+$/.test(trimmed)) {
        // Phone search (digits → LIKE)
        sql += ' AND phone LIKE ?';
        params.push(`%${trimmed}%`);
      } else {
        // Nickname search
        sql += ' AND nickname LIKE ?';
        params.push(`%${trimmed}%`);
      }
    }

    if (has_phone === 'true') {
      sql += ' AND phone IS NOT NULL';
    } else if (has_phone === 'false') {
      sql += ' AND phone IS NULL';
    }

    // Total count (for pagination)
    const countSql = sql.replace(/^SELECT \*/, 'SELECT COUNT(*) AS cnt');
    const totalRow = db.prepare(countSql).get(...params);
    const total = totalRow ? totalRow.cnt : 0;

    sql += ' ORDER BY updated_at DESC, created_at DESC';

    const lim = limit ? Math.min(parseInt(limit, 10) || 50, 200) : 50;
    const off = offset ? Math.max(parseInt(offset, 10) || 0, 0) : 0;
    sql += ' LIMIT ? OFFSET ?';
    params.push(lim, off);

    const rows = db.prepare(sql).all(...params);

    // Also get order stats per user (single query, joined in JS).
    // We track two counts:
    //   - order_count:    total orders (any status)
    //   - completed_orders_count: only orders with status='completed'
    // The latter is what drives the user's level.
    const openids = rows.map((r) => r.openid);
    let orderStatsByOpenid = {};
    if (openids.length > 0) {
      const placeholders = openids.map(() => '?').join(',');
      const orderStats = db.prepare(`
        SELECT openid,
               COUNT(*) AS cnt,
               SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_cnt,
               MAX(created_at) AS last_order_at
        FROM orders
        WHERE openid IN (${placeholders})
        GROUP BY openid
      `).all(...openids);
      for (const s of orderStats) {
        orderStatsByOpenid[s.openid] = {
          count: s.cnt,
          completed_count: s.completed_cnt || 0,
          last_order_at: s.last_order_at
        };
      }
    }

    const { computeDiscount } = require('../services/level');
    const data = rows.map((u) => ({
      openid: u.openid,
      nickname: u.nickname || null,
      avatar_url: u.avatar_url || null,
      phone: maskUserPhone(u.phone),
      has_phone: !!u.phone,
      phone_verified: !!u.phone_verified,
      level: u.level || 1,
      completed_orders: (orderStatsByOpenid[u.openid] || {}).completed_count || 0,
      discount: computeDiscount(u.level || 1), // 0.00–0.20
      order_count: (orderStatsByOpenid[u.openid] || {}).count || 0,
      last_order_at: (orderStatsByOpenid[u.openid] || {}).last_order_at || null,
      created_at: u.created_at,
      updated_at: u.updated_at
    }));

    res.json({ data, total, limit: lim, offset: off });
  } catch (err) {
    console.error('GET /api/merchant/users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/merchant/users/:openid - get a single user
router.get('/users/:openid', (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE openid = ?').get(req.params.openid);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Order stats (split by status so we can show both)
    const stats = db.prepare(`
      SELECT
        COUNT(*) AS cnt,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_cnt,
        MAX(created_at) AS last_order_at,
        SUM(total_amount) AS total_spent
      FROM orders WHERE openid = ?
    `).get(req.params.openid);

    const { computeDiscount } = require('../services/level');
    res.json({
      data: {
        openid: user.openid,
        nickname: user.nickname || null,
        avatar_url: user.avatar_url || null,
        phone: maskUserPhone(user.phone),
        has_phone: !!user.phone,
        phone_verified: !!user.phone_verified,
        level: user.level || 1,
        completed_orders: stats ? (stats.completed_cnt || 0) : 0,
        discount: computeDiscount(user.level || 1),
        order_count: stats ? stats.cnt : 0,
        last_order_at: stats ? stats.last_order_at : null,
        total_spent: stats ? stats.total_spent : 0,
        created_at: user.created_at,
        updated_at: user.updated_at
      }
    });
  } catch (err) {
    console.error('GET /api/merchant/users/:openid error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/merchant/users/:openid - delete a user
// Side effects:
//   1. Delete the user record from `users`
//   2. Delete all sessions for this openid (force logout on devices)
//   3. Anonymize historical orders: keep the row but set customer_name/phone to NULL
//      so the merchant can't see the deleted user's data afterwards.
// All operations run in a single transaction for atomicity.
router.delete('/users/:openid', (req, res) => {
  const openid = req.params.openid;
  try {
    const user = db.prepare('SELECT openid, nickname, phone FROM users WHERE openid = ?').get(openid);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    db.exec('BEGIN');
    try {
      // 1. Anonymize historical orders (also reset openid so the user's
      //    completion count is "forgotten" - their profile row will be
      //    deleted in step 3 below anyway).
      const orderUpdate = db.prepare(`
        UPDATE orders
        SET customer_name = NULL, customer_phone = NULL, openid = NULL,
            updated_at = datetime('now', 'localtime')
        WHERE openid = ?
      `).run(openid);

      // 2. Delete all sessions for this user (force logout)
      const sessionDelete = db.prepare('DELETE FROM sessions WHERE openid = ?').run(openid);

      // 3. Delete the user record
      const userDelete = db.prepare('DELETE FROM users WHERE openid = ?').run(openid);

      db.exec('COMMIT');

      console.log(
        `[AUDIT] Merchant ${req.merchantId || 'unknown'} deleted user ${openid} ` +
        `(orders anonymized: ${orderUpdate.changes}, sessions: ${sessionDelete.changes}) ` +
        `at ${new Date().toISOString()}`
      );

      res.json({
        data: {
          openid,
          deleted_user: true,
          anonymized_orders: orderUpdate.changes,
          deleted_sessions: sessionDelete.changes
        }
      });
    } catch (innerErr) {
      db.exec('ROLLBACK');
      throw innerErr;
    }
  } catch (err) {
    console.error('DELETE /api/merchant/users/:openid error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

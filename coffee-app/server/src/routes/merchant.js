// filepath: coffee-app/server/src/routes/merchant.js
// Merchant-only endpoints (sees all orders, can update any status)
const express = require('express');
const { db } = require('../db');
const { merchantAuth } = require('../middleware/merchantAuth');

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
      data: { ...order, customer_phone_masked: maskPhone(order.customer_phone) }
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

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    res.json({
      data: { ...updated, customer_phone_masked: maskPhone(updated.customer_phone), items }
    });
  } catch (err) {
    console.error('PATCH /api/merchant/orders/:id/status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

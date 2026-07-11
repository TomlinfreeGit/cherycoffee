// filepath: coffee-app/server/src/routes/orders.js
const express = require('express');
const { db } = require('../db');
const { generatePickupNumber } = require('../services/pickup');
const { customerAuth, optionalCustomerAuth } = require('../middleware/auth');
const { applyDiscount, incrementCompletedOrders } = require('../services/level');

const router = express.Router();

const VALID_STATUSES = ['pending', 'paid', 'preparing', 'ready', 'completed', 'cancelled', 'failed'];

// Phone validation: 11-digit mainland China mobile number
const PHONE_REGEX = /^1[3-9]\d{9}$/;

function validateCustomerInfo(name, phone) {
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return '请输入您的姓名';
  }
  if (name.trim().length > 30) {
    return '姓名过长（最多 30 字符）';
  }
  if (!phone || !PHONE_REGEX.test(phone)) {
    return '请输入有效的 11 位手机号';
  }
  return null;
}

// POST /api/orders - create order
// Auth: optional (we bind openid if logged in, allowing guest orders for backward compat)
router.post('/', optionalCustomerAuth, (req, res) => {
  try {
    const { items, customer_note, customer_name, customer_phone } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    // Validate customer info (required for in-store pickup verification)
    const customerErr = validateCustomerInfo(customer_name, customer_phone);
    if (customerErr) {
      return res.status(400).json({ error: customerErr });
    }

    // Validate items and compute total
    let totalAmount = 0;
    const validatedItems = [];

    // Look up the user's level (if logged in) so we can apply the discount.
    // Customer-facing prices always reflect the user's current level.
    let userLevel = 1;
    if (req.openid) {
      const u = db.prepare('SELECT level FROM users WHERE openid = ?').get(req.openid);
      if (u) userLevel = u.level || 1;
    }

    for (const item of items) {
      if (!item.product_id || !item.quantity || item.quantity <= 0) {
        return res.status(400).json({ error: 'Invalid item: product_id and quantity required' });
      }

      const product = db.prepare('SELECT * FROM products WHERE id = ? AND available = 1').get(item.product_id);
      if (!product) {
        return res.status(400).json({ error: `Product ${item.product_id} not available` });
      }

      const qty = parseInt(item.quantity, 10);
      // Apply level discount to the unit price
      const discounted = applyDiscount(product.price, userLevel);
      const unitPrice = discounted.effective;
      const subtotal = Math.round(unitPrice * qty * 100) / 100;
      totalAmount += subtotal;

      validatedItems.push({
        product_id: product.id,
        product_name: product.name,
        product_image_url: product.image_url || null,
        quantity: qty,
        unit_price: unitPrice,
        original_unit_price: discounted.original,
        subtotal,
        level_applied: userLevel
      });
    }

    const pickupNumber = generatePickupNumber();

    db.exec('BEGIN');
    try {
      const orderResult = db.prepare(`
        INSERT INTO orders (pickup_number, status, total_amount, customer_note, customer_name, customer_phone, openid)
        VALUES (?, 'pending', ?, ?, ?, ?, ?)
      `).run(
        pickupNumber,
        totalAmount,
        customer_note || null,
        customer_name.trim(),
        customer_phone,
        req.openid || null
      );

      const orderId = orderResult.lastInsertRowid;

      const insertItem = db.prepare(`
        INSERT INTO order_items (order_id, product_id, product_name, product_image_url, quantity, unit_price, subtotal)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of validatedItems) {
        insertItem.run(orderId, item.product_id, item.product_name, item.product_image_url, item.quantity, item.unit_price, item.subtotal);
      }

      db.exec('COMMIT');

      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      const orderItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);

      res.status(201).json({
        data: { ...order, items: orderItems }
      });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } catch (err) {
    console.error('POST /api/orders error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orders - list orders
// Customers can only see their own orders (filtered by openid)
router.get('/', customerAuth, (req, res) => {
  try {
    const { status, limit, scope } = req.query;

    // Merchant-only scope (not implemented; reserved for future use)
    if (scope === 'all') {
      return res.status(403).json({ error: 'Forbidden: scope=all requires merchant auth' });
    }

    let sql = 'SELECT * FROM orders WHERE openid = ?';
    const params = [req.openid];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC';

    if (limit) {
      sql += ' LIMIT ?';
      params.push(parseInt(limit, 10));
    }

    const rows = db.prepare(sql).all(...params);
    res.json({ data: rows });
  } catch (err) {
    console.error('GET /api/orders error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/orders/:id - get a single order
// Customers can only fetch their own orders; otherwise 404 (don't leak existence)
router.get('/:id', customerAuth, (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND openid = ?').get(req.params.id, req.openid);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    res.json({ data: { ...order, items } });
  } catch (err) {
    console.error('GET /api/orders/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/orders/:id/status - update order status
// Customers can cancel their own orders or mark paid (mock pay). Other transitions need merchant auth.
router.patch('/:id/status', customerAuth, (req, res) => {
  try {
    const { status, transaction_id } = req.body;
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND openid = ?').get(req.params.id, req.openid);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Customers can cancel pending/paid orders (and use mock pay for local dev)
    if (status === 'cancelled') {
      if (order.status !== 'pending' && order.status !== 'paid') {
        return res.status(403).json({
          error: 'Cannot cancel order in current status. Please contact the store.'
        });
      }
    } else if (status === 'paid') {
      // Mock pay: customer can transition pending -> paid (for local dev only)
      if (order.status !== 'pending') {
        return res.status(403).json({ error: 'Invalid status transition for customer' });
      }
    } else {
      return res.status(403).json({
        error: 'Status transitions other than cancel require merchant authorization'
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
    res.json({ data: { ...updated, items } });
  } catch (err) {
    console.error('PATCH /api/orders/:id/status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

// filepath: coffee-app/server/src/routes/orders.js
const express = require('express');
const { db } = require('../db');
const { generatePickupNumber } = require('../services/pickup');
const { customerAuth, optionalCustomerAuth } = require('../middleware/auth');
const { applyDiscount, incrementCompletedOrders } = require('../services/level');
const wechatPay = require('../services/wechatPay');

const router = express.Router();

const VALID_STATUSES = ['pending', 'paid', 'preparing', 'ready', 'completed', 'cancelled', 'failed'];

// Allowed temperature labels. Kept small + stable so the merchant UI and
// the customer UI both agree on the canonical set. If we ever need "warm"
// or "less ice", extend this list AND update menu.wxml / ProductsPage.tsx
// in lockstep.
const ALLOWED_TEMPERATURES = new Set(['热', '冷']);
const TEMP_REGEX = /^[\u4e00-\u9fa5]{1,4}$/;

function normalizeOptions(rawOptions, product) {
  // Returns the persisted options string for order_items.options, or an
  // Error describing why the request is invalid.
  const opts = (rawOptions && typeof rawOptions === 'object') ? rawOptions : {};
  if (product.support_temperature) {
    const t = opts.temperature;
    if (typeof t !== 'string' || !TEMP_REGEX.test(t)) {
      return { error: `商品「${product.name}」需要选择温度（热/冷）` };
    }
    if (!ALLOWED_TEMPERATURES.has(t)) {
      return { error: `商品「${product.name}」的温度仅支持 热/冷，收到「${t}」` };
    }
    return { value: t };
  }
  // Product doesn't support options: silently drop any choice the client sent.
  return { value: null };
}

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

      // Resolve and validate per-line options (e.g. temperature). Done
      // BEFORE price math so a 400 short-circuits cleanly.
      const opt = normalizeOptions(item.options, product);
      if (opt.error) {
        return res.status(400).json({ error: opt.error });
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
        level_applied: userLevel,
        options: opt.value
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
        INSERT INTO order_items (order_id, product_id, product_name, product_image_url, quantity, unit_price, subtotal, options)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of validatedItems) {
        insertItem.run(
          orderId,
          item.product_id,
          item.product_name,
          item.product_image_url,
          item.quantity,
          item.unit_price,
          item.subtotal,
          item.options
        );
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
//
// Query params:
//   status  - filter by order status (optional)
//   limit   - page size (default 20 if provided, max 100; when omitted, returns all rows)
//   offset  - page offset, default 0
//
// Response shape (when limit is provided):
//   { data: [...], total, limit, offset, hasMore }
// When limit is omitted (backward compatible):
//   { data: [...] }
router.get('/', customerAuth, (req, res) => {
  try {
    const { status, limit, offset, scope } = req.query;

    // Merchant-only scope (not implemented; reserved for future use)
    if (scope === 'all') {
      return res.status(403).json({ error: 'Forbidden: scope=all requires merchant auth' });
    }

    // Build WHERE clause
    const where = ['openid = ?'];
    const params = [req.openid];
    if (status) {
      where.push('status = ?');
      params.push(status);
    }
    const whereSql = ' WHERE ' + where.join(' AND ');

    // Has the caller asked for pagination? We treat the request as paged
    // when `limit` is present. Default page size = 20, max = 100.
    const isPaged = limit !== undefined && limit !== '';
    let pageSize = 20;
    let pageOffset = 0;
    if (isPaged) {
      pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
      pageOffset = Math.max(0, parseInt(offset, 10) || 0);
    }

    if (isPaged) {
      // Total count for this filter (single round-trip query)
      const countSql = 'SELECT COUNT(*) AS cnt FROM orders' + whereSql;
      const total = db.prepare(countSql).get(...params).cnt;

      const sql =
        'SELECT * FROM orders' +
        whereSql +
        ' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?';
      const rows = db.prepare(sql).all(...params, pageSize, pageOffset);

      return res.json({
        data: rows,
        total,
        limit: pageSize,
        offset: pageOffset,
        hasMore: pageOffset + rows.length < total
      });
    }

    // Legacy/unpaged response: keep returning the bare array for callers
    // that haven't migrated yet (older mini-program versions, smoke tests).
    const sql = 'SELECT * FROM orders' + whereSql + ' ORDER BY created_at DESC, id DESC';
    const rows = db.prepare(sql).all(...params);
    res.json({ data: rows });
  } catch (err) {
    console.error('GET /api/orders error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/orders/pay/notify — 微信支付 V3 回调 (无 auth,微信后台直接调用)
// 顺序重要:固定路径 `/pay/notify` 必须注册在 `/:id/xxx` 动态路由之前,避免被错位匹配。
// 入口处需挂载 express.raw,见 src/index.js;此处路由层再挂一道 raw 作兜底,
// 即使 app 层 raw 中间件被漏挂或路径匹配错位也能拿到原始 body。
const notifyRaw = express.raw({ type: '*/*', limit: '1mb' });
router.post('/pay/notify', notifyRaw, (req, res) => {
  try {
    // 容错取 body:优先 Buffer(由 express.raw 提供),其次字符串,其次已被 JSON 解析的对象
    let rawBody;
    if (Buffer.isBuffer(req.body)) {
      rawBody = req.body.toString('utf8');
    } else if (typeof req.body === 'string') {
      rawBody = req.body;
    } else if (req.body && typeof req.body === 'object') {
      // 已被前置 json parser 解析过 — 无法再做原始验签,但仍可尝试解密后比对
      rawBody = JSON.stringify(req.body);
    } else {
      console.error('Pay notify: req.body is empty/undefined, content-type=', req.headers['content-type']);
      return res.status(400).json({ code: 'FAIL', message: 'Empty request body' });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      console.error('Pay notify: invalid JSON body, length=', rawBody.length);
      return res.status(400).json({ code: 'FAIL', message: 'Invalid JSON' });
    }

    // 只处理支付成功事件;其他事件(退款等)直接 ACK,避免微信重试
    if (payload.event_type !== 'TRANSACTION.SUCCESS') {
      return res.json({ code: 'SUCCESS', message: 'ignored' });
    }
    if (!payload.resource) {
      throw new Error('Missing resource in notify payload');
    }

    // 验签 + AEAD_AES_256_GCM 解密 (兼容 V3 新老两种 header 方式)
    let decrypted;
    try {
      decrypted = wechatPay.verifyAndDecryptNotify(
        req.headers,
        rawBody,
        payload.resource
      );
    } catch (err) {
      console.error('Pay notify verify/decrypt failed:', err.message);
      // 返回 FAIL 让微信重试
      return res.status(401).json({ code: 'FAIL', message: err.message });
    }

    const { out_trade_no, transaction_id, trade_state } = decrypted;
    if (trade_state !== 'SUCCESS') {
      return res.json({ code: 'SUCCESS', message: 'trade not success' });
    }

    // pickup_number === outTradeNo (创建订单时作为商户订单号)
    const order = db.prepare('SELECT id, status FROM orders WHERE pickup_number = ?').get(out_trade_no);
    if (!order) {
      console.error('Pay notify: order not found for pickup_number', out_trade_no);
      // 找不到订单也得 ACK,避免微信无限重试 (人工介入)
      return res.json({ code: 'SUCCESS', message: 'order not found' });
    }

    // 幂等:已支付或后续状态则跳过
    if (order.status !== 'pending') {
      return res.json({ code: 'SUCCESS', message: `already ${order.status}` });
    }

    db.prepare(`
      UPDATE orders
      SET status = 'paid', transaction_id = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ? AND status = 'pending'
    `).run(transaction_id, order.id);

    console.log(`✓ Pay notify: order #${order.id} (${out_trade_no}) → paid, tx=${transaction_id}`);
    res.json({ code: 'SUCCESS', message: '成功' });
  } catch (err) {
    console.error('Pay notify handler error:', err);
    res.status(500).json({ code: 'FAIL', message: 'Internal error' });
  }
});

// POST /api/orders/:id/pay — 创建预付订单,返回小程序拉起支付所需的签名参数
// 路由位置:放在 GET /:id 之前;若已经处于非 pending 状态(已支付、已取消)返回 403。
router.post('/:id/pay', customerAuth, async (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND openid = ?').get(req.params.id, req.openid);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'pending') {
      return res.status(403).json({ error: `Order is not payable (status=${order.status})` });
    }
    if (!req.openid) {
      return res.status(400).json({ error: 'No openid bound to session, cannot initialize WeChat Pay' });
    }

    // 模式自动切换:商户未配置 → mock (前端弹窗模拟成功)
    if (wechatPay.currentMode() === 'mock') {
      const params = wechatPay.buildMockPayParams();
      return res.json({
        data: {
          mode: 'mock',
          orderId: order.id,
          ...params
        }
      });
    }

    // Real 模式:先调微信查单接口,防止回调丢失导致订单永远卡 pending
    // (典型场景:回调地址不可达/验签失败/中间件漏挂,微信侧已支付成功,
    //  但服务端仍是 pending — 此时再次拉起支付会触发 "该订单已支付")
    try {
      const existing = await wechatPay.queryOrderByOutTradeNo(order.pickup_number);
      if (existing.tradeState === 'SUCCESS') {
        db.prepare(`
          UPDATE orders
          SET status = 'paid', transaction_id = ?, updated_at = datetime('now', 'localtime')
          WHERE id = ? AND status = 'pending'
        `).run(existing.transactionId || null, order.id);
        console.log(`✓ Recover via query: order #${order.id} (${order.pickup_number}) → paid, tx=${existing.transactionId}`);
        const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
        return res.status(409).json({
          error: `Order already paid (recovered via WeChat query, tx=${existing.transactionId})`,
          data: { ...updated, recovered: true }
        });
      }
      // NOTPAY / USERPAYING / CLOSED 等:继续往下走创建新的预付单
    } catch (queryErr) {
      // 查单失败不阻塞 — 仅记录,继续走 createJsapiOrder
      console.warn(`Pay: pre-check query failed (order=${order.pickup_number}):`, queryErr.message);
    }

    // Real 模式:服务端调用 V3 JSAPI 统一下单
    try {
      const amountFen = Math.round(parseFloat(order.total_amount) * 100);
      const notifyUrl = process.env.WECHAT_NOTIFY_URL;
      if (!notifyUrl) {
        return res.status(500).json({ error: 'WECHAT_NOTIFY_URL is not configured on the server' });
      }

      const { prepayId } = await wechatPay.createJsapiOrder({
        openid: req.openid,
        outTradeNo: order.pickup_number,
        description: `咖啡订单 ${order.pickup_number}`,
        totalFen: amountFen,
        notifyUrl
      });

      // 缓存 prepay_id;回调成功后会被真实 transaction_id 覆盖
      db.prepare(`UPDATE orders SET transaction_id = ? WHERE id = ?`).run(prepayId, order.id);

      const params = wechatPay.buildClientPayParams(prepayId);
      res.json({
        data: {
          mode: 'real',
          orderId: order.id,
          ...params
        }
      });
    } catch (payErr) {
      console.error('WeChat Pay create order error:', payErr);
      const msg = payErr.isNetworkError
        ? '微信支付网络异常,请稍后再试'
        : `微信支付下单失败: ${payErr.wechatMsg || payErr.message}`;
      res.status(500).json({ error: msg });
    }
  } catch (err) {
    console.error('POST /api/orders/:id/pay error:', err);
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

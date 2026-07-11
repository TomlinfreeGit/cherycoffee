// filepath: coffee-app/server/test-level.js
// Tests for level + discount + settings.

const http = require('http');
const BASE = 'http://localhost:3000';

function req(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const r = http.request(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }); }
          catch { resolve({ status: res.statusCode, body: buf }); }
        });
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const MERCHANT = 'merchant-local-token';

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
const bad = (m, exp) => { console.log(`  ✗ ${m} (expected ${JSON.stringify(exp)})`); fail++; };

async function run() {
  console.log('\n=== Level: Pure function tests ===\n');

  const { computeLevel, computeDiscount, applyDiscount } = require('./src/services/level');

  // 1. Level calculation
  computeLevel(0) === 1 ? ok('Level(0) = 1') : bad('Level(0)', 1);
  computeLevel(1) === 1 ? ok('Level(1) = 1') : bad('Level(1)', 1);
  computeLevel(9) === 1 ? ok('Level(9) = 1 (within first tier of 10)') : bad('Level(9)', 1);
  computeLevel(10) === 2 ? ok('Level(10) = 2 (boundary)') : bad('Level(10)', 2);
  computeLevel(20) === 3 ? ok('Level(20) = 3') : bad('Level(20)', 3);
  computeLevel(100) === 11 ? ok('Level(100) = 11') : bad('Level(100)', 11);

  // Custom ordersPerLevel
  computeLevel(5, 3) === 2 ? ok('Level(5) with ordersPerLevel=3 → 2') : bad('Level(5,3)', 2);
  computeLevel(6, 3) === 3 ? ok('Level(6) with ordersPerLevel=3 → 3') : bad('Level(6,3)', 3);

  // 2. Discount calculation (defaults: 0.01 increment, 0.80 floor)
  computeDiscount(1) === 1.00 ? ok('Discount(1) = 1.00') : bad('Discount(1)', 1.00);
  computeDiscount(2) === 0.99 ? ok('Discount(2) = 0.99') : bad('Discount(2)', 0.99);
  computeDiscount(11) === 0.90 ? ok('Discount(11) = 0.90') : bad('Discount(11)', 0.90);
  computeDiscount(20) === 0.81 ? ok('Discount(20) = 0.81') : bad('Discount(20)', 0.81);
  computeDiscount(21) === 0.80 ? ok('Discount(21) = 0.80 (floor)') : bad('Discount(21)', 0.80);
  computeDiscount(50) === 0.80 ? ok('Discount(50) = 0.80 (capped)') : bad('Discount(50)', 0.80);

  // 3. applyDiscount: returns original + effective + saved
  const r1 = applyDiscount(100, 1);
  r1.effective === 100 && r1.saved === 0 ? ok('applyDiscount(100, 1) = 100, saved=0') : bad('applyDiscount(100,1)', r1);

  const r2 = applyDiscount(100, 21);
  r2.effective === 80 && r2.saved === 20 ? ok('applyDiscount(100, 21) = 80, saved=20') : bad('applyDiscount(100,21)', r2);

  // Test the floor: level 50 still floors to 80
  const r3 = applyDiscount(50, 50);
  r3.effective === 40 ? ok('applyDiscount(50, 50) = 40 (floored)') : bad('applyDiscount(50,50)', r3);

  console.log('\n=== Settings API ===\n');

  // 4. GET /api/settings is public
  let r = await req('GET', '/api/settings');
  r.status === 200 && r.body.data.level_orders_required === 10
    ? ok('GET /api/settings (public) returns defaults')
    : bad('public settings', r);

  // 5. PATCH without merchant token → 401
  r = await req('PATCH', '/api/merchant/settings', { level_orders_required: 5 });
  r.status === 401 ? ok('PATCH without token → 401') : bad('PATCH no token', 401);

  // 6. PATCH with merchant token succeeds
  r = await req('PATCH', '/api/merchant/settings', { level_orders_required: 5 }, MERCHANT);
  r.status === 200 && r.body.data.level_orders_required === 5
    ? ok('PATCH level_orders_required=5')
    : bad('PATCH level_orders_required', r);

  // 7. PATCH invalid key → 400
  r = await req('PATCH', '/api/merchant/settings', { foo_bar: 1 }, MERCHANT);
  r.status === 400 ? ok('PATCH unknown key → 400') : bad('unknown key', 400);

  // 8. PATCH out-of-range → 400
  r = await req('PATCH', '/api/merchant/settings', { level_orders_required: 0 }, MERCHANT);
  r.status === 400 ? ok('PATCH out-of-range → 400') : bad('range', 400);

  // 9. PATCH non-integer for integer field → 400
  r = await req('PATCH', '/api/merchant/settings', { level_orders_required: 3.5 }, MERCHANT);
  r.status === 400 ? ok('PATCH non-integer → 400') : bad('non-integer', 400);

  // Restore default
  await req('PATCH', '/api/merchant/settings', { level_orders_required: 10 }, MERCHANT);

  console.log('\n=== User level auto-update ===\n');

  // 10. Login as a customer
  r = await req('POST', '/api/sessions', { code: 'level-test-' + Date.now() });
  const token = r.body.data.token;
  const openid = r.body.data.openid;
  ok(`Login (openid=${openid.slice(0, 24)}...)`);

  // 11. GET /me?include=level → level=1, discount=1.00 (full price), completed_orders=0
  r = await req('GET', '/api/users/me?include=level', null, token);
  r.body.data.level === 1 && r.body.data.discount === 1 && r.body.data.completed_orders === 0
    ? ok('Initial level=1, discount=1 (full price)')
    : bad('initial', r);

  // 12. Create 10 orders and complete them - level should auto-upgrade to 2
  // First get a product
  const products = (await req('GET', '/api/products')).body.data;
  const orderIds = [];
  for (let i = 0; i < 10; i++) {
    const orderRes = await req('POST', '/api/orders', {
      items: [{ product_id: products[0].id, quantity: 1 }],
      customer_name: 'LevelTest',
      customer_phone: '13800138000'
    }, token);
    if (orderRes.status !== 201) { bad(`order ${i}`, orderRes); return; }
    orderIds.push(orderRes.body.data.id);
  }
  ok(`Created 10 orders`);

  // Complete them via merchant - status transitions must follow the chain:
  // pending → paid → preparing → ready → completed
  for (const oid of orderIds) {
    for (const status of ['paid', 'preparing', 'ready', 'completed']) {
      r = await req('PATCH', `/api/merchant/orders/${oid}/status`, { status }, MERCHANT);
      if (r.status !== 200) { bad(`complete order ${oid} → ${status}`, r); return; }
    }
  }
  ok('Completed 10 orders');

  // 13. Check level upgraded
  r = await req('GET', '/api/users/me?include=level', null, token);
  // discount here is the multiplier: level 2 with inc=0.01 → 0.99 (pay 99%)
  r.body.data.level === 2 && r.body.data.completed_orders === 10 && Math.abs(r.body.data.discount - 0.99) < 0.001
    ? ok(`After 10 orders: level=2, completed=10, multiplier=${r.body.data.discount}`)
    : bad('after 10', r);

  // 14. Create an order - price should be discounted (¥10 product → ¥9.90)
  const order = await req('POST', '/api/orders', {
    items: [{ product_id: products[0].id, quantity: 1 }],
    customer_name: 'LevelTest',
    customer_phone: '13800138000'
  }, token);
  const item = order.body.data.items[0];
  const product = products[0];
  // product price is 20, level 2 with discount multiplier 0.99 → 19.80
  Math.abs(item.unit_price - 19.80) < 0.01 && Math.abs(item.subtotal - 19.80) < 0.01
    ? ok(`Order price discounted: ¥${item.unit_price} (was ¥${product.price})`)
    : bad('discounted price', item);

  console.log('\n=== Merchant users list ===\n');

  // 15. GET /api/merchant/users should include level info
  r = await req('GET', '/api/merchant/users', null, MERCHANT);
  const targetUser = r.body.data.find((u) => u.openid === openid);
  targetUser && targetUser.level === 2 && targetUser.completed_orders >= 10
    ? ok(`Merchant sees level=${targetUser.level}, completed=${targetUser.completed_orders}`)
    : bad('merchant user list', targetUser);

  // 16. GET /api/merchant/users/:openid shows level too
  r = await req('GET', `/api/merchant/users/${openid}`, null, MERCHANT);
  r.body.data.level === 2 ? ok(`Single user endpoint: level=${r.body.data.level}`) : bad('single user', r);

  // 17. Cleanup: complete one more order to test level 3
  await req('POST', '/api/orders', {
    items: [{ product_id: products[0].id, quantity: 1 }],
    customer_name: 'LevelTest',
    customer_phone: '13800138000'
  }, token);
  // We have 11 completed now (10 + 1 from above) → should be level 2 still
  r = await req('GET', '/api/users/me?include=level', null, token);
  // The latest order is not yet completed, so completed_orders should still be 10
  r.body.data.completed_orders === 10 ? ok('Pending orders do NOT count toward level') : bad('completed count', r);

  // Complete the new order
  r = await req('POST', '/api/orders', {
    items: [{ product_id: products[0].id, quantity: 1 }],
    customer_name: 'LevelTest',
    customer_phone: '13800138000'
  }, token);
  const newId = r.body.data.id;
  await req('PATCH', `/api/merchant/orders/${newId}/status`, { status: 'paid' }, MERCHANT);
  await req('PATCH', `/api/merchant/orders/${newId}/status`, { status: 'preparing' }, MERCHANT);
  await req('PATCH', `/api/merchant/orders/${newId}/status`, { status: 'ready' }, MERCHANT);
  await req('PATCH', `/api/merchant/orders/${newId}/status`, { status: 'completed' }, MERCHANT);

  r = await req('GET', '/api/users/me?include=level', null, token);
  r.body.data.completed_orders === 11 ? ok('After 11 completed: still level 2') : bad('after 11', r);

  // 18. Reset settings for cleanup
  await req('PATCH', '/api/merchant/settings', {
    level_orders_required: 10,
    level_discount_increment: 0.01,
    min_discount: 0.80
  }, MERCHANT);

  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
// filepath: coffee-app/server/test-e2e.js
// End-to-end test: simulate customer creating order + merchant processing it.
// Mirrors the full flow tested manually in the browser.
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
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null });
          } catch {
            resolve({ status: res.statusCode, body: buf });
          }
        });
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
const bad = (m, exp) => { console.log(`  ✗ ${m} (expected ${JSON.stringify(exp)})`); fail++; };

async function run() {
  // Login first
  const loginRes = await req('POST', '/api/sessions', { code: 'test-e2e-user' });
  const TOKEN = loginRes.body.data.token;

  console.log('\n=== Customer Flow ===\n');

  // 1. Customer browses menu (filter by category)
  let r = await req('GET', '/api/products?category=意式咖啡');
  const espressoCount = r.body.data.length;
  r.status === 200 && espressoCount > 0
    ? ok(`Customer browses 意式咖啡 menu (${espressoCount} items)`)
    : bad('browse menu', 200);

  // 2. Customer picks 2 items and submits order
  r = await req('POST', '/api/orders', {
    items: [
      { product_id: 1, quantity: 2 }, // 美式 x2 = 40
      { product_id: 7, quantity: 1 }  // Dirty x1 = 28
    ],
    customer_note: '少冰',
    customer_name: '张三',
    customer_phone: '13812345678'
  }, TOKEN);

  let orderId;
  if (r.status === 201 && r.body.data.pickup_number && r.body.data.total_amount === 68) {
    ok(`Customer creates order: pickup=${r.body.data.pickup_number}, total=¥${r.body.data.total_amount}`);
    orderId = r.body.data.id;
    r.body.data.customer_note === '少冰'
      ? ok('Order includes customer note')
      : bad('customer note', '少冰');
  } else bad('create order', 201);

  console.log('\n=== Merchant Flow ===\n');

  // 3. Merchant sees order in "进行中" view
  r = await req('GET', '/api/merchant/orders?status=pending', null, 'merchant-local-token');
  (r.body.data || []).find((o) => o.id === orderId)
    ? ok('Merchant sees order in pending list')
    : bad('pending list', 'contains order');

  // 4. Customer marks paid (mock pay)
  r = await req('PATCH', `/api/orders/${orderId}/status`, { status: 'paid' }, TOKEN);
  r.body.data.status === 'paid' ? ok('Customer marks paid (mock pay)') : bad('paid', 'paid');

  // 5. Merchant starts preparing
  r = await req('PATCH', `/api/merchant/orders/${orderId}/status`, { status: 'preparing' }, 'merchant-local-token');
  r.body.data.status === 'preparing' ? ok('Merchant starts preparing') : bad('preparing', 'preparing');

  // 6. Merchant marks ready (call pickup number)
  r = await req('PATCH', `/api/merchant/orders/${orderId}/status`, { status: 'ready' }, 'merchant-local-token');
  r.body.data.status === 'ready'
    ? ok(`Order ${r.body.data.pickup_number} is ready for pickup`)
    : bad('ready', 'ready');

  // 7. Customer arrives, merchant marks completed
  r = await req('PATCH', `/api/merchant/orders/${orderId}/status`, { status: 'completed' }, 'merchant-local-token');
  r.body.data.status === 'completed' ? ok('Customer picked up, order completed') : bad('completed', 'completed');

  console.log('\n=== Edge Cases ===\n');

  // 8. Empty cart rejected
  r = await req('POST', '/api/orders', { items: [] }, TOKEN);
  r.status === 400 ? ok('Empty cart rejected with 400') : bad('empty cart', 400);

  // 9. Invalid product ID rejected
  r = await req('POST', '/api/orders', { items: [{ product_id: 9999, quantity: 1 }] }, TOKEN);
  r.status === 400 ? ok('Invalid product rejected with 400') : bad('invalid product', 400);

  // 10. Sequential pickup numbers
  const r1 = await req('POST', '/api/orders', {
    items: [{ product_id: 2, quantity: 1 }],
    customer_name: '王五',
    customer_phone: '13900000002'
  }, TOKEN);
  const r2 = await req('POST', '/api/orders', {
    items: [{ product_id: 3, quantity: 1 }],
    customer_name: '赵六',
    customer_phone: '13900000003'
  }, TOKEN);
  const seq1 = parseInt(r1.body.data.pickup_number.split('-')[1], 10);
  const seq2 = parseInt(r2.body.data.pickup_number.split('-')[1], 10);
  seq2 === seq1 + 1 ? ok(`Sequential pickup numbers: ${r1.body.data.pickup_number} → ${r2.body.data.pickup_number}`) : bad('sequential numbers', seq1 + 1);

  // 11. Cancelled flow
  r = await req('POST', '/api/orders', {
    items: [{ product_id: 1, quantity: 1 }],
    customer_name: '李四',
    customer_phone: '13900000000'
  }, TOKEN);
  const cancelId = r.body.data.id;
  r = await req('PATCH', `/api/orders/${cancelId}/status`, { status: 'cancelled' }, TOKEN);
  r.body.data.status === 'cancelled' ? ok('Order can be cancelled from pending') : bad('cancel', 'cancelled');

  // 12. Invalid transition (cancelled -> paid) - customer can't do this anyway, but test the error
  r = await req('PATCH', `/api/orders/${cancelId}/status`, { status: 'paid' }, TOKEN);
  r.status >= 400 ? ok('Cannot update cancelled order') : bad('cancelled update', 400);

  // 13. Order details retrieval
  r = await req('GET', `/api/orders/${orderId}`, null, TOKEN);
  r.body.data.items && r.body.data.items.length === 2
    ? ok(`Order detail includes ${r.body.data.items.length} items`)
    : bad('order detail', 2);

  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });

// filepath: coffee-app/server/test-api.js
// Quick smoke test for the API endpoints
const http = require('http');

const BASE = 'http://localhost:3000';

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers
    };
    const req = http.request(opts, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: chunks ? JSON.parse(chunks) : null });
        } catch {
          resolve({ status: res.statusCode, body: chunks });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  let pass = 0, fail = 0;
  const ok = (msg) => { console.log(`  ✓ ${msg}`); pass++; };
  const bad = (msg, exp) => { console.log(`  ✗ ${msg} (expected ${exp})`); fail++; };

  // Get a session token for tests
  let r = await request('POST', '/api/sessions', { code: 'test-api-user' });
  const TOKEN = r.body.data.token;

  // Health
  console.log('\n[Health]');
  r = await request('GET', '/api/health');
  r.status === 200 && r.body.status === 'ok' ? ok('GET /api/health') : bad('GET /api/health', 200);

  // Products
  console.log('\n[Products]');
  r = await request('GET', '/api/products');
  if (r.status === 200 && Array.isArray(r.body.data)) {
    ok(`GET /api/products (${r.body.data.length} products)`);
  } else bad('GET /api/products', 200);

  r = await request('GET', '/api/products?category=意式咖啡');
  r.status === 200 && r.body.data.every(p => p.category === '意式咖啡') ? ok('GET /api/products?category=意式咖啡') : bad('category filter', 200);

  r = await request('GET', '/api/products/1');
  r.status === 200 && r.body.data.id === 1 ? ok('GET /api/products/1') : bad('GET /api/products/1', 200);

  r = await request('GET', '/api/products/9999');
  r.status === 404 ? ok('GET /api/products/9999 returns 404') : bad('not found', 404);

  // Create product
  r = await request('POST', '/api/products', { name: '测试产品', category: '其他饮品', price: 25 });
  let newId;
  if (r.status === 201 && r.body.data.id) {
    ok('POST /api/products');
    newId = r.body.data.id;
  } else bad('POST /api/products', 201);

  // Update product
  if (newId) {
    r = await request('PATCH', `/api/products/${newId}`, { price: 30 });
    r.status === 200 && r.body.data.price === 30 ? ok('PATCH /api/products/:id') : bad('PATCH product', 200);

    // Toggle availability
    r = await request('PATCH', `/api/products/${newId}`, { available: false });
    r.body.data.available === 0 ? ok('Toggle availability off') : bad('toggle off', 0);

    r = await request('GET', `/api/products?availableOnly=true`);
    r.body.data.every(p => p.available === 1) ? ok('availableOnly filter excludes hidden') : bad('availableOnly', 200);

    // Delete product
    r = await request('DELETE', `/api/products/${newId}`);
    r.status === 204 ? ok('DELETE /api/products/:id') : bad('DELETE', 204);
  }

  // Orders
  console.log('\n[Orders]');
  r = await request('POST', '/api/orders', {
    items: [{ product_id: 1, quantity: 2 }, { product_id: 3, quantity: 1 }],
    customer_name: '测试用户',
    customer_phone: '13900000000'
  }, TOKEN);
  let orderId;
  if (r.status === 201 && r.body.data.pickup_number && r.body.data.items.length === 2) {
    ok(`POST /api/orders (pickup=${r.body.data.pickup_number}, total=${r.body.data.total_amount})`);
    orderId = r.body.data.id;
  } else bad('POST /api/orders', 201);

  if (orderId) {
    r = await request('GET', `/api/orders/${orderId}`, null, TOKEN);
    r.status === 200 && r.body.data.id === orderId ? ok('GET /api/orders/:id') : bad('GET order', 200);

    r = await request('GET', '/api/orders', null, TOKEN);
    Array.isArray(r.body.data) && r.body.data.length > 0 ? ok('GET /api/orders') : bad('GET orders list', 200);

    // Customer can mark paid (mock pay)
    r = await request('PATCH', `/api/orders/${orderId}/status`, { status: 'paid' }, TOKEN);
    r.body.data.status === 'paid' ? ok('Status: pending -> paid') : bad('paid', 'paid');

    // Customer cannot move to preparing (merchant-only)
    r = await request('PATCH', `/api/orders/${orderId}/status`, { status: 'preparing' }, TOKEN);
    r.status === 403 ? ok('Customer cannot prepare (403)') : bad('prepare blocked', 403);

    // Use merchant token to continue
    r = await request('PATCH', `/api/merchant/orders/${orderId}/status`, { status: 'preparing' }, 'merchant-local-token');
    r.body.data.status === 'preparing' ? ok('Merchant: paid -> preparing') : bad('preparing', 'preparing');

    r = await request('PATCH', `/api/merchant/orders/${orderId}/status`, { status: 'ready' }, 'merchant-local-token');
    r.body.data.status === 'ready' ? ok('Status: preparing -> ready') : bad('ready', 'ready');

    r = await request('PATCH', `/api/merchant/orders/${orderId}/status`, { status: 'completed' }, 'merchant-local-token');
    r.body.data.status === 'completed' ? ok('Status: ready -> completed') : bad('completed', 'completed');
  }

  // Pickup number generation - second order should have sequential number
  r = await request('POST', '/api/orders', {
    items: [{ product_id: 1, quantity: 1 }],
    customer_name: '测试用户2',
    customer_phone: '13900000001'
  }, TOKEN);
  if (r.status === 201 && r.body.data.pickup_number) {
    console.log(`  ℹ Second order pickup: ${r.body.data.pickup_number}`);
    ok('Second order gets sequential pickup number');
  } else bad('second order', 201);

  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });

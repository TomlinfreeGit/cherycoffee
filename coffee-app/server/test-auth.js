// filepath: coffee-app/server/test-auth.js
// Tests for authentication and order isolation
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
  console.log('\n=== Auth & Session ===\n');

  // 1. Login: create a session
  let r = await req('POST', '/api/sessions', { code: 'user-alice-code' });
  let aliceToken;
  if (r.status === 200 && r.body.data.token && r.body.data.openid) {
    aliceToken = r.body.data.token;
    ok(`Alice login: openid=${r.body.data.openid}`);
  } else bad('Alice login', 200);

  // 2. Login: another user (different openid)
  r = await req('POST', '/api/sessions', { code: 'user-bob-code' });
  let bobToken;
  const aliceOpenid = (await req('POST', '/api/sessions', { code: 'user-alice-code' })).body.data.openid;
  if (r.status === 200 && r.body.data.token && r.body.data.openid !== aliceOpenid) {
    bobToken = r.body.data.token;
    ok(`Bob login: openid=${r.body.data.openid} (different from Alice)`);
  } else bad('Bob login', 200);

  // Same code → same openid (deterministic for local dev)
  r = await req('POST', '/api/sessions', { code: 'user-alice-code' });
  r.body.data.openid === (await req('POST', '/api/sessions', { code: 'user-alice-code' })).body.data.openid
    ? ok('Same code produces same openid')
    : bad('openid deterministic', 'same');

  console.log('\n=== Order Isolation ===\n');

  // 3. Alice creates an order (auth required - should use ensureLoggedIn)
  // But create endpoint allows optional auth; let's use Alice's token explicitly
  r = await req('POST', '/api/orders', {
    items: [{ product_id: 1, quantity: 2 }],
    customer_name: 'Alice',
    customer_phone: '13800000001'
  }, aliceToken);
  let aliceOrderId;
  if (r.status === 201 && r.body.data.openid) {
    aliceOrderId = r.body.data.id;
    ok(`Alice creates order #${aliceOrderId} (bound to her openid)`);
  } else bad('Alice order', 201);

  // 4. Bob creates an order
  r = await req('POST', '/api/orders', {
    items: [{ product_id: 2, quantity: 1 }],
    customer_name: 'Bob',
    customer_phone: '13800000002'
  }, bobToken);
  let bobOrderId;
  if (r.status === 201) {
    bobOrderId = r.body.data.id;
    ok(`Bob creates order #${bobOrderId}`);
  } else bad('Bob order', 201);

  console.log('\n=== Privacy Enforcement ===\n');

  // 5. Alice lists orders → only sees Alice's orders
  r = await req('GET', '/api/orders', null, aliceToken);
  const aliceSees = r.body.data;
  const aliceCanSeeBobOrder = aliceSees.some((o) => o.id === bobOrderId);
  const aliceCanSeeHerOrder = aliceSees.some((o) => o.id === aliceOrderId);
  !aliceCanSeeBobOrder && aliceCanSeeHerOrder
    ? ok(`Alice sees ${aliceSees.length} order(s) — only her own`)
    : bad('Alice isolation', 'only her order');

  // 6. Bob lists orders → only sees Bob's orders
  r = await req('GET', '/api/orders', null, bobToken);
  const bobSees = r.body.data || [];
  const bobCanSeeAliceOrder = bobSees.some((o) => o.id === aliceOrderId);
  const bobCanSeeHisOrder = bobSees.some((o) => o.id === bobOrderId);
  !bobCanSeeAliceOrder && bobCanSeeHisOrder
    ? ok(`Bob sees ${bobSees.length} order(s) — only his own`)
    : bad('Bob isolation', 'only his order');

  // 7. Alice tries to fetch Bob's order by ID → 404
  r = await req('GET', `/api/orders/${bobOrderId}`, null, aliceToken);
  r.status === 404 ? ok(`Alice cannot fetch Bob's order #${bobOrderId} (404)`) : bad('cross-user fetch', 404);

  // 8. Alice fetches her own order → success
  r = await req('GET', `/api/orders/${aliceOrderId}`, null, aliceToken);
  r.status === 200 && r.body.data.id === aliceOrderId
    ? ok(`Alice fetches her own order #${aliceOrderId}`)
    : bad('own order fetch', 200);

  // 9. No auth token → 401
  r = await req('GET', '/api/orders', null, null);
  r.status === 401 ? ok('No token → 401') : bad('no auth', 401);

  // 10. Invalid token → 401
  r = await req('GET', '/api/orders', null, 'invalid-token-xyz');
  r.status === 401 ? ok('Invalid token → 401') : bad('invalid token', 401);

  console.log('\n=== Status Update Authorization ===\n');

  // 11. Alice cancels her own order → OK
  r = await req('PATCH', `/api/orders/${aliceOrderId}/status`, { status: 'cancelled' }, aliceToken);
  r.body.data.status === 'cancelled'
    ? ok('Alice cancels her own order')
    : bad('Alice cancel', 'cancelled');

  // 12. Bob tries to set Alice's order to "preparing" → 403 (customer can't)
  r = await req('PATCH', `/api/orders/${aliceOrderId}/status`, { status: 'preparing' }, bobToken);
  r.status === 404 ? ok('Bob cannot update Alice\'s order (404)') : bad('cross-user update', 404);

  // 13. Alice tries to set Bob's order to "ready" → 404
  r = await req('PATCH', `/api/orders/${bobOrderId}/status`, { status: 'ready' }, aliceToken);
  r.status === 404 ? ok('Alice cannot update Bob\'s order (404)') : bad('cross-user update', 404);

  console.log('\n=== Merchant Access (separate endpoint) ===\n');

  // 14. Merchant token can list ALL orders
  r = await req('GET', '/api/merchant/orders', null, 'merchant-local-token');
  const merchantSees = r.body.data;
  merchantSees.some((o) => o.id === aliceOrderId) &&
  merchantSees.some((o) => o.id === bobOrderId)
    ? ok(`Merchant sees all ${merchantSees.length} orders (incl. Alice + Bob)`)
    : bad('merchant all orders', 'all');

  // 15. Merchant updates any order's status (valid transition: pending -> paid)
  r = await req('PATCH', `/api/merchant/orders/${bobOrderId}/status`, { status: 'paid' }, 'merchant-local-token');
  r.body.data && r.body.data.status === 'paid'
    ? ok('Merchant updates Bob\'s order status (pending -> paid)')
    : bad('merchant update', 'paid');

  // 16. Customer token rejected on merchant endpoints
  r = await req('GET', '/api/merchant/orders', null, aliceToken);
  r.status === 401 ? ok('Customer token rejected on /api/merchant (401)') : bad('customer blocked', 401);

  console.log('\n=== Logout ===\n');

  // 17. Logout invalidates token
  await req('DELETE', '/api/sessions', null, aliceToken);
  r = await req('GET', '/api/orders', null, aliceToken);
  r.status === 401 ? ok('Alice token invalidated after logout') : bad('logout invalidation', 401);

  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });

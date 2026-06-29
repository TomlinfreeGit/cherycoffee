// filepath: coffee-app/server/test-users-merchant.js
// Tests for /api/merchant/users/* endpoints (list, get, delete).

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

const MERCHANT_TOKEN = 'merchant-local-token';

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
const bad = (m, exp) => { console.log(`  ✗ ${m} (expected ${JSON.stringify(exp)})`); fail++; };

async function login(code) {
  const r = await req('POST', '/api/sessions', { code });
  if (r.status !== 200) throw new Error(`Login failed: ${r.status}`);
  return { token: r.body.data.token, openid: r.body.data.openid };
}

async function run() {
  console.log('\n=== Merchant Users: Auth ===\n');

  // 1. No token → 401
  let r = await req('GET', '/api/merchant/users');
  r.status === 401 ? ok('No token → 401') : bad('no token', 401);

  console.log('\n=== Merchant Users: List ===\n');

  // 2. Empty list is fine (even with no users)
  r = await req('GET', '/api/merchant/users', null, MERCHANT_TOKEN);
  r.status === 200 && Array.isArray(r.body.data) && typeof r.body.total === 'number'
    ? ok(`List users (${r.body.data.length} users, total=${r.body.total})`)
    : bad('list', r);

  // 3. Create a few test users + sessions
  const u1 = await login('users-test-u1-' + Date.now());
  const u2 = await login('users-test-u2-' + Date.now());
  const u3 = await login('users-test-u3-' + Date.now());

  // Set nicknames/phones
  await req('PATCH', '/api/users/me', { nickname: '张三' }, u1.token);
  await req('POST', '/api/users/phone-plain', { phone: '13800138001' }, u1.token);
  await req('PATCH', '/api/users/me', { nickname: '李四' }, u2.token);
  await req('POST', '/api/users/phone-plain', { phone: '13800138002' }, u2.token);
  await req('PATCH', '/api/users/me', { nickname: '王五' }, u3.token);

  // 4. List now has at least 3 users
  r = await req('GET', '/api/merchant/users', null, MERCHANT_TOKEN);
  r.body.data.length >= 3
    ? ok(`After seed: ${r.body.data.length} users`)
    : bad('list after seed', r);

  // 5. Search by nickname
  r = await req('GET', '/api/merchant/users?search=张三', null, MERCHANT_TOKEN);
  r.body.data.length >= 1 && r.body.data.some((u) => u.nickname === '张三')
    ? ok('Search by nickname (张三)')
    : bad('search nickname', r);

  // 6. Search by phone
  r = await req('GET', '/api/merchant/users?search=13800138001', null, MERCHANT_TOKEN);
  r.body.data.length >= 1 && r.body.data.some((u) => u.has_phone && u.phone.includes('8001'))
    ? ok('Search by phone (13800138001)')
    : bad('search phone', r);

  // 7. Filter has_phone=true
  r = await req('GET', '/api/merchant/users?has_phone=true', null, MERCHANT_TOKEN);
  r.body.data.every((u) => u.has_phone)
    ? ok('Filter has_phone=true (all entries have phone)')
    : bad('has_phone filter', r);

  // 8. Filter has_phone=false
  r = await req('GET', '/api/merchant/users?has_phone=false', null, MERCHANT_TOKEN);
  r.body.data.every((u) => !u.has_phone)
    ? ok('Filter has_phone=false (no entry has phone)')
    : bad('has_phone=false filter', r);

  // 9. Phone is masked
  r = await req('GET', `/api/merchant/users?search=13800138001`, null, MERCHANT_TOKEN);
  const maskedEntry = r.body.data.find((u) => u.has_phone);
  maskedEntry && maskedEntry.phone === '138****8001'
    ? ok(`Phone is masked: ${maskedEntry.phone}`)
    : bad('phone masked', maskedEntry);

  console.log('\n=== Merchant Users: Detail ===\n');

  // 10. Get single user
  r = await req('GET', `/api/merchant/users/${u1.openid}`, null, MERCHANT_TOKEN);
  r.status === 200 && r.body.data.openid === u1.openid && r.body.data.nickname === '张三'
    ? ok(`GET /users/:openid → ${r.body.data.nickname}`)
    : bad('get user', r);

  // 11. 404 for unknown
  r = await req('GET', '/api/merchant/users/no-such-openid', null, MERCHANT_TOKEN);
  r.status === 404 ? ok('GET unknown user → 404') : bad('get 404', 404);

  console.log('\n=== Merchant Users: Delete ===\n');

  // 12. Place an order for u1 so we can verify anonymization
  r = await req('GET', '/api/products', null, MERCHANT_TOKEN);
  const product = r.body.data[0];
  const orderRes = await req(
    'POST',
    '/api/orders',
    {
      items: [{ product_id: product.id, quantity: 1 }],
      customer_name: '张三',
      customer_phone: '13800138001'
    },
    u1.token
  );
  const orderId = orderRes.body.data.id;
  ok(`Created order ${orderId} for u1`);

  // Verify the order has the right openid
  r = await req('GET', `/api/merchant/orders/${orderId}`, null, MERCHANT_TOKEN);
  r.body.data.openid === u1.openid && r.body.data.customer_phone === '13800138001'
    ? ok('Order has u1.openid and full phone')
    : bad('order initial state', r);

  // 13. Delete u1
  r = await req('DELETE', `/api/merchant/users/${u1.openid}`, null, MERCHANT_TOKEN);
  r.status === 200 && r.body.data.deleted_user && r.body.data.anonymized_orders >= 1
    ? ok(`Delete user: anonymized ${r.body.data.anonymized_orders} orders, deleted ${r.body.data.deleted_sessions} sessions`)
    : bad('delete user', r);

  // 14. User is gone from /users
  r = await req('GET', `/api/merchant/users/${u1.openid}`, null, MERCHANT_TOKEN);
  r.status === 404 ? ok('User no longer in /users') : bad('user after delete', 404);

  // 15. Sessions invalidated
  r = await req('GET', '/api/users/me', null, u1.token);
  r.status === 401 ? ok('u1 token invalidated') : bad('u1 session after delete', 401);

  // 16. Historical order is anonymized (openid NULL, customer_phone NULL, customer_name NULL)
  r = await req('GET', `/api/merchant/orders/${orderId}`, null, MERCHANT_TOKEN);
  r.status === 200 &&
    r.body.data.openid === null &&
    r.body.data.customer_name === null &&
    r.body.data.customer_phone === null
    ? ok('Order anonymized: openid/name/phone all NULL')
    : bad('order anonymized', r);

  // 17. Delete same user again → 404
  r = await req('DELETE', `/api/merchant/users/${u1.openid}`, null, MERCHANT_TOKEN);
  r.status === 404 ? ok('Delete already-deleted user → 404') : bad('re-delete', 404);

  // 18. Without merchant token → 401
  r = await req('DELETE', `/api/merchant/users/${u2.openid}`, null, 'bogus-token');
  r.status === 401 ? ok('Delete with bad token → 401') : bad('delete bad token', 401);

  // 19. Other users unaffected
  r = await req('GET', `/api/merchant/users/${u2.openid}`, null, MERCHANT_TOKEN);
  r.status === 200 ? ok('u2 still exists') : bad('u2 unaffected', r);

  // Cleanup
  await req('DELETE', `/api/merchant/users/${u2.openid}`, null, MERCHANT_TOKEN);
  await req('DELETE', `/api/merchant/users/${u3.openid}`, null, MERCHANT_TOKEN);

  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });

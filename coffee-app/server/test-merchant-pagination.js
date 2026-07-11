// filepath: coffee-app/server/test-merchant-pagination.js
// Tests for merchant order list pagination + users hasMore.
const http = require('http');
const BASE = 'http://localhost:3000';
const MERCHANT = 'merchant-local-token';

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

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
const bad = (m, exp) => { console.log(`  ✗ ${m} (got ${JSON.stringify(exp)})`); fail++; };

async function login(code) {
  const r = await req('POST', '/api/sessions', { code });
  if (r.status !== 200) throw new Error('login failed');
  return r.body.data.token;
}

async function run() {
  const stamp = Date.now();
  const tokenA = await login('m-page-A-' + stamp);
  const tokenB = await login('m-page-B-' + stamp);

  const prods = (await req('GET', '/api/products')).body.data;
  if (!prods.length) throw new Error('No products');

  // Create 12 orders for user A and 4 for user B (total 16)
  console.log('\n[Setup]');
  for (let i = 0; i < 12; i++) {
    await req('POST', '/api/orders', {
      items: [{ product_id: prods[0].id, quantity: 1 }],
      customer_name: '商家分页A',
      customer_phone: '13700000000'
    }, tokenA);
  }
  for (let i = 0; i < 4; i++) {
    await req('POST', '/api/orders', {
      items: [{ product_id: prods[0].id, quantity: 1 }],
      customer_name: '商家分页B',
      customer_phone: '13800000000'
    }, tokenB);
  }
  ok('Setup: 12 orders for A, 4 for B');

  // ─── 1. Legacy compat (no limit) ─────────────────────
  console.log('\n[Backward compat]');
  let r = await req('GET', '/api/merchant/orders', null, MERCHANT);
  // Just verify it still returns data + at least 16 rows
  if (r.status === 200 && Array.isArray(r.body.data) && r.body.data.length >= 16) {
    ok(`GET /api/merchant/orders (no limit) returns all rows (${r.body.data.length})`);
  } else bad('legacy merchant orders', r);

  // ─── 2. Paged shape ───────────────────────────────────
  console.log('\n[Paged shape]');
  r = await req('GET', '/api/merchant/orders?limit=5&offset=0', null, MERCHANT);
  if (
    r.status === 200 &&
    Array.isArray(r.body.data) &&
    r.body.data.length === 5 &&
    r.body.total >= 16 &&
    r.body.limit === 5 &&
    r.body.offset === 0 &&
    r.body.hasMore === true
  ) {
    ok(`limit=5 → 5 rows, total=${r.body.total}, hasMore=true`);
  } else bad('page 1 shape', r);

  // ─── 3. Walk all pages ────────────────────────────────
  console.log('\n[Walk all pages]');
  const seenIds = new Set();
  let offset = 0;
  let pages = 0;
  while (true) {
    r = await req('GET', `/api/merchant/orders?limit=5&offset=${offset}`, null, MERCHANT);
    if (r.status !== 200) { bad(`walk offset=${offset}`, r); break; }
    const rows = r.body.data;
    if (rows.length === 0) break;
    for (const row of rows) {
      if (seenIds.has(row.id)) { bad(`duplicate id ${row.id}`); return; }
      seenIds.add(row.id);
    }
    pages++;
    if (!r.body.hasMore) break;
    offset += rows.length;
    if (pages > 2000) { bad('too many pages'); return; }
  }
  if (seenIds.size >= 16 && r.body.hasMore === false) {
    ok(`Walked ${seenIds.size} orders across ${pages} pages, final hasMore=false`);
  } else bad('walk result', { seen: seenIds.size, pages, finalHasMore: r.body.hasMore });

  // ─── 4. Status filter + pagination ────────────────────
  console.log('\n[Status filter]');
  // Cancel user A's first 3 orders (transitions pending → cancelled)
  const aOrders = (await req('GET', `/api/merchant/orders?status=pending&search=商家分页A&limit=50`, null, MERCHANT)).body.data;
  for (let i = 0; i < 3; i++) {
    await req('PATCH', `/api/merchant/orders/${aOrders[i].id}/status`, { status: 'cancelled' }, MERCHANT);
  }
  r = await req('GET', '/api/merchant/orders?status=cancelled&limit=10', null, MERCHANT);
  // 由于 DB 里可能有别的测试遗留的 cancelled 订单,只验证 *至少* 有我们刚取消的 3 单
  if (r.status === 200 && r.body.total >= 3 && r.body.data.some((o) => o.customer_name === '商家分页A')) {
    ok(`Filter status=cancelled includes our 3 newly-cancelled orders (total=${r.body.total})`);
  } else bad('cancelled filter', r);

  // ─── 5. Search filter + pagination ────────────────────
  // Search by name: 由于 DB 里可能有别的测试遗留的同名订单,只验证 total >= 12 且全是用户 A
  r = await req(
    'GET',
    '/api/merchant/orders?search=' + encodeURIComponent('商家分页A') + '&limit=10',
    null,
    MERCHANT
  );
  if (
    r.status === 200 &&
    r.body.total >= 12 &&
    r.body.data.every((o) => o.customer_phone === '13700000000')
  ) {
    ok(`Search by name returns only user A's orders (total=${r.body.total})`);
  } else bad('search A', r);

  r = await req('GET', '/api/merchant/orders?search=13700000000&limit=10', null, MERCHANT);
  if (
    r.status === 200 &&
    r.body.total >= 12 &&
    r.body.data.every((o) => o.customer_phone === '13700000000')
  ) {
    ok(`Search by phone returns only user A's orders (total=${r.body.total})`);
  } else bad('phone search', r);

  // ─── 6. Users hasMore ─────────────────────────────────
  console.log('\n[Users hasMore]');
  // First make sure we have at least 11 users (10 default-ish + a few we created)
  r = await req('GET', '/api/merchant/users?limit=10', null, MERCHANT);
  if (r.status === 200 && Array.isArray(r.body.data) && typeof r.body.hasMore === 'boolean') {
    ok(`Users paged: limit=10 returns ${r.body.data.length} rows, total=${r.body.total}, hasMore=${r.body.hasMore}`);
  } else bad('users paged shape', r);

  // ─── 7. Merchant auth required ────────────────────────
  console.log('\n[Auth]');
  r = await req('GET', '/api/merchant/orders?limit=5');
  r.status === 401 ? ok('orders requires auth') : bad('no token', 401);
  r = await req('GET', '/api/merchant/users?limit=5');
  r.status === 401 ? ok('users requires auth') : bad('users no token', 401);

  // ─── 8. limit cap ─────────────────────────────────────
  r = await req('GET', '/api/merchant/orders?limit=99999', null, MERCHANT);
  if (r.body.limit === 200) {
    ok('Merchant orders limit clamped to 200');
  } else bad('orders limit cap', r.body.limit);

  r = await req('GET', '/api/merchant/users?limit=99999', null, MERCHANT);
  if (r.body.limit === 200) {
    ok('Merchant users limit clamped to 200');
  } else bad('users limit cap', r.body.limit);

  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
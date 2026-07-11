// filepath: coffee-app/server/test-orders-pagination.js
// Tests for /api/orders pagination (limit/offset/total/hasMore).
//
// Verifies:
//   1. Backward compatibility: no limit/offset returns the legacy shape {data: [...]}
//   2. limit/offset returns {data, total, limit, offset, hasMore}
//   3. Pagination walks through the full list with no overlap, no gaps
//   4. hasMore becomes false on the last page
//   5. status filter still works inside pagination
//   6. Only returns the calling user's orders (cross-user isolation)

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
  if (r.status !== 200) throw new Error('login failed: ' + JSON.stringify(r));
  return r.body.data.token;
}

async function run() {
  // Use unique codes so this test is isolated from other test runs
  const stamp = Date.now();
  const tokenA = await login('page-A-' + stamp);
  const tokenB = await login('page-B-' + stamp);

  // Get a product to order
  const prods = (await req('GET', '/api/products')).body.data;
  if (!prods.length) throw new Error('No products in DB - run seed first');

  // Create 23 orders for user A (odd number so last page is partial)
  console.log('\n[Setup] Creating 23 orders for user A...');
  const orderIds = [];
  for (let i = 0; i < 23; i++) {
    const r = await req(
      'POST',
      '/api/orders',
      {
        items: [{ product_id: prods[0].id, quantity: 1 }],
        customer_name: 'PageUser',
        customer_phone: '13900000000'
      },
      tokenA
    );
    if (r.status !== 201) throw new Error(`order ${i} failed: ${JSON.stringify(r)}`);
    orderIds.push(r.body.data.id);
  }
  // User B gets 5 orders
  for (let i = 0; i < 5; i++) {
    await req(
      'POST',
      '/api/orders',
      {
        items: [{ product_id: prods[0].id, quantity: 1 }],
        customer_name: 'PageUserB',
        customer_phone: '13900000001'
      },
      tokenB
    );
  }
  ok(`Setup: 23 orders for A, 5 for B`);

  // ─── 1. Backward compat: no limit ─────────────────────
  console.log('\n[Backward compat]');
  let r = await req('GET', '/api/orders', null, tokenA);
  if (r.status === 200 && Array.isArray(r.body.data) && r.body.data.length === 23) {
    ok('GET /api/orders (no params) returns all 23 orders (legacy shape)');
  } else bad('legacy shape', r);

  // ─── 2. Paged response shape ──────────────────────────
  console.log('\n[Pagination shape]');
  r = await req('GET', '/api/orders?limit=10&offset=0', null, tokenA);
  if (
    r.status === 200 &&
    Array.isArray(r.body.data) &&
    r.body.data.length === 10 &&
    r.body.total === 23 &&
    r.body.limit === 10 &&
    r.body.offset === 0 &&
    r.body.hasMore === true
  ) {
    ok('limit=10&offset=0 → returns 10 rows, total=23, hasMore=true');
  } else bad('page 1 shape', r);

  // ─── 3. Walk all pages, no overlap, no gaps ────────────
  console.log('\n[Walk all pages]');
  const seenIds = new Set();
  const allIds = [];
  const PAGE = 10;
  let offset = 0;
  let pages = 0;
  while (true) {
    r = await req('GET', `/api/orders?limit=${PAGE}&offset=${offset}`, null, tokenA);
    if (r.status !== 200) { bad(`walk page offset=${offset}`, r); break; }
    const rows = r.body.data;
    if (rows.length === 0) { bad('walk empty page', r); break; }
    for (const row of rows) {
      if (seenIds.has(row.id)) { bad(`duplicate id ${row.id} across pages`); return; }
      seenIds.add(row.id);
      allIds.push(row.id);
    }
    pages++;
    if (!r.body.hasMore) break;
    offset += rows.length;
    if (pages > 10) { bad('too many pages - infinite loop?', pages); return; }
  }
  if (seenIds.size === 23 && allIds.length === 23) {
    ok(`Walked 23 orders in ${pages} pages (no duplicates, no gaps)`);
  } else bad('walk total', { seen: seenIds.size, all: allIds.length });

  // ─── 4. Last page has hasMore=false ───────────────────
  // After walking, the last page should have returned hasMore=false
  if (r.body.hasMore === false) {
    ok('Final page has hasMore=false');
  } else bad('final hasMore', r.body.hasMore);

  // ─── 5. Status filter + pagination ────────────────────
  console.log('\n[Status filter]');
  // Mark some orders completed (need merchant token)
  const MERCHANT = 'merchant-local-token';
  // Complete the first 5 orders of A
  for (let i = 0; i < 5; i++) {
    const oid = orderIds[i];
    for (const s of ['paid', 'preparing', 'ready', 'completed']) {
      await req('PATCH', `/api/merchant/orders/${oid}/status`, { status: s }, MERCHANT);
    }
  }
  // Page through completed orders only
  r = await req('GET', '/api/orders?limit=10&offset=0&status=completed', null, tokenA);
  if (r.status === 200 && r.body.total === 5 && r.body.data.length === 5 && r.body.hasMore === false) {
    ok('Filter status=completed returns only the 5 completed orders');
  } else bad('status filter + pagination', r);

  // ─── 6. Cross-user isolation ───────────────────────────
  console.log('\n[Cross-user isolation]');
  r = await req('GET', '/api/orders?limit=50', null, tokenA);
  if (r.body.total === 23) {
    ok('User A sees only their 23 orders (not B\'s 5)');
  } else bad('isolation total', r.body.total);

  r = await req('GET', '/api/orders?limit=50', null, tokenB);
  if (r.body.total === 5) {
    ok('User B sees only their 5 orders');
  } else bad('B total', r.body.total);

  // ─── 7. limit cap (max 100) ───────────────────────────
  console.log('\n[Limit cap]');
  r = await req('GET', '/api/orders?limit=999', null, tokenA);
  if (r.body.limit === 100) {
    ok('limit=999 is clamped to 100');
  } else bad('limit cap', r.body.limit);

  // ─── 8. Offset past end ───────────────────────────────
  r = await req('GET', '/api/orders?limit=10&offset=1000', null, tokenA);
  if (r.status === 200 && r.body.data.length === 0 && r.body.total === 23 && r.body.hasMore === false) {
    ok('offset past end → empty data, hasMore=false');
  } else bad('past end', r);

  // ─── 9. Empty list shape ──────────────────────────────
  // Create a brand new user with no orders
  const tokenC = await login('page-empty-' + stamp);
  r = await req('GET', '/api/orders?limit=10', null, tokenC);
  if (r.status === 200 && r.body.data.length === 0 && r.body.total === 0 && r.body.hasMore === false) {
    ok('Brand-new user: total=0, hasMore=false');
  } else bad('empty user', r);

  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
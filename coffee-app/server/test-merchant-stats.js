// filepath: coffee-app/server/test-merchant-stats.js
// Tests for merchant orders status=active filter + /orders/stats endpoint.

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
  const token = await login('stats-' + stamp);

  const prods = (await req('GET', '/api/products')).body.data;
  if (!prods.length) throw new Error('no products');

  // ─── Snapshot baseline ────────────────────────────────
  console.log('\n[Baseline]');
  const baseStats = (await req('GET', '/api/merchant/orders/stats', null, MERCHANT)).body.data;
  ok(`Baseline stats: active=${baseStats.active}, preparing=${baseStats.preparing}, ready=${baseStats.ready}, today=${baseStats.today}`);

  // ─── Create a few orders with known status transitions ─
  console.log('\n[Setup]');
  const orderIds = [];
  for (let i = 0; i < 4; i++) {
    const r = await req('POST', '/api/orders', {
      items: [{ product_id: prods[0].id, quantity: 1 }],
      customer_name: 'stats-test',
      customer_phone: '13500000000'
    }, token);
    orderIds.push(r.body.data.id);
  }
  // Order 0 -> paid -> preparing -> ready (待取餐)
  // Order 1 -> paid -> preparing (制作中)
  // Order 2 -> paid (已支付)
  // Order 3 stays pending (待支付)
  await req('PATCH', `/api/merchant/orders/${orderIds[0]}/status`, { status: 'paid' }, MERCHANT);
  await req('PATCH', `/api/merchant/orders/${orderIds[0]}/status`, { status: 'preparing' }, MERCHANT);
  await req('PATCH', `/api/merchant/orders/${orderIds[0]}/status`, { status: 'ready' }, MERCHANT);

  await req('PATCH', `/api/merchant/orders/${orderIds[1]}/status`, { status: 'paid' }, MERCHANT);
  await req('PATCH', `/api/merchant/orders/${orderIds[1]}/status`, { status: 'preparing' }, MERCHANT);

  await req('PATCH', `/api/merchant/orders/${orderIds[2]}/status`, { status: 'paid' }, MERCHANT);
  // orderIds[3] 留 pending
  ok('Setup: 4 orders in 4 different statuses');

  // ─── Test /orders/stats ──────────────────────────────
  console.log('\n[/orders/stats]');
  let r = await req('GET', '/api/merchant/orders/stats', null, MERCHANT);
  if (r.status === 200 &&
      typeof r.body.data.active === 'number' &&
      typeof r.body.data.preparing === 'number' &&
      typeof r.body.data.ready === 'number' &&
      typeof r.body.data.today === 'number') {
    ok(`Stats shape OK: ${JSON.stringify(r.body.data)}`);
  } else bad('stats shape', r);

  // Today 至少要包含刚下的 4 单 (下单时间就是今天)
  if (r.body.data.today >= baseStats.today + 4) {
    ok(`today count grew by ≥4 (${baseStats.today} → ${r.body.data.today})`);
  } else bad('today counter', r.body.data);

  // active 至少比 baseline 多 4 (pending/paid/preparing/ready 都是 active)
  if (r.body.data.active >= baseStats.active + 4) {
    ok(`active count grew by ≥4 (${baseStats.active} → ${r.body.data.active})`);
  } else bad('active counter', r.body.data);

  // ready 至少比 baseline 多 1
  if (r.body.data.ready >= baseStats.ready + 1) {
    ok(`ready count grew by ≥1 (${baseStats.ready} → ${r.body.data.ready})`);
  } else bad('ready counter', r.body.data);

  // preparing 至少比 baseline 多 1
  if (r.body.data.preparing >= baseStats.preparing + 1) {
    ok(`preparing count grew by ≥1 (${baseStats.preparing} → ${r.body.data.preparing})`);
  } else bad('preparing counter', r.body.data);

  // ─── Test status=active filter ────────────────────────
  console.log('\n[status=active filter]');
  r = await req('GET', '/api/merchant/orders?status=active&limit=200', null, MERCHANT);
  // 后端 limit cap=200,total 超过 200 时需要走遍所有页。
  // 走页逻辑只检查 status 全部在 in-progress 集合里,不在乎总数。
  let allActiveRows = [...r.body.data];
  while (r.body.hasMore) {
    r = await req('GET', `/api/merchant/orders?status=active&limit=200&offset=${allActiveRows.length}`, null, MERCHANT);
    allActiveRows = allActiveRows.concat(r.body.data);
  }
  if (allActiveRows.length === r.body.total &&
      allActiveRows.every((o) => ['pending','paid','preparing','ready'].includes(o.status))) {
    ok(`status=active returns only in-progress orders (${r.body.total} rows across ${Math.ceil(r.body.total / 200)} pages)`);
  } else bad('status=active', { walked: allActiveRows.length, total: r.body.total });

  // ─── status=active vs status=ready should differ ─────
  const activeTotal = r.body.total;
  r = await req('GET', '/api/merchant/orders?status=ready&limit=500', null, MERCHANT);
  const readyTotal = r.body.total;
  if (readyTotal < activeTotal) {
    ok(`status=ready (${readyTotal}) is subset of status=active (${activeTotal})`);
  } else bad('subset check', { activeTotal, readyTotal });

  // ─── status=invalid should be empty (no match) ────────
  r = await req('GET', '/api/merchant/orders?status=invalid_status&limit=10', null, MERCHANT);
  if (r.body.total === 0 && r.body.data.length === 0) {
    ok('status=invalid returns 0 rows');
  } else bad('invalid status', r);

  // ─── Auth required ────────────────────────────────────
  r = await req('GET', '/api/merchant/orders/stats');
  r.status === 401 ? ok('stats requires auth') : bad('stats auth', 401);

  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
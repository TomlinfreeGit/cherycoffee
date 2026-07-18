// filepath: coffee-app/server/test-auto-cancel.js
// Integration tests for auto-cancel-unpaid-orders.
//
// Assumes the server is already running at http://localhost:3000 and
// the merchant token "merchant-local-token" is accepted (dev mode).
//
// Coverage:
//   - /api/settings GET exposes the two new keys
//   - PATCH /api/merchant/settings validates integer + range
//   - autoCancel.__test.tick() cancels an old pending order and leaves new ones
//   - Idempotency: a second tick changes nothing
//   - Merchant PATCH cancelled writes cancel_reason='merchant' + cancelled_at
//   - Re-running the migration module does not throw

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
const bad = (m, exp) => { console.log(`  ✗ ${m} (got ${JSON.stringify(exp)})`); fail++; };

async function run() {
  console.log('\n=== Auto-cancel: Settings API ===\n');

  let r = await req('GET', '/api/settings');
  r.status === 200 ? ok('GET /api/settings returns 200') : bad('GET /api/settings', r.status);
  if (r.body && r.body.data) {
    typeof r.body.data.order_auto_cancel_seconds === 'number'
      ? ok('GET /api/settings includes order_auto_cancel_seconds')
      : bad('order_auto_cancel_seconds in /api/settings', r.body.data);
    typeof r.body.data.auto_cancel_scan_interval_seconds === 'number'
      ? ok('GET /api/settings includes auto_cancel_scan_interval_seconds')
      : bad('auto_cancel_scan_interval_seconds in /api/settings', r.body.data);
  }

  r = await req('PATCH', '/api/merchant/settings', {
    order_auto_cancel_seconds: 1800,
    auto_cancel_scan_interval_seconds: 120
  }, MERCHANT);
  r.status === 200 ? ok('PATCH valid integer values → 200') : bad('PATCH valid', r.status);

  r = await req('PATCH', '/api/merchant/settings', { order_auto_cancel_seconds: 1800.5 }, MERCHANT);
  r.status === 400 ? ok('PATCH float rejected → 400') : bad('PATCH float', r.status);

  r = await req('PATCH', '/api/merchant/settings', { auto_cancel_scan_interval_seconds: 5 }, MERCHANT);
  r.status === 400 ? ok('PATCH out-of-range scan interval (low) → 400') : bad('PATCH low scan', r.status);

  r = await req('PATCH', '/api/merchant/settings', { auto_cancel_scan_interval_seconds: 9999 }, MERCHANT);
  r.status === 400 ? ok('PATCH out-of-range scan interval (high) → 400') : bad('PATCH high scan', r.status);

  r = await req('PATCH', '/api/merchant/settings', { order_auto_cancel_seconds: 5 }, MERCHANT);
  r.status === 400 ? ok('PATCH out-of-range cancel threshold (low) → 400') : bad('PATCH low cancel', r.status);

  r = await req('PATCH', '/api/merchant/settings', { random_garbage_key: 'foo' }, MERCHANT);
  r.status === 400 ? ok('PATCH unknown key → 400') : bad('PATCH unknown', r.status);

  r = await req('PATCH', '/api/merchant/settings', { order_auto_cancel_seconds: 1800 });
  r.status === 401 ? ok('PATCH without auth → 401') : bad('PATCH no-auth', r.status);

  console.log('\n=== Auto-cancel: SQL tick behavior ===\n');

  // Reset to safe defaults for the integration test
  await req('PATCH', '/api/merchant/settings', {
    order_auto_cancel_seconds: 3600,
    auto_cancel_scan_interval_seconds: 60
  }, MERCHANT);

  // Insert two pending orders: one 2h old (over threshold), one 5 min old (under threshold).
  // Use a 5-minute safety margin to avoid timezone-boundary flakes (UTC vs localtime).
  // Important: SQLite stores ISO strings in UTC when inserted via raw values, but the
  // auto-cancel comparison uses datetime('now', '-X seconds', 'localtime') — so we
  // convert to localtime on insert too, to keep both sides in the same reference frame.
  const { db } = require('./src/db');
  function toLocalSql(d) {
    // d is JS Date. SQLite 'localtime' is the system local TZ. We compute the offset
    // and shift the UTC ISO to local-time equivalent.
    const offsetMs = d.getTimezoneOffset() * 60 * 1000; // getTimezoneOffset returns minutes EAST of UTC inverted
    return new Date(d.getTime() - offsetMs).toISOString().replace('T', ' ').slice(0, 19);
  }
  const TWO_HOURS_AGO = toLocalSql(new Date(Date.now() - 2 * 3600 * 1000));
  const FIVE_MIN_AGO = toLocalSql(new Date(Date.now() - 5 * 60 * 1000));

  db.prepare(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE pickup_number LIKE 'TEST-AC-%')`).run();
  db.prepare(`DELETE FROM orders WHERE pickup_number LIKE 'TEST-AC-%'`).run();

  db.prepare(`
    INSERT INTO orders (pickup_number, status, total_amount, customer_name, customer_phone, created_at, updated_at)
    VALUES ('TEST-AC-OLD', 'pending', 10.0, 'tester', '13800000001', ?, ?)
  `).run(TWO_HOURS_AGO, TWO_HOURS_AGO);
  db.prepare(`
    INSERT INTO orders (pickup_number, status, total_amount, customer_name, customer_phone, created_at, updated_at)
    VALUES ('TEST-AC-NEW', 'pending', 10.0, 'tester', '13800000002', ?, ?)
  `).run(FIVE_MIN_AGO, FIVE_MIN_AGO);

  const oldId = db.prepare(`SELECT id FROM orders WHERE pickup_number = 'TEST-AC-OLD'`).get().id;
  const newId = db.prepare(`SELECT id FROM orders WHERE pickup_number = 'TEST-AC-NEW'`).get().id;

  const autoCancel = require('./src/services/autoCancel');
  autoCancel.__test.tick();

  const oldOrder = db.prepare(`SELECT status, cancel_reason, cancelled_at FROM orders WHERE id = ?`).get(oldId);
  const newOrder = db.prepare(`SELECT status, cancel_reason, cancelled_at FROM orders WHERE id = ?`).get(newId);

  oldOrder && oldOrder.status === 'cancelled' && oldOrder.cancel_reason === 'auto_timeout' && oldOrder.cancelled_at
    ? ok('2-hour-old pending order cancelled with auto_timeout')
    : bad('old order', oldOrder);
  newOrder && newOrder.status === 'pending' && newOrder.cancel_reason === null
    ? ok('5-min-old pending order left untouched (under threshold)')
    : bad('new order', newOrder);

  const cancelledBefore = oldOrder.cancelled_at;
  autoCancel.__test.tick();
  const oldOrder2 = db.prepare(`SELECT status, cancelled_at FROM orders WHERE id = ?`).get(oldId);
  oldOrder2 && oldOrder2.status === 'cancelled' && oldOrder2.cancelled_at === cancelledBefore
    ? ok('second tick is idempotent (no further changes)')
    : bad('idempotency', oldOrder2);

  console.log('\n=== Auto-cancel: PATCH status writes cancel metadata ===\n');

  r = await req('PATCH', `/api/merchant/orders/${newId}/status`, { status: 'cancelled' }, MERCHANT);
  r.status === 200 ? ok('merchant PATCH cancelled → 200') : bad('merchant PATCH cancelled', r.status);
  const cancelledByMerchant = db.prepare(`SELECT status, cancel_reason, cancelled_at FROM orders WHERE id = ?`).get(newId);
  cancelledByMerchant && cancelledByMerchant.status === 'cancelled' && cancelledByMerchant.cancel_reason === 'merchant' && cancelledByMerchant.cancelled_at
    ? ok('merchant PATCH writes cancel_reason=merchant + cancelled_at')
    : bad('merchant cancel metadata', cancelledByMerchant);

  console.log('\n=== Auto-cancel: Migration idempotency ===\n');

  // Re-importing db/index.js should NOT throw and should NOT duplicate columns.
  delete require.cache[require.resolve('./src/db')];
  let migrationOk = true;
  try {
    require('./src/db');
  } catch (e) {
    migrationOk = false;
    console.log('  migration re-import error:', e.message);
  }
  const cols = require('./src/db').db.prepare(`PRAGMA table_info(orders)`).all();
  const cnt = (name) => cols.filter((c) => c.name === name).length;
  migrationOk && cnt('cancel_reason') === 1 && cnt('cancelled_at') === 1
    ? ok('re-running migration is idempotent (cancel_reason & cancelled_at exactly once)')
    : bad('migration idempotency', { cancel_reason: cnt('cancel_reason'), cancelled_at: cnt('cancelled_at') });

  // Cleanup
  db.prepare(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE pickup_number LIKE 'TEST-AC-%')`).run();
  db.prepare(`DELETE FROM orders WHERE pickup_number LIKE 'TEST-AC-%'`).run();
  ok('cleaned up test orders');

  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error('Test runner crashed:', e);
  process.exit(1);
});
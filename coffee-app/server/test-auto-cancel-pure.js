// filepath: coffee-app/server/test-auto-cancel-pure.js
// Pure-function tests for auto-cancel helpers, runnable in isolation
// (no live server, no real DB).
//
// This is intentionally a separate file from test-auto-cancel.js so the
// require-cache trick used here to stub the DB does NOT leak into the
// SQL/integration tests in the sibling file.

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
const bad = (m, exp) => { console.log(`  ✗ ${m} (got ${JSON.stringify(exp)})`); fail++; };

console.log('\n=== Auto-cancel: Pure-function tests (settings clamp) ===\n');

// Stub the db module BEFORE requiring services/level, because the latter
// captures `db` at require time.
const settingOverrides = {};
const stubDb = {
  prepare: (sql) => {
    if (/SELECT value FROM settings WHERE key = \?/.test(sql)) {
      return {
        get: (key) => (key in settingOverrides ? { value: String(settingOverrides[key]) } : undefined)
      };
    }
    return { get: () => undefined, all: () => [], run: () => ({ changes: 0 }) };
  }
};
require.cache[require.resolve('./src/db')] = {
  exports: { db: stubDb }
};

// Force a fresh load (the test runner may have cached the real db already).
delete require.cache[require.resolve('./src/services/level')];
const {
  getAutoCancelSeconds,
  getAutoCancelScanIntervalSeconds
} = require('./src/services/level');

// (a) Defaults when missing
delete settingOverrides.order_auto_cancel_seconds;
delete settingOverrides.auto_cancel_scan_interval_seconds;
getAutoCancelSeconds() === 3600 ? ok('default cancel threshold = 3600') : bad('default cancel threshold', getAutoCancelSeconds());
getAutoCancelScanIntervalSeconds() === 60 ? ok('default scan interval = 60') : bad('default scan interval', getAutoCancelScanIntervalSeconds());

// (b) When value is set, it should be returned
settingOverrides.order_auto_cancel_seconds = 1800;
settingOverrides.auto_cancel_scan_interval_seconds = 120;
getAutoCancelSeconds() === 1800 ? ok('cancel threshold returns 1800 when set') : bad('cancel threshold', getAutoCancelSeconds());
getAutoCancelScanIntervalSeconds() === 120 ? ok('scan interval returns 120 when set') : bad('scan interval', getAutoCancelScanIntervalSeconds());

// (c) Clamp lower bound
settingOverrides.auto_cancel_scan_interval_seconds = 5;
getAutoCancelScanIntervalSeconds() === 10 ? ok('scan interval < 10 clamped to 10') : bad('scan interval low clamp', getAutoCancelScanIntervalSeconds());

// (d) Clamp upper bound
settingOverrides.auto_cancel_scan_interval_seconds = 9999;
getAutoCancelScanIntervalSeconds() === 3600 ? ok('scan interval > 3600 clamped to 3600') : bad('scan interval high clamp', getAutoCancelScanIntervalSeconds());

// (e) Invalid value falls back to default
settingOverrides.auto_cancel_scan_interval_seconds = 'not-a-number';
getAutoCancelScanIntervalSeconds() === 60 ? ok('invalid scan interval falls back to default 60') : bad('invalid fallback', getAutoCancelScanIntervalSeconds());

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===\n`);
process.exit(fail > 0 ? 1 : 0);
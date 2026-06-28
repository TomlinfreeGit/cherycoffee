// filepath: coffee-app/server/test-fallback.js
// Direct unit test of the network-error fallback path.
// Bypasses the real WeChat API by monkey-patching the wechat service.

// Force real WeChat mode so the network-error fallback path is exercised,
// even if the shell has USE_REAL_WECHAT_AUTH=false set as an override.
process.env.USE_REAL_WECHAT_AUTH = 'true';

const path = require('node:path');
process.chdir(__dirname);
require('dotenv').config({ override: true });

// Override fetch BEFORE requiring the auth module so the override is in effect.
const realFetch = global.fetch;
global.fetch = async () => {
  const err = new TypeError('fetch failed');
  err.cause = { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND api.weixin.qq.com' };
  throw err;
};

(async () => {
  try {
    const { createSession, getAuthConfig, resolveOpenid } = require('./src/middleware/auth');

    let pass = 0, fail = 0;
    const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
    const bad = (m, exp) => { console.log(`  ✗ ${m} (expected ${JSON.stringify(exp)})`); fail++; };

    console.log('\n=== Network Fallback (unit) ===\n');

    // 1. resolveOpenid should fall back to mock when fetch fails
    const r1 = await resolveOpenid('test-fallback-code');
    r1.isMock && r1.fellBack && r1.openid && r1.openid.startsWith('mock_openid_')
      ? ok(`resolveOpenid falls back to mock (openid=${r1.openid.slice(0, 32)}...)`)
      : bad('fallback to mock', r1);

    // 2. createSession should also succeed (use the fallback openid)
    const session = await createSession('test-fallback-code-2');
    session.token && session.openid && session.openid.startsWith('mock_openid_')
      ? ok(`createSession returns session with mock openid (token=${session.token.slice(0, 16)}...)`)
      : bad('createSession with fallback', session);

    // 3. Same code → same mock openid (deterministic)
    const r3a = await resolveOpenid('deterministic-code');
    const r3b = await resolveOpenid('deterministic-code');
    r3a.openid === r3b.openid
      ? ok('Fallback is deterministic: same code → same mock openid')
      : bad('deterministic fallback', r3a.openid);

    // 4. Config reports fallback was triggered
    const cfg = getAuthConfig();
    cfg.fallbackCount >= 3 && cfg.lastFallbackAt && cfg.lastFallbackReason
      ? ok(`Config reports fallback: count=${cfg.fallbackCount}, last=${cfg.lastFallbackAt}`)
      : bad('config fallback tracking', cfg);

    console.log(`\nResults: ${pass} passed, ${fail} failed`);
    process.exit(fail > 0 ? 1 : 0);
  } finally {
    // Restore fetch AFTER all async work completes
    global.fetch = realFetch;
  }
})().catch((e) => { console.error(e); process.exit(1); });

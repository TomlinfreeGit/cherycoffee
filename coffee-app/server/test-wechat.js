// filepath: coffee-app/server/test-wechat.js
// Tests for WeChat auth configuration & real-mode behavior
const http = require('http');

const BASE = 'http://localhost:3000';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
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
  console.log('\n=== Auth Config Endpoint ===\n');

  // 1. /api/sessions/config should return auth mode info
  let r = await req('GET', '/api/sessions/config');
  if (r.status === 200 && r.body.data && typeof r.body.data.useRealWechat === 'boolean') {
    ok(`Config endpoint reports useRealWechat=${r.body.data.useRealWechat}`);
  } else bad('config endpoint', 200);

  // 2. Config must NOT leak the actual secret value
  // (Field names like 'secretConfigured' are OK; we just shouldn't see real secret strings)
  const configStr = JSON.stringify(r.body);
  const hasActualSecret = /wx[a-f0-9]{16}/i.test(configStr) ||
                          /secret['"]\s*:\s*['"][a-zA-Z0-9_-]{20,}/.test(configStr);
  !hasActualSecret
    ? ok('Config does NOT leak actual secret value')
    : bad('config leak', 'no secret value');

  console.log('\n=== Login Validation ===\n');

  // 3. POST without code → 400
  r = await req('POST', '/api/sessions', {});
  r.status === 400 && r.body.error.includes('Missing code')
    ? ok('Missing code rejected (400)')
    : bad('missing code', 400);

  // 4. POST with code → either 200 (mock/fallback) or 400 with wechatCode (real+invalid)
  r = await req('POST', '/api/sessions', { code: 'test-code-12345' });
  const inRealMode = r.body && r.body.wechatCode;
  if (r.status === 200 && r.body.data && r.body.data.token && r.body.data.openid) {
    ok(`Login returns token + openid=${r.body.data.openid.slice(0, 24)}... (mock/fallback mode)`);
  } else if (inRealMode && r.body.wechatCode === 40029) {
    ok('Login rejects invalid code with wechatCode=40029 (real mode)');
  } else {
    bad('login with code', 200);
  }

  console.log('\n=== Mock Mode Behavior ===\n');

  // 5. In mock/fallback mode, same code → same openid (deterministic).
  //    In real mode, codes are single-use and fail; skip this check.
  if (!inRealMode) {
    const code = 'mock-test-' + Date.now();
    r = await req('POST', '/api/sessions', { code });
    const openid1 = r.body.data.openid;
    r = await req('POST', '/api/sessions', { code });
    const openid2 = r.body.data.openid;
    openid1 === openid2
      ? ok(`Mock mode: same code → same openid (${openid1.slice(0, 24)}...)`)
      : bad('mock deterministic', openid1);
  } else {
    ok('Mock determinism check skipped (real WeChat mode)');
  }

  console.log('\n=== Network Fallback ===\n');

  // 6. Config endpoint exposes fallback status
  r = await req('GET', '/api/sessions/config');
  if (r.status === 200 && typeof r.body.data.fallbackEnabled === 'boolean') {
    ok(`Config exposes fallbackEnabled=${r.body.data.fallbackEnabled}, fallbackCount=${r.body.data.fallbackCount}`);
  } else {
    bad('config fallback fields', 'present');
  }

  // 7. Empty code handled gracefully
  r = await req('POST', '/api/sessions', { code: '' });
  r.status === 400 || r.status === 200
    ? ok(`Empty code handled gracefully (status=${r.status})`)
    : bad('empty code', 'handled');

  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });

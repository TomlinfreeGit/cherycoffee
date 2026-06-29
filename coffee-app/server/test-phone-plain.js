// filepath: coffee-app/server/test-phone-plain.js
// Tests for the new /api/users/phone-plain endpoint (manual phone entry).

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

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
const bad = (m, exp) => { console.log(`  ✗ ${m} (expected ${JSON.stringify(exp)})`); fail++; };

async function run() {
  console.log('\n=== Manual Phone Entry ===\n');

  // 1. Need auth
  let r = await req('POST', '/api/users/phone-plain', { phone: '13800138000' });
  r.status === 401 ? ok('Without token → 401') : bad('no token', 401);

  // 2. Login (mock mode)
  r = await req('POST', '/api/sessions', { code: 'phone-plain-test-' + Date.now() });
  if (r.status !== 200) { bad('login', 200); return; }
  const token = r.body.data.token;
  const openid = r.body.data.openid;
  ok(`Login (openid=${openid.slice(0, 24)}...)`);

  // 3. Missing phone
  r = await req('POST', '/api/users/phone-plain', {}, token);
  r.status === 400 ? ok('Missing phone → 400') : bad('missing phone', 400);

  // 4. Invalid phone format
  r = await req('POST', '/api/users/phone-plain', { phone: '12345' }, token);
  r.status === 400 ? ok('Invalid phone → 400') : bad('invalid phone', 400);

  // 5. Valid phone
  r = await req('POST', '/api/users/phone-plain', { phone: '13800138000' }, token);
  if (r.status === 200 && r.body.data.has_phone && r.body.data.phone_masked === '138****8000') {
    ok('Valid phone → 200 with masked 138****8000');
  } else bad('valid phone', r);

  // 6. GET /me reflects the phone
  r = await req('GET', '/api/users/me', null, token);
  r.body.data.has_phone === true && r.body.data.phone_masked === '138****8000'
    ? ok('GET /me shows the saved phone')
    : bad('GET /me after save', r);

  // 7. Update to a different phone
  r = await req('POST', '/api/users/phone-plain', { phone: '13911112222' }, token);
  r.status === 200 && r.body.data.phone_masked === '139****2222'
    ? ok('Update phone → 139****2222')
    : bad('update phone', r);

  // 8. Unbind via DELETE
  r = await req('DELETE', '/api/users/me/phone', null, token);
  r.status === 204 ? ok('DELETE /me/phone → 204') : bad('unbind', 204);

  r = await req('GET', '/api/users/me', null, token);
  r.body.data.has_phone === false
    ? ok('After unbind, has_phone=false')
    : bad('after unbind', r);

  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });

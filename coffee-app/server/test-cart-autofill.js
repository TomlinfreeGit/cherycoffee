// filepath: coffee-app/server/test-cart-autofill.js
// Tests for the new behavior that lets the cart auto-fill the user's real
// nickname + phone number via GET /api/users/me?include=phone.

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
  console.log('\n=== Cart Auto-Fill (include=phone) ===\n');

  // 1. Need auth
  let r = await req('GET', '/api/users/me?include=phone');
  r.status === 401 ? ok('No token → 401') : bad('no token', 401);

  // 2. Login
  r = await req('POST', '/api/sessions', { code: 'cart-autofill-' + Date.now() });
  if (r.status !== 200) { bad('login', 200); return; }
  const token = r.body.data.token;
  ok('Login');

  // 3. Without ?include=phone, no real phone is returned
  r = await req('GET', '/api/users/me', null, token);
  r.status === 200 && r.body.data.phone === undefined && r.body.data.phone_masked === null
    ? ok('Default: no real `phone`, no `phone_masked` for new user')
    : bad('default no phone', r);

  // 4. Even with ?include=phone on a user with no phone, real `phone` is null
  r = await req('GET', '/api/users/me?include=phone', null, token);
  r.status === 200 && r.body.data.phone === null
    ? ok('include=phone on user with no phone → phone=null')
    : bad('include with no phone', r);

  // 5. Set nickname + phone
  await req('PATCH', '/api/users/me', { nickname: '小李' }, token);
  await req('POST', '/api/users/phone-plain', { phone: '13800138000' }, token);

  // 6. Default: still no real phone (privacy default)
  r = await req('GET', '/api/users/me', null, token);
  r.status === 200 && r.body.data.phone === undefined && r.body.data.phone_masked === '138****8000'
    ? ok('Default: masked only, no raw `phone` (privacy default)')
    : bad('default masked', r);

  // 7. With ?include=phone: real phone is returned
  r = await req('GET', '/api/users/me?include=phone', null, token);
  r.status === 200 && r.body.data.phone === '13800138000' && r.body.data.phone_masked === '138****8000' && r.body.data.nickname === '小李'
    ? ok('include=phone: real phone 13800138000 + nickname 小李 + masked 138****8000')
    : bad('include=phone', r);

  // 8. ?include=other (e.g. avatar) doesn't leak phone
  r = await req('GET', '/api/users/me?include=avatar', null, token);
  r.body.data.phone === undefined
    ? ok('include=avatar does NOT leak phone')
    : bad('include=avatar', r);

  // 9. ?include= (empty) is a no-op
  r = await req('GET', '/api/users/me?include=', null, token);
  r.body.data.phone === undefined
    ? ok('include= (empty) is no-op')
    : bad('empty include', r);

  // 10. Comma-separated: include=avatar,phone
  r = await req('GET', '/api/users/me?include=avatar,phone', null, token);
  r.body.data.phone === '13800138000'
    ? ok('include=avatar,phone works')
    : bad('multi include', r);

  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });

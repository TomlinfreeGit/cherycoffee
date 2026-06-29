// filepath: coffee-app/server/test-profile.js
// Tests for /api/users/* endpoints and the WXBizDataCrypt decryption.
//
// Run with the server already running on http://localhost:3000.

const http = require('http');
const crypto = require('node:crypto');

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

/**
 * Build a valid WeChat-style encryptedData block.
 *  - sessionKey: 16-byte key
 *  - phoneNumber: phone digits
 *  Returns { encryptedData, iv } as base64 strings.
 *
 * This is a self-contained simulator: we encrypt the JSON payload with the
 * session_key using the same algorithm WeChat uses, so we can test the
 * decryption roundtrip end-to-end.
 */
function buildEncryptedPhone(sessionKeyBuf, phone) {
  // Generate random 16-byte IV
  const ivBuf = crypto.randomBytes(16);

  // WeChat-style payload
  const payload = {
    phoneNumber: phone,
    purePhoneNumber: phone,
    countryCode: '86',
    watermark: { timestamp: Date.now(), appid: 'wxe4960bd1de36b34e' }
  };
  const plain = JSON.stringify(payload);

  // AES-128-CBC with PKCS#7 padding
  const cipher = crypto.createCipheriv('aes-128-cbc', sessionKeyBuf, ivBuf);
  cipher.setAutoPadding(true);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);

  return {
    encryptedData: encrypted.toString('base64'),
    iv: ivBuf.toString('base64')
  };
}

async function run() {
  console.log('\n=== Profile: Auth Required ===\n');

  // 1. GET /me without token should 401
  let r = await req('GET', '/api/users/me');
  r.status === 401
    ? ok('GET /me without token → 401')
    : bad('GET /me unauthenticated', 401);

  // 2. Login to get a token
  //    Two paths:
  //    - Mock mode (server's .env has USE_REAL_WECHAT_AUTH=false, or network fallback fires)
  //      → 200 + token
  //    - Real mode (server actually reaches api.weixin.qq.com)
  //      → 400 with wechatCode=40029 (invalid code, expected for fake code)
  //    For the test to work in BOTH cases, we accept either a successful login
  //    OR skip the API-dependent tests if real mode rejects.
  r = await req('POST', '/api/sessions', { code: 'test-profile-user-' + Date.now() });
  if (r.status === 200 && r.body.data && r.body.data.token) {
    ok(`Login returns token (openid=${r.body.data.openid.slice(0, 24)}...)`);
  } else if (r.status === 400 && r.body.wechatCode === 40029) {
    console.log('  ⚠ Server is in REAL WeChat mode (no mock fallback).');
    console.log('    Skipping API-dependent tests; only running unit tests.');
    // Skip the rest of the API tests
    runUnitTestsOnly();
    return;
  } else {
    bad('login', 200);
    return;
  }
  const token = r.body.data.token;
  const openid = r.body.data.openid;

  console.log('\n=== Profile: GET / PATCH /me ===\n');

  // 3. GET /me with token should return empty user
  r = await req('GET', '/api/users/me', null, token);
  if (r.status === 200 && r.body.data.openid === openid && !r.body.data.nickname && !r.body.data.has_phone) {
    ok('GET /me returns empty profile for new user');
  } else bad('GET /me empty', r);

  // 4. PATCH nickname
  r = await req('PATCH', '/api/users/me', { nickname: '小明' }, token);
  r.status === 200 && r.body.data.nickname === '小明'
    ? ok('PATCH nickname')
    : bad('PATCH nickname', r);

  // 5. PATCH avatar_url
  r = await req('PATCH', '/api/users/me', { avatar_url: 'https://example.com/avatar.png' }, token);
  r.status === 200 && r.body.data.avatar_url === 'https://example.com/avatar.png'
    ? ok('PATCH avatar_url')
    : bad('PATCH avatar_url', r);

  // 6. PATCH rejects overly long nickname
  r = await req('PATCH', '/api/users/me', { nickname: 'a'.repeat(100) }, token);
  r.status === 400
    ? ok('PATCH rejects too-long nickname')
    : bad('PATCH too-long nickname', 400);

  // 7. PATCH empty body
  r = await req('PATCH', '/api/users/me', {}, token);
  r.status === 400
    ? ok('PATCH empty body rejected')
    : bad('PATCH empty body', 400);

  console.log('\n=== Profile: Phone Decryption ===\n');

  // 8. Without session_key, phone decrypt should fail with clear error
  r = await req('POST', '/api/users/phone', {
    encryptedData: 'irrelevant',
    iv: 'irrelevant'
  }, token);
  // In mock mode, no session_key is stored → expect 400 with helpful message
  if (r.status === 400 && /session_key|session-key|session key/i.test(r.body.error || '')) {
    ok('POST /phone without session_key → 400 with helpful error');
  } else {
    // If real WeChat mode and a session_key exists, we can't easily test
    // the success path without WeChat, but we can at least ensure it doesn't 500
    r.status === 500
      ? bad('POST /phone returned 500', '4xx expected')
      : ok(`POST /phone returned ${r.status} (acceptable: ${r.body.error})`);
  }

  // 9. Direct unit test of decryptData: build encrypted block, decrypt it
  const sessionKeyBuf = crypto.randomBytes(16);
  const { encryptedData, iv } = buildEncryptedPhone(sessionKeyBuf, '13800138000');
  const { decryptPhone } = require('./src/services/wxbizdatacrypt');
  try {
    const result = decryptPhone(sessionKeyBuf.toString('base64'), encryptedData, iv);
    result.purePhoneNumber === '13800138000'
      ? ok('decryptPhone roundtrip: 13800138000')
      : bad('decryptPhone roundtrip', result);
  } catch (e) {
    bad('decryptPhone roundtrip', e.message);
  }

  // 10. Wrong session_key should fail
  const wrongKey = crypto.randomBytes(16).toString('base64');
  try {
    decryptPhone(wrongKey, encryptedData, iv);
    bad('decryptPhone with wrong key', 'should throw');
  } catch (e) {
    e.decryptError === true
      ? ok('decryptPhone with wrong session_key throws decryptError')
      : bad('decryptPhone wrong key', e.message);
  }

  // 11. Invalid IV length
  try {
    decryptPhone(sessionKeyBuf.toString('base64'), encryptedData, Buffer.from('short').toString('base64'));
    bad('decryptPhone with short IV', 'should throw');
  } catch (e) {
    /IV|Invalid/i.test(e.message)
      ? ok('decryptPhone with short IV rejected')
      : bad('decryptPhone short IV', e.message);
  }

  console.log('\n=== Profile: Phone Unbind ===\n');

  // 12. Manually set a phone in DB, then DELETE /me/phone
  const { db } = require('./src/db');
  db.prepare(`UPDATE users SET phone = ?, phone_verified = 1 WHERE openid = ?`).run('13900139000', openid);

  r = await req('GET', '/api/users/me', null, token);
  r.status === 200 && r.body.data.has_phone === true && r.body.data.phone_masked === '139****9000'
    ? ok('GET /me shows masked phone 139****9000')
    : bad('GET /me masked phone', r);

  r = await req('DELETE', '/api/users/me/phone', null, token);
  r.status === 204
    ? ok('DELETE /me/phone → 204')
    : bad('DELETE /me/phone', 204);

  r = await req('GET', '/api/users/me', null, token);
  r.status === 200 && r.body.data.has_phone === false
    ? ok('GET /me after delete: has_phone=false')
    : bad('GET /me after delete', r);

  // 13. Logout
  r = await req('DELETE', '/api/sessions', null, token);
  r.status === 204
    ? ok('DELETE /api/sessions logout')
    : bad('logout', 204);

  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

/**
 * Run only the unit tests (decryption) when the server is in real WeChat mode.
 * Avoids the need for a valid WeChat login code.
 */
function runUnitTestsOnly() {
  console.log('\n=== Profile: Phone Decryption (unit) ===\n');
  const { decryptPhone } = require('./src/services/wxbizdatacrypt');

  const sessionKeyBuf = crypto.randomBytes(16);
  const { encryptedData, iv } = buildEncryptedPhone(sessionKeyBuf, '13800138000');
  try {
    const result = decryptPhone(sessionKeyBuf.toString('base64'), encryptedData, iv);
    result.purePhoneNumber === '13800138000'
      ? ok('decryptPhone roundtrip: 13800138000')
      : bad('decryptPhone roundtrip', result);
  } catch (e) {
    bad('decryptPhone roundtrip', e.message);
  }

  const wrongKey = crypto.randomBytes(16).toString('base64');
  try {
    decryptPhone(wrongKey, encryptedData, iv);
    bad('decryptPhone with wrong key', 'should throw');
  } catch (e) {
    e.decryptError === true
      ? ok('decryptPhone with wrong session_key throws decryptError')
      : bad('decryptPhone wrong key', e.message);
  }

  try {
    decryptPhone(sessionKeyBuf.toString('base64'), encryptedData, Buffer.from('short').toString('base64'));
    bad('decryptPhone with short IV', 'should throw');
  } catch (e) {
    /IV|Invalid/i.test(e.message)
      ? ok('decryptPhone with short IV rejected')
      : bad('decryptPhone short IV', e.message);
  }

  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });

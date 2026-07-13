// filepath: coffee-app/server/test-temperature.js
// End-to-end test for the hot/cold temperature option feature.
// Tests:
//   1. Create a product with support_temperature=1
//   2. Create a product with support_temperature=0 (default)
//   3. Order the temp-required product WITHOUT options → 400
//   4. Order the temp-required product WITH options.temperature='热' → 201
//   5. Order the temp-required product with options.temperature='常温' (not allowed) → 400
//   6. Order the plain product (no options) → 201, options=NULL
//   7. Order the plain product WITH options → 201, options=NULL (silently dropped)
//   8. Verify the saved order_items.options column matches

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
const bad = (m, exp) => { console.log(`  ✗ ${m} (expected ${JSON.stringify(exp)})`); fail++; };

async function run() {
  console.log('\n=== Temperature option: product setup ===\n');

  // Make sure we have a category to attach to
  const cats = (await req('GET', '/api/categories')).body.data;
  const cat = cats[0];
  if (!cat) { console.error('No categories seeded, aborting.'); process.exit(1); }

  // 1. Create a product that requires temperature
  let r = await req('POST', '/api/products', {
    name: '测试-温度必选',
    category: cat.name,
    price: 20,
    support_temperature: 1
  }, MERCHANT);
  let pidTemp;
  if (r.status === 201 && r.body.data.id && r.body.data.support_temperature === 1) {
    pidTemp = r.body.data.id;
    ok(`Create temp-required product: id=${pidTemp}, support_temperature=1`);
  } else { bad('create temp product', r); return; }

  // 2. Create a product that does NOT require temperature
  r = await req('POST', '/api/products', {
    name: '测试-无温度',
    category: cat.name,
    price: 15
  }, MERCHANT);
  let pidPlain;
  if (r.status === 201 && r.body.data.id && r.body.data.support_temperature === 0) {
    pidPlain = r.body.data.id;
    ok(`Create plain product: id=${pidPlain}, support_temperature=0 (default)`);
  } else { bad('create plain product', r); return; }

  console.log('\n=== Temperature option: order validation ===\n');

  // Login first to get an openid
  const loginRes = await req('POST', '/api/sessions', { code: 'mock-code-for-test' });
  if (loginRes.status !== 200 || !loginRes.body?.data?.token) {
    console.error('login failed', loginRes);
    process.exit(1);
  }
  const userToken = loginRes.body.data.token;

  // 3. Order temp-required product WITHOUT options → 400
  r = await req('POST', '/api/orders', {
    items: [{ product_id: pidTemp, quantity: 1 }],
    customer_name: '测试人',
    customer_phone: '13800000000'
  }, userToken);
  r.status === 400 && /温度/.test(r.body.error || '')
    ? ok('Order temp product without options → 400')
    : bad('temp product no options', r);

  // 4. Order temp-required product WITH '热' → 201
  r = await req('POST', '/api/orders', {
    items: [{ product_id: pidTemp, quantity: 1, options: { temperature: '热' } }],
    customer_name: '测试人',
    customer_phone: '13800000000'
  }, userToken);
  let hotOrderId;
  if (r.status === 201 && r.body.data.items?.[0]?.options === '热') {
    hotOrderId = r.body.data.id;
    ok('Order temp product with 热 → 201, options=热');
  } else { bad('temp product with 热', r); }

  // 5. Order temp-required product with disallowed temperature → 400
  r = await req('POST', '/api/orders', {
    items: [{ product_id: pidTemp, quantity: 1, options: { temperature: '常温' } }],
    customer_name: '测试人',
    customer_phone: '13800000000'
  }, userToken);
  r.status === 400 && /热\/冷/.test(r.body.error || '')
    ? ok('Order temp product with 常温 → 400')
    : bad('temp product invalid temperature', r);

  // 6. Order plain product (no options) → 201, options=NULL
  r = await req('POST', '/api/orders', {
    items: [{ product_id: pidPlain, quantity: 1 }],
    customer_name: '测试人',
    customer_phone: '13800000000'
  }, userToken);
  let plainOrderId;
  if (r.status === 201 && r.body.data.items?.[0]?.options === null) {
    plainOrderId = r.body.data.id;
    ok('Order plain product without options → 201, options=null');
  } else { bad('plain product no options', r); }

  // 7. Order plain product WITH options → 201, options=NULL (silently dropped)
  r = await req('POST', '/api/orders', {
    items: [{ product_id: pidPlain, quantity: 1, options: { temperature: '热' } }],
    customer_name: '测试人',
    customer_phone: '13800000000'
  }, userToken);
  if (r.status === 201 && r.body.data.items?.[0]?.options === null) {
    ok('Order plain product with options → 201, options dropped to null');
  } else { bad('plain product with options dropped', r); }

  console.log('\n=== Temperature option: order retrieval ===\n');

  // 8. Re-fetch the hot order and verify the options column is persisted
  if (hotOrderId) {
    r = await req('GET', `/api/orders/${hotOrderId}`, null, userToken);
    r.status === 200 && r.body.data.items?.[0]?.options === '热'
      ? ok('GET /api/orders/:id returns options=热')
      : bad('retrieve hot order options', r);
  }

  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });

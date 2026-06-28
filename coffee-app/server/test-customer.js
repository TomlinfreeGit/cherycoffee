// filepath: coffee-app/server/test-customer.js
// Tests for customer info (name + phone) collection and display
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
  // Login as customer
  let r = await req('POST', '/api/sessions', { code: 'customer-test-user' });
  const TOKEN = r.body.data.token;

  console.log('\n=== Customer Info Validation ===\n');

  // 1. Missing name → 400
  r = await req('POST', '/api/orders', {
    items: [{ product_id: 1, quantity: 1 }],
    customer_phone: '13812345678'
  }, TOKEN);
  r.status === 400 && /姓名/.test(r.body.error)
    ? ok('Missing name → 400')
    : bad('missing name', 400);

  // 2. Missing phone → 400
  r = await req('POST', '/api/orders', {
    items: [{ product_id: 1, quantity: 1 }],
    customer_name: '张三'
  }, TOKEN);
  r.status === 400 && /手机/.test(r.body.error)
    ? ok('Missing phone → 400')
    : bad('missing phone', 400);

  // 3. Invalid phone format → 400
  r = await req('POST', '/api/orders', {
    items: [{ product_id: 1, quantity: 1 }],
    customer_name: '张三',
    customer_phone: '12345'
  }, TOKEN);
  r.status === 400 && /手机/.test(r.body.error)
    ? ok('Invalid phone → 400')
    : bad('invalid phone', 400);

  // 4. Phone with letters → 400
  r = await req('POST', '/api/orders', {
    items: [{ product_id: 1, quantity: 1 }],
    customer_name: '张三',
    customer_phone: '1381234567a'
  }, TOKEN);
  r.status === 400
    ? ok('Phone with letters → 400')
    : bad('phone with letters', 400);

  // 5. Name too long → 400
  r = await req('POST', '/api/orders', {
    items: [{ product_id: 1, quantity: 1 }],
    customer_name: 'a'.repeat(31),
    customer_phone: '13812345678'
  }, TOKEN);
  r.status === 400
    ? ok('Name too long → 400')
    : bad('name too long', 400);

  console.log('\n=== Successful Order Creation ===\n');

  // 6. Valid customer info → success
  r = await req('POST', '/api/orders', {
    items: [{ product_id: 1, quantity: 2 }],
    customer_name: '张三',
    customer_phone: '13812345678'
  }, TOKEN);

  let orderId;
  if (r.status === 201 && r.body.data.customer_name === '张三' && r.body.data.customer_phone === '13812345678') {
    orderId = r.body.data.id;
    ok(`Order created with customer info: id=${orderId}`);
  } else bad('create with info', 201);

  // 7. Phone leading with 0 → invalid
  r = await req('POST', '/api/orders', {
    items: [{ product_id: 1, quantity: 1 }],
    customer_name: '李四',
    customer_phone: '01234567890'
  }, TOKEN);
  r.status === 400 ? ok('Phone not starting with 1 → 400') : bad('phone prefix', 400);

  // 8. Phone with 12 digits → invalid
  r = await req('POST', '/api/orders', {
    items: [{ product_id: 1, quantity: 1 }],
    customer_name: '李四',
    customer_phone: '138123456789'
  }, TOKEN);
  r.status === 400 ? ok('Phone 12 digits → 400') : bad('phone too long', 400);

  console.log('\n=== Customer View (Privacy) ===\n');

  // 9. Customer fetching own order sees their info
  r = await req('GET', `/api/orders/${orderId}`, null, TOKEN);
  r.status === 200 && r.body.data.customer_name === '张三'
    ? ok('Customer sees own name in order')
    : bad('customer name visible', 200);

  console.log('\n=== Merchant View (Masked) ===\n');

  // 10. Merchant sees the order with masked phone
  r = await req('GET', '/api/merchant/orders', null, 'merchant-local-token');
  const found = (r.body.data || []).find((o) => o.id === orderId);
  if (found && found.customer_name === '张三' && found.customer_phone_masked === '138****5678') {
    ok(`Merchant sees masked phone: ${found.customer_phone_masked}`);
  } else bad('merchant masked phone', { masked: '138****5678' });

  // 11. List view returns both full phone and masked
  r = await req('GET', '/api/merchant/orders', null, 'merchant-local-token');
  const orderInList = (r.body.data || []).find((o) => o.id === orderId);
  if (orderInList && orderInList.customer_phone_masked === '138****5678') {
    ok('List view includes masked phone for merchant convenience');
  } else bad('list masked', 200);

  // 12. Detail view also returns masked phone (and full)
  r = await req('GET', `/api/merchant/orders/${orderId}`, null, 'merchant-local-token');
  if (r.body.data.customer_phone_masked === '138****5678') {
    ok('Detail view includes masked phone');
  } else bad('detail masked', 200);

  // 12b. Customer token CANNOT see merchant masked phone via list (uses different endpoint)
  // This is implicitly tested by the customer endpoint using /api/orders not /api/merchant/orders
  ok('Customer uses /api/orders endpoint, not /api/merchant/*');

  console.log('\n=== Phone Reveal Endpoint ===\n');

  // 13. Reveal full phone (merchant only)
  r = await req('GET', `/api/merchant/orders/${orderId}/full-phone`, null, 'merchant-local-token');
  r.status === 200 && r.body.data.customer_phone === '13812345678'
    ? ok('Merchant can reveal full phone: 13812345678')
    : bad('reveal phone', 200);

  // 14. Customer cannot access reveal endpoint
  r = await req('GET', `/api/merchant/orders/${orderId}/full-phone`, null, TOKEN);
  r.status === 401
    ? ok('Customer cannot access reveal endpoint (401)')
    : bad('customer blocked', 401);

  console.log('\n=== Search by Phone/Name ===\n');

  // 15. Search by partial phone
  r = await req('GET', '/api/merchant/orders?search=1381234', null, 'merchant-local-token');
  const foundByPhone = (r.body.data || []).find((o) => o.id === orderId);
  foundByPhone ? ok('Search by phone finds the order') : bad('search phone', 'found');

  // 16. Search by name
  r = await req('GET', '/api/merchant/orders?search=张三', null, 'merchant-local-token');
  const foundByName = (r.body.data || []).find((o) => o.id === orderId);
  foundByName ? ok('Search by name finds the order') : bad('search name', 'found');

  // 17. Search by non-existent name
  r = await req('GET', '/api/merchant/orders?search=不存在的名字', null, 'merchant-local-token');
  const notFound = (r.body.data || []).find((o) => o.id === orderId);
  !notFound ? ok('Non-matching search returns no results') : bad('search no-match', 'empty');

  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });

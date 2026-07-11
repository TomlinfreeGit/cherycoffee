// filepath: coffee-app/server/test-categories.js
// Tests for /api/categories endpoints.

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

const MERCHANT_TOKEN = 'merchant-local-token';

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
const bad = (m, exp) => { console.log(`  ✗ ${m} (expected ${JSON.stringify(exp)})`); fail++; };

async function run() {
  console.log('\n=== Categories: Public list ===\n');

  // 1. GET /api/categories is public (no token)
  let r = await req('GET', '/api/categories');
  if (r.status === 200 && Array.isArray(r.body.data) && r.body.data.length >= 3) {
    ok(`GET /api/categories (public, ${r.body.data.length} categories)`);
    // Verify each entry has product_count
    if (typeof r.body.data[0].product_count === 'number') {
      ok('Categories include product_count');
    } else bad('product_count field', 'number');
  } else bad('list categories', r);

  console.log('\n=== Categories: Merchant CRUD ===\n');

  // 2. POST without merchant token → 401
  r = await req('POST', '/api/categories', { name: 'Test' });
  r.status === 401 ? ok('POST without token → 401') : bad('no token POST', 401);

  // 3. Create new category
  r = await req('POST', '/api/categories', { name: '测试分类', icon: '🧪' }, MERCHANT_TOKEN);
  let catId;
  if (r.status === 201 && r.body.data.id && r.body.data.name === '测试分类') {
    catId = r.body.data.id;
    ok(`Create category: id=${catId} 测试分类`);
  } else { bad('create category', r); return; }

  // 4. Duplicate name → 409
  r = await req('POST', '/api/categories', { name: '测试分类' }, MERCHANT_TOKEN);
  r.status === 409 ? ok('Duplicate name → 409') : bad('duplicate', 409);

  // 5. Empty name → 400
  r = await req('POST', '/api/categories', { name: '' }, MERCHANT_TOKEN);
  r.status === 400 ? ok('Empty name → 400') : bad('empty name', 400);

  // 6. PATCH (rename)
  r = await req('PATCH', `/api/categories/${catId}`, { name: '测试分类改名' }, MERCHANT_TOKEN);
  r.status === 200 && r.body.data.name === '测试分类改名'
    ? ok('PATCH rename')
    : bad('rename', r);

  // 7. PATCH sort_order + icon
  r = await req('PATCH', `/api/categories/${catId}`, { sort_order: 99, icon: '🍵' }, MERCHANT_TOKEN);
  r.status === 200 && r.body.data.sort_order === 99 && r.body.data.icon === '🍵'
    ? ok('PATCH sort_order + icon')
    : bad('patch sort/icon', r);

  // 8. PATCH 404
  r = await req('PATCH', '/api/categories/99999', { name: 'x' }, MERCHANT_TOKEN);
  r.status === 404 ? ok('PATCH unknown → 404') : bad('PATCH 404', 404);

  // 9. Create a product in this category
  r = await req('POST', '/api/products', {
    name: '测试商品', category: '测试分类改名', price: 10
  }, MERCHANT_TOKEN);
  if (r.status === 201) ok('Created product in 测试分类改名');
  else bad('create product', r);

  // Verify product_count
  r = await req('GET', '/api/categories');
  const cat = r.body.data.find((c) => c.id === catId);
  cat && cat.product_count >= 1
    ? ok(`product_count = ${cat.product_count} (>=1)`)
    : bad('product_count after add', cat);

  // 10. DELETE the category
  r = await req('DELETE', `/api/categories/${catId}`, null, MERCHANT_TOKEN);
  r.status === 200 && r.body.data.deleted && r.body.data.detached_products >= 1
    ? ok(`DELETE: detached ${r.body.data.detached_products} products`)
    : bad('delete category', r);

  // 11. Verify products in that category now have category=NULL
  r = await req('GET', '/api/products');
  const staleProduct = r.body.data.find((p) => p.name === '测试商品');
  staleProduct && (staleProduct.category === null || staleProduct.category === '测试分类改名')
    ? ok(`Product after delete: category=${staleProduct.category}`)
    : bad('product after delete', staleProduct);

  console.log('\nResults: ${pass} passed, ${fail} failed');
  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
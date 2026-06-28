// filepath: coffee-app/server/test-upload.js
// Test image upload endpoint
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3000';
const TOKEN = 'merchant-local-token';

// Create a tiny PNG (1x1 transparent pixel)
const tinyPng = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C489' +
  '0000000D49444154789C636000010000000500010D0A2DB40000000049454E44AE426082',
  'hex'
);

function uploadFile(path, filename, token) {
  return new Promise((resolve, reject) => {
    // Build multipart body
    const boundary = '----formboundary' + Date.now();
    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: image/png\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, tinyPng, footer]);

    const url = new URL(BASE + path);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
          Authorization: `Bearer ${token}`
        }
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(buf) });
          } catch {
            resolve({ status: res.statusCode, body: buf });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

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
  console.log('\n=== Upload Auth ===\n');

  // 1. Upload without auth → 401
  const noAuth = await uploadFile('/api/uploads', 'test.png', '');
  noAuth.status === 401
    ? ok('No auth → 401')
    : bad('no auth', 401);

  // 2. Upload with merchant token → 201
  const up = await uploadFile('/api/uploads', 'test-coffee.png', TOKEN);
  let uploadedUrl;
  if (up.status === 201 && up.body.data.url && up.body.data.url.startsWith('/uploads/')) {
    uploadedUrl = up.body.data.url;
    ok(`Upload successful: ${up.body.data.filename} (${up.body.data.size} bytes)`);
  } else bad('upload', 201);

  console.log('\n=== Static File Serving ===\n');

  // 3. Fetch the uploaded file
  if (uploadedUrl) {
    const fileUrl = BASE + uploadedUrl;
    await new Promise((resolve) => {
      http.get(fileUrl, (res) => {
        const len = parseInt(res.headers['content-length'], 10);
        if (res.statusCode === 200 && len > 0) {
          ok(`Static file served: ${fileUrl} (${len} bytes)`);
        } else {
          bad(`static serve (status=${res.statusCode}, len=${len})`, 200);
        }
        res.resume();
        res.on('end', resolve);
      }).on('error', (e) => { bad('static serve', 200); resolve(); });
    });
  }

  console.log('\n=== Link to Product ===\n');

  // 4. Create a product using uploaded image URL
  const createRes = await req('POST', '/api/products', {
    name: '测试商品-上传图',
    category: '意式咖啡',
    price: 99,
    image_url: uploadedUrl
  }, TOKEN);
  if (createRes.status === 201 && createRes.body.data.image_url === uploadedUrl) {
    ok(`Created product with uploaded image: id=${createRes.body.data.id}`);
    // Cleanup
    await req('DELETE', `/api/products/${createRes.body.data.id}`, null, TOKEN);
    console.log('  ℹ Cleaned up test product');
  } else bad('create with image', 201);

  console.log('\n=== Delete Upload ===\n');

  // 5. Delete the uploaded file
  if (uploadedUrl) {
    const filename = path.basename(uploadedUrl);
    const del = await req('DELETE', `/api/uploads/${filename}`, null, TOKEN);
    del.status === 204 ? ok(`Deleted upload: ${filename}`) : bad('delete upload', 204);

    // Verify file no longer accessible
    await new Promise((resolve) => {
      http.get(BASE + uploadedUrl, (res) => {
        console.log(`  DEBUG: after-delete status=${res.statusCode}`);
        if (res.statusCode === 404) {
          ok('Deleted file returns 404');
        } else {
          bad(`file after delete (status=${res.statusCode})`, 404);
        }
        res.resume();
        res.on('end', resolve);
      }).on('error', (e) => { bad(`file after delete (${e.message})`, 404); resolve(); });
    });
  }

  console.log('\n=== Security ===\n');

  // 6. Path traversal attempt
  const trav = await req('DELETE', '/api/uploads/..%2F..%2Fetc%2Fpasswd', null, TOKEN);
  trav.status === 400 || trav.status === 404
    ? ok(`Path traversal blocked (status=${trav.status})`)
    : bad('path traversal', 'blocked');

  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });

// filepath: coffee-app/server/test-settings-auto-refresh.js
// 验证 order_auto_refresh_ms 这个新 settings key 能被读写 + 默认值 + 范围校验
const { spawn } = require('node:child_process');
const server = spawn(process.execPath, ['src/index.js'], {
  cwd: __dirname,
  env: { ...process.env, PORT: '3002' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let logs = '';
server.stdout.on('data', (b) => { logs += b.toString(); });
server.stderr.on('data', (b) => { logs += b.toString(); });

const BASE = 'http://localhost:3002';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer merchant-local-token' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = text; }
  return { status: res.status, data };
}

async function main() {
  await sleep(800);

  // 先重置为默认值,避免之前测试残留 (30000) 影响"默认值"断言
  await req('PATCH', '/api/merchant/settings', { order_auto_refresh_ms: 10000 });

  // settings 表里值是字符串 ("10000"),断言用 Number() 兼容
  const expected = (v) => Number(v) === Number(v);
  const eqVal = (a, b) => Number(a) === Number(b);

  // 1) GET /api/merchant/settings 应带回默认值
  const initial = await req('GET', '/api/merchant/settings');
  console.log('GET initial:', initial.status, JSON.stringify(initial.data.data));
  if (!eqVal(initial.data.data.order_auto_refresh_ms, 10000)) {
    throw new Error(`默认值应为 10000, 实际 ${initial.data.data.order_auto_refresh_ms}`);
  }
  console.log('✓ 默认值 10000ms (10s)');

  // 2) PATCH 改为 30s
  const updated = await req('PATCH', '/api/merchant/settings', { order_auto_refresh_ms: 30000 });
  console.log('PATCH 30000:', updated.status);
  if (updated.status !== 200) throw new Error('更新失败');
  if (!eqVal(updated.data.data.order_auto_refresh_ms, 30000)) {
    throw new Error(`更新后值应为 30000, 实际 ${updated.data.data.order_auto_refresh_ms}`);
  }
  console.log('✓ 成功改为 30000ms (30s)');

  // 3) 验证持久化
  const reread = await req('GET', '/api/merchant/settings');
  if (!eqVal(reread.data.data.order_auto_refresh_ms, 30000)) {
    throw new Error('持久化失败');
  }
  console.log('✓ 持久化验证通过 (GET 重读仍是 30000)');

  // 4) 范围校验: 太小应拒
  const tooSmall = await req('PATCH', '/api/merchant/settings', { order_auto_refresh_ms: 1000 });
  console.log('PATCH 1000:', tooSmall.status, tooSmall.data.error);
  if (tooSmall.status !== 400) throw new Error('1000ms 应被拒绝');
  console.log('✓ 1000ms (1s) 被正确拒绝');

  // 5) 范围校验: 太大应拒
  const tooBig = await req('PATCH', '/api/merchant/settings', { order_auto_refresh_ms: 999999 });
  console.log('PATCH 999999:', tooBig.status, tooBig.data.error);
  if (tooBig.status !== 400) throw new Error('999999 应被拒绝');
  console.log('✓ 999999 (>10min) 被正确拒绝');

  // 6) 非白名单 key 拒
  const unknown = await req('PATCH', '/api/merchant/settings', { evil: 1 });
  console.log('PATCH evil:', unknown.status, unknown.data.error);
  if (unknown.status !== 400) throw new Error('陌生 key 应被拒绝');
  console.log('✓ 陌生 key 被正确拒绝');

  // 7) 恢复默认,避免污染开发库
  await req('PATCH', '/api/merchant/settings', { order_auto_refresh_ms: 10000 });

  console.log('\n--- 全部通过 ✅ ---');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAIL:', err.message);
    console.log(logs);
    process.exit(1);
  })
  .finally(() => {
    setTimeout(() => { try { server.kill('SIGTERM'); } catch (_) {} }, 200);
  });

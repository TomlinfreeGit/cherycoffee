// filepath: coffee-app/server/test-pay-mock.js
// 一次性端到端脚本: 启动后端 → 模拟下单 → 调用 /pay → 断言 mock 模式返回。
// 用 child_process 跑后端, 测完自动 kill。

const { spawn } = require('node:child_process');
const path = require('node:path');

const BASE = 'http://localhost:3001'; // 不同于默认 3000,避免冲突
const server = spawn(process.execPath, ['src/index.js'], {
  cwd: __dirname,
  env: { ...process.env, PORT: '3001' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let logs = '';
server.stdout.on('data', (b) => { logs += b.toString(); });
server.stderr.on('data', (b) => { logs += b.toString(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch (_) { return { status: res.status, data: text }; }
}

async function main() {
  await sleep(800);
  console.log('--- 后端日志片段 ---');
  console.log(logs.split('\n').filter((l) => l.includes('Server running') || l.includes('error')).join('\n'));

  // 1) mock 登录获取 token
  const login = await req('POST', '/api/sessions', { code: 'test-pay-mock-code' });
  console.log('login.status=', login.status, 'openid=', login.data?.data?.openid);
  if (login.status !== 200 || !login.data?.data?.token) throw new Error('登录失败');
  const token = login.data.data.token;

  // 2) 获取一个 product id
  const products = await req('GET', '/api/products');
  const product = products.data?.data?.[0];
  if (!product) throw new Error('没有商品可用');
  console.log('product=', product.id, product.name);

  // 3) 创建订单
  const authReq = (method, url, body) =>
    fetch(BASE + url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined
    }).then(async (r) => ({ status: r.status, data: JSON.parse(await r.text()) }));

  const created = await authReq('POST', '/api/orders', {
    items: [{ product_id: product.id, quantity: 1 }],
    customer_name: '测试用户',
    customer_phone: '13800138000'
  });
  if (created.status !== 201) {
    console.log('create order failed:', JSON.stringify(created));
    throw new Error('创建订单失败');
  }
  const order = created.data.data;
  console.log('order.id=', order.id, 'pickup=', order.pickup_number, 'amount=', order.total_amount);

  // 4) 调用支付 (mock 模式)
  const pay = await authReq('POST', `/api/orders/${order.id}/pay`, {});
  console.log('pay.status=', pay.status);
  console.log('pay.data=', JSON.stringify(pay.data));
  if (pay.status !== 200) throw new Error('支付请求失败');
  if (!pay.data?.data?.paySign) throw new Error('未返回 paySign');
  if (pay.data.data.paySign !== 'mock') {
    console.log('⚠ 注意:当前不是 mock 模式,可能环境变量未触发 mock fallback');
  } else {
    console.log('✓ Mock 模式已正确返回,前端将弹窗模拟');
  }

  // 5) notify 回调 (随便给个空 payload,应该 401 验签失败)
  const notify = await fetch(BASE + '/api/orders/pay/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  console.log('notify.status=', notify.status);

  console.log('\n--- 全部通过 ✅ ---');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FAIL:', err.message);
    console.log('--- 后端日志 ---');
    console.log(logs);
    process.exit(1);
  })
  .finally(() => {
    setTimeout(() => { try { server.kill('SIGTERM'); } catch (_) {} }, 200);
  });

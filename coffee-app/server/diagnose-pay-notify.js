// filepath: coffee-app/server/diagnose-pay-notify.js
// 一站式诊断 + 模拟回调测试。
//
// 用法:
//   node diagnose-pay-notify.js                       跑配置诊断 + 模拟回调
//   node diagnose-pay-notify.js --notify-url <url>    覆盖 .env 里的 WECHAT_NOTIFY_URL
//   node diagnose-pay-notify.js --order-id <id>       只对某订单做查单恢复 (走 query 接口)
//   node diagnose-pay-notify.js --recover-pending     扫描所有 pending 且 transaction_id 形如 prepay_id 的订单,自动查单恢复
//
// 模拟回调会发送两种 header 模式,验证服务端对新版 Wechatpay-* headers 的兼容性。

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');

const wechatPay = require('./src/services/wechatPay');
const { db } = require('./src/db');

const argv = process.argv.slice(2);
const flagIdx = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};
const notifyUrlOverride = flagIdx('--notify-url');
const targetOrderId = flagIdx('--order-id');
const recoverPending = argv.includes('--recover-pending');

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const WARN = '\x1b[33m!\x1b[0m';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? PASS : FAIL} ${name}${detail ? `  → ${detail}` : ''}`);
}

function mask(key, value) {
  if (!value) return '(空)';
  if (key.includes('KEY') || key.includes('SECRET') || key.includes('PATH')) return '(已设置)';
  if (value.length > 24) return value.slice(0, 8) + '***' + value.slice(-4);
  return value;
}

async function main() {
  console.log('\n=== WeChat Pay 真实环境诊断 ===\n');

  // 1. 模式
  const mode = wechatPay.currentMode();
  check('当前支付模式', mode === 'real', `mode=${mode}${mode === 'real' ? '' : '  (请补全商户凭据)'}`);

  // 2. 环境变量
  const items = [
    ['WECHAT_APPID', process.env.WECHAT_APPID],
    ['WECHAT_MCH_ID', process.env.WECHAT_MCH_ID],
    ['WECHAT_API_V3_KEY', process.env.WECHAT_API_V3_KEY],
    ['WECHAT_SERIAL_NO', process.env.WECHAT_SERIAL_NO],
    ['WECHAT_NOTIFY_URL', notifyUrlOverride || process.env.WECHAT_NOTIFY_URL],
    ['WECHAT_PRIVATE_KEY_PATH', process.env.WECHAT_PRIVATE_KEY_PATH],
    ['WECHAT_PAY_PUBLIC_KEY_PATH', process.env.WECHAT_PAY_PUBLIC_KEY_PATH]
  ];
  for (const [k, v] of items) {
    check(`${k} 已设置`, !!v, mask(k, v));
  }

  if (process.env.WECHAT_PRIVATE_KEY_PATH) {
    const p = path.resolve(process.env.WECHAT_PRIVATE_KEY_PATH);
    check('商户私钥文件存在', fs.existsSync(p), p);
  }
  if (process.env.WECHAT_PAY_PUBLIC_KEY_PATH) {
    const p = path.resolve(process.env.WECHAT_PAY_PUBLIC_KEY_PATH);
    check('微信支付公钥文件存在', fs.existsSync(p), p);
  }

  // 3. 私钥可加载
  let privateKeyOk = false;
  try {
    if (process.env.WECHAT_PRIVATE_KEY_PATH) {
      const key = fs.readFileSync(path.resolve(process.env.WECHAT_PRIVATE_KEY_PATH), 'utf8');
      const test = crypto.createSign('RSA-SHA256').update('test').end().sign(key, 'base64');
      privateKeyOk = !!test;
    }
  } catch (e) { privateKeyOk = false; }
  check('商户私钥可被 Node 加载并签名', privateKeyOk, privateKeyOk ? 'sign() OK' : '加载/签名失败');

  // 4. 公钥可验签
  let publicKeyOk = false;
  try {
    if (process.env.WECHAT_PAY_PUBLIC_KEY_PATH && process.env.WECHAT_PRIVATE_KEY_PATH) {
      const pub = fs.readFileSync(path.resolve(process.env.WECHAT_PAY_PUBLIC_KEY_PATH), 'utf8');
      const key = fs.readFileSync(path.resolve(process.env.WECHAT_PRIVATE_KEY_PATH), 'utf8');
      const sig = crypto.createSign('RSA-SHA256').update('test').end().sign(key, 'base64');
      publicKeyOk = crypto.createVerify('RSA-SHA256').update('test').end().verify(pub, sig, 'base64');
    }
  } catch (e) { publicKeyOk = false; }
  check('微信支付公钥可验签 (私钥↔公钥配对)', publicKeyOk, publicKeyOk ? 'verify() OK' : '验签失败 → 公钥错(应下载"微信支付公钥"pub_key.pem)');

  // 5. 回调 URL 可达性
  const notifyUrl = notifyUrlOverride || process.env.WECHAT_NOTIFY_URL;
  if (notifyUrl) {
    check('回调 URL 是 HTTPS', notifyUrl.startsWith('https://'), notifyUrl);
    const pingRes = await pingUrl(notifyUrl);
    check('回调 URL 公网可达', pingRes.ok, pingRes.detail);
  } else {
    check('WECHAT_NOTIFY_URL 已设置', false, '未设置 → 服务端会直接 500,永不回调');
  }

  // 6. 模拟两种 header 模式发回调
  if (mode === 'real' && privateKeyOk && notifyUrl) {
    console.log('\n=== 模拟微信回调 (两种 header 模式) ===\n');
    await testNotify(notifyUrl, 'wechatpay-headers');  // 新版
    await testNotify(notifyUrl, 'authorization');        // 老版
  }

  // 7. 查单恢复
  if (mode === 'real' && (targetOrderId || recoverPending)) {
    console.log('\n=== 查单恢复 (主动查微信确认支付状态) ===\n');
    await recoverOrders(targetOrderId);
  }

  summary();
}

async function testNotify(notifyUrl, mode) {
  // 找一个 pending 的订单作为目标
  const order = db.prepare("SELECT * FROM orders WHERE status = 'pending' ORDER BY id DESC LIMIT 1").get();
  if (!order) {
    console.log(`${WARN} 没有 pending 订单可测,跳过 ${mode} 模式模拟`);
    return;
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const outTradeNo = order.pickup_number;
  const transactionId = `MOCK_TX_${Date.now()}`;

  // 用 APIv3 密钥加密模拟 resource
  const v3Key = process.env.WECHAT_API_V3_KEY;
  if (!v3Key || v3Key.length < 32) {
    console.log(`${FAIL} 加密 resource 失败: WECHAT_API_V3_KEY 未配置或长度不足`);
    return;
  }
  const payload = {
    out_trade_no: outTradeNo,
    transaction_id: transactionId,
    trade_state: 'SUCCESS',
    success_time: new Date().toISOString().replace(/\.\d{3}Z$/, '+08:00')
  };
  const aad = 'transaction';
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(v3Key, 'utf8'), Buffer.from(nonce, 'utf8'));
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const enc = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ciphertext = Buffer.concat([enc, tag]).toString('base64');

  const body = JSON.stringify({
    id: `EV-${Date.now()}`,
    create_time: new Date().toISOString().replace(/\.\d{3}Z$/, '+08:00'),
    resource_type: 'encrypt-resource',
    event_type: 'TRANSACTION.SUCCESS',
    summary: '支付成功',
    resource: { ciphertext, nonce, associated_data: aad }
  });

  // 用商户私钥对 timestamp\nonce\nbody\n 签名
  const privateKey = fs.readFileSync(path.resolve(process.env.WECHAT_PRIVATE_KEY_PATH), 'utf8');
  // 等等 — 回调验签用的是微信支付公钥验签,所以这里应该用微信支付公钥... 不,签名应该用微信的私钥。
  // 实际上回调是微信用平台私钥签名,我们用平台公钥验签。这里我们模拟签名只能用我们手上有的私钥,
  // 所以服务端验签会失败 — 这只能测试到 "服务端没把请求拒掉" 这一步。完全验签需要在生产环境真实回调。
  // 但 header 解析这一关能测出来。
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${timestamp}\n${nonce}\n${body}\n`);
  signer.end();
  const signature = signer.sign(privateKey, 'base64');

  let headers;
  if (mode === 'wechatpay-headers') {
    headers = {
      'Content-Type': 'application/json',
      'Wechatpay-Signature': signature,
      'Wechatpay-Timestamp': timestamp,
      'Wechatpay-Nonce': nonce,
      'Wechatpay-Serial': process.env.WECHAT_SERIAL_NO || 'MOCK_SERIAL'
    };
  } else {
    headers = {
      'Content-Type': 'application/json',
      Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${process.env.WECHAT_MCH_ID}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${process.env.WECHAT_SERIAL_NO || 'MOCK_SERIAL'}",signature="${signature}"`
    };
  }

  console.log(`→ POST ${notifyUrl} (mode=${mode}) pickup=${outTradeNo}`);
  try {
    const res = await postJson(notifyUrl, body, headers);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { parsed = { raw: text }; }
    const ok = res.status >= 200 && res.status < 300 && parsed.code !== 'FAIL';
    check(`模拟回调 [${mode}]`, ok, `HTTP ${res.status}  ${JSON.stringify(parsed).slice(0, 120)}`);
  } catch (e) {
    check(`模拟回调 [${mode}]`, false, e.message);
  }
}

async function recoverOrders(orderId) {
  let orders;
  if (orderId) {
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    orders = o ? [o] : [];
    if (!orders.length) console.log(`${FAIL} 找不到订单 #${orderId}`);
  } else {
    orders = db.prepare(`
      SELECT * FROM orders
      WHERE status = 'pending'
        AND transaction_id IS NOT NULL
        AND transaction_id LIKE 'prepay_id=%'
      ORDER BY id DESC LIMIT 20
    `).all();
    console.log(`扫描到 ${orders.length} 个待恢复订单`);
  }
  for (const order of orders) {
    try {
      const q = await wechatPay.queryOrderByOutTradeNo(order.pickup_number);
      console.log(`  #${order.id} ${order.pickup_number} → trade_state=${q.tradeState}, tx=${q.transactionId || '-'}`);
      if (q.tradeState === 'SUCCESS') {
        db.prepare(`
          UPDATE orders
          SET status = 'paid', transaction_id = ?, updated_at = datetime('now', 'localtime')
          WHERE id = ? AND status = 'pending'
        `).run(q.transactionId || null, order.id);
        console.log(`  ${PASS} 恢复成功: order #${order.id} → paid`);
      } else if (q.tradeState === 'NOTPAY') {
        console.log(`  ${WARN} 微信显示未支付,跳过 (transaction_id 仍是 prepay_id,正常)`);
      } else {
        console.log(`  ${WARN} 微信返回 trade_state=${q.tradeState},无需处理`);
      }
    } catch (e) {
      console.log(`  ${FAIL} #${order.id} 查单失败: ${e.message}`);
    }
  }
}

function pingUrl(url) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request({
        method: 'HEAD',
        host: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        timeout: 5000
      }, (res) => resolve({ ok: true, detail: `HTTP ${res.statusCode} from ${u.hostname}` }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, detail: '连接超时 (5s)' }); });
      req.on('error', (e) => resolve({ ok: false, detail: e.code || e.message }));
      req.end();
    } catch (e) { resolve({ ok: false, detail: e.message }); }
  });
}

function postJson(url, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request({
        method: 'POST',
        host: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers: { 'Content-Length': Buffer.byteLength(body), ...extraHeaders },
        timeout: 10000
      }, (res) => resolve(res));
      req.on('timeout', () => { req.destroy(); reject(new Error('请求超时 (10s)')); });
      req.on('error', (e) => reject(new Error(e.code || e.message)));
      req.write(body);
      req.end();
    } catch (e) { reject(e); }
  });
}

function summary() {
  const failed = results.filter((r) => !r.ok);
  console.log('\n=== 总结 ===');
  console.log(`通过: ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    console.log('\n失败项:');
    for (const f of failed) console.log(`  - ${f.name}  ${f.detail}`);
    console.log('\n常见修复:');
    console.log('  1. .env: WECHAT_MCH_ID / WECHAT_API_V3_KEY / WECHAT_SERIAL_NO / WECHAT_PRIVATE_KEY_PATH / WECHAT_PAY_PUBLIC_KEY_PATH / WECHAT_NOTIFY_URL 全部填');
    console.log('  2. WECHAT_NOTIFY_URL 必须是 https:// 且公网可访问');
    console.log('  3. 私钥 = API 证书 apiclient_key.pem;公钥 = 平台"微信支付公钥" pub_key.pem');
    console.log('  4. 跑 node diagnose-pay-notify.js --recover-pending 修复卡 pending 的订单');
  } else {
    console.log('\n所有配置检查通过 ✅');
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(2); });
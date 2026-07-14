// filepath: coffee-app/server/src/services/wechatPay.js
// WeChat Pay V3 — 小程序 JSAPI 支付 + 回调验签解密
// 安全设计:
//   • 仅服务端持有商户私钥 / APIv3 密钥,前端只拿一次性签名结果。
//   • 客户端签名使用 RSA-SHA256(对应小程序文档"RSA 签名方式")。
//   • 回调验签使用 V3 平台公钥 + AEAD_AES_256_GCM 解密 (正确性标准流程)。
//   • Mock 模式:商户未配置时,前端用 paySign=='mock' 自动弹窗模拟,不调 wx.requestPayment。
// 参考文档:
//   - https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_5_1.shtml   (统一下单 JSAPI)
//   - https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_5_4.shtml   (小程序前端拉起)
//   - https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_1_5.shtml   (回调验签解密)

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const WECHAT_PAY_BASE = 'https://api.mch.weixin.qq.com';
const FETCH_TIMEOUT_MS = 5000;

/** 商户是否已配置齐全 (mch_id + appid + v3 key + 商户证书私钥 + 公钥 + serial_no) */
function isConfigured() {
  return !!(
    process.env.WECHAT_APPID &&
    process.env.WECHAT_MCH_ID &&
    process.env.WECHAT_API_V3_KEY &&
    process.env.WECHAT_SERIAL_NO &&
    process.env.WECHAT_PRIVATE_KEY_PATH &&
    fs.existsSync(path.resolve(process.env.WECHAT_PRIVATE_KEY_PATH || '')) &&
    process.env.WECHAT_PAY_PUBLIC_KEY_PATH &&
    fs.existsSync(path.resolve(process.env.WECHAT_PAY_PUBLIC_KEY_PATH || ''))
  );
}

/** 当前应当使用的模式: 'real' 或 'mock' */
function currentMode() {
  return isConfigured() ? 'real' : 'mock';
}

/**
 * 构造 V3 Authorization header (签名 + 元信息)
 * 文档: https://pay.weixin.qq.com/wiki/doc/apiv3/wechatpay/wechatpay4_0.shtml
 */
function buildAuth(method, urlPath, body) {
  const mchId = process.env.WECHAT_MCH_ID;
  const serialNo = process.env.WECHAT_SERIAL_NO;
  const privateKey = fs.readFileSync(path.resolve(process.env.WECHAT_PRIVATE_KEY_PATH), 'utf8');

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = crypto.randomBytes(16).toString('hex');

  const message = `${method}\n${urlPath}\n${timestamp}\n${nonceStr}\n${body}\n`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(message);
  signer.end();
  const signature = signer.sign(privateKey, 'base64');

  return {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonceStr}",timestamp="${timestamp}",serial_no="${serialNo}",signature="${signature}"`
    }
  };
}

/** 解析回调请求头里的 Authorization 字段 */
function parseAuth(authorization) {
  const prefix = 'WECHATPAY2-SHA256-RSA2048 ';
  if (!authorization || !authorization.startsWith(prefix)) {
    throw new Error('Invalid or missing WeChat Pay Authorization header');
  }
  const out = {};
  for (const part of authorization.slice(prefix.length).split(',')) {
    const [k, ...rest] = part.split('=');
    if (!k) continue;
    out[k.trim()] = rest.join('=').replace(/^"|"$/g, '').trim();
  }
  return out;
}

/**
 * JSAPI 统一下单
 * 文档: https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_5_1.shtml
 *
 * @param {object} params
 * @param {string} params.openid       用户 openid
 * @param {string} params.outTradeNo   商户订单号 (全局唯一,本项目用 pickup_number)
 * @param {string} params.description  商品描述
 * @param {number} params.totalFen     金额(分,整数,避免浮点)
 * @param {string} params.notifyUrl    支付回调 URL
 * @returns {Promise<{prepayId: string}>}
 */
async function createJsapiOrder({ openid, outTradeNo, description, totalFen, notifyUrl }) {
  const urlPath = '/v3/pay/transactions/jsapi';
  const body = JSON.stringify({
    appid: process.env.WECHAT_APPID,
    mchid: process.env.WECHAT_MCH_ID,
    description,
    out_trade_no: outTradeNo,
    notify_url: notifyUrl,
    amount: { total: totalFen, currency: 'CNY' },
    payer: { openid }
  });

  const { headers } = buildAuth('POST', urlPath, body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(WECHAT_PAY_BASE + urlPath, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal
    });
  } catch (netErr) {
    const isTimeout = netErr.name === 'AbortError';
    const e = new Error(`WeChat Pay API network error (${isTimeout ? 'timeout' : netErr.message || 'unknown'})`);
    e.isNetworkError = true;
    e.isTimeout = isTimeout;
    e.cause = netErr;
    throw e;
  } finally {
    clearTimeout(timer);
  }

  // 204 = 正常创建 (V3 大部分查询接口). 但统一下单 总是返回 JSON,这里安全判断 res.status
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { /* keep {} */ }

  if (!res.ok || !data.prepay_id) {
    const e = new Error(`WeChat Pay create order failed: ${data.message || `HTTP ${res.status}`}`);
    e.wechatCode = data.errcode;
    e.wechatMsg = data.message;
    throw e;
  }

  return { prepayId: data.prepay_id };
}

/**
 * 查询微信支付订单状态
 * 文档: https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_5_6.shtml
 *
 * 用商户订单号 (out_trade_no = pickup_number) 去微信查真实状态。
 * 用于:回调丢失/失败后,前端轮询或服务端定时任务主动补救,把卡在 pending 的
 * 已支付订单推到 paid。
 *
 * @param {string} outTradeNo  商户订单号 (pickup_number)
 * @returns {Promise<{tradeState: string, transactionId?: string, raw: object}>}
 *   tradeState: 'SUCCESS' | 'REFUND' | 'NOTPAY' | 'CLOSED' | 'REVOKED' | 'USERPAYING' | 'PAYERROR'
 */
async function queryOrderByOutTradeNo(outTradeNo) {
  const urlPath = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}`;
  const { headers } = buildAuth('GET', urlPath, '');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(WECHAT_PAY_BASE + urlPath, {
      method: 'GET',
      headers,
      signal: controller.signal
    });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) { /* keep {} */ }
    if (!res.ok) {
      const e = new Error(`WeChat Pay query failed: ${data.message || `HTTP ${res.status}`}`);
      e.wechatCode = data.errcode;
      e.wechatMsg = data.message;
      e.status = res.status;
      throw e;
    }
    return {
      tradeState: data.trade_state,
      transactionId: data.transaction_id,
      raw: data
    };
  } catch (netErr) {
    const isTimeout = netErr.name === 'AbortError';
    const e = new Error(`WeChat Pay query network error (${isTimeout ? 'timeout' : netErr.message || 'unknown'})`);
    e.isNetworkError = true;
    e.isTimeout = isTimeout;
    e.cause = netErr;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 生成小程序前端拉起支付所需的参数
 * 文档: https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_5_4.shtml
 * 签名 message = appId\ntimestamp\nnonceStr\npackage\n
 */
function buildClientPayParams(prepayId) {
  const appId = process.env.WECHAT_APPID;
  const privateKey = fs.readFileSync(path.resolve(process.env.WECHAT_PRIVATE_KEY_PATH), 'utf8');

  const timeStamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const pkg = `prepay_id=${prepayId}`;

  const message = `${appId}\n${timeStamp}\n${nonceStr}\n${pkg}\n`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(message);
  signer.end();
  const paySign = signer.sign(privateKey, 'base64');

  return {
    timeStamp,
    nonceStr,
    package: pkg,
    signType: 'RSA',
    paySign
  };
}

/**
 * 验签 + AEAD_AES_256_GCM 解密 回调通知
 * 文档: https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_1_5.shtml
 *
 * 兼容微信支付 V3 两种回调签名格式:
 *  ① 老方式 (APIv3 密钥模式): 所有签名信息串在 Authorization 头里
 *       Authorization: WECHATPAY2-SHA256-RSA2048 mchid="..",nonce_str="..",timestamp="..",serial_no="..",signature=".."
 *  ② 新方式 (微信支付公钥模式): 签名信息分散到独立 header
 *       Wechatpay-Signature / Wechatpay-Timestamp / Wechatpay-Nonce / Wechatpay-Serial
 *     验签用的公钥取自 WECHAT_PAY_PUBLIC_KEY_PATH,即商户平台"微信支付公钥"(pub_key.pem)。
 *
 * @param {object} headers  req.headers (Express 默认小写化)
 * @param {string} rawBody  原始 JSON 字符串
 * @param {object} resource body.resource { ciphertext, nonce, associated_data }
 * @returns {object} 解密后的明文对象 (含 out_trade_no / transaction_id / trade_state 等)
 */
function verifyAndDecryptNotify(headers, rawBody, resource) {
  let timestamp;
  let nonce;
  let signature;
  let mode;

  const authHeader = headers && (headers.authorization || headers.Authorization);
  const sigHeader = headers && (headers['wechatpay-signature'] || headers['Wechatpay-Signature']);
  const tsHeader = headers && (headers['wechatpay-timestamp'] || headers['Wechatpay-Timestamp']);
  const ncHeader = headers && (headers['wechatpay-nonce'] || headers['Wechatpay-Nonce']);

  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('WECHATPAY2-SHA256-RSA2048 ')) {
    // ① 老方式
    const parsed = parseAuth(authHeader);
    timestamp = parsed.timestamp;
    nonce = parsed.nonce;
    signature = parsed.signature;
    mode = 'authorization';
  } else if (sigHeader && tsHeader && ncHeader) {
    // ② 新方式 (微信支付公钥模式)
    timestamp = tsHeader;
    nonce = ncHeader;
    signature = sigHeader;
    mode = 'wechatpay-headers';
  } else {
    throw new Error(
      'Invalid or missing WeChat Pay signature headers ' +
      '(expected Authorization: WECHATPAY2-SHA256-RSA2048 ... or Wechatpay-Signature + Wechatpay-Timestamp + Wechatpay-Nonce)'
    );
  }

  const publicKey = fs.readFileSync(path.resolve(process.env.WECHAT_PAY_PUBLIC_KEY_PATH), 'utf8');
  const verifyMessage = `${timestamp}\n${nonce}\n${rawBody}\n`;
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(verifyMessage);
  verifier.end();
  const ok = verifier.verify(publicKey, signature, 'base64');
  if (!ok) throw new Error(`Invalid WeChat Pay notify signature (mode=${mode})`);

  const key = Buffer.from(process.env.WECHAT_API_V3_KEY, 'utf8');
  const { ciphertext, nonce: aesNonce, associated_data: aad } = resource;

  const buf = Buffer.from(ciphertext, 'base64');
  const tag = buf.subarray(buf.length - 16);
  const encrypted = buf.subarray(0, buf.length - 16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(aesNonce, 'utf8'));
  decipher.setAuthTag(tag);
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));

  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext);
}

/**
 * Mock 模式客户端拉起支付所需的参数
 * 前端检测到 paySign === 'mock' 时,不调用 wx.requestPayment,而弹窗模拟成功。
 */
function buildMockPayParams() {
  return {
    timeStamp: String(Math.floor(Date.now() / 1000)),
    nonceStr: crypto.randomBytes(16).toString('hex'),
    package: 'prepay_id=mock',
    signType: 'MD5',
    paySign: 'mock'
  };
}

module.exports = {
  isConfigured,
  currentMode,
  buildAuth,
  createJsapiOrder,
  queryOrderByOutTradeNo,
  buildClientPayParams,
  buildMockPayParams,
  verifyAndDecryptNotify,
  WECHAT_PAY_BASE
};

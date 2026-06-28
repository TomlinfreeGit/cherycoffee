// filepath: coffee-app/server/src/services/wechat.js
// Real WeChat API integration
// https://developers.weixin.qq.com/miniprogram/dev/api-backend/open-api/login/auth.code2Session.html

const crypto = require('node:crypto');

const WECHAT_API_BASE = 'https://api.weixin.qq.com';
const FETCH_TIMEOUT_MS = 3000;

/**
 * Exchange a wx.login() code for the user's openid.
 * @param {string} code - from wx.login()
 * @param {string} appid - WeChat AppID
 * @param {string} secret - WeChat AppSecret
 * @returns {Promise<{openid: string, session_key?: string, unionid?: string}>}
 */
async function code2Session(code, appid, secret) {
  if (!code) throw new Error('Missing code');
  if (!appid || !secret) throw new Error('Missing WECHAT_APPID or WECHAT_SECRET');

  const url = new URL(`${WECHAT_API_BASE}/sns/jscode2session`);
  url.searchParams.set('appid', appid);
  url.searchParams.set('secret', secret);
  url.searchParams.set('js_code', code);
  url.searchParams.set('grant_type', 'authorization_code');

  // Network layer: catch DNS/timeout/connection errors and re-throw as a typed error
  // so callers (auth.js) can decide to fall back to mock mode.
  // Use AbortController to enforce a hard timeout (default 3s) so we don't hang.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal
    });
  } catch (netErr) {
    const isTimeout = netErr.name === 'AbortError' || netErr.cause?.code === 'ABORT_ERR';
    const err = new Error(
      `WeChat API network error (${isTimeout ? 'timeout' : netErr.cause?.code || netErr.cause?.message || netErr.message || 'unknown'}) ` +
      `(attempted ${WECHAT_API_BASE}:443)`
    );
    err.isNetworkError = true;
    err.isTimeout = isTimeout;
    err.cause = netErr.cause || netErr;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`WeChat API HTTP error: ${res.status}`);
  }

  const data = await res.json();

  if (data.errcode) {
    // Common errors:
    // 40029: code 无效 (js_code已经被使用过,或者过期)
    // 40163: code 已被使用
    // 45011: 频率限制
    const err = new Error(`WeChat API error: ${data.errmsg} (code=${data.errcode})`);
    err.wechatCode = data.errcode;
    err.wechatMsg = data.errmsg;
    throw err;
  }

  if (!data.openid) {
    throw new Error('WeChat API returned no openid');
  }

  return {
    openid: data.openid,
    session_key: data.session_key,
    unionid: data.unionid
  };
}

module.exports = { code2Session };

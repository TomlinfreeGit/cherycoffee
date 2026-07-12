// filepath: coffee-app/server/src/routes/merchantAuth.js
// 商家后台鉴权路由。
//   POST   /api/merchant-auth/login                    — 账号密码登录,返回 token (允许多端)
//   POST   /api/merchant-auth/logout                   — 当前 token 登出
//   GET    /api/merchant-auth/me                       — 当前登录用户信息
//   GET    /api/merchant-auth/sessions                 — 列出当前账号的全部登录设备
//   DELETE /api/merchant-auth/sessions/:token_suffix   — 远程踢出指定设备 (按 token 末尾 6 位)
//   POST   /api/merchant-auth/sessions/revoke-others   — 一键踢出除当前设备外的所有
//   POST   /api/merchant-auth/change-password          — 改密 (会清空所有 session)
//
// 多端策略: 同一商家账号可在多个设备同时登录,token 互不影响。改密仍会清空所有 session。
// 路由前缀 merchant-auth 是有意的,避免与 routes/merchant.js (业务订单管理) 路径碰撞。

const express = require('express');
const { merchantAuth } = require('../middleware/merchantAuth');
const {
  findMerchantByUsername,
  findMerchantByToken,
  findMerchantById,
  verifyPassword,
  checkRateLimit,
  recordFailure,
  recordSuccess,
  createSession,
  deleteSession,
  listSessions,
  revokeSession,
  revokeAllOtherSessions,
  changePassword,
  markLogin,
  USERNAME_REGEX
} = require('../services/merchantAuth');

const router = express.Router();

// 提取客户端 IP (优先信任 proxy 头,但只在已知反代场景;这里直接用 socket.remoteAddress)
function clientIp(req) {
  return (req.headers['x-forwarded-for']?.toString().split(',')[0].trim()) ||
         req.socket?.remoteAddress ||
         'unknown';
}

// POST /api/merchant-auth/login
// body: { username, password }
// 200: { data: { token, username, role, expiresAt } }
// 400: 输入非法;401: 用户/密码错误;429: 失败过多,被封禁
router.post('/login', (req, res) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (!username || !password) {
      return res.status(400).json({ error: '用户名和密码不能为空' });
    }
    if (!USERNAME_REGEX.test(username)) {
      return res.status(400).json({ error: '用户名格式非法' });
    }

    const ip = clientIp(req);

    // 1. 检查限速
    const rl = checkRateLimit(ip, username);
    if (!rl.allowed) {
      const sec = Math.ceil(rl.retryAfterMs / 1000);
      return res.status(429).json({
        error: `登录失败次数过多,请 ${sec} 秒后再试`,
        retryAfterMs: rl.retryAfterMs
      });
    }

    // 2. 查账号
    const merchant = findMerchantByUsername(username);
    if (!merchant || merchant.disabled) {
      recordFailure(ip, username);
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 3. 验密
    if (!verifyPassword(password, merchant.password_hash)) {
      recordFailure(ip, username);
      const blocked = checkRateLimit(ip, username);
      if (!blocked.allowed) {
        return res.status(429).json({
          error: `登录失败次数过多,请 ${Math.ceil(blocked.retryAfterMs / 1000)} 秒后再试`,
          retryAfterMs: blocked.retryAfterMs
        });
      }
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    // 4. 成功 → 清限速 / 创建 session / 标登录时间
    recordSuccess(ip, username);
    const { token, expiresAt } = createSession(merchant.id, ip, req.headers['user-agent']);
    markLogin(merchant.id);

    console.log(`✓ [merchantAuth] Login ok: username='${username}' ip='${ip}'`);
    res.json({
      data: {
        token,
        username: merchant.username,
        role: merchant.role,
        expiresAt
      }
    });
  } catch (err) {
    console.error('POST /api/merchant-auth/login error:', err);
    res.status(500).json({ error: '登录失败,请稍后再试' });
  }
});

// 鉴权路由从这里开始
router.use(merchantAuth);

// POST /api/merchant-auth/logout - 退出登录
router.post('/logout', (req, res) => {
  // 中间件已校验 token,直接删除
  deleteSession(req.sessionToken);
  res.json({ data: { ok: true } });
});

// GET /api/merchant-auth/me - 获取当前账号信息
router.get('/me', (req, res) => {
  res.json({ data: { id: req.merchant.id, username: req.merchant.username, role: req.merchant.role } });
});

// GET /api/merchant-auth/sessions - 列出当前账号的所有登录设备
// 响应不包含完整 token 哈希,只暴露末尾 6 位供 UI 标识。
router.get('/sessions', (req, res) => {
  const list = listSessions(req.merchant.id, req.sessionToken);
  res.json({ data: list });
});

// POST /api/merchant-auth/sessions/revoke-others - 一键踢出除当前 token 外的所有
router.post('/sessions/revoke-others', (req, res) => {
  const count = revokeAllOtherSessions(req.merchant.id, req.sessionToken);
  res.json({ data: { ok: true, revoked: count } });
});

// DELETE /api/merchant-auth/sessions/:tokenSuffix - 按末尾 6 位踢出指定设备
// 因为不存完整 token,只能匹配 suffix (足够人类识别 + 防止暴力枚举)
// 业务规则: 不能踢出当前会话自身
router.delete('/sessions/:tokenSuffix', (req, res) => {
  const suffix = String(req.params.tokenSuffix || '');
  if (!/^[0-9a-f]{6}$/.test(suffix)) {
    return res.status(400).json({ error: 'tokenSuffix 必须是 6 位十六进制' });
  }
  // 找到该账号下匹配 suffix 的 token
  const candidates = (() => {
    const { db } = require('../db');
    return db.prepare(`
      SELECT token FROM merchant_sessions
      WHERE merchant_id = ? AND substr(token, -6) = ?
    `).all(req.merchant.id, suffix);
  })();
  if (candidates.length === 0) {
    return res.status(404).json({ error: '未找到匹配的设备' });
  }
  if (candidates.length > 1) {
    return res.status(409).json({
      error: '匹配到多台设备,请提供更多上下文或重新登录后查看',
      matches: candidates.length
    });
  }
  const targetToken = candidates[0].token;
  if (targetToken === req.sessionToken) {
    return res.status(400).json({ error: '不能踢出当前会话,请用 /logout' });
  }
  const ok = revokeSession(req.merchant.id, targetToken);
  res.json({ data: { ok } });
});

// POST /api/merchant-auth/change-password
// body: { oldPassword, newPassword }
router.post('/change-password', (req, res) => {
  // dev fallback 身份没有对应 merchant 行,不允许改密 (无可改的密码)
  if (req.merchant.isDevFallback) {
    return res.status(403).json({ error: 'Dev fallback 模式不允许改密' });
  }
  const { oldPassword, newPassword } = req.body || {};
  if (typeof oldPassword !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'oldPassword / newPassword 必填' });
  }
  try {
    changePassword(req.merchant.id, oldPassword, newPassword);
    // 改密后当前 token 已失效,前端应清 localStorage 并跳到 /login
    res.json({ data: { ok: true, message: '密码已更新,需重新登录' } });
  } catch (err) {
    res.status(400).json({ error: err.message || '改密失败' });
  }
});

module.exports = router;

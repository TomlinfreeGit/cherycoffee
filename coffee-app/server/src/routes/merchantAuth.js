// filepath: coffee-app/server/src/routes/merchantAuth.js
// 商家后台鉴权路由。
//   POST   /api/merchant-auth/login           — 账号密码登录,返回 token
//   POST   /api/merchant-auth/logout          — 当前 token 登出
//   GET    /api/merchant-auth/me              — 当前登录用户信息
//   POST   /api/merchant-auth/change-password — 改密
//
// 注意: 路由前缀 merchant-auth 是有意的,避免与 routes/merchant.js(管理订单等业务)碰撞。

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

// filepath: coffee-app/server/src/middleware/merchantAuth.js
// 商家鉴权中间件 — 数据库 token 校验版。
//
// 安全策略:
//   • Bearer token 必须能在 merchant_sessions 表里查到,未过期,对应账号未禁用。
//   • 任何成功响应都带防缓存头 (no-store),避免 token 被 CDN/反向代理存下。
//   • 401 时不返回 'invalid token' 等具体细节,统一 'Unauthorized' 防扫端口。
//   • 开发模式 (NODE_ENV=development) 应急通道:如果 ALLOW_DEV_MERCHANT_TOKEN !== 'false'
//     且环境变量中没有登录账号配置,仍接受老的 'merchant-local-token' 作为逃生口。
//     启动时会有 WARN,生产 (NODE_ENV=production) 自动禁止。

const { findMerchantByToken } = require('../services/merchantAuth');

function clientIp(req) {
  return (req.headers['x-forwarded-for']?.toString().split(',')[0].trim()) ||
         req.socket?.remoteAddress ||
         'unknown';
}

// 启动期决定 dev fallback 是否启用
function isDevFallbackAllowed() {
  // 1) 默认仅在 development 模式 + 显式未禁用时启用
  if (process.env.NODE_ENV === 'production') return false;
  if (process.env.ALLOW_DEV_MERCHANT_TOKEN === 'false') return false;
  // 2) 即便 dev 模式,只要配置了真实账号,也关闭 dev fallback 防止混用
  const haveRealAccounts = !!process.env.MERCHANT_ADMIN_USERNAME && !!process.env.MERCHANT_ADMIN_PASSWORD;
  if (haveRealAccounts && process.env.ALLOW_DEV_MERCHANT_TOKEN !== 'true') return false;
  return true;
}

let devFallbackEnabled = isDevFallbackAllowed();

if (devFallbackEnabled) {
  console.warn('\n⚠ [merchantAuth] DEV FALLBACK TOKEN ("merchant-local-token") IS ACCEPTED.');
  console.warn('  This MUST be disabled in production. To disable:');
  console.warn('    export NODE_ENV=production');
  console.warn('  Or:');
  console.warn('    export ALLOW_DEV_MERCHANT_TOKEN=false\n');
}

function merchantAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // dev fallback 通路 — 仅 dev 且明确允许时启用
  if (devFallbackEnabled && token === 'merchant-local-token') {
    if (!req._devWarned) {
      console.warn(`[merchantAuth] Dev fallback token used by ip='${clientIp(req)}' path='${req.path}'`);
      req._devWarned = true;
    }
    // id=0 标记为 dev-fallback,业务路由不应信任该身份做敏感操作
    req.merchant = { id: 0, username: 'dev-fallback', role: 'owner', isDevFallback: true };
    req.sessionToken = 'merchant-local-token';
    safeNoStore(res);
    return next();
  }

  // 正常路径:数据库 session 校验
  const merchant = findMerchantByToken(token, clientIp(req));
  if (!merchant) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.merchant = merchant;
  req.sessionToken = token;
  safeNoStore(res);
  next();
}

function safeNoStore(res) {
  // 防止响应被任何代理/浏览器缓存存下 (token 应每次重新校验)
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  return res;
}

module.exports = {
  merchantAuth,
  // 暴露给测试或动态配置使用
  isDevFallbackEnabled: () => devFallbackEnabled,
  setDevFallbackEnabled: (v) => {
    devFallbackEnabled = !!v;
  }
};

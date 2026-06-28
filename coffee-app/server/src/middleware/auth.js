// filepath: coffee-app/server/src/middleware/auth.js
// 会话管理：创建、查询、删除 session token
const crypto = require('node:crypto');
const { db } = require('../db');
const { code2Session } = require('../services/wechat');

// Feature flag: real WeChat login vs local mock
const USE_REAL_WECHAT_AUTH = process.env.USE_REAL_WECHAT_AUTH === 'true';
const WECHAT_APPID = process.env.WECHAT_APPID;
const WECHAT_SECRET = process.env.WECHAT_SECRET;

// When USE_REAL_WECHAT_AUTH=true but the WeChat API is unreachable (DNS, timeout,
// firewall, etc.), fall back to mock mode so local dev keeps working.
// Set to 'false' to disable the fallback and surface real errors.
const WECHAT_FALLBACK_TO_MOCK = process.env.WECHAT_FALLBACK_TO_MOCK !== 'false';

// Track how many times we've fallen back (visible via /api/sessions/config)
let fallbackCount = 0;
let lastFallbackAt = null;
let lastFallbackReason = null;

// In-memory cache: code -> { openid, expiresAt }
const codeCache = new Map();
const CODE_TTL_MS = 5 * 60 * 1000;

/**
 * Get a mock openid derived from the code (deterministic for testing).
 */
function getMockOpenid(code) {
  return 'mock_openid_' + crypto.createHash('sha256').update(code || 'anonymous').digest('hex').slice(0, 16);
}

/**
 * Resolve a wx.login code to a real openid via WeChat API or cache.
 */
async function resolveOpenid(code) {
  if (!USE_REAL_WECHAT_AUTH) {
    return { openid: getMockOpenid(code), isMock: true };
  }

  // Check cache
  if (code && codeCache.has(code)) {
    const cached = codeCache.get(code);
    if (cached.expiresAt > Date.now()) {
      return { openid: cached.openid, isMock: false };
    }
    codeCache.delete(code);
  }

  if (!WECHAT_APPID || !WECHAT_SECRET) {
    throw new Error(
      'USE_REAL_WECHAT_AUTH=true but WECHAT_APPID/WECHAT_SECRET not set. ' +
      'Set them in .env or set USE_REAL_WECHAT_AUTH=false for local dev.'
    );
  }

  let result;
  try {
    result = await code2Session(code, WECHAT_APPID, WECHAT_SECRET);
  } catch (e) {
    if (e.isNetworkError && WECHAT_FALLBACK_TO_MOCK) {
      fallbackCount += 1;
      lastFallbackAt = new Date().toISOString();
      lastFallbackReason = e.message;
      console.warn(
        `⚠ WeChat API unreachable, falling back to mock openid. ` +
        `Reason: ${e.message}. ` +
        `Set WECHAT_FALLBACK_TO_MOCK=false to disable.`
      );
      return { openid: getMockOpenid(code), isMock: true, fellBack: true };
    }
    throw e;
  }

  if (code) {
    codeCache.set(code, {
      openid: result.openid,
      expiresAt: Date.now() + CODE_TTL_MS
    });
    setTimeout(() => codeCache.delete(code), CODE_TTL_MS).unref?.();
  }

  return { openid: result.openid, isMock: false };
}

/**
 * Create a new session.
 */
async function createSession(code) {
  const { openid } = await resolveOpenid(code);
  const token = 'tok_' + crypto.randomBytes(24).toString('hex');

  db.prepare(`
    INSERT INTO sessions (token, openid) VALUES (?, ?)
  `).run(token, openid);

  return { token, openid };
}

function resolveSession(token) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!row) return null;
  db.prepare(`UPDATE sessions SET last_seen_at = datetime('now', 'localtime') WHERE token = ?`).run(token);
  return row.openid;
}

function deleteSession(token) {
  if (!token) return false;
  const result = db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  return result.changes > 0;
}

function customerAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const openid = resolveSession(token);
  if (!openid) {
    return res.status(401).json({ error: 'Unauthorized. Please login first.' });
  }
  req.openid = openid;
  req.sessionToken = token;
  next();
}

function optionalCustomerAuth(req, _res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const openid = resolveSession(token);
  if (openid) {
    req.openid = openid;
    req.sessionToken = token;
  }
  next();
}

function getAuthConfig() {
  return {
    useRealWechat: USE_REAL_WECHAT_AUTH,
    fallbackEnabled: WECHAT_FALLBACK_TO_MOCK,
    appIdConfigured: !!WECHAT_APPID,
    secretConfigured: !!WECHAT_SECRET,
    fallbackCount,
    lastFallbackAt,
    lastFallbackReason
  };
}

module.exports = {
  createSession,
  resolveSession,
  deleteSession,
  customerAuth,
  optionalCustomerAuth,
  resolveOpenid,
  getAuthConfig
};

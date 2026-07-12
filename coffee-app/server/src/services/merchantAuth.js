// filepath: coffee-app/server/src/services/merchantAuth.js
// 商家后台鉴权服务: scrypt 哈希、登录限速、session CRUD、首次启动的种子账号。
//
// 安全要点:
//  • 密码存储使用 Node 内置 scrypt (128 字节随机 salt + 64 字节派生密钥),无第三方依赖。
//  • 比较使用 crypto.timingSafeEqual 防时序攻击。
//  • 登录失败 5 次/15 分钟 → IP+用户名级联限速。
//  • session token 用 32 字节随机 (256 bit 熵),无状态无法离线伪造。
//  • 默认 12 小时过期,每次成功访问滑动续期到当前时间+窗口。
//  • 密码不能为默认强口令 'admin123' / '123456' / 等常见弱口令。

const crypto = require('node:crypto');
const { db } = require('../db');

// ─── 常量 ──────────────────────────────────────────────────────
const SCRYPT_N = 16384;     // CPU/memory cost
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEY_LEN = 64;         // 派生密钥字节数
const SALT_LEN = 16;        // salt 字节数

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;       // 默认 12 小时
const SESSION_RENEW_MS = 60 * 60 * 1000;           // 滑动续期:超过 1 小时没活动才推到满 TTL

const LOGIN_MAX_ATTEMPTS = 5;            // 5 次失败
const LOGIN_WINDOW_MS = 15 * 60 * 1000;  // 15 分钟窗口
const LOGIN_BLOCK_MS = 15 * 60 * 1000;   // 超过阈值后封 15 分钟

const USERNAME_REGEX = /^[a-zA-Z0-9_.-]{3,32}$/;

// 弱口令黑名单 (生产环境务必改 + 强制 8 位以上)
const WEAK_PASSWORDS = new Set([
  'admin', 'admin123', 'password', '123456', '12345678', 'qwerty',
  'letmein', 'welcome', 'abc123', 'iloveyou'
]);

// ─── 哈希工具 ──────────────────────────────────────────────────
function hashPassword(plain) {
  const salt = crypto.randomBytes(SALT_LEN);
  const derived = crypto.scryptSync(plain, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p });
  return `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

function verifyPassword(plain, storedHash) {
  if (typeof storedHash !== 'string' || !storedHash.startsWith('scrypt$')) return false;
  try {
    const parts = storedHash.split('$');
    if (parts.length !== 6) return false;
    const N = Number(parts[1]); const r = Number(parts[2]); const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    const derived = crypto.scryptSync(plain, salt, expected.length, { N, r, p });
    // constant-time 比较,长度不一致时直接 false (不会抛)
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch (_) {
    return false;
  }
}

// ─── 登录限速 (IP + 用户名 双维度) ────────────────────────────
// key = `${ip}::${usernameLower}`,value = { fails: n, firstAt, blockedUntil }
const attemptBuckets = new Map();

function attemptKey(ip, username) {
  return `${ip}::${String(username || '').toLowerCase()}`;
}

/**
 * 检查是否被封。返回 { allowed, retryAfterMs }
 */
function checkRateLimit(ip, username) {
  const key = attemptKey(ip, username);
  const now = Date.now();
  const b = attemptBuckets.get(key);
  if (!b) return { allowed: true, retryAfterMs: 0 };
  if (b.blockedUntil && b.blockedUntil > now) {
    return { allowed: false, retryAfterMs: b.blockedUntil - now };
  }
  // 窗口已过 → 重置
  if (b.firstAt && now - b.firstAt > LOGIN_WINDOW_MS) {
    attemptBuckets.delete(key);
    return { allowed: true, retryAfterMs: 0 };
  }
  return { allowed: true, retryAfterMs: 0 };
}

function recordFailure(ip, username) {
  const key = attemptKey(ip, username);
  const now = Date.now();
  let b = attemptBuckets.get(key);
  if (!b || (b.firstAt && now - b.firstAt > LOGIN_WINDOW_MS)) {
    b = { fails: 0, firstAt: now, blockedUntil: 0 };
    attemptBuckets.set(key, b);
  }
  b.fails += 1;
  if (b.fails >= LOGIN_MAX_ATTEMPTS) {
    b.blockedUntil = now + LOGIN_BLOCK_MS;
    console.warn(`[merchantAuth] Login blocked for ${key}: ${b.fails} failures within window`);
  }
}

function recordSuccess(ip, username) {
  attemptBuckets.delete(attemptKey(ip, username));
}

// 定期清理过期桶,防止 Map 内存增长
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of attemptBuckets) {
    const expired = (b.blockedUntil && b.blockedUntil <= now) ||
      (b.firstAt && now - b.firstAt > LOGIN_WINDOW_MS);
    if (expired) attemptBuckets.delete(k);
  }
}, 5 * 60 * 1000).unref?.();

// ─── session CRUD ──────────────────────────────────────────────
function createSession(merchantId, ip, userAgent) {
  const token = crypto.randomBytes(32).toString('hex');  // 64-char
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();
  // 先删旧 session (one-session-per-user: 用户只能在一处登录)
  db.prepare('DELETE FROM merchant_sessions WHERE merchant_id = ?').run(merchantId);
  db.prepare(`
    INSERT INTO merchant_sessions (token, merchant_id, expires_at, ip, user_agent)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, merchantId, expiresAt, ip || null, (userAgent || '').slice(0, 200));
  return { token, expiresAt };
}

/**
 * 校验 token: 返回对应 merchant (无则 null),同时:
 *  - 已过期 → 删除并返回 null
 *  - 滑动续期: 若距 last_seen_at 已超过 SESSION_RENEW_MS,自动延长 expires_at
 */
function findMerchantByToken(token, ip) {
  if (!token || typeof token !== 'string' || token.length < 32) return null;
  const row = db.prepare(`
    SELECT s.token, s.merchant_id, s.expires_at, s.last_seen_at,
           m.id, m.username, m.role, m.disabled
    FROM merchant_sessions s
    JOIN merchants m ON m.id = s.merchant_id
    WHERE s.token = ?
  `).get(token);
  if (!row) return null;
  if (row.disabled) {
    deleteSession(token);
    return null;
  }
  const now = new Date();
  const expiresAt = new Date(row.expires_at.replace(' ', 'T') + (row.expires_at.endsWith('Z') ? '' : 'Z'));
  if (expiresAt.getTime() <= now.getTime()) {
    db.prepare('DELETE FROM merchant_sessions WHERE token = ?').run(token);
    return null;
  }
  // 滑动续期
  const lastSeen = new Date(row.last_seen_at.replace(' ', 'T') + (row.last_seen_at.endsWith('Z') ? '' : 'Z'));
  if (now.getTime() - lastSeen.getTime() > SESSION_RENEW_MS) {
    const newExpiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
    db.prepare(`
      UPDATE merchant_sessions
      SET expires_at = ?, last_seen_at = ?
      WHERE token = ?
    `).run(newExpiresAt, now.toISOString(), token);
  } else {
    db.prepare(`UPDATE merchant_sessions SET last_seen_at = ? WHERE token = ?`)
      .run(now.toISOString(), token);
  }
  return { id: row.id, username: row.username, role: row.role };
}

function deleteSession(token) {
  if (!token) return false;
  const r = db.prepare('DELETE FROM merchant_sessions WHERE token = ?').run(token);
  return r.changes > 0;
}

// ─── 账号 CRUD ─────────────────────────────────────────────────
function findMerchantByUsername(username) {
  if (!username) return null;
  return db.prepare('SELECT * FROM merchants WHERE username = ?').get(username);
}

function findMerchantById(id) {
  return db.prepare('SELECT id, username, role, disabled, last_login_at, created_at FROM merchants WHERE id = ?').get(id);
}

function createMerchant(username, password, role = 'owner') {
  if (!USERNAME_REGEX.test(username)) {
    throw new Error('Username must be 3-32 chars, alphanumeric / underscore / dot / dash only');
  }
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    throw new Error('Password is too weak (in common-password list)');
  }
  const hash = hashPassword(password);
  const info = db.prepare(`
    INSERT INTO merchants (username, password_hash, role) VALUES (?, ?, ?)
  `).run(username, hash, role);
  return info.lastInsertRowid;
}

function changePassword(merchantId, oldPlain, newPlain) {
  const m = db.prepare('SELECT password_hash FROM merchants WHERE id = ?').get(merchantId);
  if (!m) throw new Error('Account not found');
  if (!verifyPassword(oldPlain, m.password_hash)) throw new Error('Old password is incorrect');
  if (newPlain.length < 8) throw new Error('New password must be at least 8 characters');
  if (WEAK_PASSWORDS.has(newPlain.toLowerCase())) throw new Error('New password is too weak');
  const newHash = hashPassword(newPlain);
  db.prepare(`
    UPDATE merchants
    SET password_hash = ?, updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(newHash, merchantId);
  // 改密后强制下线:删除该 merchant 的所有 session
  db.prepare('DELETE FROM merchant_sessions WHERE merchant_id = ?').run(merchantId);
  return true;
}

function markLogin(merchantId) {
  db.prepare(`
    UPDATE merchants
    SET last_login_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(merchantId);
}

// ─── 启动时种子账号 (生产环境必设环境变量) ──────────────────────
function ensureSeedAccount() {
  const username = process.env.MERCHANT_ADMIN_USERNAME;
  const password = process.env.MERCHANT_ADMIN_PASSWORD;

  if (username && password) {
    // 显式指定 → 强制覆盖/创建
    const existing = findMerchantByUsername(username);
    const hash = hashPassword(password);
    if (existing) {
      // 仅当密码哈希与新值不同才更新 (避免每次启动覆盖,浪费时间)
      const verifyOk = verifyPassword(password, existing.password_hash);
      if (!verifyOk) {
        db.prepare(`UPDATE merchants SET password_hash = ?, disabled = 0, updated_at = datetime('now','localtime') WHERE id = ?`)
          .run(hash, existing.id);
        console.log(`✓ [merchantAuth] Seed admin '${username}' password reset from env`);
      } else {
        console.log(`✓ [merchantAuth] Seed admin '${username}' already up-to-date (from env)`);
      }
      return;
    }
    db.prepare(`INSERT INTO merchants (username, password_hash, role) VALUES (?, ?, 'owner')`)
      .run(username, hash);
    console.log(`✓ [merchantAuth] Seed admin '${username}' created (from env)`);
    return;
  }

  // 未配置 → 不创建默认账号,只警告
  const count = db.prepare('SELECT COUNT(*) AS n FROM merchants').get().n;
  if (count === 0) {
    console.warn('\n⚠ [merchantAuth] No merchant account configured.');
    console.warn('  Set MERCHANT_ADMIN_USERNAME and MERCHANT_ADMIN_PASSWORD in .env to create the first admin.');
    console.warn('  Login will be disabled until that is done.\n');
  }
}

// 启动时自动跑
ensureSeedAccount();

module.exports = {
  hashPassword,
  verifyPassword,
  checkRateLimit,
  recordFailure,
  recordSuccess,
  createSession,
  findMerchantByToken,
  deleteSession,
  findMerchantByUsername,
  findMerchantById,
  createMerchant,
  changePassword,
  markLogin,
  ensureSeedAccount,
  SESSION_TTL_MS,
  USERNAME_REGEX,
  WEAK_PASSWORDS
};

// filepath: coffee-app/server/test-merchant-auth.js
// 商家鉴权安全端到端测试。
// 设计要点:
//   • 启动时 seed 一个 admin / adminPass1234 账号(测试专用,不污染 .env)
//   • 多个用例顺序安排,避免"限速桶"影响后续用例:
//     [1] login ok → [2] 鉴权 → [4] /me → [5] logout → token 失效
//     [3] 限速放在 [5] 之后 → 限速需要错密码,会污染后续 login
//     [7] 改密场景委托给 dev fallback 验证(避免与限速冲突)
//     [8] dev fallback
//     [9] 安全响应头
//     [10] 哈希格式

const { spawn } = require('node:child_process');

const server = spawn(process.execPath, ['src/index.js'], {
  cwd: __dirname,
  env: {
    ...process.env,
    PORT: '3003',
    MERCHANT_ADMIN_USERNAME: 'admin',
    MERCHANT_ADMIN_PASSWORD: 'adminPass1234',
    ALLOW_DEV_MERCHANT_TOKEN: 'true'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let logs = '';
server.stdout.on('data', (b) => { logs += b.toString(); });
server.stderr.on('data', (b) => { logs += b.toString(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = 'http://localhost:3003';

async function req(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  let data;
  try { data = await res.json(); } catch (_) { data = {}; }
  return { status: res.status, data };
}

let pass = 0;
let fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.error('  ✗ ' + msg); }
}

async function runStage(name, fn) {
  console.log(`\n[${name}]`);
  await fn();
}

async function main() {
  await sleep(900);

  let adminToken = null;

  await runStage('1. 登录 + token 格式', async () => {
    const r = await req('POST', '/api/merchant-auth/login', {
      username: 'admin', password: 'adminPass1234'
    });
    assert(r.status === 200, '登录返回 200');
    assert(typeof r.data.data.token === 'string' && r.data.data.token.length >= 64,
      'token >= 64 字符 (randomBytes 32 字节 hex)');
    assert(/^[0-9a-f]+$/.test(r.data.data.token), 'token 是 16 进制字符');
    assert(r.data.data.username === 'admin', '回带 username');
    assert(r.data.data.expiresAt, '回带 expiresAt');
    adminToken = r.data.data.token;
  });

  await runStage('2. token 鉴权访问受限接口', async () => {
    const ok = await req('GET', '/api/merchant/orders?limit=1', null, adminToken);
    assert(ok.status === 200, '带真 token → 200');

    const noAuth = await req('GET', '/api/merchant/orders', null, null);
    assert(noAuth.status === 401, '无 token → 401');

    const fakeAuth = await req('GET', '/api/merchant/orders', null, 'fake-token-string');
    assert(fakeAuth.status === 401, '假 token → 401');
  });

  await runStage('4. /me 返回当前账号', async () => {
    const me = await req('GET', '/api/merchant-auth/me', null, adminToken);
    assert(me.status === 200, '/me 200');
    assert(me.data.data.username === 'admin', '/me.username === admin');
    assert(me.data.data.role === 'owner', '/me.role === owner');
  });

  await runStage('5. /logout 使旧 token 失效', async () => {
    const lo = await req('POST', '/api/merchant-auth/logout', {}, adminToken);
    assert(lo.status === 200, 'logout 200');
    const after = await req('GET', '/api/merchant-auth/me', null, adminToken);
    assert(after.status === 401, 'logout 后旧 token → 401');
    adminToken = null;
  });

  await runStage('3. 错密码限速 → 429', async () => {
    for (let i = 1; i <= 4; i++) {
      const r = await req('POST', '/api/merchant-auth/login', {
        username: 'admin', password: 'wrong' + i
      });
      assert(r.status === 401, `第 ${i} 次错误密码 → 401`);
    }
    const fifth = await req('POST', '/api/merchant-auth/login', {
      username: 'admin', password: 'wrong5'
    });
    assert(fifth.status === 429, '第 5 次错误密码 → 429 (服务端二次 check)');
    assert(typeof fifth.data.retryAfterMs === 'number', '429 含 retryAfterMs');
    const still = await req('POST', '/api/merchant-auth/login', {
      username: 'admin', password: 'adminPass1234'
    });
    assert(still.status === 429, '封禁后正确密码也 → 429');
  });

  await runStage('6. 多端会话并存 (PC + 手机)', async () => {
    // 限速桶还压着 → 用同一账号已经有 [1] 的 token 做这件事: 第二个 token 应独立
    // 但 [1] 的 token 没有被 [5] 删掉,这就要看 [5] 的代码: logout 仅删当前 token。
    // 我们再用一个新 ip 模拟"第二台设备" (注意: 限速绑定 IP+username,新 IP 不在同一桶)。
    // 现实: 限速桶的键是 IP::username,不同 IP 不互相影响。

    // 技巧: 用我刚 [1] 拿到的 token 做"PC session",再让 [1] token 重新用一个干净 IP 拿第二个 token
    // 不现实 — 客户端登录接口是公开的,只能在测试里模拟多 IP。
    // 最直接的验证: 直接走 service 层 createSession 两次
    const { createSession: cs, findMerchantByToken, listSessions } =
      require('./src/services/merchantAuth');
    const { db } = require('./src/db');
    const m = db.prepare('SELECT id FROM merchants WHERE username = ?').get('admin');
    const sessionBefore = db.prepare('SELECT COUNT(*) AS n FROM merchant_sessions WHERE merchant_id = ?')
      .get(m.id).n;

    // 制造两个新 session 模拟多端
    const a = cs(m.id, '192.168.1.10', 'Chrome/PC');
    const b = cs(m.id, '10.0.0.5', 'iPhone/Mobile');
    assert(typeof a.token === 'string' && a.token.length >= 64, 'A token 生成');
    assert(b.token !== a.token, 'A、B token 互不相同');

    // 两个都能查到对应 merchant
    const mA = findMerchantByToken(a.token);
    const mB = findMerchantByToken(b.token);
    assert(mA && mA.id === m.id, 'A token 能查到 merchant');
    assert(mB && mB.id === m.id, 'B token 能查到 merchant');

    // 计数
    const sessionAfter = db.prepare('SELECT COUNT(*) AS n FROM merchant_sessions WHERE merchant_id = ?')
      .get(m.id).n;
    assert(sessionAfter === sessionBefore + 2, '两台设备 session 都持久化了');

    // listSessions 正确返回 + is_current 标记
    const list = listSessions(m.id, a.token);
    assert(list.length >= 2, 'listSessions 返回至少 2 条');
    const currentItems = list.filter((s) => s.is_current);
    assert(currentItems.length === 1, '只有 1 条标记 is_current');
    assert(currentItems[0].token_suffix === a.token.slice(-6),
      'is_current 设备的 token_suffix 与 A token 匹配');
    assert(!list.find((s) => s.token_suffix === a.token.slice(-6)).is_current === false,
      'A 在列表中且 is_current=true');
  });

  await runStage('7. 改密 - dev fallback 被拒 + 真密码清空所有 session', async () => {
    // dev fallback 不能改密(没有对应 merchant 行)
    const devReject = await req('POST', '/api/merchant-auth/change-password', {
      oldPassword: 'adminPass1234', newPassword: 'newPass5678'
    }, 'merchant-local-token');
    assert(devReject.status === 403, 'dev fallback 改密 → 403 (拒绝)');

    // 直接 service 层验证 (避开 [3] 留下的限速桶):
    // - 改密成功
    // - 改密后清空该 merchant_id 下的所有 session
    // - 旧密码验证失败,新密码验证通过
    const {
      findMerchantByUsername,
      changePassword: changePw
    } = require('./src/services/merchantAuth');
    const m = findMerchantByUsername('admin');
    assert(!!m, 'admin 账号存在');

    changePw(m.id, 'adminPass1234', 'tempPass9999');
    const { verifyPassword } = require('./src/services/merchantAuth');
    const row = require('./src/db').db.prepare('SELECT password_hash FROM merchants WHERE id = ?').get(m.id);
    assert(verifyPassword('tempPass9999', row.password_hash), '新密码验证成功');
    assert(!verifyPassword('adminPass1234', row.password_hash), '旧密码验证失败');

    const sessCount = require('./src/db').db.prepare('SELECT COUNT(*) AS n FROM merchant_sessions WHERE merchant_id = ?').get(m.id).n;
    assert(sessCount === 0, '改密后所有 session 被清');

    // 回滚
    changePw(m.id, 'tempPass9999', 'adminPass1234');

    // [6] 的多端 session 已经被这次改密清掉了,补一次重建,让后续测试稳定
    const { createSession: cs2 } = require('./src/services/merchantAuth');
    cs2(m.id, '192.168.1.10', 'Chrome/PC');
    cs2(m.id, '10.0.0.5', 'iPhone/Mobile');
  });

  await runStage('11. 多端管理: revoke-others', async () => {
    // 当前账号应有 2 个 session (来自 [7] 重建)。拿其中一个 token 调 revoke-others,
    // 应只保留请求所用 token 自身
    const { listSessions: ls, findMerchantByToken } = require('./src/services/merchantAuth');
    const { db } = require('./src/db');
    const m = db.prepare('SELECT id FROM merchants WHERE username = ?').get('admin');

    // 找一个 token 来代表"当前客户端"
    const tokens = db.prepare('SELECT token FROM merchant_sessions WHERE merchant_id = ? LIMIT 2').all(m.id);
    assert(tokens.length >= 2, '至少有 2 个 session 可以测');

    // 第一次 revoke-others,保留 token[0]
    const { revokeAllOtherSessions: rao } = require('./src/services/merchantAuth');
    const n1 = rao(m.id, tokens[0].token);
    assert(n1 >= 1, 'revoke-others 至少删除 1 条');

    // 现在只应剩 1 条
    const after = db.prepare('SELECT COUNT(*) AS n FROM merchant_sessions WHERE merchant_id = ?').get(m.id).n;
    assert(after === 1, '剩下 1 条 session');
    const remaining = db.prepare('SELECT token FROM merchant_sessions WHERE merchant_id = ?').get(m.id);
    assert(remaining.token === tokens[0].token, '保留下来的是当前 token');
  });

  await runStage('8. dev fallback 在 dev 模式下可用', async () => {
    const me = await req('GET', '/api/merchant-auth/me', null, 'merchant-local-token');
    assert(me.status === 200, 'dev fallback → 200');
    assert(me.data.data.username === 'dev-fallback', 'username === dev-fallback');
    assert(me.data.data.role === 'owner', 'role === owner');
  });

  await runStage('9. 安全响应头 + Cache-Control', async () => {
    const h = await fetch(BASE + '/api/health');
    assert(h.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options nosniff');
    assert(h.headers.get('x-frame-options') === 'DENY', 'X-Frame-Options DENY');
    assert((h.headers.get('permissions-policy') || '').includes('camera=()'), 'Permissions-Policy 禁用摄像头');

    const r = await fetch(BASE + '/api/merchant/orders', {
      headers: { Authorization: 'Bearer merchant-local-token' }
    });
    assert(r.headers.get('cache-control') === 'no-store', '受限响应 Cache-Control no-store');
    assert(r.headers.get('pragma') === 'no-cache', '受限响应 Pragma no-cache');
  });

  await runStage('10. 密码哈希安全', async () => {
    const { db } = require('./src/db');
    const row = db.prepare('SELECT password_hash FROM merchants WHERE username = ?').get('admin');
    assert(row.password_hash.startsWith('scrypt$16384$8$1$'), '哈希格式 scrypt$N$r$p$…');
    assert(row.password_hash.length > 100, '哈希很长 (>100 chars)');
    assert(!row.password_hash.includes('adminPass1234'), '明文密码不在 hash 中');
    const parts = row.password_hash.split('$');
    assert(parts.length === 6, '6 段 (algorithm + N + r + p + salt + key)');
    assert(parts[4].length >= 22, 'salt base64 ≥ 22 字符 (16 字节)');
    console.log('    哈希样例: ' + row.password_hash.slice(0, 50) + '…');
  });

  console.log(`\n--- 总结 ---`);
  console.log(`通过: ${pass}`);
  console.log(`失败: ${fail}`);
  if (fail > 0) throw new Error(`${fail} 个断言失败`);
  console.log('--- 全部安全检查通过 ✅ ---');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFAIL:', err.message);
    console.error(logs);
    process.exit(1);
  })
  .finally(() => {
    setTimeout(() => { try { server.kill('SIGTERM'); } catch (_) {} }, 200);
  });

// filepath: coffee-app/server/src/services/autoCancel.js
// auto-cancel-unpaid-orders
//
// 自动取消超时未支付订单的后台任务。
// - 单语句 UPDATE 原子取消 (status='pending' AND created_at < cutoff),天然幂等。
// - 每 tick 重新读取阈值与间隔,商家在后台改设置后下一次 tick 即生效。
// - 关停语义: clearInterval 已注册的 handle,SIGTERM/SIGINT 时调用 stop()。
//
// 与路由层无耦合,启动/关闭由 src/index.js 控制。

const { db } = require('../db');
const {
  getAutoCancelSeconds,
  getAutoCancelScanIntervalSeconds
} = require('./level');

// 单次 tick 取消超过该阈值则 WARN,便于发现历史数据批量清理场景
const LARGE_SWEEP_WARN_THRESHOLD = 1000;

// 取消 SQL: cutoff 用参数化,避免 SQL 注入。
// 注意: cutoff 形如 'YYYY-MM-DD HH:MM:SS' 是 SQLite datetime('now', ...) 的格式,
// 所以这里用一个减法表达式而不是 bind 参数 — datetime() 内部的修饰只能字面量。
// 因此 cutoff 字符串我们必须自己组装,但其内容是数字化的秒数,安全。
function tick() {
  const start = Date.now();
  const thresholdSeconds = getAutoCancelSeconds();

  // 阈值是受控数字 (>= 1), 拼接后是 SQL 常量,无注入风险。
  const cutoffSql = `datetime('now', '-${Math.floor(thresholdSeconds)} seconds', 'localtime')`;

  const sql = `
    UPDATE orders
       SET status = 'cancelled',
           cancel_reason = 'auto_timeout',
           cancelled_at = datetime('now', 'localtime'),
           updated_at = datetime('now', 'localtime')
     WHERE status = 'pending'
       AND created_at < ${cutoffSql}
  `;

  let cancelled = 0;
  try {
    const res = db.prepare(sql).run();
    cancelled = res.changes;
  } catch (err) {
    console.error('auto-cancel tick failed:', err.message);
    return;
  }

  const durationMs = Date.now() - start;
  console.log(
    JSON.stringify({
      event: 'auto-cancel-tick',
      cancelled,
      durationMs,
      thresholdSeconds
    })
  );

  if (cancelled > LARGE_SWEEP_WARN_THRESHOLD) {
    console.warn(`auto-cancel large sweep: ${cancelled} rows`);
  }
}

let handle = null;
let currentInterval = null;

/**
 * 启动定时任务。
 * - 第一次立即执行一次 tick,避免启动到下一次 setInterval 之间窗口里的过期订单被遗漏。
 * - 之后每 interval 秒执行一次。
 * - 当商家在后台改了 scan interval,下次 reschedule 会用最新值。
 */
function start() {
  if (handle) {
    // 已运行则不重复启动,但同步到最新 interval (便于热更新)
    rescheduleIfChanged();
    return;
  }
  schedule();
  // 启动时打一条 armed 日志,便于运维在启动日志里一眼确认任务上线
  const thresholdSeconds = getAutoCancelSeconds();
  const intervalSeconds = getAutoCancelScanIntervalSeconds();
  console.log(`auto-cancel task armed, threshold=${thresholdSeconds}s, interval=${intervalSeconds}s`);
}

function schedule() {
  const intervalSeconds = getAutoCancelScanIntervalSeconds();
  currentInterval = intervalSeconds;
  // 第一次立刻执行一次,避免冷启动后等到第一个 interval 才动手
  tick();
  handle = setInterval(() => {
    rescheduleIfChanged();
    tick();
  }, intervalSeconds * 1000);
}

function rescheduleIfChanged() {
  const intervalSeconds = getAutoCancelScanIntervalSeconds();
  if (intervalSeconds !== currentInterval) {
    clearInterval(handle);
    handle = null;
    schedule();
  }
}

function stop() {
  if (handle) {
    clearInterval(handle);
    handle = null;
    console.log('auto-cancel task stopped');
  }
}

// 测试用钩子: 触发一次 tick 但不修改调度状态
const __test = { tick };

module.exports = { start, stop, __test };
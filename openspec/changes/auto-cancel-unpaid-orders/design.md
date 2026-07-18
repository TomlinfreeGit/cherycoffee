## Context

- **现状**：`orders.status = 'pending'` 是下单后、支付前的中间态。当前只有商家手动调 `PATCH /api/orders/:id/status` 才能取消，没有任何后台机制回收超时订单。服务器 (`coffee-app/server/src/index.js`) 启动时仅 `app.listen(...)`，没有注册后台任务。
- **数据库**：`node:sqlite` (better-sqlite3 风格) 同步 API；`orders` 表已有 `idx_orders_status` 与 `idx_orders_created_at`。`settings` 表已是 key-value 结构 (`src/services/settings.js`)，新增两个键几乎零成本。
- **运行时**：单进程 Express 服务，长连接；适合用 `setInterval` 而非独立 worker（避免引入新依赖）。
- **约束**：
  - 不能阻塞 HTTP 请求路径；
  - 取消操作必须幂等（并发 webhook + 定时器可能撞车）；
  - 配置热更新（商家后台改设置后无需重启）。

## Goals / Non-Goals

**Goals**
- 1 小时内未支付的 `pending` 订单被自动取消（阈值可配置）；
- 取消是事务化的，状态机写入安全，并写入 `cancel_reason='auto_timeout'` 与 `cancelled_at`；
- 商家后台能调整阈值与扫描间隔；
- 不引入新 npm 依赖；幂等；启动/关停时不丢不重。

**Non-Goals**
- 通知顾客（短信/模板消息）—— 留给后续工单；
- 退还优惠券/积分 —— 现状是下单后才扣等级进度，本工单不动；
- 多副本部署下的 leader election —— 单进程即可；
- 商家手动改订单 `cancelled_at` 的 UI —— 仅展示，不允许手填。

## Decisions

### 1. 用 `setInterval` 而非独立 worker / BullMQ

- **理由**：单进程 Express，无分布式诉求；`setInterval` 零依赖。扫描 SQL 是单条 `UPDATE ... WHERE` 走索引，几毫秒可完成。
- **替代**：`node-cron`、`bullmq`。前者只是语法糖，后者引入 Redis，代价不匹配。

### 2. 用一条 `UPDATE ... WHERE` 原子化取消，而非"先 SELECT 再逐条 UPDATE"

```sql
UPDATE orders
   SET status = 'cancelled',
       cancel_reason = 'auto_timeout',
       cancelled_at = datetime('now', 'localtime'),
       updated_at = datetime('now', 'localtime')
 WHERE status = 'pending'
   AND created_at < datetime('now', '-3600 seconds', 'localtime');
```

- **理由**：单语句天然幂等（重复执行不会再次修改 `cancelled` 行）；返回 `changes()` 即"本轮取消数"，用于日志。
- **替代**：先 `SELECT id` 再循环 `UPDATE`，需事务 + 行锁，多一倍代码且无收益。
- **索引**：现有 `idx_orders_status` + `idx_orders_created_at` 已能服务此查询；仍额外补 `(status, created_at)` 复合索引以确保 SQLite 选 `status` 索引扫描后再按 `created_at` 范围过滤，避免退化为全表扫。复合索引在百万行规模上才有意义，但成本几乎为零，先建上。

### 3. 配置存在 `settings` 表，每 tick 重新读

- 服务层只暴露两个函数 `getAutoCancelSeconds()` 与 `getAutoCancelScanIntervalSeconds()`，内部查 `settings`。
- 任务里每次 `setInterval` 回调都从 settings 重读一次间隔与阈值，商家后台改完后下一次 tick 即生效。
- **替代**：用内存变量 + pubsub 通知更新。多一层失效机制，收益小。

### 4. 关停语义：`SIGTERM`/`SIGINT` 触发 `clearInterval`

- 在 `src/index.js` 注册 `process.on('SIGTERM', stop)` / `process.on('SIGINT', stop)`，调用 `autoCancel.stop()`，保证 PM2 / Docker stop 时不会有回调在退出途中执行一半。
- 退出时已经在事务里的 SQL 会被 SQLite 自然 abort，无半完成状态。

### 5. 历史数据兼容：在 schema 迁移里删除 7 天以上的 `pending`

- SQLite 跑迁移时，若 `created_at < datetime('now', '-7 days') AND status='pending'`，一次 DELETE + WARN 日志，避免新任务一上线就取消全部历史测试单。
- 7 天内（包括正在生效的 1 小时）的不动，商家能看到还在板的"陈年挂单"。

### 6. UI 表达：在订单详情顶部加一条横幅

- 命中条件：`status === 'cancelled' && cancel_reason === 'auto_timeout'`。
- 商家端用 hover tooltip 即可，避免新增弹窗组件。

## Risks / Trade-offs

- **Risk：服务器长时间宕机重启后会一次性取消大量过期订单** → Mitigation：一次 SQL 仍是事务级别的；如一次性超过 1000 行，记录 WARN 让运维知晓。
- **Risk：商家把扫描间隔改到极小（如 1 秒）导致 DB 抖动** → Mitigation：后端对 `auto_cancel_scan_interval_seconds` 做范围校验（最小 10 秒，最大 3600 秒）。
- **Risk：顾客在第 59 分 59 秒支付时碰上 tick** → Mitigation：tick 时刻用 `<` 严格小于，差 1 秒的订单本轮不取消；最坏情况差一轮间隔，不会出现"刚付的钱被回滚"。
- **Risk：`SET cancel_reason` 在某些 SQLite 版本不支持修改已带默认值的列** → Mitigation：列定义为 `TEXT DEFAULT NULL`，nullable 写入无障碍；迁移用 try-catch 包裹 `ALTER TABLE`。
- **Trade-off**：不做商家主动触发"立即扫描"按钮 —— 简单一些；如后续需要，再补 `POST /api/merchant/orders/sweep-unpaid` 即可。

## Migration Plan

1. **Schema 迁移**（在 `src/db/index.js` 的 `migrate()` 末尾）：
   - `ALTER TABLE orders ADD COLUMN cancel_reason TEXT`（try-catch 兜"重复列"）；
   - `ALTER TABLE orders ADD COLUMN cancelled_at TEXT`（同上）；
   - `CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status, created_at)`；
   - 历史清理：`DELETE FROM orders WHERE status='pending' AND created_at < datetime('now','-7 days')` + `console.warn`。
2. **配置种子**：在 settings 里若两键不存在则写入默认值 3600 / 60。
3. **代码部署**：依次发布 `services/autoCancel.js`、修改 `index.js`、更新 orders/merchant 路由的 SELECT。
4. **前端灰度**：订单详情加横幅（纯前端热更新即可，不需要后端协调）。
5. **回滚**：若上线后出问题，删 `autoCancel.start()` 调用 + 关停 interval 即可回退；新加的两列 nullable 不影响旧逻辑。

## Open Questions

- 自动取消是否要给顾客发模板消息"您的订单 X 因超时已取消"？—— 建议下个 change 单独做，本工单不做。
- 商家后台是否暴露"立即扫描一次"按钮？—— 见 Risks 的 Trade-off，待 PM 拍板。
- 阈值是否要按"商品类别"分别配置（如现做饮品 vs 蛋糕礼盒）？—— 现阶段单一阈值，分类阈值待业务方反馈。
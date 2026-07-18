## Why

当前订单一旦创建为 `pending` 状态，若顾客长时间未支付，订单将一直占用取餐号位、库存资源，并干扰商家看板上"待支付/待制作"的统计。需要为未支付订单增加自动取消机制：超过 1 小时仍为 `pending` 的订单自动转为 `cancelled`，并记录取消原因，便于商家腾出取餐号资源、顾客收到清晰反馈。

## What Changes

- **新增后台定时任务**：服务端启动后注册一个周期任务（默认每 60 秒一轮），扫描 `orders` 表中 `status = 'pending'` 且 `created_at` 早于"当前时间 - 配置阈值"的订单，事务化地将状态置为 `cancelled` 并写入 `cancel_reason = 'auto_timeout'` 与 `cancelled_at` 时间戳。
- **新增配置项**：在 `settings` 表中新增两个键（默认 3600 秒超时、60 秒扫描间隔），商家后台可在"系统设置"页面查看/修改。修改后无需重启服务即可生效（任务下一次 tick 时读取最新值）。
- **数据库迁移**：在 `orders` 表上新增 `cancel_reason TEXT` 与 `cancelled_at TEXT` 两个可空列，并补上 `(status, created_at)` 复合索引以加速扫描。
- **订单列表/详情返回**：现有 `GET /api/orders`、`GET /api/orders/:id`、`GET /api/merchant/orders` 响应中追加 `cancel_reason` 与 `cancelled_at` 字段（NULL 时省略）。
- **小程序/商家 UI 适配**：订单详情页在状态为 `cancelled` 且 `cancel_reason === 'auto_timeout'` 时，顶部展示"因超时未支付，已自动取消"灰色提示横幅；商家端订单列表状态徽章沿用 `cancelled` 但支持悬停查看原因。
- **可观测性**：定时任务每次运行写入结构化日志 `{ scanned, cancelled, durationMs, thresholdSeconds }`，便于运维排查；首次启动时也打印一次"auto-cancel task armed, threshold=Xs, interval=Ys"。

## Capabilities

### New Capabilities

- `auto-cancel-task`: 服务端周期任务，自动取消超时未支付的订单；包含配置项读取、扫描、状态机转换、幂等保护与日志。

### Modified Capabilities

- `order-management`: 增加 `cancel_reason` / `cancelled_at` 两个字段在订单响应中的体现，并扩展状态机（pending → cancelled via auto_timeout）的合法转换。
- `settings`: 商家后台设置页需新增两个键 `order_auto_cancel_seconds` 与 `auto_cancel_scan_interval_seconds` 的展示与编辑入口（默认值同上）。

## Impact

- **后端**：`coffee-app/server/src/` 新增 `services/autoCancel.js`；在 `src/index.js` 启动钩子里调用其 `start()`；`src/db/schema.js` 新增两列 + 一索引；`src/routes/orders.js` 与 `src/routes/merchant.js` 在 SELECT 中带出新字段；`src/routes/settings.js` 暴露两个新设置键。
- **数据库**：现有 `data/` 下的 SQLite 文件需要一次性迁移（`ALTER TABLE orders ADD COLUMN cancel_reason TEXT` / `ADD COLUMN cancelled_at TEXT` + `CREATE INDEX`）。Schema 中已用 `IF NOT EXISTS`/try-catch 包裹，幂等。
- **小程序**：`coffee-app/mini-program/pages/order-detail/order-detail.{wxml,js,wxss}` 增加"自动取消"横幅。
- **商家端**：`coffee-app/merchant-web/src/pages/orders/` 与 `settings/` 页面增加对应展示/编辑。
- **可观测性**：新增一行 stdout 日志；无需新依赖。
- **风险**：定时任务首次启动会触发大量历史 `pending` 订单一次性被取消（迁移前数据库里堆积的测试数据）。缓解：迁移时同步清理 `created_at` 早于 7 天且 `status = 'pending'` 的订单，或在 `start()` 时一次性消化历史记录并单独打 WARN 日志。
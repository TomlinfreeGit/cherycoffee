# Server

咖啡小程序 / 商家后台的后端服务 (Node.js + Express + node:sqlite)。

## 快速启动

```powershell
cd coffee-app/server
npm install
npm start            # 默认监听 :3000
npm run dev          # node --watch 热重载
```

## 配置

所有可调参数写在 `.env` 中，可参考 `.env.example`。商家可在"系统设置"页面调整
部分运行时参数（无需重启即可生效）：

| Key                              | 范围                  | 默认    | 说明                              |
|----------------------------------|-----------------------|---------|-----------------------------------|
| `level_orders_required`          | 1–10000 整数          | 10      | 每多少单升一级                    |
| `level_discount_increment`       | 0.001–0.5             | 0.01    | 每级折扣增量                      |
| `min_discount`                   | 0.10–1.00             | 0.80    | 最低折扣                          |
| `order_auto_refresh_ms`          | 5000–600000 整数(ms)  | 10000   | 后台订单列表自动刷新间隔           |
| `order_auto_cancel_seconds`      | 30–86400 整数(秒)     | 3600    | 未支付订单超时自动取消阈值         |
| `auto_cancel_scan_interval_seconds` | 10–3600 整数(秒)  | 60      | 后台扫描间隔                      |

## 自动取消超时订单 (`auto-cancel-unpaid-orders`)

服务器启动后自动注册一个 `setInterval` 任务：

- 每 N 秒（默认 60，可在商家后台调整）扫描一次 `orders` 表；
- 把 `status='pending'` 且 `created_at < now - 阈值秒` 的订单，**单条 SQL**
  原子地置为 `cancelled`，并写入 `cancel_reason='auto_timeout'` 与 `cancelled_at`；
- 取消完成后打印一行 JSON 结构化日志：
  ```json
  {"event":"auto-cancel-tick","cancelled":N,"durationMs":T,"thresholdSeconds":S}
  ```
- 若本轮取消行数 > 1000，会额外打一条 `WARN: auto-cancel large sweep: N rows`，
  便于发现历史数据批量清理场景。

### 启动 / 关闭

- 启动：`app.listen` 之后调用 `autoCancel.start()`，启动时打印一行：
  ```
  auto-cancel task armed, threshold=Xs, interval=Ys
  ```
- 关闭：`SIGTERM` / `SIGINT` 触发 `autoCancel.stop()`，调用 `clearInterval`，
  关闭途中不会有半完成的事务写入。

### 配置热更新

任务每次 tick 都从 `settings` 表重读阈值与间隔，商家在后台保存后**下一次 tick
即生效**，无需重启服务。如果商家把扫描间隔改到一个与当前不同的值，任务会在下
一个 tick 自动 reschedule。

### Rollout / Rollback

**Rollout**:
1. 部署新代码（含 `services/autoCancel.js` 与 `index.js` 改动）。
2. 服务首次启动会执行一次 `migrate()`：自动加 `cancel_reason`、`cancelled_at`
   两列，建复合索引，并删除 `pending` 且 `created_at < now - 7 days` 的历史挂单
   （一次性 `WARN` 日志记录数量）。
3. 启动日志出现 `auto-cancel task armed, ...` 即视为成功。

**Rollback**:
- 临时停用：注释 `src/index.js` 中 `autoCancel.start()` 的调用，重启服务即可。
  新增的两列 `cancel_reason` / `cancelled_at` 都是 nullable，旧代码路径不会报错。
- 完全回滚：移除 `services/autoCancel.js` 的引用，并把 `src/db/index.js` 的迁移
  数组里两行 `cancel_reason` / `cancelled_at` 也清掉（可选，列保留也无副作用）。

### 监控

- 看是否在跑：日志中应每小时出现至少一行 `auto-cancel-tick`。
- 看是否健康：`cancelled` 长期为 0 且没有 ERROR，视为正常。
- 看是否过载：出现 `auto-cancel large sweep` WARN 时人工确认是否历史数据残留。

## 测试

```powershell
npm test                 # 全部集成测试
npm run test:auto-cancel # 仅本特性的测试 (含纯函数 + 集成)
```

要求服务已在 `localhost:3000` 跑（dev token `merchant-local-token` 接受）。
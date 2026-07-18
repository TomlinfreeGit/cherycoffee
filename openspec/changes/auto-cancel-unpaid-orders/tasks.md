## 1. Database Schema & Migration

- [x] 1.1 Add `cancel_reason TEXT` column to `orders` table via try-catch `ALTER TABLE` in `src/db/index.js` migrate step
- [x] 1.2 Add `cancelled_at TEXT` column to `orders` table via try-catch `ALTER TABLE` in the same step
- [x] 1.3 Create composite index `idx_orders_status_created ON orders(status, created_at)` (idempotent)
- [x] 1.4 Backfill-cancellation: delete `pending` orders older than 7 days with WARN log

## 2. Settings Keys (Seed & Read Helpers)

- [x] 2.1 Add `getAutoCancelSeconds()` and `getAutoCancelScanIntervalSeconds()` helpers in `src/services/settings.js`
- [x] 2.2 Default to `3600` and `60` when keys are missing
- [x] 2.3 Clamp `auto_cancel_scan_interval_seconds` to `[10, 3600]` with WARN if out of range

## 3. Auto-Cancel Service

- [x] 3.1 Create `src/services/autoCancel.js` exporting `start()` and `stop()`
- [x] 3.2 Implement single-statement `UPDATE orders SET status='cancelled', cancel_reason='auto_timeout', cancelled_at=..., updated_at=... WHERE status='pending' AND created_at < ?`
- [x] 3.3 Compute cutoff via `datetime('now', '-X seconds', 'localtime')` with X from settings
- [x] 3.4 Use `setInterval`; on each tick re-read threshold and interval; reschedule if interval changes
- [x] 3.5 Log structured `{ event: 'auto-cancel-tick', cancelled, durationMs, thresholdSeconds }` per tick
- [x] 3.6 WARN log when a single tick cancels more than 1000 rows
- [x] 3.7 Wire `autoCancel.start()` into `src/index.js` after `app.listen`
- [x] 3.8 Wire `process.on('SIGTERM'/'SIGINT', autoCancel.stop)` in `src/index.js`

## 4. Order API Responses

- [x] 4.1 Update `GET /api/orders` SELECT to include `cancel_reason, cancelled_at`
- [x] 4.2 Update `GET /api/orders/:id` SELECT to include `cancel_reason, cancelled_at`
- [x] 4.3 Update `GET /api/merchant/orders` and `GET /api/merchant/orders/:id` likewise
- [x] 4.4 Update `PATCH /api/orders/:id/status` to set `cancel_reason='merchant'` and `cancelled_at` when transitioning to `cancelled`

## 5. Settings API Surface

- [x] 5.1 Add `order_auto_cancel_seconds` to the public `GET /api/settings` payload
- [x] 5.2 Add `auto_cancel_scan_interval_seconds` to the public `GET /api/settings` payload
- [x] 5.3 Extend `PATCH /api/merchant/settings` to validate and persist the two new keys (integer type, range checks)
- [x] 5.4 Return validation error `400` for non-integer or out-of-range values

## 6. Customer UI (Mini-Program)

- [x] 6.1 In `order-detail.wxml`, add a banner `<view class="auto-cancel-banner" wx:if="{{order.cancel_reason === 'auto_timeout'}}">因超时未支付，已自动取消</view>`
- [x] 6.2 Render `cancelled_at` next to the banner in `YYYY-MM-DD HH:mm` format
- [x] 6.3 Style the banner with grey background in `order-detail.wxss`

## 7. Merchant Web UI

- [x] 7.1 In `merchant-web` settings page, add two labelled inputs for `order_auto_cancel_seconds` and `auto_cancel_scan_interval_seconds`
- [x] 7.2 Pre-fill inputs from `GET /api/settings`
- [x] 7.3 Wire the form to `PATCH /api/merchant/settings`; show toast on success and refresh
- [x] 7.4 Show range hint under the scan-interval input (`10–3600 秒`)
- [x] 7.5 In merchant orders list/detail, display a small "自动取消" tag when `cancel_reason === 'auto_timeout'`

## 8. Tests

- [x] 8.1 Unit test: `autoCancel` tick cancels orders older than threshold and leaves newer ones alone
- [x] 8.2 Unit test: tick is idempotent when run twice (second run changes 0 rows)
- [x] 8.3 Unit test: settings clamp returns 10 for values < 10 and 3600 for values > 3600
- [x] 8.4 Integration test: `PATCH /api/orders/:id/status` to `cancelled` writes `cancel_reason='merchant'` and `cancelled_at`
- [x] 8.5 Migration test: re-running schema migration against an existing DB does not throw

## 9. Observability & Rollout

- [x] 9.1 Confirm startup log line appears once: `auto-cancel task armed, threshold=Xs, interval=Ys`
- [x] 9.2 Verify `SIGTERM` cleanly stops the timer (`process.exit` test)
- [x] 9.3 Document rollout & rollback steps in `README.md` (or `coffee-app/server/README.md`)
- [x] 9.4 Re-run `openspec validate auto-cancel-unpaid-orders` and `openspec list` to confirm artifacts are apply-ready
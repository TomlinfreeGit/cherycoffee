## ADDED Requirements

### Requirement: Auto-cancel timer registered at server startup

The system MUST register a background timer when the HTTP server starts and clear it on `SIGTERM` / `SIGINT`.

#### Scenario: Server boots
- **WHEN** `src/index.js` finishes binding the Express app to a port
- **THEN** the system SHALL call `autoCancel.start()` which schedules a recurring task
- **AND** it SHALL log one line `auto-cancel task armed, threshold=Xs, interval=Ys`

#### Scenario: Server receives shutdown signal
- **WHEN** the process receives `SIGTERM` or `SIGINT`
- **THEN** the system SHALL call `autoCancel.stop()` which clears the interval
- **AND** no further cancellation SQL statements SHALL be issued after `stop()` returns

### Requirement: Threshold-based cancellation of pending orders

The system MUST atomically cancel every `pending` order whose `created_at` is older than the configured threshold.

#### Scenario: Pending order exceeds threshold
- **WHEN** a `pending` order has `created_at < now - threshold_seconds`
- **THEN** the next task tick SHALL set its `status` to `cancelled`
- **AND** SHALL set `cancel_reason = 'auto_timeout'`
- **AND** SHALL set `cancelled_at = datetime('now', 'localtime')`
- **AND** SHALL update `updated_at`

#### Scenario: Pending order still within threshold
- **WHEN** a `pending` order has `created_at >= now - threshold_seconds`
- **THEN** the task SHALL NOT modify that order

#### Scenario: Idempotent execution
- **WHEN** the task tick runs while a previous tick's update is still in flight
- **THEN** the second run SHALL NOT re-modify already-cancelled rows
- **AND** the SQL `UPDATE ... WHERE status='pending'` MUST be used so the engine skips already-cancelled rows

#### Scenario: Non-pending orders are untouched
- **WHEN** an order has any status other than `pending` (e.g. `paid`, `preparing`, `completed`, `cancelled`)
- **THEN** the task SHALL NOT modify it regardless of age

### Requirement: Configurable threshold and interval via settings

The system MUST read the threshold (seconds) and the scan interval (seconds) from the `settings` table on every tick, defaulting to `3600` and `60` respectively.

#### Scenario: Settings key missing on first run
- **WHEN** `settings` table has no row for `order_auto_cancel_seconds`
- **THEN** the system SHALL treat the threshold as `3600` seconds
- **AND** SHALL treat `auto_cancel_scan_interval_seconds` as `60` seconds
- **AND** the values are not persisted in this case (lazy seed only when merchant saves them)

#### Scenario: Merchant changes the threshold
- **WHEN** merchant updates `order_auto_cancel_seconds` to a new value via the settings UI/API
- **THEN** the very next task tick SHALL use the new value without restarting the server

#### Scenario: Invalid interval value
- **WHEN** `auto_cancel_scan_interval_seconds` is set below `10` or above `3600`
- **THEN** the system SHALL clamp the effective interval to the nearest boundary (`10` or `3600`) and log a WARN

### Requirement: Structured logging per tick

The system MUST emit one structured log line per tick with the count of orders it cancelled and how long the tick took.

#### Scenario: Normal tick
- **WHEN** the tick runs and cancels `N` orders in `T` ms
- **THEN** the system SHALL log `{ event: 'auto-cancel-tick', scanned: N, durationMs: T, thresholdSeconds: <threshold> }`

#### Scenario: First tick after long downtime
- **WHEN** more than 1000 rows are cancelled in a single tick
- **THEN** the system SHALL additionally log a WARN line `auto-cancel large sweep: N rows` so operators can investigate

### Requirement: Graceful startup cleanup of stale rows

The system MUST, during the migration step that adds the new columns, delete `pending` orders older than 7 days so the timer does not mass-cancel historical test data on its first run.

#### Scenario: Migration runs against a database with old pending orders
- **WHEN** the migration encounters `pending` orders with `created_at < now - 7 days`
- **THEN** the system SHALL delete them in a single SQL statement
- **AND** SHALL log a WARN line `auto-cancel cleanup: deleted N historical pending orders`
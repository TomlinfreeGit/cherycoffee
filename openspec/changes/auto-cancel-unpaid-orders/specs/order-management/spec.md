## ADDED Requirements

### Requirement: Order row exposes cancellation metadata

The `orders` row MUST expose `cancel_reason` and `cancelled_at` fields. They SHALL be `NULL` unless the order was cancelled.

#### Scenario: Order cancelled manually
- **WHEN** an order transitions to `cancelled` via `PATCH /api/orders/:id/status`
- **THEN** `cancel_reason` SHALL be `'merchant'` (or `'customer'` depending on the actor; the value MUST be one of a documented enum)
- **AND** `cancelled_at` SHALL equal the timestamp of the transition

#### Scenario: Order cancelled by auto-cancel timer
- **WHEN** an order is cancelled by the auto-cancel task
- **THEN** `cancel_reason` SHALL be `'auto_timeout'`
- **AND** `cancelled_at` SHALL equal the time the task tick wrote the cancellation

#### Scenario: Active order
- **WHEN** an order is `pending`, `paid`, `preparing`, `ready`, or `completed`
- **THEN** both `cancel_reason` and `cancelled_at` SHALL be `NULL`

### Requirement: Cancellation metadata returned in API responses

The endpoints `GET /api/orders`, `GET /api/orders/:id`, `GET /api/merchant/orders`, and `GET /api/merchant/orders/:id` MUST include `cancel_reason` and `cancelled_at` on each returned order.

#### Scenario: Customer lists own orders
- **WHEN** customer calls `GET /api/orders`
- **THEN** every order object in `data` MUST contain `cancel_reason` and `cancelled_at` fields (null when not cancelled)

#### Scenario: Merchant views cancelled order
- **WHEN** merchant opens an order detail page and the order was auto-cancelled
- **THEN** the response payload MUST include `cancel_reason: "auto_timeout"` and a non-null `cancelled_at`
- **AND** the merchant UI MUST surface a hint that the cancellation was automatic

### Requirement: Status transition `pending → cancelled` allowed for auto-cancel

The order status machine MUST permit a transition from `pending` to `cancelled` for the auto-cancel task, and MUST record `cancel_reason='auto_timeout'`.

#### Scenario: Auto-cancel writes a cancelled order
- **WHEN** the auto-cancel task updates a `pending` order
- **THEN** the order's `status` becomes `cancelled`
- **AND** `cancel_reason` becomes `'auto_timeout'`
- **AND** `cancelled_at` becomes the current timestamp

#### Scenario: Race with customer payment
- **WHEN** a payment webhook and an auto-cancel tick attempt to mutate the same order within the same second
- **THEN** exactly one of the two transitions wins (the one that observes `status='pending'` first)
- **AND** the losing write MUST NOT corrupt the row

### Requirement: Customer UI surfaces auto-cancel reason

The mini-program order detail page MUST display a banner when an order was cancelled automatically.

#### Scenario: Customer opens an auto-cancelled order
- **WHEN** customer opens an order whose `status='cancelled'` and `cancel_reason='auto_timeout'`
- **THEN** the page MUST show a grey banner with text "因超时未支付，已自动取消"
- **AND** MUST show the `cancelled_at` timestamp in `YYYY-MM-DD HH:mm` format

#### Scenario: Customer opens a manually cancelled order
- **WHEN** customer opens an order whose `status='cancelled'` but `cancel_reason != 'auto_timeout'`
- **THEN** the page MUST show the existing cancelled message (no auto-cancel banner)
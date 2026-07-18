## ADDED Requirements

### Requirement: Settings expose auto-cancel keys

The system MUST expose two new keys in the `settings` table: `order_auto_cancel_seconds` (integer, default `3600`) and `auto_cancel_scan_interval_seconds` (integer, default `60`). Both keys MUST be retrievable through the existing public settings API (`GET /api/settings`) and editable through the merchant settings endpoint (`PATCH /api/merchant/settings`).

#### Scenario: Public client requests settings
- **WHEN** the mini-program calls `GET /api/settings`
- **THEN** the response MUST include `order_auto_cancel_seconds` and `auto_cancel_scan_interval_seconds` as integers (using defaults if not yet persisted)

#### Scenario: Merchant updates the threshold
- **WHEN** merchant calls `PATCH /api/merchant/settings` with `{ order_auto_cancel_seconds: 1800 }`
- **THEN** the system SHALL persist `1800` to the `settings` table
- **AND** SHALL return the updated settings payload

#### Scenario: Merchant provides a non-integer value
- **WHEN** merchant submits `order_auto_cancel_seconds: "abc"` or any non-integer
- **THEN** the system SHALL reject with `400` and a descriptive error message

#### Scenario: Merchant provides an out-of-range scan interval
- **WHEN** merchant submits `auto_cancel_scan_interval_seconds` less than `10` or greater than `3600`
- **THEN** the system SHALL reject with `400` indicating the allowed range

### Requirement: Settings page UI lists the new keys

The merchant web settings page MUST render two input fields for the auto-cancel threshold and scan interval, pre-filled from the API.

#### Scenario: Merchant opens settings page
- **WHEN** merchant navigates to `/settings`
- **THEN** the page MUST show a labelled input "未支付订单自动取消 (秒)" with the current value
- **AND** MUST show a labelled input "扫描间隔 (秒)" with the current value
- **AND** the form MUST show the allowed range hint for the scan interval

#### Scenario: Merchant saves an updated threshold
- **WHEN** merchant clicks "保存" with a new threshold value
- **THEN** the page MUST call `PATCH /api/merchant/settings`
- **AND** on success MUST display a toast "设置已保存"
- **AND** MUST refresh the displayed value to match the persisted state
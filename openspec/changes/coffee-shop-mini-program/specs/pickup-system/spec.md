## ADDED Requirements

### Requirement: Pickup number generation

The system SHALL generate sequential pickup numbers for orders on each day.

#### Scenario: First order of the day

- **WHEN** the first order is created on a new day
- **THEN** system SHALL generate pickup number `YYYYMMDD-001`
- **AND** system SHALL initialize the daily counter for that date

#### Scenario: Subsequent orders on the same day

- **WHEN** an order is created on a date that already has orders
- **THEN** system SHALL generate pickup number with incremented sequence number
- **AND** system SHALL increment the daily counter

#### Scenario: New day resets sequence

- **WHEN** an order is created on a new date
- **THEN** system SHALL start sequence from 001
- **AND** system SHALL create a new daily counter entry

### Requirement: Pickup number display

The system SHALL display the pickup number to customers after order creation.

#### Scenario: Customer receives pickup number

- **WHEN** order is successfully created and payment is confirmed
- **THEN** customer SHALL be shown the pickup number
- **AND** customer SHALL be able to view the pickup number in order details

### Requirement: Pickup number for merchant

The system SHALL allow merchants to view and use pickup numbers for calling orders.

#### Scenario: Merchant views current ready orders

- **WHEN** merchant requests orders with status `ready`
- **THEN** system SHALL return all ready orders with their pickup numbers
- **AND** orders SHALL be sorted by pickup number ascending

#### Scenario: Merchant calls pickup number

- **WHEN** merchant completes preparation and marks order as ready
- **THEN** the order's pickup number SHALL be displayed on the order management screen
- **AND** customer can be notified (future enhancement: push notification)

## ADDED Requirements

### Requirement: Order creation

The system SHALL allow customers to create orders with selected products and obtain a pickup number.

#### Scenario: Customer creates an order

- **WHEN** customer submits an order with valid products and cart contents
- **THEN** system SHALL create an order with status `pending`
- **AND** system SHALL generate a unique pickup number for the day
- **AND** system SHALL return the order ID and pickup number

#### Scenario: Customer submits empty cart

- **WHEN** customer attempts to submit an order with no items
- **THEN** system SHALL return an error indicating cart is empty
- **AND** no order SHALL be created

### Requirement: Order status tracking

The system SHALL track order lifecycle through defined statuses.

#### Scenario: Order status transitions

- **WHEN** an order is created
- **THEN** status SHALL be `pending` (awaiting payment)

- **WHEN** payment is confirmed
- **THEN** status SHALL be `paid`

- **WHEN** merchant starts preparing the order
- **THEN** status SHALL be `preparing`

- **WHEN** merchant marks the order as ready
- **THEN** status SHALL be `ready`

- **WHEN** customer picks up the order
- **THEN** status SHALL be `completed`

- **WHEN** order is cancelled
- **THEN** status SHALL be `cancelled`

### Requirement: Order retrieval

The system SHALL allow customers and merchants to retrieve order information.

#### Scenario: Customer views order by ID

- **WHEN** customer provides a valid order ID
- **THEN** system SHALL return order details including pickup number, status, items, and total amount

#### Scenario: Merchant views all orders

- **WHEN** merchant requests the order list
- **THEN** system SHALL return all orders sorted by creation time (newest first)
- **AND** each order SHALL include pickup number, status, total amount, and creation time

#### Scenario: Merchant filters orders by status

- **WHEN** merchant requests orders filtered by a specific status
- **THEN** system SHALL return only orders matching that status

### Requirement: Order status update

The system SHALL allow merchants to update order status.

#### Scenario: Merchant updates order status

- **WHEN** merchant provides a valid order ID and new status
- **THEN** system SHALL update the order status
- **AND** system SHALL record the update timestamp
- **AND** system SHALL reject invalid status transitions

#### Scenario: Invalid status transition

- **WHEN** merchant attempts to change status from `pending` directly to `ready`
- **THEN** system SHALL reject the transition
- **AND** return an error indicating the transition is invalid

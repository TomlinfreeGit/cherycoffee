## ADDED Requirements

### Requirement: WeChat Pay integration

The system SHALL integrate with WeChat Pay to process payments for orders.

#### Scenario: Customer initiates payment

- **WHEN** customer confirms order and taps "Pay with WeChat Pay"
- **THEN** system SHALL create a WeChat Pay unified order
- **AND** system SHALL return payment parameters (appId, timeStamp, nonceStr, package, signType, paySign)
- **AND** system SHALL set order status to `pending`

#### Scenario: Payment succeeds

- **WHEN** WeChat Pay sends a success callback to the system
- **THEN** system SHALL verify the callback signature
- **AND** system SHALL update the order status to `paid`
- **AND** system SHALL record the transaction ID

#### Scenario: Payment fails

- **WHEN** WeChat Pay sends a failure callback
- **THEN** system SHALL update the order status to `failed`
- **AND** system SHALL record the failure reason

#### Scenario: Payment times out

- **WHEN** customer does not complete payment within 15 minutes
- **THEN** system SHALL update the order status to `cancelled`

### Requirement: Payment security

The system SHALL validate all payment callbacks to ensure authenticity.

#### Scenario: Callback signature validation

- **WHEN** system receives a WeChat Pay callback
- **THEN** system SHALL verify the signature using the merchant's API key
- **AND** system SHALL only process the callback if signature is valid
- **AND** invalid callbacks SHALL be logged and rejected

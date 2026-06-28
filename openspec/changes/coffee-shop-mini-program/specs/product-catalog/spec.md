## ADDED Requirements

### Requirement: Product catalog display

The system SHALL display all available products organized by category for customers to browse and order.

#### Scenario: Customer views product list

- **WHEN** customer opens the mini-program
- **THEN** system SHALL display all available products grouped by category (意式咖啡, 其他饮品, 创意特调)
- **AND** each product SHALL show name, price, and image

#### Scenario: Customer views product details

- **WHEN** customer taps on a product
- **THEN** system SHALL show product name, category, price, and full-size image
- **AND** system SHALL show an "Add to Cart" button

### Requirement: Product availability control

The system SHALL allow merchants to control which products are available for ordering.

#### Scenario: Merchant toggles product availability

- **WHEN** merchant sets a product's available status to false
- **THEN** the product SHALL NOT appear in the customer-facing product list
- **AND** the product SHALL remain visible in merchant management

#### Scenario: Available products are displayed

- **WHEN** customer requests the product list
- **THEN** system SHALL return only products where `available = true`
- **AND** products SHALL be sorted by `sort_order` ascending

### Requirement: Product management

The system SHALL allow merchants to create, update, and delete products.

#### Scenario: Merchant adds a new product

- **WHEN** merchant submits a new product with name, category, price, and image URL
- **THEN** system SHALL create the product with `available = true`
- **AND** system SHALL assign the next available `sort_order`

#### Scenario: Merchant updates product details

- **WHEN** merchant updates a product's name, price, category, or image URL
- **THEN** system SHALL persist the changes immediately
- **AND** changes SHALL be reflected in customer-facing list if the product is available

#### Scenario: Merchant deletes a product

- **WHEN** merchant deletes a product
- **THEN** system SHALL remove the product from the database
- **AND** the product SHALL NOT appear in any product list

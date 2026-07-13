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

### Requirement: Bilingual menu categories

The system SHALL display menu categories in the mini-program sidebar using both Chinese and English names, with no icon.

#### Scenario: Merchant configures a bilingual category

- **WHEN** merchant creates or edits a category
- **THEN** merchant SHALL provide a required Chinese name (1–20 chars)
- **AND** merchant MAY optionally provide an English name (1–40 chars)
- **AND** the system SHALL NOT expose or store an `icon` field for categories

#### Scenario: Customer views the category sidebar

- **WHEN** the customer opens the menu page
- **THEN** each sidebar entry SHALL show the Chinese name on top and (if set) the English name below in a muted style
- **AND** no emoji or icon SHALL appear in the sidebar entry
- **AND** the active category SHALL be highlighted with a left accent border

#### Scenario: Category has no English name

- **WHEN** a category was created without an English name
- **THEN** the sidebar entry SHALL only show the Chinese name (no empty English line)

### Requirement: Product temperature option

The system SHALL allow merchants to mark products that need a hot/cold choice at order time.

#### Scenario: Merchant enables temperature option

- **WHEN** merchant creates or edits a product
- **THEN** merchant MAY toggle the `support_temperature` flag (default off)
- **AND** the flag SHALL be persisted as an integer 0/1 on the product row

#### Scenario: Customer adds a temperature-required product to cart

- **WHEN** customer adds a product where `support_temperature = 1` to the cart
- **THEN** the customer-facing UI SHALL require a hot/cold choice first
- **AND** the same product with different temperatures SHALL be stored as separate cart lines

#### Scenario: Customer adds a product without temperature option

- **WHEN** customer adds a product where `support_temperature = 0` to the cart
- **THEN** the product SHALL be added as-is with no extra option

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

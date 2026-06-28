## 1. Project Setup

- [x] 1.1 Initialize Node.js project with package.json
- [x] 1.2 Install dependencies (Express, node:sqlite, cors)
- [x] 1.3 Initialize Taro project for WeChat mini-program
- [x] 1.4 Initialize React + Vite project for merchant web
- [x] 1.5 Create project folder structure

## 2. Database Setup

- [x] 2.1 Create SQLite database schema
- [x] 2.2 Create products table with categories
- [x] 2.3 Create orders, order_items tables
- [x] 2.4 Create daily_counter table
- [x] 2.5 Seed initial product data from menu

## 3. Backend API Development

- [x] 3.1 Implement GET /api/products endpoint
- [x] 3.2 Implement GET /api/products/:id endpoint
- [x] 3.3 Implement POST /api/products endpoint
- [x] 3.4 Implement PATCH /api/products/:id endpoint
- [x] 3.5 Implement DELETE /api/products/:id endpoint
- [x] 3.6 Implement POST /api/orders endpoint
- [x] 3.7 Implement GET /api/orders/:id endpoint
- [x] 3.8 Implement GET /api/orders endpoint (with filters)
- [x] 3.9 Implement PATCH /api/orders/:id/status endpoint
- [x] 3.10 Implement pickup number generation logic
- [x] 3.11 Test all API endpoints with curl/Postman

## 4. WeChat Pay Integration

- [ ] 4.1 Set up WeChat Pay merchant account info
- [ ] 4.2 Implement payment parameter generation
- [ ] 4.3 Implement payment callback handler
- [ ] 4.4 Add signature validation
- [ ] 4.5 Test with WeChat Pay sandbox (or mock)

## 5. Mini-Program Frontend (Customer)

- [x] 5.1 Create product list page with category tabs
- [x] 5.2 Create product detail modal/sheet (uses inline display, no modal needed)
- [x] 5.3 Implement shopping cart functionality
- [x] 5.4 Create order confirmation page (cart page)
- [x] 5.5 Implement WeChat Pay integration (using mock pay for local dev)
- [x] 5.6 Create order success page with pickup number
- [x] 5.7 Create order history page
- [x] 5.8 Add order status tracking display

## 6. Merchant Web Frontend

- [x] 6.1 Create merchant login page
- [x] 6.2 Create product management page (list view)
- [x] 6.3 Create product edit/add form
- [x] 6.4 Create order management page (list view)
- [x] 6.5 Implement order status update actions
- [x] 6.6 Add real-time order refresh

## 7. Integration & Testing

- [x] 7.1 Connect mini-program to backend API
- [x] 7.2 Connect merchant web to backend API
- [x] 7.3 End-to-end test: browse → order → pay → fulfill
- [x] 7.4 Test all order status transitions
- [x] 7.5 Test edge cases (empty cart, payment timeout, etc.)

## 9. User Privacy (Added)

- [x] 9.1 Add sessions table and token-based auth
- [x] 9.2 Bind orders to user openid
- [x] 9.3 Filter customer order endpoints by openid
- [x] 9.4 Add merchant-only endpoints (/api/merchant/orders) with separate auth
- [x] 9.5 Restrict customer status updates (only cancel + mock pay)
- [x] 9.6 Update mini-program with wx.login() and token storage
- [x] 9.7 Update merchant web to use merchant token
- [x] 9.8 Add cross-user isolation tests (18 tests passing)

## 10. Real WeChat Auth (Added)

- [x] 10.1 Add WECHAT_APPID/WECHAT_SECRET/USE_REAL_WECHAT_AUTH env vars
- [x] 10.2 Implement code2Session call to WeChat API
- [x] 10.3 Add in-memory cache for code→openid (avoid rate limits)
- [x] 10.4 Map WeChat error codes to friendly HTTP status
- [x] 10.5 Add /api/sessions/config endpoint (safe diagnostics)
- [x] 10.6 Update .env.example with WeChat credentials template
- [x] 10.7 Write comprehensive WECHAT-SETUP.md guide
- [x] 10.8 Add test-wechat.js (6 tests for config + login flow)

## 11. Image Upload (Added)

- [x] 11.1 Install multer for multipart/form-data handling
- [x] 11.2 Add POST /api/uploads (merchant-only, returns URL)
- [x] 11.3 Add DELETE /api/uploads/:filename
- [x] 11.4 Serve /uploads/* statically
- [x] 11.5 MIME type validation (jpg/png/gif/webp/svg)
- [x] 11.6 Path traversal protection
- [x] 11.7 Update merchant web: file picker + preview + drag-drop
- [x] 11.8 Image thumbnail in product table
- [x] 11.9 Add test-upload.js (7 tests)

## 12. Image Display in Mini-Program (Added)

- [x] 12.1 Add product_image_url column to order_items (denormalized)
- [x] 12.2 Add DB migration system (idempotent column adds)
- [x] 12.3 Add api.resolveImageUrl() helper
- [x] 12.4 Update menu page: <image> with emoji fallback
- [x] 12.5 Update cart page: thumbnail + name + qty controls
- [x] 12.6 Update order-success page: thumbnail + product details
- [x] 12.7 Update order-detail page: thumbnail + product details
- [x] 12.8 Store image_url in cart item when adding (app.js)
- [x] 12.9 onImageError fallback to emoji in all pages

## 13. Customer Info (Name + Phone) (Added)

- [x] 13.1 Add customer_name + customer_phone columns to orders
- [x] 13.2 Phone validation regex (^1[3-9]\d{9}$)
- [x] 13.3 POST /api/orders accepts customer_name + customer_phone (required)
- [x] 13.4 Phone masking for merchant views (138****5678)
- [x] 13.5 GET /api/merchant/orders supports ?search= for name/phone
- [x] 13.6 GET /api/merchant/orders/:id/full-phone endpoint (audit logged)
- [x] 13.7 Mini-program cart page: customer info form with validation
- [x] 13.8 Mini-program stores last-used customer profile locally
- [x] 13.9 Mini-program shows customer info on order-success + order-detail
- [x] 13.10 Merchant web shows name + masked phone in orders table
- [x] 13.11 Merchant web "查看完整" button with audit toast
- [x] 13.12 test-customer.js with 18 tests (validation, privacy, search)

## 8. Deployment Preparation

- [x] 8.1 Configure CORS for production
- [x] 8.2 Set up environment variables
- [x] 8.3 Prepare database for production (backup strategy documented in README)
- [x] 8.4 Document deployment steps

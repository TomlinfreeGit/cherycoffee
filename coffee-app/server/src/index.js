// filepath: coffee-app/server/src/index.js
require('dotenv').config();
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const productsRouter = require('./routes/products');
const ordersRouter = require('./routes/orders');
const sessionsRouter = require('./routes/sessions');
const merchantRouter = require('./routes/merchant');
const merchantAuthRouter = require('./routes/merchantAuth');
const uploadsRouter = require('./routes/uploads');
const usersRouter = require('./routes/users');
const categoriesRouter = require('./routes/categories');
const settingsRouter = require('./routes/settings');

// 初始化商家鉴权子系统 (若 env 配置了 MERCHANT_ADMIN_USERNAME/PASSWORD 会自动种子账号;
// 该副作用必须在加载 merchantAuth 中间件之前完成,否则 middleware 启动 WARN 会重复)
// 副作用: 服务启动 → 自动建表 → 自动 hash 检查 seed → 显示 WARN。
require('./middleware/merchantAuth');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';  // Listen on all interfaces for LAN access

const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: corsOrigin === '*' ? true : corsOrigin.split(',') }));

// 加固基础安全响应头 (手动实现,避免引入 helmet)
// 不强制使用 HSTS (开发用 http),仅做语义必要项
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  // Permissions-Policy 禁止摄像头/麦克风/定位等敏感能力
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()'
  );
  next();
});

// 微信支付 V3 回调:必须在 app.use(express.json(...)) 之前挂 express.raw,
// 才能拿到原始 JSON 字符串以验签。Express 会先匹配这个路径,继续 next() 才会到下面 json parser。
app.use('/api/orders/pay/notify', express.raw({ type: '*/*', limit: '1mb' }));

app.use(express.json({ limit: '1mb' }));

// Serve uploaded files statically
// Use explicit MIME types so SVG, WebP, etc. get correct Content-Type (some Node
// versions return no Content-Type for .svg which makes <image> fail to render).
const uploadStatic = express.static(path.join(__dirname, '..', 'uploads'), {
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    const mime = {
      '.svg': 'image/svg+xml',
      '.svgz': 'image/svg+xml',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    }[ext];
    if (mime) res.setHeader('Content-Type', mime);
  }
});
app.use('/uploads', uploadStatic);

// Request logging (development)
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/products', productsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/sessions', sessionsRouter);
// merchantAuth 路由必须在 /api/merchant 之前挂 (否则会被业务路由的 middleware 拦截)
app.use('/api/merchant-auth', merchantAuthRouter);
app.use('/api/merchant', merchantRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/users', usersRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api', settingsRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.url });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, HOST, () => {
  console.log(`✓ Server running on http://${HOST}:${PORT}`);
  console.log(`  Local:   http://localhost:${PORT}/api/health`);
  console.log(`  Network: http://0.0.0.0:${PORT}/api/health`);
  if (HOST === '0.0.0.0') {
    const { networkInterfaces } = require('node:os');
    const nets = networkInterfaces();
    const addrs = [];
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          addrs.push(`http://${net.address}:${PORT}`);
        }
      }
    }
    if (addrs.length > 0) {
      console.log(`  LAN:     ${addrs.join(', ')}`);
    }
  }
});

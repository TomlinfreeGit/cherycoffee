// filepath: coffee-app/server/src/index.js
require('dotenv').config();
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const productsRouter = require('./routes/products');
const ordersRouter = require('./routes/orders');
const sessionsRouter = require('./routes/sessions');
const merchantRouter = require('./routes/merchant');
const uploadsRouter = require('./routes/uploads');
const usersRouter = require('./routes/users');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';  // Listen on all interfaces for LAN access

const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: corsOrigin === '*' ? true : corsOrigin.split(',') }));
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
app.use('/api/merchant', merchantRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/users', usersRouter);

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

// filepath: coffee-app/server/generate-sample-images.js
// Generate simple SVG placeholder images for products that have no image_url.
// Each image is color-coded by category and shows an emoji + product name.
// SVGs are tiny (~1KB each), no external dependencies.
//
// Usage:
//   node generate-sample-images.js            # fill in missing images only
//   node generate-sample-images.js --force     # regenerate ALL product images

const path = require('node:path');
const fs = require('node:fs');
require('dotenv').config();
const { db } = require('./src/db');

const UPLOADS_DIR = path.join(__dirname, 'uploads');

const CATEGORY_STYLE = {
  '意式咖啡': { bg1: '#6F4E37', bg2: '#A0826D', emoji: '☕' },
  '其他饮品': { bg1: '#E6B17E', bg2: '#F4D4B0', emoji: '🥤' },
  '创意特调': { bg1: '#7C3AED', bg2: '#C084FC', emoji: '🍹' }
};

const DEFAULT_STYLE = { bg1: '#3B82F6', bg2: '#93C5FD', emoji: '🍵' };

/**
 * Build an SVG image for a product.
 * Pure SVG: works in browsers, mini-program, and merchant web.
 */
function buildSvg(name, category) {
  const style = CATEGORY_STYLE[category] || DEFAULT_STYLE;
  const id = `g${Math.random().toString(36).slice(2, 9)}`;
  const safeName = String(name)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <defs>
    <linearGradient id="${id}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${style.bg1}"/>
      <stop offset="100%" stop-color="${style.bg2}"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" fill="url(#${id})"/>
  <text x="200" y="180" text-anchor="middle" font-size="120">${style.emoji}</text>
  <text x="200" y="290" text-anchor="middle" font-size="28" fill="#fff" font-weight="600" font-family="system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif">${safeName}</text>
  <text x="200" y="330" text-anchor="middle" font-size="18" fill="#ffffff" opacity="0.85" font-family="system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif">${category}</text>
</svg>`;
}

/**
 * Save an SVG to the uploads dir and return the relative URL.
 */
function saveSvg(name, category, idHint) {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  const stamp = Date.now();
  const hash = idHint ? idHint.toString().padStart(6, '0') : Math.random().toString(36).slice(2, 8);
  const filename = `sample-${stamp}-${hash}.svg`;
  const filepath = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(filepath, buildSvg(name, category), 'utf8');
  return `/uploads/${filename}`;
}

function main() {
  const force = process.argv.includes('--force');
  const products = db.prepare('SELECT id, name, category, image_url FROM products').all();

  let updated = 0;
  let skipped = 0;
  const stmt = db.prepare('UPDATE products SET image_url = ?, updated_at = datetime(\'now\', \'localtime\') WHERE id = ?');

  for (const p of products) {
    if (!force && p.image_url) {
      skipped += 1;
      continue;
    }
    const url = saveSvg(p.name, p.category, p.id);
    stmt.run(url, p.id);
    updated += 1;
    console.log(`  ✓ ${p.id}. ${p.name} → ${url}`);
  }

  console.log(`\nDone. Updated ${updated}, skipped ${skipped}.`);
  if (!force) {
    console.log('Tip: pass --force to regenerate ALL product images.');
  }
}

try {
  main();
} catch (e) {
  console.error('Error:', e);
  process.exit(1);
}

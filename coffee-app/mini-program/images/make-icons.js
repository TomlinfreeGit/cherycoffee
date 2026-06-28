// filepath: coffee-app/mini-program/images/make-icons.js
// Generate minimal PNG icons for the mini-program tabBar
// Uses pure-JS PNG encoding (no native deps)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Minimal pure-JS PNG writer
function createPng(width, height, drawPixel) {
  const channels = 4; // RGBA
  const rawData = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      const [r, g, b, a] = drawPixel(x, y);
      rawData[idx] = r;
      rawData[idx + 1] = g;
      rawData[idx + 2] = b;
      rawData[idx + 3] = a;
    }
  }

  // Add filter byte (0) at start of each scanline
  const filtered = Buffer.alloc(height * (width * channels + 1));
  for (let y = 0; y < height; y++) {
    filtered[y * (width * channels + 1)] = 0;
    rawData.copy(filtered, y * (width * channels + 1) + 1, y * width * channels, (y + 1) * width * channels);
  }

  const compressed = zlib.deflateSync(filtered);

  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  function crc32(buf) {
    let c;
    const table = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    const crc = crc32(Buffer.concat([typeBuf, data]));
    crcBuf.writeUInt32BE(crc, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);  // bit depth
  ihdr.writeUInt8(6, 9);  // color type (RGBA)
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// Icons: 48x48 PNG with simple monochrome shape (alpha-blended on white)
function makeIcon(color, drawShape) {
  return createPng(48, 48, (x, y) => {
    const inside = drawShape(x, y);
    if (inside) return [...hexToRgb(color), 255];
    return [255, 255, 255, 0]; // transparent
  });
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16)
  ];
}

// Menu icon: 3 horizontal bars (list/grid style)
function menuShape(x, y) {
  // Three 4-pixel-tall bars with 6-pixel gaps
  const bar1 = y >= 10 && y <= 13 && x >= 12 && x <= 36;
  const bar2 = y >= 22 && y <= 25 && x >= 12 && x <= 36;
  const bar3 = y >= 34 && y <= 37 && x >= 12 && x <= 36;
  return bar1 || bar2 || bar3;
}

// Cart icon: simple shopping cart
function cartShape(x, y) {
  // Cart body
  if (x >= 12 && x <= 38 && y >= 18 && y <= 32) return true;
  // Handle (left vertical)
  if (x >= 6 && x <= 9 && y >= 10 && y <= 32) return true;
  // Handle (top horizontal)
  if (x >= 6 && x <= 14 && y >= 8 && y <= 11) return true;
  // Wheels
  if ((x - 16) * (x - 16) + (y - 38) * (y - 38) <= 9) return true;
  if ((x - 32) * (x - 32) + (y - 38) * (y - 38) <= 9) return true;
  return false;
}

// Orders icon: document/clipboard
function ordersShape(x, y) {
  // Outer rectangle
  if (x >= 10 && x <= 38 && y >= 6 && y <= 42) {
    // Hollow inside - 6px border
    if (x >= 14 && x <= 34 && y >= 12 && y <= 38) return false;
    return true;
  }
  // Top clip
  if (x >= 18 && x <= 30 && y >= 3 && y <= 9) return true;
  return false;
}

const icons = [
  { name: 'menu.png', color: '#8a7f72', draw: menuShape },
  { name: 'menu-active.png', color: '#6f4e37', draw: menuShape },
  { name: 'cart.png', color: '#8a7f72', draw: cartShape },
  { name: 'cart-active.png', color: '#6f4e37', draw: cartShape },
  { name: 'orders.png', color: '#8a7f72', draw: ordersShape },
  { name: 'orders-active.png', color: '#6f4e37', draw: ordersShape }
];

for (const icon of icons) {
  const buf = makeIcon(icon.color, icon.draw);
  fs.writeFileSync(path.join(__dirname, icon.name), buf);
  console.log(`✓ Generated ${icon.name} (${buf.length} bytes)`);
}

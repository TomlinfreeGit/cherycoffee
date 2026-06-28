// filepath: coffee-app/server/src/routes/uploads.js
// Image upload route (merchant web only)
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { merchantAuth } = require('../middleware/merchantAuth');

const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');

// Allowed image MIME types
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

// Configure multer storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    // Generate unique filename: <random>.<ext>
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const hash = crypto.randomBytes(8).toString('hex');
    const stamp = Date.now();
    cb(null, `${stamp}-${hash}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: ${ALLOWED_MIME.join(', ')}`));
    }
  }
});

// All upload routes require merchant auth
router.use(merchantAuth);

// POST /api/uploads - upload single image
// Field name: "file" (or "image")
router.post('/', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Use multipart/form-data with field "file".' });
    }

    // Return the URL where the file can be fetched
    const url = `/uploads/${req.file.filename}`;

    res.status(201).json({
      data: {
        filename: req.file.filename,
        url,
        size: req.file.size,
        mimetype: req.file.mimetype,
        originalName: req.file.originalname
      }
    });
  } catch (err) {
    console.error('POST /api/uploads error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// DELETE /api/uploads/:filename - delete an uploaded file
router.delete('/:filename', (req, res) => {
  try {
    // Sanitize: prevent path traversal
    const filename = path.basename(req.params.filename);
    const filepath = path.join(UPLOADS_DIR, filename);

    // Verify it's inside UPLOADS_DIR
    if (!filepath.startsWith(UPLOADS_DIR)) {
      return res.status(400).json({ error: 'Invalid filename' });
    }

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    fs.unlinkSync(filepath);
    res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/uploads/:filename error:', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// Error handler for multer errors
router.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB)` });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

module.exports = router;

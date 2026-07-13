// filepath: coffee-app/server/src/routes/products.js
const express = require('express');
const { db } = require('../db');

const router = express.Router();

// GET /api/products - list all products (with optional category filter, availableOnly)
router.get('/', (req, res) => {
  try {
    const { category, availableOnly } = req.query;
    let sql = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    if (availableOnly === 'true') {
      sql += ' AND available = 1';
    }

    sql += ' ORDER BY sort_order ASC, id ASC';

    const rows = db.prepare(sql).all(...params);
    res.json({ data: rows });
  } catch (err) {
    console.error('GET /api/products error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/products/:id
router.get('/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!row) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json({ data: row });
  } catch (err) {
    console.error('GET /api/products/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/products - create a product
router.post('/', (req, res) => {
  try {
    const { name, category, price, description, image_url, available, sort_order, support_temperature } = req.body;

    if (!name || price == null) {
      return res.status(400).json({ error: 'name and price are required' });
    }
    // category is optional (products can be created without a category, or detached)

    // Compute next sort_order if not provided
    let sortVal = sort_order;
    if (sortVal == null) {
      const maxRow = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS max FROM products').get();
      sortVal = maxRow.max + 1;
    }

    const result = db.prepare(`
      INSERT INTO products (name, category, price, description, image_url, available, sort_order, support_temperature)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      category || null,
      Number(price),
      description || null,
      image_url || null,
      available === false ? 0 : 1,
      sortVal,
      support_temperature ? 1 : 0
    );

    const created = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ data: created });
  } catch (err) {
    console.error('POST /api/products error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/products/:id
router.patch('/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const allowed = ['name', 'category', 'price', 'description', 'image_url', 'available', 'sort_order', 'support_temperature'];
    const updates = [];
    const params = [];

    for (const key of allowed) {
      if (key in req.body) {
        let val = req.body[key];
        if (key === 'available' || key === 'support_temperature') {
          val = val ? 1 : 0;
        }
        updates.push(`${key} = ?`);
        params.push(val);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = datetime('now', 'localtime')`);
    params.push(req.params.id);

    db.prepare(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    res.json({ data: updated });
  } catch (err) {
    console.error('PATCH /api/products/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/products/:id
router.delete('/:id', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.status(204).end();
  } catch (err) {
    console.error('DELETE /api/products/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

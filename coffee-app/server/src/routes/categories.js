// filepath: coffee-app/server/src/routes/categories.js
// Menu category CRUD endpoints.
// - GET /api/categories       (public; used by mini-program menu sidebar)
// - All other routes require merchant auth.
const express = require('express');
const { db } = require('../db');
const { merchantAuth } = require('../middleware/merchantAuth');

const router = express.Router();

const NAME_MAX_LEN = 20;
const NAME_EN_MAX_LEN = 40;

// GET /api/categories - list all categories (ordered)
// Public endpoint used by the mini-program menu sidebar.
router.get('/', (_req, res) => {
  try {
    const rows = db.prepare(`
      SELECT c.id, c.name, c.name_en, c.sort_order,
             (SELECT COUNT(*) FROM products p WHERE p.category = c.name) AS product_count
      FROM categories c
      ORDER BY c.sort_order ASC, c.id ASC
    `).all();
    res.json({ data: rows });
  } catch (err) {
    console.error('GET /api/categories error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// All routes below require merchant auth
router.use(merchantAuth);

// POST /api/categories - create
// body: { name, name_en?, sort_order? }
router.post('/', (req, res) => {
  try {
    const { name, name_en, sort_order } = req.body || {};
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: '分类名称不能为空' });
    }
    const trimmed = name.trim();
    if (trimmed.length > NAME_MAX_LEN) {
      return res.status(400).json({ error: `分类名称过长（最多 ${NAME_MAX_LEN} 字符）` });
    }

    // English name is optional but, if provided, must respect the max length.
    let trimmedEn = null;
    if (name_en != null && name_en !== '') {
      if (typeof name_en !== 'string') {
        return res.status(400).json({ error: '英文名称格式错误' });
      }
      trimmedEn = name_en.trim();
      if (trimmedEn.length > NAME_EN_MAX_LEN) {
        return res.status(400).json({ error: `英文名称过长（最多 ${NAME_EN_MAX_LEN} 字符）` });
      }
      if (trimmedEn.length === 0) trimmedEn = null;
    }

    // Check uniqueness
    const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(trimmed);
    if (existing) {
      return res.status(409).json({ error: '分类名称已存在' });
    }

    let sortVal = sort_order;
    if (sortVal == null) {
      const maxRow = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS max FROM categories').get();
      sortVal = maxRow.max + 1;
    }

    const result = db.prepare(`
      INSERT INTO categories (name, name_en, sort_order) VALUES (?, ?, ?)
    `).run(trimmed, trimmedEn, Number(sortVal) || 0);

    const created = db.prepare(
      'SELECT id, name, name_en, sort_order, created_at, updated_at FROM categories WHERE id = ?'
    ).get(result.lastInsertRowid);
    res.status(201).json({ data: created });
  } catch (err) {
    console.error('POST /api/categories error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/categories/:id - update name / name_en / sort_order
// Note: the `icon` field is intentionally ignored — categories no longer
// carry an icon. The DB column is kept nullable for historical data.
router.patch('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const allowed = ['name', 'name_en', 'sort_order'];
    const updates = [];
    const params = [];

    for (const key of allowed) {
      if (key in req.body) {
        let val = req.body[key];
        if (key === 'name') {
          if (typeof val !== 'string' || val.trim().length === 0) {
            return res.status(400).json({ error: '分类名称不能为空' });
          }
          if (val.length > NAME_MAX_LEN) {
            return res.status(400).json({ error: `分类名称过长` });
          }
          val = val.trim();
          // uniqueness check (excluding self)
          const dup = db.prepare('SELECT id FROM categories WHERE name = ? AND id != ?').get(val, id);
          if (dup) {
            return res.status(409).json({ error: '分类名称已存在' });
          }
        } else if (key === 'name_en') {
          // Allow clearing the English name by passing null/empty string.
          if (val === null || val === '') {
            val = null;
          } else if (typeof val === 'string') {
            val = val.trim();
            if (val.length > NAME_EN_MAX_LEN) {
              return res.status(400).json({ error: `英文名称过长` });
            }
            if (val.length === 0) val = null;
          } else {
            return res.status(400).json({ error: '英文名称格式错误' });
          }
        }
        updates.push(`${key} = ?`);
        params.push(val);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    updates.push(`updated_at = datetime('now', 'localtime')`);
    params.push(id);

    db.prepare(`UPDATE categories SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const updated = db.prepare(
      'SELECT id, name, name_en, sort_order, created_at, updated_at FROM categories WHERE id = ?'
    ).get(id);
    res.json({ data: updated });
  } catch (err) {
    console.error('PATCH /api/categories/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/categories/:id - delete
// Side effects: products with this category have their `category` set to NULL
// (so they remain but are no longer in any menu category).
router.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid id' });
    }
    const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!cat) {
      return res.status(404).json({ error: 'Category not found' });
    }

    db.exec('BEGIN');
    try {
      // Detach products from this category
      const updated = db.prepare('UPDATE products SET category = NULL WHERE category = ?').run(cat.name);
      const deleted = db.prepare('DELETE FROM categories WHERE id = ?').run(id);
      db.exec('COMMIT');

      console.log(
        `[AUDIT] Category ${cat.name} (id=${id}) deleted by merchant ${req.merchantId || 'unknown'}, ` +
        `${updated.changes} products detached at ${new Date().toISOString()}`
      );
      res.json({
        data: { id, name: cat.name, deleted: deleted.changes > 0, detached_products: updated.changes }
      });
    } catch (innerErr) {
      db.exec('ROLLBACK');
      throw innerErr;
    }
  } catch (err) {
    console.error('DELETE /api/categories/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
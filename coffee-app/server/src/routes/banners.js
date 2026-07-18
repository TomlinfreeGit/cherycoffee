// filepath: coffee-app/server/src/routes/banners.js
// Menu-top banner / carousel endpoints.
//
// This file exports TWO routers, mounted separately in index.js:
//   - The default `router` is mounted at /api/banners and exposes the public
//     GET / endpoint used by the mini-program.
//   - The `merchantRouter` (via module.exports.merchantRouter) is mounted at
//     /api/merchant/banners and exposes merchant CRUD endpoints.
//
// Endpoints:
//   GET    /api/banners                  - public, returns enabled banners (sorted)
//   GET    /api/merchant/banners         - merchant, full list (enabled + disabled)
//   POST   /api/merchant/banners         - merchant, create
//   PATCH  /api/merchant/banners/:id     - merchant, update
//   DELETE /api/merchant/banners/:id     - merchant, delete
//   POST   /api/merchant/banners/reorder - merchant, bulk reorder (body: { ids: [...] })

const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const { db } = require('../db');
const { merchantAuth } = require('../middleware/merchantAuth');

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');

const ALLOWED_LINK_TYPES = new Set(['none', 'category', 'product']);
const TITLE_MAX_LEN = 60;
const MAX_BANNERS = 10; // 最多 10 张,避免加载过慢

/**
 * Best-effort: delete an uploaded image file IF no banner row still references it.
 * Mirror of removeUploadIfOrphan in products.js.
 */
function removeUploadIfOrphan(url) {
  try {
    if (!url || typeof url !== 'string') return;
    if (!url.startsWith('/uploads/')) return;
    const filename = path.basename(url);
    if (!filename || filename === url) return;
    const filepath = path.join(UPLOADS_DIR, filename);
    const resolved = path.resolve(filepath);
    if (!resolved.startsWith(path.resolve(UPLOADS_DIR) + path.sep)) return;
    if (!fs.existsSync(resolved)) return;

    const refCount = db
      .prepare('SELECT COUNT(*) AS n FROM banners WHERE image_url = ?')
      .get(url).n;
    if (refCount > 0) return;

    fs.unlinkSync(resolved);
    console.log(`[banners] removed orphan upload: ${filename}`);
  } catch (err) {
    console.warn(`[banners] failed to remove orphan upload (${url}):`, err.message);
  }
}

// ─── Public router (mounted at /api/banners) ─────────────────────
const router = express.Router();

// GET / - enabled banners only, sorted by sort_order ASC.
router.get('/', (_req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT id, image_url, title, link_type, link_value, sort_order
         FROM banners
         WHERE enabled = 1
         ORDER BY sort_order ASC, id ASC`
      )
      .all();
    res.json({ data: rows });
  } catch (err) {
    console.error('GET /api/banners error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Merchant router (mounted at /api/merchant/banners) ──────────
const merchantRouter = express.Router();

// All merchant routes require auth
merchantRouter.use(merchantAuth);

// GET / - full list (enabled + disabled)
merchantRouter.get('/', (_req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT id, image_url, title, link_type, link_value, sort_order, enabled, created_at, updated_at
         FROM banners
         ORDER BY sort_order ASC, id ASC`
      )
      .all();
    res.json({ data: rows });
  } catch (err) {
    console.error('GET /api/merchant/banners error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Validate body. Returns { ok: true, value } or { ok: false, error }.
function validatePayload(body, isCreate) {
  const cleaned = {};

  if (isCreate) {
    if (!body.image_url || typeof body.image_url !== 'string') {
      return { ok: false, error: '请提供图片(image_url)' };
    }
    if (!body.image_url.startsWith('/uploads/')) {
      return { ok: false, error: 'image_url 必须是 /uploads/ 开头的服务器路径' };
    }
    cleaned.image_url = body.image_url;
  } else if ('image_url' in body) {
    if (!body.image_url || typeof body.image_url !== 'string') {
      return { ok: false, error: 'image_url 无效' };
    }
    if (!body.image_url.startsWith('/uploads/')) {
      return { ok: false, error: 'image_url 必须是 /uploads/ 开头的服务器路径' };
    }
    cleaned.image_url = body.image_url;
  }

  if ('title' in body) {
    if (body.title == null || body.title === '') {
      cleaned.title = null;
    } else if (typeof body.title !== 'string') {
      return { ok: false, error: 'title 格式错误' };
    } else {
      const t = body.title.trim();
      if (t.length > TITLE_MAX_LEN) {
        return { ok: false, error: `title 过长（最多 ${TITLE_MAX_LEN} 字符）` };
      }
      cleaned.title = t.length === 0 ? null : t;
    }
  }

  if ('link_type' in body) {
    if (!ALLOWED_LINK_TYPES.has(body.link_type)) {
      return { ok: false, error: 'link_type 必须是 none / category / product' };
    }
    cleaned.link_type = body.link_type;
    if (body.link_type === 'none') {
      cleaned.link_value = null;
    } else if ('link_value' in body) {
      if (body.link_value == null || body.link_value === '') {
        return { ok: false, error: `link_type=${body.link_type} 时必须提供 link_value` };
      }
      cleaned.link_value = String(body.link_value);
    }
  } else if ('link_value' in body) {
    if (body.link_value == null || body.link_value === '') {
      cleaned.link_value = null;
    } else {
      cleaned.link_value = String(body.link_value);
    }
  }

  if ('sort_order' in body) {
    const n = Number(body.sort_order);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      return { ok: false, error: 'sort_order 必须为整数' };
    }
    cleaned.sort_order = n;
  }

  if ('enabled' in body) {
    cleaned.enabled = body.enabled ? 1 : 0;
  }

  return { ok: true, value: cleaned };
}

// POST / - create
merchantRouter.post('/', (req, res) => {
  try {
    const count = db.prepare('SELECT COUNT(*) AS n FROM banners').get().n;
    if (count >= MAX_BANNERS) {
      return res.status(400).json({ error: `最多只能添加 ${MAX_BANNERS} 张轮播图` });
    }

    const v = validatePayload(req.body || {}, true);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const data = v.value;

    if (data.sort_order == null) {
      const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM banners').get().m;
      data.sort_order = max + 1;
    }
    if (data.enabled == null) data.enabled = 1;
    if (data.link_type == null) data.link_type = 'none';
    if (!('link_value' in data)) data.link_value = null;
    if (!('title' in data)) data.title = null;

    const result = db
      .prepare(
        `INSERT INTO banners (image_url, title, link_type, link_value, sort_order, enabled)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.image_url,
        data.title,
        data.link_type,
        data.link_value,
        data.sort_order,
        data.enabled
      );

    const created = db
      .prepare(
        `SELECT id, image_url, title, link_type, link_value, sort_order, enabled, created_at, updated_at
         FROM banners WHERE id = ?`
      )
      .get(result.lastInsertRowid);
    res.status(201).json({ data: created });
  } catch (err) {
    console.error('POST /api/merchant/banners error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /:id - update
merchantRouter.patch('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

    const existing = db.prepare('SELECT * FROM banners WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Banner not found' });

    const v = validatePayload(req.body || {}, false);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const updates = v.value;

    // If link_type becomes 'none', force link_value to null
    if (updates.link_type === 'none') {
      updates.link_value = null;
    }

    const keys = Object.keys(updates);
    if (keys.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const setSql = keys.map((k) => `${k} = ?`).join(', ');
    const params = keys.map((k) => updates[k]);
    params.push(id);

    db.prepare(
      `UPDATE banners SET ${setSql}, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(...params);

    const updated = db
      .prepare(
        `SELECT id, image_url, title, link_type, link_value, sort_order, enabled, created_at, updated_at
         FROM banners WHERE id = ?`
      )
      .get(id);

    if ('image_url' in updates && existing.image_url !== updates.image_url) {
      removeUploadIfOrphan(existing.image_url);
    }

    res.json({ data: updated });
  } catch (err) {
    console.error('PATCH /api/merchant/banners/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /:id
merchantRouter.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

    const existing = db.prepare('SELECT * FROM banners WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Banner not found' });

    db.prepare('DELETE FROM banners WHERE id = ?').run(id);
    removeUploadIfOrphan(existing.image_url);

    res.json({ data: { id, deleted: true } });
  } catch (err) {
    console.error('DELETE /api/merchant/banners/:id error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /reorder - body: { ids: [3, 1, 2] }
merchantRouter.post('/reorder', (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
    if (!ids || ids.length === 0) {
      return res.status(400).json({ error: 'ids 必须是非空数组' });
    }
    if (!ids.every((x) => Number.isInteger(x))) {
      return res.status(400).json({ error: 'ids 必须全部为整数' });
    }
    const placeholders = ids.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT id FROM banners WHERE id IN (${placeholders})`)
      .all(...ids);
    if (rows.length !== ids.length) {
      return res.status(400).json({ error: 'ids 中存在不存在的 banner' });
    }

    const update = db.prepare(
      `UPDATE banners SET sort_order = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    );
    db.exec('BEGIN');
    try {
      ids.forEach((id, idx) => update.run(idx + 1, id));
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    const list = db
      .prepare(
        `SELECT id, image_url, title, link_type, link_value, sort_order, enabled, created_at, updated_at
         FROM banners ORDER BY sort_order ASC, id ASC`
      )
      .all();
    res.json({ data: list });
  } catch (err) {
    console.error('POST /api/merchant/banners/reorder error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.merchantRouter = merchantRouter;
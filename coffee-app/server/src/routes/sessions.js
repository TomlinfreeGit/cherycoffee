// filepath: coffee-app/server/src/routes/sessions.js
const express = require('express');
const { createSession, deleteSession, getAuthConfig } = require('../middleware/auth');

const router = express.Router();

// GET /api/sessions/config - public config (does NOT leak secret)
router.get('/config', (_req, res) => {
  res.json({ data: getAuthConfig() });
});

// POST /api/sessions - exchange wx.login code for a session token
router.post('/', async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) {
      return res.status(400).json({ error: 'Missing code in request body' });
    }

    const session = await createSession(code);
    res.json({
      data: {
        token: session.token,
        openid: session.openid
      }
    });
  } catch (e) {
    console.error('POST /api/sessions error:', e);

    if (e.wechatCode === 40029 || e.wechatCode === 40163) {
      return res.status(400).json({
        error: 'Invalid or expired code. Please restart the mini-program.',
        wechatCode: e.wechatCode
      });
    }
    if (e.wechatCode === 45011) {
      return res.status(429).json({
        error: 'Too many requests. Please try again later.',
        wechatCode: e.wechatCode
      });
    }

    res.status(500).json({ error: e.message || 'Login failed' });
  }
});

// DELETE /api/sessions - logout
router.delete('/', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  deleteSession(token);
  res.status(204).end();
});

module.exports = router;

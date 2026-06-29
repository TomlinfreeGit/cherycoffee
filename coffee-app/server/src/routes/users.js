// filepath: coffee-app/server/src/routes/users.js
// Customer profile endpoints:
//   GET    /api/users/me      - get cached nickname/avatar/phone
//   PATCH  /api/users/me      - update nickname/avatar (manual save)
//   POST   /api/users/phone   - decrypt WeChat encrypted phone data
//   DELETE /api/users/me/phone - remove stored phone

const express = require('express');
const { db } = require('../db');
const { customerAuth, getSessionByToken, updateSessionKey } = require('../middleware/auth');
const { decryptPhone } = require('../services/wxbizdatacrypt');

const router = express.Router();

const NICKNAME_MAX_LEN = 30;
const PHONE_REGEX = /^1[3-9]\d{9}$/;

function maskPhone(phone) {
  if (!phone || phone.length < 7) return phone || null;
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

function getOrCreateUser(openid) {
  let user = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
  if (!user) {
    db.prepare('INSERT INTO users (openid) VALUES (?)').run(openid);
    user = db.prepare('SELECT * FROM users WHERE openid = ?').get(openid);
  }
  return user;
}

function serializeUser(user) {
  return {
    openid: user.openid,
    nickname: user.nickname || null,
    avatar_url: user.avatar_url || null,
    has_phone: !!user.phone,
    phone_masked: user.phone ? maskPhone(user.phone) : null
  };
}

// All routes require login
router.use(customerAuth);

// GET /api/users/me
router.get('/me', (req, res) => {
  try {
    const user = getOrCreateUser(req.openid);
    res.json({ data: serializeUser(user) });
  } catch (e) {
    console.error('GET /api/users/me error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/users/me - update nickname / avatar
// body: { nickname?, avatar_url? }
router.patch('/me', (req, res) => {
  try {
    const { nickname, avatar_url } = req.body || {};

    if (nickname !== undefined && nickname !== null) {
      if (typeof nickname !== 'string') {
        return res.status(400).json({ error: 'nickname must be a string' });
      }
      if (nickname.length > NICKNAME_MAX_LEN) {
        return res.status(400).json({ error: `nickname too long (max ${NICKNAME_MAX_LEN})` });
      }
    }
    if (avatar_url !== undefined && avatar_url !== null) {
      if (typeof avatar_url !== 'string') {
        return res.status(400).json({ error: 'avatar_url must be a string' });
      }
      if (avatar_url.length > 1000) {
        return res.status(400).json({ error: 'avatar_url too long' });
      }
    }

    getOrCreateUser(req.openid);

    const updates = [];
    const params = [];
    if (nickname !== undefined) {
      updates.push('nickname = ?');
      params.push(nickname ? nickname.trim() : null);
    }
    if (avatar_url !== undefined) {
      updates.push('avatar_url = ?');
      params.push(avatar_url || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = datetime('now', 'localtime')`);
    params.push(req.openid);

    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE openid = ?`).run(...params);

    const user = db.prepare('SELECT * FROM users WHERE openid = ?').get(req.openid);
    res.json({ data: serializeUser(user) });
  } catch (e) {
    console.error('PATCH /api/users/me error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users/phone - decrypt WeChat phone data
// body: { encryptedData, iv }
// Requires session_key in the current session (i.e., user logged in via real WeChat)
router.post('/phone', (req, res) => {
  try {
    const { encryptedData, iv } = req.body || {};
    if (!encryptedData || !iv) {
      return res.status(400).json({ error: 'encryptedData and iv are required' });
    }

    const session = getSessionByToken(req.sessionToken);
    if (!session || !session.session_key) {
      return res.status(400).json({
        error: 'No session_key available. Phone number decryption requires real WeChat login. ' +
          'Set USE_REAL_WECHAT_AUTH=true in .env.'
      });
    }

    let phoneInfo;
    try {
      phoneInfo = decryptPhone(session.session_key, encryptedData, iv);
    } catch (e) {
      console.warn(`Decrypt phone failed for openid=${req.openid}: ${e.message}`);
      return res.status(400).json({ error: e.message });
    }

    const phone = phoneInfo.purePhoneNumber || phoneInfo.phoneNumber;
    if (!phone) {
      return res.status(400).json({ error: 'Decrypted data has no phone number' });
    }
    if (!PHONE_REGEX.test(phone)) {
      return res.status(400).json({ error: `Decrypted phone is not a valid mainland number: ${phone}` });
    }

    // Save to user record
    getOrCreateUser(req.openid);
    db.prepare(`
      UPDATE users
      SET phone = ?, phone_verified = 1, updated_at = datetime('now', 'localtime')
      WHERE openid = ?
    `).run(phone, req.openid);

    const user = db.prepare('SELECT * FROM users WHERE openid = ?').get(req.openid);
    res.json({ data: serializeUser(user) });
  } catch (e) {
    console.error('POST /api/users/phone error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/users/me/phone - remove stored phone (logout-style clear)
router.delete('/me/phone', (req, res) => {
  try {
    db.prepare(`
      UPDATE users SET phone = NULL, phone_verified = 0, updated_at = datetime('now', 'localtime')
      WHERE openid = ?
    `).run(req.openid);
    res.status(204).end();
  } catch (e) {
    console.error('DELETE /api/users/me/phone error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

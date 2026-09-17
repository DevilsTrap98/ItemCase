const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getMysqlPool } = require('../config/db-mysql');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

function mapUser(row) {
  return { id: row.id, name: row.name, email: row.email, username: row.username };
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

const USERNAME_RE = /^[a-z0-9_]{3,32}$/;

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

router.post('/register', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim();
    const username = normalizeUsername(req.body?.username);

    if (!email || !password || !name || !username) {
      return res.status(400).json({ error: 'name, email, username and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'username must be 3-32 characters: lowercase letters, numbers, underscore' });
    }

    const pool = getMysqlPool();
    const [existing] = await pool.query('SELECT id, email, username FROM users WHERE email = ? OR username = ?', [email, username]);
    if (existing.some((r) => r.email === email)) {
      return res.status(409).json({ error: 'email already registered' });
    }
    if (existing.some((r) => r.username === username)) {
      return res.status(409).json({ error: 'username already taken' });
    }

    const id = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(
      'INSERT INTO users (id, email, password_hash, name, username) VALUES (?, ?, ?, ?, ?)',
      [id, email, passwordHash, name, username]
    );
    // Auto-join the app-wide general chat (see schema.sql's 'global' conversation).
    await pool.query('INSERT IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', ['global', id]);

    const user = { id, name, email, username };
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const pool = getMysqlPool();
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'invalid email or password' });
    }

    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'invalid email or password' });
    }

    const user = mapUser(rows[0]);
    res.json({ token: signToken(user), user });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) return res.status(401).json({ error: 'user no longer exists' });
    res.json({ user: mapUser(rows[0]) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

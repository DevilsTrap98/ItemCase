const express = require('express');
const { getMysqlPool } = require('../config/db-mysql');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function mapNotification(row) {
  // mysql2 already parses JSON-typed columns into objects — only a raw
  // string (e.g. from a driver that doesn't auto-parse) needs JSON.parse.
  let payload = row.payload;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch (e) { payload = null; }
  }
  return { id: row.id, type: row.type, payload: payload || null, readAt: row.read_at, createdAt: row.created_at };
}

router.get('/', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
      [req.user.id]
    );
    res.json(rows.map(mapNotification));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/read', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    await pool.query('UPDATE notifications SET read_at = NOW() WHERE id = ? AND user_id = ? AND read_at IS NULL', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/read-all', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    await pool.query('UPDATE notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL', [req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

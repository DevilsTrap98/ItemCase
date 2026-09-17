const express = require('express');
const { getMysqlPool } = require('../config/db-mysql');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email FROM user_blocks b
       JOIN users u ON u.id = b.blocked_id
       WHERE b.blocker_id = ?`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    if (userId === req.user.id) return res.status(400).json({ error: 'cannot block yourself' });

    const pool = getMysqlPool();
    await pool.query('INSERT IGNORE INTO user_blocks (blocker_id, blocked_id) VALUES (?, ?)', [req.user.id, userId]);
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete('/:userId', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    await pool.query('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?', [req.user.id, req.params.userId]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;

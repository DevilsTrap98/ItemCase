const express = require('express');
const crypto = require('crypto');
const { getMysqlPool } = require('../config/db-mysql');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();
router.use(optionalAuth);

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.type || !body.message) {
      return res.status(400).json({ error: 'type and message are required' });
    }

    const id = crypto.randomUUID();
    const pool = getMysqlPool();
    await pool.query(
      `INSERT INTO feedback (id, type, message, app_version, platform, submitted_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, body.type, body.message, body.appVersion || '', body.platform || '', req.user?.id || null]
    );
    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

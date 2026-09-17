const express = require('express');
const crypto = require('crypto');
const { getMysqlPool } = require('../config/db-mysql');

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.targetType || !body.targetId || !body.reason) {
      return res.status(400).json({ error: 'targetType, targetId and reason are required' });
    }

    const id = crypto.randomUUID();
    const pool = getMysqlPool();
    await pool.query(
      `INSERT INTO reports (id, target_type, target_id, target_name, reason, comment, status)
       VALUES (?, ?, ?, ?, ?, ?, 'open')`,
      [id, body.targetType, body.targetId, body.targetName || '', body.reason, body.comment || '']
    );
    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

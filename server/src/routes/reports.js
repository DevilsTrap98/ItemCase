const express = require('express');
const crypto = require('crypto');
const { getMysqlPool } = require('../config/db-mysql');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();
router.use(optionalAuth);

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.targetType || !body.targetId || !body.reason) {
      return res.status(400).json({ error: 'targetType, targetId and reason are required' });
    }

    const id = crypto.randomUUID();
    const pool = getMysqlPool();
    await pool.query(
      `INSERT INTO reports (id, target_type, target_id, target_name, reason, comment, status, submitted_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
      [id, body.targetType, body.targetId, body.targetName || '', body.reason, body.comment || '', req.user?.id || null]
    );

    // A report against a public catalog entry pulls it out of public view
    // immediately, before any admin has looked at it — moderation then
    // either restores or permanently removes it (see admin.js). Only an
    // approved entry gets hidden this way; anything already pending/removed
    // etc. is left alone.
    if (body.targetType === 'catalogItem') {
      await pool.query(
        "UPDATE catalog_entries SET previous_status_before_report = status, status = 'reported' WHERE id = ? AND status = 'approved'",
        [body.targetId]
      );
    }

    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

const express = require('express');
const crypto = require('crypto');
const { getMysqlPool } = require('../config/db-mysql');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();
router.use(optionalAuth);

// A single report never hides anything by itself — that would let any one
// account sabotage the catalog on demand. It only becomes an automatic
// quarantine once several *independent, authenticated* reporters have all
// flagged the same item (anonymous/guest reports don't count toward this).
// Anything more targeted — one clearly severe report, a technical/security
// concern — is a deliberate moderator action (see admin.js's manual
// quarantine endpoint), not something this threshold decides.
const INDEPENDENT_REPORTS_FOR_AUTO_QUARANTINE = 3;

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

    if (body.targetType === 'catalogItem') {
      const [[{ count }]] = await pool.query(
        `SELECT COUNT(DISTINCT submitted_by_user_id) AS count FROM reports
         WHERE target_type = 'catalogItem' AND target_id = ? AND status = 'open' AND submitted_by_user_id IS NOT NULL`,
        [body.targetId]
      );
      if (Number(count) >= INDEPENDENT_REPORTS_FOR_AUTO_QUARANTINE) {
        const [result] = await pool.query(
          "UPDATE catalog_entries SET previous_status_before_report = status, status = 'reported' WHERE id = ? AND status = 'approved'",
          [body.targetId]
        );
        if (result.affectedRows) {
          await pool.query(
            'INSERT INTO catalog_entry_history (id, catalog_item_id, from_status, to_status, reason, actor_user_id) VALUES (UUID(), ?, ?, ?, ?, ?)',
            [body.targetId, 'approved', 'reported', `Automatisch in Quarantäne: ${count} unabhängige Meldungen`, null]
          );
        }
      }
    }

    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

const express = require('express');
const crypto = require('crypto');
const { getMysqlPool } = require('../config/db-mysql');
const { requireAuth } = require('../middleware/auth');
const { notify } = require('../utils/notify');

const router = express.Router();
router.use(requireAuth);

function mapUser(row) {
  return { id: row.id, name: row.name, email: row.email, username: row.username };
}

router.get('/', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const myId = req.user.id;

    const [accepted] = await pool.query(
      `SELECT u.id, u.name, u.email, u.username FROM friend_requests fr
       JOIN users u ON u.id = IF(fr.from_user_id = ?, fr.to_user_id, fr.from_user_id)
       WHERE fr.status = 'accepted' AND (fr.from_user_id = ? OR fr.to_user_id = ?)`,
      [myId, myId, myId]
    );

    const [incoming] = await pool.query(
      `SELECT fr.id, u.id AS user_id, u.name, u.email, u.username, fr.created_at FROM friend_requests fr
       JOIN users u ON u.id = fr.from_user_id
       WHERE fr.status = 'pending' AND fr.to_user_id = ?`,
      [myId]
    );

    const [outgoing] = await pool.query(
      `SELECT fr.id, u.id AS user_id, u.name, u.email, u.username, fr.created_at FROM friend_requests fr
       JOIN users u ON u.id = fr.to_user_id
       WHERE fr.status = 'pending' AND fr.from_user_id = ?`,
      [myId]
    );

    res.json({
      friends: accepted.map(mapUser),
      incoming: incoming.map((r) => ({ id: r.id, user: { id: r.user_id, name: r.name, email: r.email, username: r.username }, createdAt: r.created_at })),
      outgoing: outgoing.map((r) => ({ id: r.id, user: { id: r.user_id, name: r.name, email: r.email, username: r.username }, createdAt: r.created_at }))
    });
  } catch (err) {
    next(err);
  }
});

router.post('/requests', async (req, res, next) => {
  try {
    const identifier = String(req.body?.identifier ?? req.body?.toUsername ?? '').trim().replace(/^@/, '').toLowerCase();
    if (!identifier || identifier.length > 254) return res.status(400).json({ error: 'Bitte Nutzername, E-Mail oder Anzeigename eingeben.' });

    const pool = getMysqlPool();
    let [targetRows] = await pool.query(
      'SELECT id, name, email, username FROM users WHERE LOWER(username) = ? OR LOWER(email) = ? LIMIT 2',
      [identifier, identifier]
    );
    if (targetRows.length === 0) {
      [targetRows] = await pool.query(
        'SELECT id, name, email, username FROM users WHERE LOWER(name) = ? LIMIT 2',
        [identifier]
      );
      if (targetRows.length > 1) {
        return res.status(409).json({ error: 'Mehrere Nutzer haben diesen Anzeigenamen. Bitte nutze den Nutzernamen oder die E-Mail.' });
      }
    }
    if (targetRows.length === 0) return res.status(404).json({ error: 'Kein passender Nutzer gefunden.' });

    const target = targetRows[0];
    if (target.id === req.user.id) return res.status(400).json({ error: 'cannot friend yourself' });

    const [blocks] = await pool.query(
      `SELECT 1 FROM user_blocks
       WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
      [req.user.id, target.id, target.id, req.user.id]
    );
    if (blocks.length > 0) return res.status(403).json({ error: 'blocked' });

    const [existing] = await pool.query(
      `SELECT id, status FROM friend_requests
       WHERE status IN ('pending', 'accepted')
         AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))`,
      [req.user.id, target.id, target.id, req.user.id]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: `friend request already ${existing[0].status}` });
    }

    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO friend_requests (id, from_user_id, to_user_id, status) VALUES (?, ?, ?, "pending")',
      [id, req.user.id, target.id]
    );
    await notify(req.app.get('io'), target.id, 'friend_request', { requestId: id, from: mapUser(req.user) });
    res.status(201).json({ id, user: mapUser(target) });
  } catch (err) {
    next(err);
  }
});

async function respond(req, res, next, status) {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query(
      'SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = "pending"',
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'request not found' });

    await pool.query('UPDATE friend_requests SET status = ?, responded_at = NOW() WHERE id = ?', [status, req.params.id]);
    if (status === 'accepted') {
      await notify(req.app.get('io'), rows[0].from_user_id, 'friend_accepted', { by: mapUser(req.user) });
    }
    res.json({ id: req.params.id, status });
  } catch (err) {
    next(err);
  }
}

router.post('/requests/:id/accept', (req, res, next) => respond(req, res, next, 'accepted'));
router.post('/requests/:id/decline', (req, res, next) => respond(req, res, next, 'declined'));

router.delete('/:userId', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    await pool.query(
      `DELETE FROM friend_requests
       WHERE status = 'accepted'
         AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))`,
      [req.user.id, req.params.userId, req.params.userId, req.user.id]
    );
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;

const express = require('express');
const crypto = require('crypto');
const { getMysqlPool } = require('../config/db-mysql');
const { requireAuth } = require('../middleware/auth');
const { filterText } = require('../utils/wordFilter');
const { emitToUsers } = require('../realtime');

const router = express.Router();
router.use(requireAuth);

async function memberIdsOf(pool, conversationId) {
  const [rows] = await pool.query('SELECT user_id FROM conversation_members WHERE conversation_id = ?', [conversationId]);
  return rows.map((r) => r.user_id);
}

async function assertMember(pool, conversationId, userId) {
  const [rows] = await pool.query(
    'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?',
    [conversationId, userId]
  );
  return rows.length > 0;
}

router.get('/', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query(
      `SELECT c.id, c.type, c.group_id, cm.last_read_at,
              g.name AS group_name,
              (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
              (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_at
       FROM conversation_members cm
       JOIN conversations c ON c.id = cm.conversation_id
       LEFT JOIN collector_groups g ON g.id = c.group_id
       WHERE cm.user_id = ?`,
      [req.user.id]
    );

    const results = [];
    for (const row of rows) {
      let peer = null;
      if (row.type === 'direct') {
        const [peerRows] = await pool.query(
          `SELECT u.id, u.name, u.email FROM conversation_members cm
           JOIN users u ON u.id = cm.user_id
           WHERE cm.conversation_id = ? AND cm.user_id != ?`,
          [row.id, req.user.id]
        );
        peer = peerRows[0] || null;
      }
      results.push({
        id: row.id,
        type: row.type,
        groupId: row.group_id,
        groupName: row.group_name,
        peer,
        lastMessage: row.last_message,
        lastMessageAt: row.last_message_at,
        unread: !!(row.last_message_at && (!row.last_read_at || new Date(row.last_message_at) > new Date(row.last_read_at)))
      });
    }
    res.json(results);
  } catch (err) {
    next(err);
  }
});

router.post('/direct', async (req, res, next) => {
  try {
    const { friendId } = req.body || {};
    if (!friendId) return res.status(400).json({ error: 'friendId is required' });

    const pool = getMysqlPool();
    const [friendship] = await pool.query(
      `SELECT 1 FROM friend_requests
       WHERE status = 'accepted' AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))`,
      [req.user.id, friendId, friendId, req.user.id]
    );
    if (friendship.length === 0) return res.status(403).json({ error: 'not friends' });

    const [existing] = await pool.query(
      `SELECT c.id FROM conversations c
       JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
       JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
       WHERE c.type = 'direct'`,
      [req.user.id, friendId]
    );
    if (existing.length > 0) return res.json({ id: existing[0].id });

    const id = crypto.randomUUID();
    await pool.query('INSERT INTO conversations (id, type) VALUES (?, "direct")', [id]);
    await pool.query('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?), (?, ?)', [id, req.user.id, id, friendId]);
    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/messages', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    if (!(await assertMember(pool, req.params.id, req.user.id))) {
      return res.status(403).json({ error: 'not a member of this conversation' });
    }

    const before = req.query.before ? new Date(req.query.before) : null;
    const [rows] = before
      ? await pool.query(
          `SELECT m.*, u.name AS sender_name FROM messages m JOIN users u ON u.id = m.sender_id
           WHERE m.conversation_id = ? AND m.created_at < ? ORDER BY m.created_at DESC LIMIT 50`,
          [req.params.id, before]
        )
      : await pool.query(
          `SELECT m.*, u.name AS sender_name FROM messages m JOIN users u ON u.id = m.sender_id
           WHERE m.conversation_id = ? ORDER BY m.created_at DESC LIMIT 50`,
          [req.params.id]
        );

    res.json(rows.reverse().map((r) => ({
      id: r.id, conversationId: r.conversation_id, senderId: r.sender_id, senderName: r.sender_name,
      body: r.body, filtered: !!r.filtered, createdAt: r.created_at
    })));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/messages', async (req, res, next) => {
  try {
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'body is required' });
    if (body.length > 2000) return res.status(400).json({ error: 'message too long' });

    const pool = getMysqlPool();
    if (!(await assertMember(pool, req.params.id, req.user.id))) {
      return res.status(403).json({ error: 'not a member of this conversation' });
    }

    const memberIds = await memberIdsOf(pool, req.params.id);
    if (memberIds.length === 2) {
      const otherId = memberIds.find((id) => id !== req.user.id);
      const [blocks] = await pool.query(
        `SELECT 1 FROM user_blocks
         WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
        [req.user.id, otherId, otherId, req.user.id]
      );
      if (blocks.length > 0) return res.status(403).json({ error: 'blocked' });
    }

    const { text, blocked, masked } = await filterText(body);
    if (blocked) return res.status(422).json({ error: 'message rejected by content filter' });

    const id = crypto.randomUUID();
    const message = {
      id, conversationId: req.params.id, senderId: req.user.id, senderName: req.user.name,
      body: text, filtered: masked, createdAt: new Date().toISOString()
    };
    await pool.query(
      'INSERT INTO messages (id, conversation_id, sender_id, body, filtered) VALUES (?, ?, ?, ?, ?)',
      [id, req.params.id, req.user.id, text, masked ? 1 : 0]
    );
    await pool.query('UPDATE conversation_members SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?', [req.params.id, req.user.id]);

    emitToUsers(req.app.get('io'), memberIds, 'message:new', message);
    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/read', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    await pool.query('UPDATE conversation_members SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

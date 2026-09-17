const express = require('express');
const crypto = require('crypto');
const { getMysqlPool } = require('../config/db-mysql');
const { requireAuth } = require('../middleware/auth');
const { notify } = require('../utils/notify');
const { RANK, getRole, getGroupConversationId } = require('../utils/groupRoles');

const router = express.Router();
router.use(requireAuth);

function mapGroup(row) {
  return { id: row.id, name: row.name, description: row.description, visibility: row.visibility, ownerId: row.owner_id, createdAt: row.created_at };
}

router.get('/', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query(
      `SELECT g.*, gm.role, c.id AS conversation_id,
              (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS member_count
       FROM group_members gm
       JOIN collector_groups g ON g.id = gm.group_id
       LEFT JOIN conversations c ON c.group_id = g.id
       WHERE gm.user_id = ?`,
      [req.user.id]
    );
    res.json(rows.map((r) => ({ ...mapGroup(r), role: r.role, conversationId: r.conversation_id, memberCount: r.member_count })));
  } catch (err) {
    next(err);
  }
});

router.get('/discover', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query(
      `SELECT g.*, (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS member_count
       FROM collector_groups g
       WHERE g.visibility = 'public' AND g.id NOT IN (SELECT group_id FROM group_members WHERE user_id = ?)
         AND g.id NOT IN (SELECT group_id FROM group_bans WHERE user_id = ?)`,
      [req.user.id, req.user.id]
    );
    res.json(rows.map((r) => ({ ...mapGroup(r), memberCount: r.member_count })));
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const visibility = req.body?.visibility === 'private' ? 'private' : 'public';
    const description = String(req.body?.description || '').trim();

    const pool = getMysqlPool();
    const id = crypto.randomUUID();
    const conversationId = crypto.randomUUID();

    await pool.query('INSERT INTO collector_groups (id, name, description, visibility, owner_id) VALUES (?, ?, ?, ?, ?)', [id, name, description, visibility, req.user.id]);
    await pool.query('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, "owner")', [id, req.user.id]);
    await pool.query('INSERT INTO conversations (id, type, group_id) VALUES (?, "group", ?)', [conversationId, id]);
    await pool.query('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', [conversationId, req.user.id]);

    res.status(201).json({ id, name, description, visibility, ownerId: req.user.id, role: 'owner', conversationId, memberCount: 1 });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [groupRows] = await pool.query('SELECT * FROM collector_groups WHERE id = ?', [req.params.id]);
    if (groupRows.length === 0) return res.status(404).json({ error: 'group not found' });
    const group = groupRows[0];

    const myRole = await getRole(pool, req.params.id, req.user.id);
    if (group.visibility === 'private' && !myRole) return res.status(403).json({ error: 'private group' });

    const [members] = await pool.query(
      `SELECT u.id, u.name, u.email, gm.role, gm.joined_at FROM group_members gm
       JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ? ORDER BY FIELD(gm.role, 'owner','admin','moderator','member'), gm.joined_at`,
      [req.params.id]
    );
    const conversationId = await getGroupConversationId(pool, req.params.id);

    res.json({ ...mapGroup(group), myRole, conversationId, members });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/join', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [groupRows] = await pool.query('SELECT * FROM collector_groups WHERE id = ?', [req.params.id]);
    if (groupRows.length === 0) return res.status(404).json({ error: 'group not found' });
    if (groupRows[0].visibility !== 'public') return res.status(403).json({ error: 'group is private' });

    const [banned] = await pool.query('SELECT 1 FROM group_bans WHERE group_id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (banned.length > 0) return res.status(403).json({ error: 'banned from this group' });

    await pool.query('INSERT IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, "member")', [req.params.id, req.user.id]);
    const conversationId = await getGroupConversationId(pool, req.params.id);
    if (conversationId) await pool.query('INSERT IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', [conversationId, req.user.id]);

    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/members', async (req, res, next) => {
  try {
    const username = String(req.body?.username || '').trim().toLowerCase();
    if (!username) return res.status(400).json({ error: 'username is required' });

    const pool = getMysqlPool();
    const myRole = await getRole(pool, req.params.id, req.user.id);
    if (RANK[myRole] < RANK.admin) return res.status(403).json({ error: 'admin role required' });

    const [userRows] = await pool.query('SELECT id, name, email FROM users WHERE username = ?', [username]);
    if (userRows.length === 0) return res.status(404).json({ error: 'no user with that username' });
    const target = userRows[0];

    const [banned] = await pool.query('SELECT 1 FROM group_bans WHERE group_id = ? AND user_id = ?', [req.params.id, target.id]);
    if (banned.length > 0) return res.status(403).json({ error: 'user is banned from this group' });

    await pool.query('INSERT IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, "member")', [req.params.id, target.id]);
    const conversationId = await getGroupConversationId(pool, req.params.id);
    if (conversationId) await pool.query('INSERT IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', [conversationId, target.id]);

    const [groupRows] = await pool.query('SELECT name FROM collector_groups WHERE id = ?', [req.params.id]);
    await notify(req.app.get('io'), target.id, 'group_added', { groupId: req.params.id, groupName: groupRows[0]?.name, by: { id: req.user.id, name: req.user.name } });

    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/members/:userId', async (req, res, next) => {
  try {
    const newRole = req.body?.role;
    if (!['admin', 'moderator', 'member'].includes(newRole)) return res.status(400).json({ error: 'invalid role' });

    const pool = getMysqlPool();
    const myRole = await getRole(pool, req.params.id, req.user.id);
    const targetRole = await getRole(pool, req.params.id, req.params.userId);
    if (!targetRole) return res.status(404).json({ error: 'not a member' });
    if (RANK[myRole] < RANK.admin) return res.status(403).json({ error: 'admin role required' });
    if (RANK[myRole] <= RANK[targetRole]) return res.status(403).json({ error: 'cannot modify a member with equal or higher rank' });
    if (RANK[newRole] >= RANK[myRole]) return res.status(403).json({ error: 'cannot grant a role equal to or higher than your own' });

    await pool.query('UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?', [newRole, req.params.id, req.params.userId]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

async function removeMember(req, res, next, { ban }) {
  try {
    const pool = getMysqlPool();
    const isSelf = req.params.userId === req.user.id;
    const myRole = await getRole(pool, req.params.id, req.user.id);
    const targetRole = await getRole(pool, req.params.id, req.params.userId);
    if (!targetRole) return res.status(404).json({ error: 'not a member' });
    if (targetRole === 'owner') return res.status(400).json({ error: 'the owner cannot be removed; delete the group instead' });

    if (!isSelf) {
      if (RANK[myRole] < RANK.moderator) return res.status(403).json({ error: 'moderator role required' });
      if (RANK[myRole] <= RANK[targetRole]) return res.status(403).json({ error: 'cannot act on a member with equal or higher rank' });
    }

    await pool.query('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', [req.params.id, req.params.userId]);
    const conversationId = await getGroupConversationId(pool, req.params.id);
    if (conversationId) await pool.query('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [conversationId, req.params.userId]);
    if (ban) await pool.query('INSERT IGNORE INTO group_bans (group_id, user_id) VALUES (?, ?)', [req.params.id, req.params.userId]);

    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

router.delete('/:id/members/:userId', (req, res, next) => removeMember(req, res, next, { ban: false }));
router.post('/:id/ban/:userId', (req, res, next) => removeMember(req, res, next, { ban: true }));

router.delete('/:id', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const myRole = await getRole(pool, req.params.id, req.user.id);
    if (myRole !== 'owner') return res.status(403).json({ error: 'owner role required' });
    await pool.query('DELETE FROM collector_groups WHERE id = ?', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;

const { getMysqlPool } = require('../config/db-mysql');

const RANK = { member: 0, moderator: 1, admin: 2, owner: 3 };

async function getRole(pool, groupId, userId) {
  const [rows] = await pool.query('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, userId]);
  return rows[0]?.role || null;
}

async function getGroupConversationId(pool, groupId) {
  const [rows] = await pool.query('SELECT id FROM conversations WHERE group_id = ?', [groupId]);
  return rows[0]?.id || null;
}

module.exports = { RANK, getRole, getGroupConversationId };

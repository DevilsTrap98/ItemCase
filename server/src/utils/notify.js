const crypto = require('crypto');
const { getMysqlPool } = require('../config/db-mysql');
const { emitToUsers } = require('../realtime');

// Persists a Notification Center entry and pushes it live if the recipient
// is polling (see realtime.js). `io` is a legacy, unused argument — kept so
// existing call sites didn't need to change.
async function notify(io, userId, type, payload) {
  const pool = getMysqlPool();
  const id = crypto.randomUUID();
  await pool.query('INSERT INTO notifications (id, user_id, type, payload) VALUES (?, ?, ?, ?)', [
    id, userId, type, JSON.stringify(payload || {})
  ]);
  const notification = { id, type, payload, readAt: null, createdAt: new Date().toISOString() };
  emitToUsers(io, [userId], 'notification:new', notification);
  return notification;
}

module.exports = { notify };

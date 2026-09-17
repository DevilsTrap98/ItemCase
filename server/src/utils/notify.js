const crypto = require('crypto');
const { getMysqlPool } = require('../config/db-mysql');
const { emitToUsers } = require('../realtime');

// Persists a Notification Center entry and pushes it live if the recipient
// is connected. `io` may be undefined (e.g. in tests) — persistence still
// happens, just without the live push.
async function notify(io, userId, type, payload) {
  const pool = getMysqlPool();
  const id = crypto.randomUUID();
  await pool.query('INSERT INTO notifications (id, user_id, type, payload) VALUES (?, ?, ?, ?)', [
    id, userId, type, JSON.stringify(payload || {})
  ]);
  const notification = { id, type, payload, readAt: null, createdAt: new Date().toISOString() };
  if (io) emitToUsers(io, [userId], 'notification:new', notification);
  return notification;
}

module.exports = { notify };

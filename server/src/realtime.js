const jwt = require('jsonwebtoken');
const { getMysqlPool } = require('./config/db-mysql');

// Counts sockets per user rather than a plain Set, so a user connected
// from two windows/devices doesn't flip to "offline" when only one of
// them disconnects.
const onlineCounts = new Map();

function markOnline(userId) {
  onlineCounts.set(userId, (onlineCounts.get(userId) || 0) + 1);
}

function markOffline(userId) {
  const next = (onlineCounts.get(userId) || 1) - 1;
  if (next <= 0) onlineCounts.delete(userId);
  else onlineCounts.set(userId, next);
}

function isOnline(userId) {
  return onlineCounts.has(userId);
}

// Every connected client joins exactly one room, `user:<id>` — events are
// addressed to recipients by user id (looked up from conversation/group
// membership at send-time in the routes) rather than by pre-joining
// per-conversation rooms. That keeps delivery correct even when membership
// changes without requiring the client to reconnect.
function initRealtime(io) {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('unauthorized'));
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'], issuer: 'itemcase-api', audience: 'itemcase-desktop' });
      const pool = getMysqlPool();
      const [rows] = await pool.query('SELECT token_version, account_status FROM users WHERE id = ?', [payload.id]);
      if (!rows.length || rows[0].account_status !== 'active' || Number(rows[0].token_version) !== Number(payload.tokenVersion || 0)) throw new Error('revoked');
      socket.user = payload;
      next();
    } catch (e) {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.user.id}`);
    markOnline(socket.user.id);

    socket.on('disconnect', () => markOffline(socket.user.id));

    socket.on('typing', async ({ conversationId, isTyping } = {}) => {
      if (typeof conversationId !== 'string' || conversationId.length > 64) return;
      try {
        const pool = getMysqlPool();
        const [membership] = await pool.query(
          `SELECT 1 FROM conversation_members cm
           JOIN users u ON u.id = cm.user_id
           WHERE cm.conversation_id = ? AND cm.user_id = ? AND u.token_version = ? AND u.account_status = 'active'`,
          [conversationId, socket.user.id, Number(socket.user.tokenVersion || 0)]
        );
        if (membership.length === 0) return;
        const [members] = await pool.query(
          'SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id <> ?',
          [conversationId, socket.user.id]
        );
        members.forEach(({ user_id: id }) => {
          socket.to(`user:${id}`).emit('typing', { conversationId, userId: socket.user.id, isTyping: !!isTyping });
        });
      } catch (error) {
        console.error('[realtime] typing authorization failed', error.message);
      }
    });
  });
}

function emitToUsers(io, userIds, event, payload) {
  userIds.forEach((id) => io.to(`user:${id}`).emit(event, payload));
}

module.exports = { initRealtime, emitToUsers, isOnline };

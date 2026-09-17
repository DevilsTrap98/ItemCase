const jwt = require('jsonwebtoken');

// Every connected client joins exactly one room, `user:<id>` — events are
// addressed to recipients by user id (looked up from conversation/group
// membership at send-time in the routes) rather than by pre-joining
// per-conversation rooms. That keeps delivery correct even when membership
// changes without requiring the client to reconnect.
function initRealtime(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('unauthorized'));
    try {
      socket.user = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch (e) {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.user.id}`);

    socket.on('typing', ({ conversationId, memberIds, isTyping }) => {
      (memberIds || [])
        .filter((id) => id !== socket.user.id)
        .forEach((id) => {
          socket.to(`user:${id}`).emit('typing', { conversationId, userId: socket.user.id, isTyping: !!isTyping });
        });
    });
  });
}

function emitToUsers(io, userIds, event, payload) {
  userIds.forEach((id) => io.to(`user:${id}`).emit(event, payload));
}

module.exports = { initRealtime, emitToUsers };

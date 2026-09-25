// "Live" delivery without WebSockets: plain HTTP polling.
//
// Shared web-hosting packages generally can't hold WebSocket (Socket.io)
// connections open, so events are instead queued per user in memory and
// clients ask for anything new via GET /api/realtime/poll (see
// routes/realtime.js) every few seconds. The producer API is unchanged —
// emitToUsers(io, userIds, event, payload) — so notify() and the routes
// that push messages didn't need to change (the `io` argument is unused).
//
// State is per Node process: fine for the usual single-process hosting; if
// this were ever scaled to several processes the queue would have to move
// into the database or Redis. Nothing is lost by a restart that matters:
// notifications and messages are persisted in MySQL and fetched on load —
// the queue is only the "push" hint on top of that.

const QUEUE_LIMIT = 200;          // events kept per user
const QUEUE_TTL_MS = 5 * 60 * 1000;
const ONLINE_WINDOW_MS = 45 * 1000; // "online" = polled within this window

const queues = new Map();   // userId -> [{ id, event, payload, at }]
const lastSeen = new Map(); // userId -> ms timestamp of last poll
let nextEventId = 1;

function isOnline(userId) {
  const seen = lastSeen.get(userId);
  return !!seen && Date.now() - seen < ONLINE_WINDOW_MS;
}

function emitToUsers(_io, userIds, event, payload) {
  const now = Date.now();
  userIds.forEach((userId) => {
    const queue = queues.get(userId) || [];
    queue.push({ id: nextEventId++, event, payload, at: now });
    while (queue.length > QUEUE_LIMIT) queue.shift();
    queues.set(userId, queue);
  });
}

// Returns events newer than `since`. Without a cursor (first poll after
// start-up/login) nothing is replayed — just the current cursor — because
// anything older is already available through the normal list endpoints.
function pollEvents(userId, since) {
  lastSeen.set(userId, Date.now());
  const now = Date.now();
  const queue = (queues.get(userId) || []).filter((e) => now - e.at < QUEUE_TTL_MS);
  if (queue.length) queues.set(userId, queue); else queues.delete(userId);

  const latest = nextEventId - 1;
  // No cursor, or one from before a server restart (ids restart at 1):
  // resync to "now" instead of replaying or silently missing events.
  if (!Number.isSafeInteger(since) || since > latest) return { cursor: latest, events: [] };
  const events = queue.filter((e) => e.id > since).map(({ id, event, payload }) => ({ id, event, payload }));
  return { cursor: events.length ? events[events.length - 1].id : since, events };
}

// Drops idle bookkeeping so the maps don't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [userId, seen] of lastSeen) if (now - seen > ONLINE_WINDOW_MS * 4) lastSeen.delete(userId);
  for (const [userId, queue] of queues) {
    const fresh = queue.filter((e) => now - e.at < QUEUE_TTL_MS);
    if (fresh.length) queues.set(userId, fresh); else queues.delete(userId);
  }
}, 60 * 1000).unref();

module.exports = { emitToUsers, isOnline, pollEvents };

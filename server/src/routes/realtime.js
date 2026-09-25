const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { pollEvents } = require('../realtime');

const router = express.Router();

// GET /api/realtime/poll?since=<cursor>
// Replaces the former Socket.io channel (see src/realtime.js). Also doubles
// as the presence heartbeat: a user counts as online while they keep polling.
router.get('/poll', requireAuth, (req, res) => {
  const since = req.query.since === undefined ? NaN : Number(req.query.since);
  res.json(pollEvents(req.user.id, since));
});

module.exports = router;

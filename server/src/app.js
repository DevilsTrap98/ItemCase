const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const friendsRoutes = require('./routes/friends');
const blocksRoutes = require('./routes/blocks');
const groupsRoutes = require('./routes/groups');
const forumRoutes = require('./routes/forum');
const conversationsRoutes = require('./routes/conversations');
const notificationsRoutes = require('./routes/notifications');
const catalogRoutes = require('./routes/catalog');
const reportsRoutes = require('./routes/reports');
const feedbackRoutes = require('./routes/feedback');
const { errorHandler } = require('./middleware/errorHandler');

// Express app definition only — no listen(), no DB connect — so it can be
// imported and driven directly in tests later without starting a real
// server (same split as MatchIQ's server/src/app.js).
function createApp() {
  const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? '*';
  const allowedOrigins = CLIENT_ORIGIN.split(',').map((origin) => origin.trim());
  const corsOrigin = allowedOrigins.includes('*') ? true : allowedOrigins;

  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: corsOrigin }));
  // Higher limit than a typical JSON API: catalog/photo submissions carry
  // base64 image data URLs (see schema.sql image_data columns).
  app.use(express.json({ limit: '8mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/friends', friendsRoutes);
  app.use('/api/blocks', blocksRoutes);
  app.use('/api/groups', groupsRoutes);
  app.use('/api/forum', forumRoutes);
  app.use('/api/conversations', conversationsRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/catalog', catalogRoutes);
  app.use('/api/reports', reportsRoutes);
  app.use('/api/feedback', feedbackRoutes);

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };

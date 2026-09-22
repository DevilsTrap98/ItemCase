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
const collectionRoutes = require('./routes/collection');
const wishlistRoutes = require('./routes/wishlist');
const marketRoutes = require('./routes/market');
const catalogRoutes = require('./routes/catalog');
const reportsRoutes = require('./routes/reports');
const feedbackRoutes = require('./routes/feedback');
const adminRoutes = require('./routes/admin');
const { FEATURES, requireFeature } = require('./config/featureFlags');
const { errorHandler } = require('./middleware/errorHandler');
const { globalLimiter, submissionLimiter } = require('./middleware/rateLimits');
const { uploadsRoot, authorizePrivateImage } = require('./utils/imageStorage');

// Express app definition only — no listen(), no DB connect — so it can be
// imported and driven directly in tests later without starting a real
// server (same split as MatchIQ's server/src/app.js).
function createApp() {
  const allowedOrigins = String(process.env.CLIENT_ORIGIN || '')
    .split(',').map((origin) => origin.trim()).filter(Boolean);
  const corsOrigin = (origin, callback) => {
    // Native Electron/CLI calls do not carry a browser Origin header.
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed'));
  };

  const app = express();
  app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: corsOrigin, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], maxAge: 86400 }));
  // Uploads arrive once as data URLs and are immediately decoded into files.
  // They are never persisted as base64 in MySQL.
  app.use(express.json({ limit: '8mb' }));
  app.use(globalLimiter);

  app.use('/uploads', authorizePrivateImage, express.static(uploadsRoot, {
    fallthrough: false,
    immutable: true,
    maxAge: '30d',
    setHeaders(res) {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
  }));

  // Public — the client reads this once at startup to decide which nav
  // entries and screens to render. The server-side requireFeature() gates
  // below are what actually enforce this; the client hiding itself is just
  // UX, never the security boundary (spec: "eine rein visuelle Ausblendung
  // im Client reicht nicht aus").
  app.get('/api/config/features', (_req, res) => res.json(FEATURES));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/friends', requireFeature('friends'), friendsRoutes);
  // user_blocks is shared plumbing for the friends-block and market-block
  // features; it has no reason to be reachable unless at least one of them is on.
  app.use('/api/blocks', (req, res, next) => (FEATURES.friends || FEATURES.market ? next() : res.status(404).json({ error: 'not found' })), blocksRoutes);
  app.use('/api/groups', requireFeature('groups'), groupsRoutes);
  app.use('/api/forum', requireFeature('forum'), forumRoutes);
  app.use('/api/conversations', requireFeature('chat'), conversationsRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/collection', collectionRoutes);
  app.use('/api/wishlist', wishlistRoutes);
  app.use('/api/market', requireFeature('market'), marketRoutes);
  app.use('/api/catalog', catalogRoutes);
  app.use('/api/reports', submissionLimiter, reportsRoutes);
  app.use('/api/feedback', submissionLimiter, feedbackRoutes);
  app.use('/api/admin', adminRoutes);

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };

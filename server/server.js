require('dotenv').config();

const http = require('http');
const { Server } = require('socket.io');
const { createApp } = require('./src/app');
const { getMysqlPool } = require('./src/config/db-mysql');
const { initRealtime } = require('./src/realtime');

for (const name of ['MYSQL_URL', 'JWT_SECRET']) {
  if (!process.env[name]) {
    console.error(`[startup] Missing required env var ${name} — see .env.example`);
    process.exit(1);
  }
}
if (Buffer.byteLength(process.env.JWT_SECRET, 'utf8') < 32) {
  console.error('[startup] JWT_SECRET must contain at least 32 bytes');
  process.exit(1);
}

const PORT = Number(process.env.PORT ?? 5100);
const HOST = process.env.HOST || '0.0.0.0';

// Fails fast if the database is unreachable instead of accepting traffic
// it can't actually serve (same pattern as MatchIQ's server.js).
getMysqlPool()
  .query('SELECT 1')
  .then(() => {
    const app = createApp();
    const httpServer = http.createServer(app);

    const allowedOrigins = String(process.env.CLIENT_ORIGIN || '')
      .split(',').map((origin) => origin.trim()).filter(Boolean);
    const io = new Server(httpServer, {
      cors: {
        origin(origin, callback) {
          if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return callback(null, true);
          return callback(new Error('Origin not allowed'));
        },
        methods: ['GET', 'POST']
      }
    });
    initRealtime(io);
    // Routes reach the socket layer via req.app.get('io') to push
    // message/notification events after persisting them.
    app.set('io', io);

    httpServer.listen(PORT, HOST, () => console.log(`[startup] ItemCase server listening on ${HOST}:${PORT}`));
  })
  .catch((error) => {
    console.error('[startup] Failed to connect to MySQL', error);
    process.exit(1);
  });

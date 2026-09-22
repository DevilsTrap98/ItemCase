const mysql = require('mysql2/promise');

let rawPool;

const TRANSIENT_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR'
]);

function createPool() {
  const uri = process.env.MYSQL_URL;
  if (!uri) throw new Error('Missing required env var MYSQL_URL');
  const parsed = new URL(uri);
  return mysql.createPool({
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    waitForConnections: true,
    connectionLimit: 10,
    maxIdle: 10,
    idleTimeout: 60_000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  });
}

function currentPool() {
  if (!rawPool) rawPool = createPool();
  return rawPool;
}

async function retryAfterReconnect(operation) {
  const failedPool = currentPool();
  try {
    return await operation(failedPool);
  } catch (error) {
    if (!TRANSIENT_CODES.has(error.code)) throw error;
    if (rawPool === failedPool) rawPool = createPool();
    failedPool.end().catch(() => {});
    return operation(currentPool());
  }
}

// A stable facade lets every route share the pool while transparently
// replacing stale connections dropped by hosted MySQL after idle time.
const poolFacade = {
  query: (...args) => retryAfterReconnect((pool) => pool.query(...args)),
  execute: (...args) => retryAfterReconnect((pool) => pool.execute(...args)),
  getConnection: () => retryAfterReconnect((pool) => pool.getConnection()),
  end: async () => closeMysqlPool()
};

function getMysqlPool() {
  currentPool();
  return poolFacade;
}

async function closeMysqlPool() {
  if (rawPool) {
    const closing = rawPool;
    rawPool = undefined;
    await closing.end();
  }
}

module.exports = { getMysqlPool, closeMysqlPool };

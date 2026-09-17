const mysql = require('mysql2/promise');

// Single shared pool for the whole app (same pattern as MatchIQ's
// server/src/config/db-mysql.js) — one connection pool reused across
// every request instead of connecting per query.
let pool;

function getMysqlPool() {
  if (!pool) {
    const uri = process.env.MYSQL_URL;
    if (!uri) throw new Error('Missing required env var MYSQL_URL');
    pool = mysql.createPool(uri);
  }
  return pool;
}

async function closeMysqlPool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

module.exports = { getMysqlPool, closeMysqlPool };

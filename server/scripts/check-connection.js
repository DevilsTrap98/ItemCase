require('dotenv').config();
const mysql = require('mysql2/promise');

// Quick standalone diagnostic: run `node scripts/check-connection.js` to
// verify MYSQL_URL in .env actually authenticates, without starting the
// whole server or touching any tables.
(async () => {
  if (!process.env.MYSQL_URL) {
    console.error('[check] Missing required env var MYSQL_URL — see .env.example');
    process.exit(1);
  }
  try {
    const pool = mysql.createPool(process.env.MYSQL_URL);
    await pool.query('SELECT 1');
    console.log('[check] Connection OK.');
    await pool.end();
  } catch (err) {
    console.error('[check] Connection FAILED:', err.code, '-', err.message);
    process.exit(1);
  }
})();

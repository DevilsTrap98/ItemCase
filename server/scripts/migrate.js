require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// Applies schema.sql idempotently (CREATE TABLE IF NOT EXISTS / INSERT
// IGNORE throughout), so re-running this after the schema already exists
// is safe and just seeds any still-missing demo rows.
async function migrate() {
  if (!process.env.MYSQL_URL) {
    console.error('[migrate] Missing required env var MYSQL_URL — see .env.example');
    process.exit(1);
  }

  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf-8');
  // Strip full-line comments first — filtering whole statements that
  // *start* with "--" would also throw out a real statement whenever a
  // comment happens to precede it in the same chunk (it did, for both
  // catalog_entries and the seed INSERT).
  const withoutComments = sql.replace(/^--.*$/gm, '');
  const statements = withoutComments
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // ALTER TABLE has no universal "IF NOT EXISTS" in MySQL, so a column/index
  // that a previous run already added throws here on a re-run — treated as
  // success rather than a failure.
  const ALREADY_APPLIED = new Set(['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_FK_DUP_NAME']);

  const pool = mysql.createPool(process.env.MYSQL_URL);
  try {
    for (const statement of statements) {
      try {
        await pool.query(statement);
      } catch (err) {
        if (ALREADY_APPLIED.has(err.code)) {
          console.log(`[migrate] already applied (${err.code}), skipping: ${statement.slice(0, 60)}...`);
          continue;
        }
        throw err;
      }
    }
    const [tables] = await pool.query('SHOW TABLES');
    console.log('[migrate] Schema applied. Tables:', tables.map((t) => Object.values(t)[0]).join(', '));
  } finally {
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('[migrate] Failed:', err.message);
  process.exit(1);
});

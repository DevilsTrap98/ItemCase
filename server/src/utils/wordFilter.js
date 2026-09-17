const { getMysqlPool } = require('../config/db-mysql');

let cache = null;
let cacheAt = 0;
const CACHE_MS = 60_000;

async function getWordList() {
  if (cache && Date.now() - cacheAt < CACHE_MS) return cache;
  const pool = getMysqlPool();
  const [rows] = await pool.query('SELECT word, severity FROM blocked_words');
  cache = rows;
  cacheAt = Date.now();
  return cache;
}

const LEET_SUBS = { a: '[a@4]', e: '[e3]', i: '[i1!]', o: '[o0]', s: '[s$5]', u: '[uü]' };

// Builds a regex that also catches simple evasions: leetspeak substitutions
// and separators inserted between letters (e.g. "s.c-h e i ß e").
function buildPattern(word) {
  const body = word
    .split('')
    .map((ch) => LEET_SUBS[ch.toLowerCase()] || ch)
    .join('[\\s\\-_.*]*');
  return new RegExp(body, 'gi');
}

// Checks free-text against the (versioned, DB-backed) blocked-word list.
// 'mask' severity replaces the match with asterisks; 'block' severity
// rejects the message outright — mirrors the PDF's severity-based filter.
async function filterText(text) {
  const words = await getWordList();
  let result = text;
  let blocked = false;
  let masked = false;

  for (const { word, severity } of words) {
    const pattern = buildPattern(word);
    if (pattern.test(result)) {
      if (severity === 'block') {
        blocked = true;
      } else {
        masked = true;
        result = result.replace(buildPattern(word), (match) => '*'.repeat(match.length));
      }
    }
  }

  return { text: result, blocked, masked };
}

module.exports = { filterText };

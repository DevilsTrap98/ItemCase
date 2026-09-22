const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getMysqlPool } = require('../config/db-mysql');

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) throw new Error('JWT_SECRET must contain at least 32 bytes');
  return secret;
}

function signToken(user, { rememberMe = false } = {}) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, username: user.username, tariff: user.tariff || 'free', tokenVersion: Number(user.tokenVersion ?? user.token_version ?? 0) },
    getSecret(),
    { expiresIn: rememberMe ? '30d' : '12h', algorithm: 'HS256', issuer: 'itemcase-api', audience: 'itemcase-desktop', jwtid: crypto.randomUUID() }
  );
}

function readToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  try {
    return jwt.verify(token, getSecret(), { algorithms: ['HS256'], issuer: 'itemcase-api', audience: 'itemcase-desktop' });
  } catch (e) {
    return null;
  }
}

// A manual tariff grant (see admin.js POST /tariff-grants) ends itself the
// moment it's past due, without needing a scheduled job: the very next
// authenticated request from that user reverts them. Only queried for
// non-free users, so this costs nothing on the hot path for everyone else.
async function expireTariffGrantIfDue(pool, userId, currentTariff) {
  if (currentTariff === 'free') return currentTariff;
  const [[grant]] = await pool.query(
    "SELECT * FROM tariff_grants WHERE user_id = ? AND status = 'active' AND ends_at IS NOT NULL AND ends_at <= NOW() LIMIT 1",
    [userId]
  );
  if (!grant) return currentTariff;
  await pool.query("UPDATE tariff_grants SET status = 'expired' WHERE id = ?", [grant.id]);
  // Only revert if nothing else (a newer grant, an admin action) already
  // changed the tariff away from what this grant set.
  if (grant.tariff === currentTariff) {
    await pool.query("UPDATE users SET tariff = 'free', token_version = token_version + 1 WHERE id = ?", [userId]);
    return 'free';
  }
  return currentTariff;
}

// Rejects the request if there's no valid token.
async function requireAuth(req, res, next) {
  const payload = readToken(req);
  if (!payload) return res.status(401).json({ error: 'Authentication required' });
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query('SELECT token_version, role, tariff, account_status FROM users WHERE id = ?', [payload.id]);
    if (rows.length === 0 || Number(rows[0].token_version) !== Number(payload.tokenVersion || 0)) {
      return res.status(401).json({ error: 'Sitzung ist abgelaufen' });
    }
    if (rows[0].account_status === 'suspended') return res.status(403).json({ error: 'Dieses Konto wurde gesperrt.' });
    const tariff = await expireTariffGrantIfDue(pool, payload.id, rows[0].tariff || 'free');
    req.user = { ...payload, role: rows[0].role, tariff };
    next();
  } catch (error) {
    next(error);
  }
}

// Attaches req.user when a valid token is present, but never rejects —
// used by routes that accept both guest and logged-in submissions.
async function optionalAuth(req, _res, next) {
  const payload = readToken(req);
  if (!payload) { req.user = null; return next(); }
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query('SELECT token_version, role, tariff, account_status FROM users WHERE id = ?', [payload.id]);
    req.user = rows.length && rows[0].account_status === 'active' && Number(rows[0].token_version) === Number(payload.tokenVersion || 0) ? { ...payload, role: rows[0].role, tariff: rows[0].tariff || 'free' } : null;
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { signToken, requireAuth, optionalAuth };

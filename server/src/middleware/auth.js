const jwt = require('jsonwebtoken');

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('Missing required env var JWT_SECRET');
  return secret;
}

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name, username: user.username }, getSecret(), { expiresIn: '90d' });
}

function readToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  try {
    return jwt.verify(token, getSecret());
  } catch (e) {
    return null;
  }
}

// Rejects the request if there's no valid token.
function requireAuth(req, res, next) {
  const payload = readToken(req);
  if (!payload) return res.status(401).json({ error: 'Authentication required' });
  req.user = payload;
  next();
}

// Attaches req.user when a valid token is present, but never rejects —
// used by routes that accept both guest and logged-in submissions.
function optionalAuth(req, _res, next) {
  req.user = readToken(req);
  next();
}

module.exports = { signToken, requireAuth, optionalAuth };

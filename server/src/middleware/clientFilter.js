// Restricts /api/* to requests carrying a known ItemCase-client identifier
// — set by the desktop app and (if used) the Android app, never by an
// arbitrary browser tab. This is explicitly NOT real access control: the
// value ships inside the distributed .exe/.apk and anyone who inspects it
// can read and replay it with curl. Real security is still JWT auth on
// every authenticated route plus per-route ownership checks — this only
// filters out generic scanners/bots hitting the API with no client at all.
// If CLIENT_APP_SECRET is unset, the check is a no-op (fails open) so a
// fresh deployment isn't accidentally locked out before it's configured.
// Mounted only on the /api prefix (see app.js) — /uploads and /showcase/:username
// are separate, top-level routes and are never touched by this, since those
// must stay reachable by any ordinary browser (a share link or an image URL
// is worthless if only the app itself can open it).
function requireKnownClient(req, res, next) {
  const allowed = String(process.env.CLIENT_APP_SECRET || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowed.length) return next();
  const provided = req.get('X-ItemCase-Client');
  if (!allowed.includes(provided)) return res.status(404).json({ error: 'not found' });
  next();
}

module.exports = { requireKnownClient };

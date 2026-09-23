function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin-Rechte erforderlich' });
  next();
}

// Moderators handle catalog/report/feedback submissions like an admin, but
// not user management, tariffs, dealer verification or forum moderation —
// those routes additionally require requireAdmin (see routes/admin.js).
function requireModerator(req, res, next) {
  if (req.user?.role !== 'admin' && req.user?.role !== 'moderator') {
    return res.status(403).json({ error: 'Moderator- oder Admin-Rechte erforderlich' });
  }
  next();
}

module.exports = { requireAdmin, requireModerator };

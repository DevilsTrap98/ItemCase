function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin-Rechte erforderlich' });
  next();
}

module.exports = { requireAdmin };

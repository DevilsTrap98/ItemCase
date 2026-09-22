function errorHandler(err, _req, res, _next) {
  console.error('[error]', err);
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  const expose = status < 500 || process.env.NODE_ENV !== 'production';
  res.status(status).json({ error: expose ? (err.message || 'Fehler') : 'Interner Serverfehler' });
}

module.exports = { errorHandler };

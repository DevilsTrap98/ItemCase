const express = require('express');
const { getMysqlPool } = require('../config/db-mysql');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { publicImageUrl, removeStoredImage } = require('../utils/imageStorage');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const VALID_REVIEW_STATUSES = new Set(['pending', 'approved', 'rejected']);
const VALID_REPORT_STATUSES = new Set(['open', 'reviewed', 'dismissed']);
const VALID_FEEDBACK_STATUSES = new Set(['open', 'reviewed', 'archived']);

router.get('/summary', async (_req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [[feedback], [reports], [entries], [photos], [categories], [users], [threads]] = await Promise.all([
      pool.query("SELECT COUNT(*) count FROM feedback WHERE status = 'open'"),
      pool.query("SELECT COUNT(*) count FROM reports WHERE status = 'open'"),
      pool.query("SELECT COUNT(*) count FROM catalog_entries WHERE status = 'pending'"),
      pool.query("SELECT COUNT(*) count FROM catalog_photo_proposals WHERE status = 'pending'"),
      pool.query("SELECT COUNT(*) count FROM catalog_categories WHERE status = 'pending'"),
      pool.query('SELECT COUNT(*) count FROM users'),
      pool.query('SELECT COUNT(*) count FROM forum_threads')
    ]);
    res.json({
      openFeedback: Number(feedback[0].count), openReports: Number(reports[0].count),
      pendingEntries: Number(entries[0].count), pendingPhotos: Number(photos[0].count), pendingCategories: Number(categories[0].count),
      users: Number(users[0].count), forumThreads: Number(threads[0].count)
    });
  } catch (error) { next(error); }
});

router.get('/inbox', async (_req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [feedback] = await pool.query(
      `SELECT f.*, u.name sender_name, u.username sender_username, u.email sender_email
       FROM feedback f LEFT JOIN users u ON u.id = f.submitted_by_user_id ORDER BY f.created_at DESC LIMIT 250`
    );
    const [reports] = await pool.query(
      `SELECT r.*, u.name sender_name, u.username sender_username, u.email sender_email
       FROM reports r LEFT JOIN users u ON u.id = r.submitted_by_user_id ORDER BY r.created_at DESC LIMIT 250`
    );
    res.json({ feedback, reports });
  } catch (error) { next(error); }
});

router.patch('/feedback/:id', async (req, res, next) => {
  try {
    const status = String(req.body?.status || '');
    if (!VALID_FEEDBACK_STATUSES.has(status)) return res.status(400).json({ error: 'Ungültiger Status' });
    await getMysqlPool().query('UPDATE feedback SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.patch('/reports/:id', async (req, res, next) => {
  try {
    const status = String(req.body?.status || '');
    if (!VALID_REPORT_STATUSES.has(status)) return res.status(400).json({ error: 'Ungültiger Status' });
    await getMysqlPool().query('UPDATE reports SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.get('/catalog', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [entries] = await pool.query("SELECT * FROM catalog_entries ORDER BY FIELD(status, 'pending', 'approved', 'rejected'), submitted_at DESC LIMIT 300");
    const [photos] = await pool.query(
      `SELECT p.*, e.name item_name FROM catalog_photo_proposals p
       JOIN catalog_entries e ON e.id = p.catalog_item_id
       ORDER BY FIELD(p.status, 'pending', 'approved', 'rejected'), p.submitted_at DESC LIMIT 300`
    );
    const [categories] = await pool.query("SELECT * FROM catalog_categories ORDER BY FIELD(status, 'pending', 'approved', 'rejected'), submitted_at DESC LIMIT 300");
    res.json({
      entries: entries.map((row) => ({ ...row, image_url: publicImageUrl(row.image_path, req) })),
      photos: photos.map((row) => ({ ...row, image_url: publicImageUrl(row.image_path, req) })),
      categories
    });
  } catch (error) { next(error); }
});

router.patch('/catalog/:kind/:id', async (req, res, next) => {
  const status = String(req.body?.status || '');
  if (!VALID_REVIEW_STATUSES.has(status)) return res.status(400).json({ error: 'Ungültiger Status' });
  const pool = getMysqlPool();
  try {
    if (req.params.kind === 'entries') {
      await pool.query('UPDATE catalog_entries SET status = ? WHERE id = ?', [status, req.params.id]);
    } else if (req.params.kind === 'categories') {
      await pool.query('UPDATE catalog_categories SET status = ? WHERE id = ?', [status, req.params.id]);
    } else if (req.params.kind === 'photos') {
      const [rows] = await pool.query('SELECT * FROM catalog_photo_proposals WHERE id = ?', [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'Vorschlag nicht gefunden' });
      if (status === 'approved' && rows[0].image_path) {
        const [entries] = await pool.query('SELECT image_path FROM catalog_entries WHERE id = ?', [rows[0].catalog_item_id]);
        await pool.query('UPDATE catalog_entries SET image_path = ? WHERE id = ?', [rows[0].image_path, rows[0].catalog_item_id]);
        if (entries[0]?.image_path !== rows[0].image_path) await removeStoredImage(entries[0]?.image_path);
      }
      await pool.query('UPDATE catalog_photo_proposals SET status = ? WHERE id = ?', [status, req.params.id]);
    } else return res.status(404).json({ error: 'Unbekannte Freigabeart' });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.get('/forum', async (_req, res, next) => {
  try {
    const [threads] = await getMysqlPool().query(
      `SELECT t.id, t.title, t.category, t.status, t.created_at, u.name author_name, u.username author_username,
              (SELECT COUNT(*) FROM forum_posts p WHERE p.thread_id = t.id) post_count
       FROM forum_threads t JOIN users u ON u.id = t.author_id ORDER BY t.created_at DESC LIMIT 250`
    );
    res.json(threads);
  } catch (error) { next(error); }
});

router.delete('/forum/threads/:id', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query('SELECT image_path FROM forum_threads WHERE id = ?', [req.params.id]);
    await pool.query('DELETE FROM forum_threads WHERE id = ?', [req.params.id]);
    if (rows[0]) await removeStoredImage(rows[0].image_path);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.get('/users', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim().slice(0, 80);
    const like = `%${search}%`;
    const [users] = await getMysqlPool().query(
      `SELECT id, name, username, email, role, account_status, created_at FROM users
       WHERE ? = '' OR name LIKE ? OR username LIKE ? OR email LIKE ?
       ORDER BY created_at DESC LIMIT 250`, [search, like, like, like]
    );
    res.json(users);
  } catch (error) { next(error); }
});

router.patch('/users/:id/role', async (req, res, next) => {
  try {
    const role = req.body?.role === 'admin' ? 'admin' : 'user';
    if (req.params.id === req.user.id && role !== 'admin') return res.status(400).json({ error: 'Du kannst dir nicht selbst die Admin-Rechte entziehen.' });
    await getMysqlPool().query('UPDATE users SET role = ?, token_version = token_version + 1 WHERE id = ?', [role, req.params.id]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.patch('/users/:id/status', async (req, res, next) => {
  try {
    const status = req.body?.status === 'suspended' ? 'suspended' : 'active';
    if (req.params.id === req.user.id && status !== 'active') return res.status(400).json({ error: 'Du kannst dein eigenes Konto nicht sperren.' });
    await getMysqlPool().query('UPDATE users SET account_status = ?, token_version = token_version + 1 WHERE id = ?', [status, req.params.id]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

module.exports = router;

const express = require('express');
const { getMysqlPool } = require('../config/db-mysql');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { publicImageUrl, removeStoredImage } = require('../utils/imageStorage');
const { notify } = require('../utils/notify');
const { recalculate } = require('../utils/communityValue');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const VALID_REVIEW_STATUSES = new Set(['pending', 'approved', 'rejected']);
const VALID_ENTRY_STATUSES = new Set(['pending', 'approved', 'rejected', 'needs_changes', 'removed']);
const VALID_REPORT_STATUSES = new Set(['open', 'reviewed', 'dismissed']);
const VALID_FEEDBACK_STATUSES = new Set(['open', 'reviewed', 'archived']);

async function logCatalogHistory(pool, { catalogItemId, fromStatus, toStatus, reason, actorUserId }) {
  await pool.query(
    'INSERT INTO catalog_entry_history (id, catalog_item_id, from_status, to_status, reason, actor_user_id) VALUES (UUID(), ?, ?, ?, ?, ?)',
    [catalogItemId, fromStatus, toStatus, reason || null, actorUserId || null]
  );
}

router.get('/summary', async (_req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [[feedback], [reports], [entries], [photos], [categories], [users], [threads], [dealers]] = await Promise.all([
      pool.query("SELECT COUNT(*) count FROM feedback WHERE status = 'open'"),
      pool.query("SELECT COUNT(*) count FROM reports WHERE status = 'open'"),
      pool.query("SELECT COUNT(*) count FROM catalog_entries WHERE status = 'pending'"),
      pool.query("SELECT COUNT(*) count FROM catalog_photo_proposals WHERE status = 'pending'"),
      pool.query("SELECT COUNT(*) count FROM catalog_categories WHERE status = 'pending'"),
      pool.query('SELECT COUNT(*) count FROM users'),
      pool.query('SELECT COUNT(*) count FROM forum_threads'),
      pool.query("SELECT COUNT(*) count FROM dealer_profiles WHERE verification_status = 'pending'")
    ]);
    res.json({
      openFeedback: Number(feedback[0].count), openReports: Number(reports[0].count),
      pendingEntries: Number(entries[0].count), pendingPhotos: Number(photos[0].count), pendingCategories: Number(categories[0].count),
      users: Number(users[0].count), forumThreads: Number(threads[0].count), pendingDealers: Number(dealers[0].count)
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
    const pool = getMysqlPool();
    const [reports] = await pool.query('SELECT * FROM reports WHERE id = ?', [req.params.id]);
    await pool.query('UPDATE reports SET status = ? WHERE id = ?', [status, req.params.id]);

    // A report against a catalog item auto-hid it (see reports.js); resolve
    // that here instead of leaving it stuck in "reported" forever.
    const report = reports[0];
    if (report && report.target_type === 'catalogItem') {
      const [entries] = await pool.query('SELECT * FROM catalog_entries WHERE id = ?', [report.target_id]);
      const entry = entries[0];
      if (entry && entry.status === 'reported') {
        if (status === 'dismissed') {
          const restoreTo = entry.previous_status_before_report || 'approved';
          await pool.query(
            "UPDATE catalog_entries SET status = ?, previous_status_before_report = NULL, moderated_by = ?, moderated_at = NOW() WHERE id = ?",
            [restoreTo, req.user.id, entry.id]
          );
          await logCatalogHistory(pool, { catalogItemId: entry.id, fromStatus: 'reported', toStatus: restoreTo, reason: 'Meldung abgewiesen', actorUserId: req.user.id });
        } else if (status === 'reviewed') {
          await pool.query(
            "UPDATE catalog_entries SET status = 'removed', moderation_reason = ?, moderated_by = ?, moderated_at = NOW(), previous_status_before_report = NULL WHERE id = ?",
            [`Nach Meldung entfernt: ${report.reason}${report.comment ? ' – ' + report.comment : ''}`, req.user.id, entry.id]
          );
          await logCatalogHistory(pool, { catalogItemId: entry.id, fromStatus: 'reported', toStatus: 'removed', reason: report.reason, actorUserId: req.user.id });
          if (entry.submitted_by_user_id) await notify(req.app.get('io'), entry.submitted_by_user_id, 'catalog_entry_removed', { catalogItemId: entry.id, name: entry.name });
        }
      }
    }
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
  const isEntry = req.params.kind === 'entries';
  if (isEntry ? !VALID_ENTRY_STATUSES.has(status) : !VALID_REVIEW_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Ungültiger Status' });
  }
  const reason = String(req.body?.reason || '').trim();
  if (isEntry && ['rejected', 'needs_changes', 'removed'].includes(status) && !reason) {
    return res.status(400).json({ error: 'Für diese Entscheidung ist eine Begründung erforderlich.' });
  }
  const pool = getMysqlPool();
  try {
    if (req.params.kind === 'entries') {
      const [rows] = await pool.query('SELECT * FROM catalog_entries WHERE id = ?', [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'Katalogeintrag nicht gefunden' });
      const entry = rows[0];
      await pool.query(
        'UPDATE catalog_entries SET status = ?, moderation_reason = ?, moderated_by = ?, moderated_at = NOW() WHERE id = ?',
        [status, reason || null, req.user.id, req.params.id]
      );
      await logCatalogHistory(pool, { catalogItemId: req.params.id, fromStatus: entry.status, toStatus: status, reason, actorUserId: req.user.id });
      if (entry.submitted_by_user_id) {
        await notify(req.app.get('io'), entry.submitted_by_user_id, `catalog_entry_${status}`, { catalogItemId: req.params.id, name: entry.name, reason });
      }
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

// CommunityMarkt: dealer verification queue. "Verified" only ever means an
// admin looked at the profile's stated business info/contact details and
// approved them here — never anything automated, and never a claim about
// registry lookups we don't actually perform.
router.get('/dealers', async (_req, res, next) => {
  try {
    const [rows] = await getMysqlPool().query(
      `SELECT dp.*, u.name, u.username, u.email,
              (SELECT COUNT(*) FROM market_listings ml WHERE ml.owner_id = dp.owner_id) AS listing_count
       FROM dealer_profiles dp JOIN users u ON u.id = dp.owner_id
       ORDER BY FIELD(dp.verification_status, 'pending', 'rejected', 'verified'), dp.updated_at DESC LIMIT 300`
    );
    res.json(rows.map((row) => ({ ...row, logo_url: publicImageUrl(row.logo_path, _req), listing_count: Number(row.listing_count) })));
  } catch (error) { next(error); }
});

router.patch('/dealers/:ownerId/verification', async (req, res, next) => {
  try {
    const status = String(req.body?.status || '');
    if (!['verified', 'rejected', 'pending'].includes(status)) return res.status(400).json({ error: 'Ungültiger Status' });
    const pool = getMysqlPool();
    await pool.query(
      `UPDATE dealer_profiles SET verification_status = ?, verified_at = ?, verified_by = ?, rejection_reason = ? WHERE owner_id = ?`,
      [
        status, status === 'verified' ? new Date() : null, status === 'verified' ? req.user.id : null,
        status === 'rejected' ? String(req.body?.reason || '').slice(0, 2000) : null, req.params.ownerId
      ]
    );
    await notify(req.app.get('io'), req.params.ownerId, `dealer_verification_${status}`, { reason: req.body?.reason || null });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

// ---- Community-Schätzwert moderation ----
// Admins review flagged patterns and can exclude/restore individual
// estimates or pause a whole item's calculation. They can never set or
// override a value directly (spec section 16).

router.get('/community-values/flags', async (_req, res, next) => {
  try {
    const pool = getMysqlPool();
    // Heuristic v1: surface aggregates with low confidence-to-volume ratio
    // is not meaningful yet without real usage data, so for now this lists
    // recently-changed aggregates plus any estimate an admin has already
    // excluded, so the review queue has something concrete to act on.
    const [aggregates] = await pool.query(
      `SELECT cva.*, ce.name AS item_name
       FROM community_value_aggregates cva
       JOIN catalog_entries ce ON ce.id = cva.catalog_item_id
       ORDER BY cva.calculated_at DESC LIMIT 50`
    );
    const [excluded] = await pool.query(
      `SELECT cve.*, ce.name AS item_name
       FROM community_value_estimates cve
       JOIN catalog_entries ce ON ce.id = cve.catalog_item_id
       WHERE cve.status IN ('Excluded', 'Flagged') ORDER BY cve.updated_at DESC LIMIT 50`
    );
    res.json({ aggregates, excludedEstimates: excluded });
  } catch (err) { next(err); }
});

router.post('/community-values/estimates/:id/exclude', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query('SELECT * FROM community_value_estimates WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Schätzung nicht gefunden' });
    await pool.query(
      "UPDATE community_value_estimates SET status = 'Excluded', exclude_reason = ?, updated_at = NOW() WHERE id = ?",
      [String(req.body?.reason || ''), req.params.id]
    );
    await recalculate(pool, rows[0].catalog_item_id, rows[0].condition_code);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/community-values/estimates/:id/restore', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query('SELECT * FROM community_value_estimates WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Schätzung nicht gefunden' });
    await pool.query("UPDATE community_value_estimates SET status = 'Active', exclude_reason = NULL, updated_at = NOW() WHERE id = ?", [req.params.id]);
    await recalculate(pool, rows[0].catalog_item_id, rows[0].condition_code);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// "Pausing" an item's calculation means excluding every active estimate for
// it without deleting them — recalculate() then reports Insufficient/no
// public value until an admin restores them individually.
router.post('/community-values/items/:id/pause', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [conditions] = await pool.query(
      "SELECT DISTINCT condition_code FROM community_value_estimates WHERE catalog_item_id = ? AND status = 'Active'",
      [req.params.id]
    );
    await pool.query(
      "UPDATE community_value_estimates SET status = 'Flagged', exclude_reason = ?, updated_at = NOW() WHERE catalog_item_id = ? AND status = 'Active'",
      [String(req.body?.reason || 'Wertberechnung pausiert'), req.params.id]
    );
    for (const row of conditions) await recalculate(pool, req.params.id, row.condition_code);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

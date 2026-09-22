const express = require('express');
const { getMysqlPool } = require('../config/db-mysql');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { publicImageUrl, removeStoredImage } = require('../utils/imageStorage');
const { notify } = require('../utils/notify');
const { recalculate } = require('../utils/communityValue');
const { awardXp, reverseXp, reverseCatalogItemXp, getProgress } = require('../utils/collectorXp');
const { logCatalogHistory } = require('../utils/catalogHistory');
const { decideChangeRequest, CHANGE_TYPE_XP } = require('../utils/changeRequests');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const VALID_REVIEW_STATUSES = new Set(['pending', 'approved', 'rejected']);
const VALID_ENTRY_STATUSES = new Set(['pending', 'approved', 'rejected', 'needs_changes', 'removed', 'reported']);
const VALID_REPORT_STATUSES = new Set(['open', 'reviewed', 'dismissed']);
const VALID_FEEDBACK_STATUSES = new Set(['open', 'reviewed', 'archived']);

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
  if (isEntry && ['rejected', 'needs_changes', 'removed', 'reported'].includes(status) && !reason) {
    return res.status(400).json({ error: 'Für diese Entscheidung ist eine Begründung erforderlich.' });
  }
  const pool = getMysqlPool();
  try {
    if (req.params.kind === 'entries') {
      const [rows] = await pool.query('SELECT * FROM catalog_entries WHERE id = ?', [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'Katalogeintrag nicht gefunden' });
      const entry = rows[0];
      // "Moderatoren dürfen eigene Beiträge nicht selbst genehmigen" — a
      // second pair of eyes is required, full stop, not just for XP purposes.
      if (entry.submitted_by_user_id && entry.submitted_by_user_id === req.user.id) {
        return res.status(403).json({ error: 'Du kannst deine eigene Einreichung nicht selbst moderieren.' });
      }
      // 'reported' is a manual quarantine here (a moderator deliberately
      // pulling a live entry, e.g. a clear-cut violation or a security
      // concern) — remember what to restore it to if the concern turns out
      // to be unfounded, same as the auto-quarantine path in reports.js.
      const previousStatusBeforeReport = status === 'reported' ? entry.status : null;
      await pool.query(
        'UPDATE catalog_entries SET status = ?, moderation_reason = ?, moderated_by = ?, moderated_at = NOW(), previous_status_before_report = ? WHERE id = ?',
        [status, reason || null, req.user.id, previousStatusBeforeReport, req.params.id]
      );
      await logCatalogHistory(pool, { catalogItemId: req.params.id, fromStatus: entry.status, toStatus: status, reason, actorUserId: req.user.id });

      // XP only on the FIRST approval ever. Routes through the linked
      // change_request when this entry has one (its unique change_request_id
      // key on contribution_xp_transactions is the real idempotency guard);
      // xp_awarded_at is the fallback for entries created before the
      // unified change-request model existed. "RemovedForViolation" claws
      // it back either way.
      if (status === 'approved') {
        if (entry.change_request_id) {
          await decideChangeRequest(pool, { changeRequestId: entry.change_request_id, moderatorId: req.user.id, decision: 'approved' });
        } else {
          const [claim] = await pool.query(
            'UPDATE catalog_entries SET xp_awarded_at = NOW() WHERE id = ? AND xp_awarded_at IS NULL',
            [req.params.id]
          );
          if (claim.affectedRows) {
            await awardXp(pool, { userId: entry.submitted_by_user_id, sourceType: 'CatalogItemApproved', sourceId: req.params.id, approvedBy: req.user.id });
          }
        }
      } else if (['rejected', 'needs_changes', 'removed'].includes(status) && entry.change_request_id) {
        await pool.query(
          "UPDATE catalog_change_requests SET status = ?, moderator_id = ?, moderator_reason = ?, reviewed_at = NOW() WHERE id = ? AND status = 'pending'",
          [status === 'removed' ? 'rejected' : status, req.user.id, reason || null, entry.change_request_id]
        );
      }
      if (status === 'removed' && entry.xp_awarded_at) {
        await reverseCatalogItemXp(pool, { catalogItemId: req.params.id, reason: `Beitrag entfernt: ${reason}`, actorUserId: req.user.id });
      }

      if (entry.submitted_by_user_id) {
        await notify(req.app.get('io'), entry.submitted_by_user_id, `catalog_entry_${status}`, { catalogItemId: req.params.id, name: entry.name, reason });
      }
    } else if (req.params.kind === 'categories') {
      await pool.query('UPDATE catalog_categories SET status = ? WHERE id = ?', [status, req.params.id]);
    } else if (req.params.kind === 'photos') {
      const [rows] = await pool.query('SELECT * FROM catalog_photo_proposals WHERE id = ?', [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'Vorschlag nicht gefunden' });
      const proposal = rows[0];
      if (proposal.submitted_by_user_id && proposal.submitted_by_user_id === req.user.id) {
        return res.status(403).json({ error: 'Du kannst deinen eigenen Vorschlag nicht selbst moderieren.' });
      }
      if (status === 'approved' && proposal.image_path) {
        const [entries] = await pool.query('SELECT image_path FROM catalog_entries WHERE id = ?', [proposal.catalog_item_id]);
        await pool.query('UPDATE catalog_entries SET image_path = ? WHERE id = ?', [proposal.image_path, proposal.catalog_item_id]);
        if (entries[0]?.image_path !== proposal.image_path) await removeStoredImage(entries[0]?.image_path);
      }
      await pool.query('UPDATE catalog_photo_proposals SET status = ? WHERE id = ?', [status, req.params.id]);
      if (status === 'approved') {
        if (proposal.change_request_id) {
          await decideChangeRequest(pool, { changeRequestId: proposal.change_request_id, moderatorId: req.user.id, decision: 'approved' });
        } else {
          const [claim] = await pool.query(
            'UPDATE catalog_photo_proposals SET xp_awarded_at = NOW() WHERE id = ? AND xp_awarded_at IS NULL',
            [req.params.id]
          );
          if (claim.affectedRows) {
            await awardXp(pool, { userId: proposal.submitted_by_user_id, sourceType: 'ImageApproved', sourceId: req.params.id, approvedBy: req.user.id });
          }
        }
      } else if (proposal.change_request_id && ['rejected'].includes(status)) {
        await pool.query(
          "UPDATE catalog_change_requests SET status = 'rejected', moderator_id = ?, reviewed_at = NOW() WHERE id = ? AND status = 'pending'",
          [req.user.id, proposal.change_request_id]
        );
      }
    } else return res.status(404).json({ error: 'Unbekannte Freigabeart' });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

// Correction proposals to already-approved entries — the moderation view
// the user's own "Beitrags- und Prüfzentrum" proposal calls for: before/
// after side by side (calculated_diff_json), the server-classified XP
// category, and a way to override that category with a required reason.
router.get('/change-requests', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const status = ['pending', 'approved', 'rejected', 'needs_changes'].includes(req.query.status) ? req.query.status : 'pending';
    const [rows] = await pool.query(
      `SELECT ccr.*, ce.name AS item_name, u.name AS submitter_name, u.username AS submitter_username
       FROM catalog_change_requests ccr
       LEFT JOIN catalog_entries ce ON ce.id = ccr.catalog_item_id
       LEFT JOIN users u ON u.id = ccr.submitted_by
       WHERE ccr.status = ? AND ccr.change_type IN ('minor_correction', 'major_correction', 'identifier')
       ORDER BY ccr.submitted_at ASC LIMIT 200`,
      [status]
    );
    res.json(rows);
  } catch (error) { next(error); }
});

router.post('/change-requests/:id/decide', async (req, res, next) => {
  try {
    const decision = String(req.body?.decision || '');
    if (!['approved', 'rejected', 'needs_changes'].includes(decision)) return res.status(400).json({ error: 'Ungültige Entscheidung' });
    const reason = String(req.body?.reason || '').trim();
    if (decision !== 'approved' && !reason) return res.status(400).json({ error: 'Für diese Entscheidung ist eine Begründung erforderlich.' });
    const xpTypeOverride = req.body?.xpTypeOverride && Object.keys(CHANGE_TYPE_XP).includes(req.body.xpTypeOverride) ? req.body.xpTypeOverride : undefined;
    const pool = getMysqlPool();
    const result = await decideChangeRequest(pool, { changeRequestId: req.params.id, moderatorId: req.user.id, decision, reason, xpTypeOverride });
    res.json({ ok: true, ...result });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

// Candidate duplicate groups: entries sharing an identical name (case-
// insensitive) or an identical, non-empty EAN/ISBN/manufacturer number.
// Heuristic only — an admin still decides whether they're really the same
// product before merging.
router.get('/catalog/duplicates', async (_req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query(
      `SELECT * FROM catalog_entries WHERE status NOT IN ('merged', 'removed') ORDER BY LOWER(name) ASC`
    );
    const groups = [];
    const seen = new Set();
    const keyOf = (r, field) => (r[field] ? `${field}:${String(r[field]).toLowerCase().trim()}` : null);
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      const keys = [keyOf(row, 'name'), keyOf(row, 'ean'), keyOf(row, 'isbn'), keyOf(row, 'manufacturer_number')].filter(Boolean);
      const matches = rows.filter((other) => other.id !== row.id && !seen.has(other.id) && keys.some((k) => [keyOf(other, 'name'), keyOf(other, 'ean'), keyOf(other, 'isbn'), keyOf(other, 'manufacturer_number')].includes(k)));
      if (matches.length) {
        const group = [row, ...matches];
        group.forEach((g) => seen.add(g.id));
        groups.push(group.map((g) => ({ id: g.id, name: g.name, brand: g.brand, category: g.category, ean: g.ean, isbn: g.isbn, manufacturerNumber: g.manufacturer_number, status: g.status, submittedAt: g.submitted_at })));
      }
    }
    res.json(groups);
  } catch (error) { next(error); }
});

// Follows merged_into_id to the final canonical entry (an entry can itself
// have been merged again later), capped so a bad chain can't loop forever.
async function resolveCanonical(pool, id) {
  let current = id;
  for (let i = 0; i < 5; i++) {
    const [[row]] = await pool.query('SELECT id, merged_into_id FROM catalog_entries WHERE id = ?', [current]);
    if (!row) return null;
    if (!row.merged_into_id) return row.id;
    current = row.merged_into_id;
  }
  return current;
}

router.post('/catalog/entries/:id/merge', async (req, res, next) => {
  try {
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Bitte einen Grund für den Merge angeben.' });
    const pool = getMysqlPool();
    const sourceId = req.params.id;
    const targetId = await resolveCanonical(pool, String(req.body?.intoId || ''));
    if (!targetId) return res.status(404).json({ error: 'Ziel-Katalogeintrag nicht gefunden' });
    if (targetId === sourceId) return res.status(400).json({ error: 'Ein Eintrag kann nicht mit sich selbst zusammengeführt werden.' });

    const [[source]] = await pool.query('SELECT * FROM catalog_entries WHERE id = ?', [sourceId]);
    if (!source) return res.status(404).json({ error: 'Katalogeintrag nicht gefunden' });
    if (source.status === 'merged') return res.status(400).json({ error: 'Dieser Eintrag wurde bereits zusammengeführt.' });

    // 1) Every private collection item that pointed at the old entry now
    // points at the canonical one — the private data itself (name,
    // condition, purchase price, notes, images…) is never touched.
    await pool.query('UPDATE collection_items SET catalog_item_id = ? WHERE catalog_item_id = ?', [targetId, sourceId]);
    await pool.query('UPDATE wishlist_items SET catalog_item_id = ? WHERE catalog_item_id = ?', [targetId, sourceId]);
    // Pending photo proposals on the old entry get reviewed against the
    // canonical one instead of being silently dropped.
    await pool.query('UPDATE catalog_photo_proposals SET catalog_item_id = ? WHERE catalog_item_id = ?', [targetId, sourceId]);
    // Reports keep their full history/audit trail — they're re-pointed at
    // the canonical entry, never deleted.
    await pool.query("UPDATE reports SET target_id = ? WHERE target_type = 'catalogItem' AND target_id = ?", [targetId, sourceId]);

    // 2) Community-Schätzwert estimates move over too. A user may already
    // have estimated the canonical item under the same condition — in that
    // case keep whichever estimate is more recent and drop the other,
    // since the unique (user, item, condition) key can't hold both.
    const [estimates] = await pool.query("SELECT * FROM community_value_estimates WHERE catalog_item_id = ? AND status = 'Active'", [sourceId]);
    const touchedConditions = new Set();
    for (const est of estimates) {
      touchedConditions.add(est.condition_code);
      const [[existing]] = await pool.query(
        "SELECT * FROM community_value_estimates WHERE catalog_item_id = ? AND user_id = ? AND condition_code = ?",
        [targetId, est.user_id, est.condition_code]
      );
      if (!existing) {
        await pool.query('UPDATE community_value_estimates SET catalog_item_id = ? WHERE id = ?', [targetId, est.id]);
      } else if (new Date(est.updated_at) > new Date(existing.updated_at)) {
        await pool.query('UPDATE community_value_estimates SET status = ? WHERE id = ?', ['Deleted', existing.id]);
        await pool.query('UPDATE community_value_estimates SET catalog_item_id = ? WHERE id = ?', [targetId, est.id]);
      } else {
        await pool.query('UPDATE community_value_estimates SET status = ? WHERE id = ?', ['Deleted', est.id]);
      }
    }
    await pool.query('DELETE FROM community_value_aggregates WHERE catalog_item_id = ?', [sourceId]);
    for (const condition of touchedConditions) await recalculate(pool, targetId, condition);

    // 3) The old entry becomes a permanent redirect stub — never deleted,
    // so nothing that referenced it (history, reports) ever dangles.
    await pool.query(
      "UPDATE catalog_entries SET status = 'merged', merged_into_id = ?, moderation_reason = ?, moderated_by = ?, moderated_at = NOW() WHERE id = ?",
      [targetId, reason, req.user.id, sourceId]
    );
    await logCatalogHistory(pool, { catalogItemId: sourceId, fromStatus: source.status, toStatus: 'merged', reason: `Zusammengeführt mit ${targetId}: ${reason}`, actorUserId: req.user.id });
    const [[target]] = await pool.query('SELECT status FROM catalog_entries WHERE id = ?', [targetId]);
    await logCatalogHistory(pool, { catalogItemId: targetId, fromStatus: target.status, toStatus: target.status, reason: `Duplikat zusammengeführt von ${sourceId}: ${reason}`, actorUserId: req.user.id });

    if (source.submitted_by_user_id) {
      await notify(req.app.get('io'), source.submitted_by_user_id, 'catalog_entry_merged', { catalogItemId: sourceId, mergedIntoId: targetId, name: source.name });
    }

    res.json({ ok: true, targetId });
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

// XP ledger — read-only visibility plus a manual reversal for confirmed
// abuse (spec section 20). No manual XP *grant* endpoint here on purpose:
// the only way to earn XP is through an actual approval, per "Administra-
// toren pflegen keine Preise" style principle applied to XP too.
router.get('/xp/:userId', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [transactions] = await pool.query(
      'SELECT * FROM contribution_xp_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 200',
      [req.params.userId]
    );
    const progress = await getProgress(pool, req.params.userId);
    res.json({ progress, transactions });
  } catch (error) { next(error); }
});

router.post('/xp-transactions/:id/reverse', async (req, res, next) => {
  try {
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Ein Grund ist erforderlich.' });
    const pool = getMysqlPool();
    await reverseXp(pool, { transactionId: req.params.id, reason, actorUserId: req.user.id });
    res.json({ ok: true });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

// Manual tariff grants: a temporary or hand-approved paid tariff, with a
// full audit trail (who, why, when, until when) — see the user's own
// instruction that this must never be an untracked UPDATE users.tariff.
router.get('/tariff-grants', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const userId = req.query.userId ? String(req.query.userId) : null;
    const [rows] = await pool.query(
      `SELECT tg.*, u.name user_name, u.username user_username, a.name granted_by_name
       FROM tariff_grants tg JOIN users u ON u.id = tg.user_id JOIN users a ON a.id = tg.granted_by
       WHERE ? IS NULL OR tg.user_id = ? ORDER BY tg.created_at DESC LIMIT 250`,
      [userId, userId]
    );
    res.json(rows);
  } catch (error) { next(error); }
});

router.post('/tariff-grants', async (req, res, next) => {
  try {
    const { userId, tariff, reason, endsAt } = req.body || {};
    if (!['collectorPlus', 'collectorPro', 'business'].includes(tariff)) return res.status(400).json({ error: 'Ungültiger Tarif' });
    if (!String(reason || '').trim()) return res.status(400).json({ error: 'Ein Grund ist erforderlich.' });
    const pool = getMysqlPool();
    const [[targetUser]] = await pool.query('SELECT id FROM users WHERE id = ?', [userId]);
    if (!targetUser) return res.status(404).json({ error: 'Nutzer nicht gefunden' });

    const ends = endsAt ? new Date(endsAt) : null;
    if (ends && Number.isNaN(ends.getTime())) return res.status(400).json({ error: 'Ungültiges Enddatum' });

    // Superseding a still-active grant closes it out first, so the audit
    // trail never has two "active" grants open for the same account at once.
    await pool.query("UPDATE tariff_grants SET status = 'revoked' WHERE user_id = ? AND status = 'active'", [userId]);
    await pool.query(
      'INSERT INTO tariff_grants (id, user_id, tariff, granted_by, reason, ends_at) VALUES (UUID(), ?, ?, ?, ?, ?)',
      [userId, tariff, req.user.id, reason.trim(), ends]
    );
    await pool.query('UPDATE users SET tariff = ?, token_version = token_version + 1 WHERE id = ?', [tariff, userId]);
    await notify(req.app.get('io'), userId, 'tariff_granted', { tariff, reason: reason.trim(), endsAt: ends });
    res.status(201).json({ ok: true });
  } catch (error) { next(error); }
});

router.post('/tariff-grants/:id/revoke', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [[grant]] = await pool.query("SELECT * FROM tariff_grants WHERE id = ? AND status = 'active'", [req.params.id]);
    if (!grant) return res.status(404).json({ error: 'Aktive Vergabe nicht gefunden' });
    await pool.query("UPDATE tariff_grants SET status = 'revoked' WHERE id = ?", [req.params.id]);
    const [[user]] = await pool.query('SELECT tariff FROM users WHERE id = ?', [grant.user_id]);
    if (user?.tariff === grant.tariff) {
      await pool.query("UPDATE users SET tariff = 'free', token_version = token_version + 1 WHERE id = ?", [grant.user_id]);
    }
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

const express = require('express');
const crypto = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { getMysqlPool } = require('../config/db-mysql');
const { optionalAuth, requireAuth } = require('../middleware/auth');
const { storeDataUrl, removeStoredImage, publicImageUrl } = require('../utils/imageStorage');
const { recalculate, CONDITION_CODES } = require('../utils/communityValue');
const { getProgress } = require('../utils/collectorXp');

const router = express.Router();
router.use(optionalAuth);

// Spec section 10: "maximal 20 neue oder geänderte Schätzungen pro Tag".
// Keyed per-user (not per-IP) since this only applies to authenticated writes.
const valueEstimateLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
  handler: (_req, res) => res.status(429).json({ error: 'Tageslimit für Wertschätzungen erreicht. Bitte versuche es morgen wieder.' })
});

function mapEntry(row, req) {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    category: row.category,
    releaseYear: row.release_year,
    ean: row.ean,
    isbn: row.isbn,
    manufacturerNumber: row.manufacturer_number,
    imageUrl: publicImageUrl(row.image_path, req),
    marketValue: row.market_value,
    conditionValues: row.condition_values || {},
    status: row.status,
    moderationReason: row.moderation_reason || '',
    moderatedAt: row.moderated_at || null,
    mergedIntoId: row.merged_into_id || null,
    contributor: row.contributor,
    rightsConfirmed: !!row.rights_confirmed,
    licenseVersion: row.license_version,
    submittedAt: row.submitted_at
  };
}

async function logCatalogHistory(pool, { catalogItemId, fromStatus, toStatus, reason, actorUserId }) {
  await pool.query(
    'INSERT INTO catalog_entry_history (id, catalog_item_id, from_status, to_status, reason, actor_user_id) VALUES (?, ?, ?, ?, ?, ?)',
    [crypto.randomUUID(), catalogItemId, fromStatus, toStatus, reason || null, actorUserId || null]
  );
}

router.get('/', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query("SELECT * FROM catalog_entries WHERE status = 'approved' ORDER BY submitted_at DESC");
    res.json(rows.map((row) => mapEntry(row, req)));
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.name || !String(body.name).trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!body.rightsConfirmed) {
      return res.status(400).json({ error: 'rightsConfirmed must be true' });
    }

    const id = crypto.randomUUID();
    const pool = getMysqlPool();
    const imagePath = await storeDataUrl(body.imageData, 'catalog', 'entries', id);
    try {
      await pool.query(
      `INSERT INTO catalog_entries
        (id, name, brand, category, release_year, ean, isbn, manufacturer_number, image_path, market_value, condition_values, status, contributor, submitted_by_user_id, rights_confirmed, license_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      [
        id,
        String(body.name).trim(),
        body.brand || '',
        body.category || '',
        body.releaseYear || null,
        body.ean || '',
        body.isbn || '',
        body.manufacturerNumber || '',
        imagePath,
        body.marketValue || null,
        JSON.stringify(body.conditionValues || {}),
        body.contributor || req.user?.name || '',
        req.user?.id || null,
        body.rightsConfirmed ? 1 : 0,
        body.licenseVersion || '1.0'
      ]
      );
    } catch (error) {
      await removeStoredImage(imagePath);
      throw error;
    }

    await logCatalogHistory(pool, { catalogItemId: id, fromStatus: 'new', toStatus: 'pending', actorUserId: req.user?.id });
    const [rows] = await pool.query('SELECT * FROM catalog_entries WHERE id = ?', [id]);
    res.status(201).json(mapEntry(rows[0], req));
  } catch (err) {
    next(err);
  }
});

// A user's own standing — no progress UI yet (that's a later phase), but
// the number itself is already real and queryable, not fabricated client-side.
router.get('/mine/progress', requireAuth, async (req, res, next) => {
  try {
    const progress = await getProgress(getMysqlPool(), req.user.id);
    res.json({
      confirmedLifetimeXp: progress.confirmed_lifetime_xp,
      collectorLevel: progress.collector_level,
      slotEligibleXp: progress.slot_eligible_xp,
      earnedCollectionSlots: progress.earned_collection_slots
    });
  } catch (err) { next(err); }
});

// A submitter's own view of their submissions, including ones the public
// list never shows (pending/needs_changes/rejected/reported/removed) — the
// only way "Einreicher über Entscheidungen informieren" (spec) is possible.
router.get('/mine/submissions', requireAuth, async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query('SELECT * FROM catalog_entries WHERE submitted_by_user_id = ? ORDER BY submitted_at DESC', [req.user.id]);
    res.json(rows.map((row) => mapEntry(row, req)));
  } catch (err) { next(err); }
});

// Resubmit after "needs_changes" (or a rejection) — only the original
// submitter, and only from a state where a resubmission makes sense. This
// is intentionally a full replace of the reviewable fields, not a merge.
router.put('/:id', requireAuth, async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query('SELECT * FROM catalog_entries WHERE id = ? AND submitted_by_user_id = ?', [req.params.id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Einreichung nicht gefunden' });
    const entry = rows[0];
    if (!['needs_changes', 'rejected'].includes(entry.status)) {
      return res.status(400).json({ error: 'Diese Einreichung kann in ihrem aktuellen Status nicht bearbeitet werden.' });
    }
    const body = req.body || {};
    if (!body.name || !String(body.name).trim()) return res.status(400).json({ error: 'name is required' });

    let imagePath = entry.image_path;
    if (body.imageData !== undefined && body.imageData !== null && !/^https?:\/\//i.test(body.imageData)) {
      imagePath = await storeDataUrl(body.imageData, 'catalog', 'entries', entry.id);
    } else if (body.imageData === null) imagePath = null;

    try {
      await pool.query(
        `UPDATE catalog_entries SET name=?, brand=?, category=?, release_year=?, ean=?, isbn=?, manufacturer_number=?,
           image_path=?, market_value=?, condition_values=?, status='pending', moderation_reason=NULL, moderated_by=NULL, moderated_at=NULL
         WHERE id = ?`,
        [
          String(body.name).trim(), body.brand || '', body.category || '', body.releaseYear || null,
          body.ean || '', body.isbn || '', body.manufacturerNumber || '', imagePath,
          body.marketValue || null, JSON.stringify(body.conditionValues || {}), entry.id
        ]
      );
    } catch (error) {
      if (imagePath !== entry.image_path) await removeStoredImage(imagePath);
      throw error;
    }
    if (imagePath !== entry.image_path) await removeStoredImage(entry.image_path);
    await logCatalogHistory(pool, { catalogItemId: entry.id, fromStatus: entry.status, toStatus: 'pending', reason: 'Erneut eingereicht nach Überarbeitung', actorUserId: req.user.id });

    const [updated] = await pool.query('SELECT * FROM catalog_entries WHERE id = ?', [entry.id]);
    res.json(mapEntry(updated[0], req));
  } catch (err) { next(err); }
});

router.post('/:id/photo', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.rightsConfirmed) {
      return res.status(400).json({ error: 'rightsConfirmed must be true' });
    }

    const pool = getMysqlPool();
    const [entryRows] = await pool.query('SELECT id FROM catalog_entries WHERE id = ?', [req.params.id]);
    if (entryRows.length === 0) {
      return res.status(404).json({ error: 'catalog entry not found' });
    }

    const id = crypto.randomUUID();
    const imagePath = await storeDataUrl(body.imageData, 'catalog-proposals', req.user?.id || 'anonymous', id);
    try {
      await pool.query(
      `INSERT INTO catalog_photo_proposals
        (id, catalog_item_id, image_path, contributor, submitted_by_user_id, rights_confirmed, license_version, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [id, req.params.id, imagePath, body.contributor || req.user?.name || '', req.user?.id || null, body.rightsConfirmed ? 1 : 0, body.licenseVersion || '1.0']
      );
    } catch (error) {
      await removeStoredImage(imagePath);
      throw error;
    }
    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
});

router.get('/categories', async (_req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query("SELECT name FROM catalog_categories WHERE status = 'approved' ORDER BY name ASC");
    res.json(rows.map((r) => r.name));
  } catch (err) {
    next(err);
  }
});

router.post('/categories', async (req, res, next) => {
  try {
    const name = (req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    const pool = getMysqlPool();
    await pool.query('INSERT IGNORE INTO catalog_categories (name, status) VALUES (?, "pending")', [name]);
    const [rows] = await pool.query('SELECT name FROM catalog_categories ORDER BY name ASC');
    res.status(201).json(rows.map((r) => r.name));
  } catch (err) {
    next(err);
  }
});

// ---- Community-Schätzwert ----
// Public read (so the catalog page works for guests too); writes require a
// verified, non-suspended account (requireAuth already checks account_status;
// email verification is enforced at login, so reaching here implies both).

function minorToMajor(minor) {
  return minor === null || minor === undefined ? null : Math.round(minor) / 100;
}

router.get('/:id/community-values', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [aggregates] = await pool.query(
      'SELECT * FROM community_value_aggregates WHERE catalog_item_id = ?',
      [req.params.id]
    );
    let mine = [];
    if (req.user) {
      const [rows] = await pool.query(
        "SELECT condition_code, estimated_value_minor, confirmed_at, updated_at FROM community_value_estimates WHERE catalog_item_id = ? AND user_id = ? AND status = 'Active'",
        [req.params.id, req.user.id]
      );
      mine = rows;
    }
    const byCondition = {};
    for (const code of CONDITION_CODES) {
      const agg = aggregates.find((a) => a.condition_code === code);
      const own = mine.find((m) => m.condition_code === code);
      byCondition[code] = {
        conditionCode: code,
        medianValue: agg ? minorToMajor(agg.median_value_minor) : null,
        lowerValue: agg ? minorToMajor(agg.lower_value_minor) : null,
        upperValue: agg ? minorToMajor(agg.upper_value_minor) : null,
        estimateCount: agg ? agg.estimate_count : 0,
        contributorCount: agg ? agg.contributor_count : 0,
        confidenceLevel: agg ? agg.confidence_level : 'Insufficient',
        calculatedAt: agg ? agg.calculated_at : null,
        currency: 'EUR',
        myEstimate: own ? { value: minorToMajor(own.estimated_value_minor), confirmedAt: own.confirmed_at, updatedAt: own.updated_at } : null
      };
    }
    res.json(byCondition);
  } catch (err) { next(err); }
});

router.post('/:id/community-value-estimate', requireAuth, valueEstimateLimiter, async (req, res, next) => {
  try {
    const conditionCode = String(req.body?.conditionCode || '');
    const value = Number(req.body?.value);
    if (!CONDITION_CODES.includes(conditionCode)) return res.status(400).json({ error: 'invalid conditionCode' });
    if (!Number.isFinite(value) || value <= 0 || value > 1000000) return res.status(400).json({ error: 'invalid value' });

    const pool = getMysqlPool();
    const [items] = await pool.query('SELECT id FROM catalog_entries WHERE id = ? AND status = "approved"', [req.params.id]);
    if (!items.length) return res.status(404).json({ error: 'Katalogeintrag nicht gefunden' });

    const valueMinor = Math.round(value * 100);
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO community_value_estimates (id, catalog_item_id, user_id, condition_code, estimated_value_minor, currency_code, status, confirmed_at)
       VALUES (?, ?, ?, ?, ?, 'EUR', 'Active', NOW())
       ON DUPLICATE KEY UPDATE estimated_value_minor = VALUES(estimated_value_minor), status = 'Active', confirmed_at = NOW(), updated_at = NOW()`,
      [id, req.params.id, req.user.id, conditionCode, valueMinor]
    );

    const result = await recalculate(pool, req.params.id, conditionCode);
    res.status(201).json({
      ok: true,
      conditionCode,
      myEstimate: { value },
      aggregate: {
        medianValue: minorToMajor(result.medianValueMinor), lowerValue: minorToMajor(result.lowerValueMinor),
        upperValue: minorToMajor(result.upperValueMinor), estimateCount: result.estimateCount,
        contributorCount: result.contributorCount, confidenceLevel: result.confidenceLevel
      }
    });
  } catch (err) { next(err); }
});

router.post('/:id/community-value-estimate/:conditionCode/confirm', requireAuth, async (req, res, next) => {
  try {
    if (!CONDITION_CODES.includes(req.params.conditionCode)) return res.status(400).json({ error: 'invalid conditionCode' });
    const pool = getMysqlPool();
    const [result] = await pool.query(
      "UPDATE community_value_estimates SET confirmed_at = NOW() WHERE catalog_item_id = ? AND user_id = ? AND condition_code = ? AND status = 'Active'",
      [req.params.id, req.user.id, req.params.conditionCode]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Keine aktive Einschätzung gefunden' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id/community-value-estimate/:conditionCode', requireAuth, async (req, res, next) => {
  try {
    if (!CONDITION_CODES.includes(req.params.conditionCode)) return res.status(400).json({ error: 'invalid conditionCode' });
    const pool = getMysqlPool();
    const [result] = await pool.query(
      "UPDATE community_value_estimates SET status = 'Deleted', updated_at = NOW() WHERE catalog_item_id = ? AND user_id = ? AND condition_code = ? AND status = 'Active'",
      [req.params.id, req.user.id, req.params.conditionCode]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Keine aktive Einschätzung gefunden' });
    await recalculate(pool, req.params.id, req.params.conditionCode);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

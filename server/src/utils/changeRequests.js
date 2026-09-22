// Unified contribution/review model — every catalog contribution (new
// item, new photo, or a correction to an already-approved item) is first a
// catalog_change_requests row. XP is only ever created here, from a
// confirmed moderation decision on a request — never directly from a user
// action. change_type is classified server-side from the actual diff,
// never chosen by the submitter.

const crypto = require('crypto');
const { awardXp } = require('./collectorXp');
const { logCatalogHistory } = require('./catalogHistory');
const { withTransaction } = require('../config/db-mysql');

const CHANGE_TYPE_XP = {
  new_item: 10,
  new_variant: 6,
  new_image: 4,
  major_correction: 3,
  identifier: 2,
  minor_correction: 1,
  duplicate_report: 1
};

// Fields a correction proposal is allowed to touch on an existing entry.
const CORRECTABLE_FIELDS = ['name', 'brand', 'category', 'releaseYear', 'ean', 'isbn', 'manufacturerNumber'];
const IDENTIFIER_FIELDS = ['ean', 'isbn', 'manufacturerNumber'];
// Fields where ANY change is treated as significant regardless of how
// small the text edit looks — a one-character difference can mean an
// entirely different year, product, or claim of authenticity (spec
// feedback: "1998 → 1999", "Original → Fälschung"). Text-distance
// heuristics only ever apply to fields NOT in this list.
const SEMANTIC_FIELDS = ['name', 'category', 'releaseYear'];
const CORRECTION_COOLDOWN_HOURS = 24;

function fieldToColumn(field) {
  return { releaseYear: 'release_year', manufacturerNumber: 'manufacturer_number' }[field] || field;
}

// {field: {before, after}} for only the fields that actually changed.
function computeDiff(before, proposed) {
  const diff = {};
  for (const field of CORRECTABLE_FIELDS) {
    if (!(field in proposed)) continue;
    const beforeValue = before ? (before[field] ?? null) : null;
    const afterValue = proposed[field] === '' ? null : proposed[field];
    if (String(beforeValue ?? '') !== String(afterValue ?? '')) {
      diff[field] = { before: beforeValue, after: afterValue };
    }
  }
  return diff;
}

// The server decides the category — never the submitter. Order matters,
// per the spec feedback: special fields first, then a field's inherent
// meaning, then how many fields changed, and only as a last resort — for
// genuine spelling/typo cleanup — a text-distance comparison.
function classifyChangeType(diff) {
  const changedFields = Object.keys(diff);
  if (!changedFields.length) return null;

  // 1) Special fields: identifiers are their own category regardless of
  // how many of them changed or how different the values look.
  const onlyIdentifiers = changedFields.every((f) => IDENTIFIER_FIELDS.includes(f));
  if (onlyIdentifiers) return 'identifier';

  // 2) Field meaning: touching a semantically load-bearing field (name,
  // category, release year) is always major — the field's identity, not
  // the size of the text edit, is what matters here.
  if (changedFields.some((f) => SEMANTIC_FIELDS.includes(f))) return 'major_correction';

  // 3) Field count: multiple non-semantic fields changed together.
  if (changedFields.length > 1) return 'major_correction';

  // 4) Only now, for a single non-semantic, non-identifier field (in
  // practice: brand), does text distance decide typo-fix vs. real change.
  const { before, after } = diff[changedFields[0]];
  const beforeStr = String(before ?? '');
  const afterStr = String(after ?? '');
  if (!beforeStr) return 'minor_correction';
  const distance = levenshtein(beforeStr, afterStr);
  return distance <= Math.max(3, Math.ceil(beforeStr.length * 0.3)) ? 'minor_correction' : 'major_correction';
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

// Creates a new_item/new_image change request directly in 'pending' (these
// aren't classified from a diff — they have no "before").
async function createDirectRequest(pool, { catalogItemId, submittedBy, changeType, proposedData }) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO catalog_change_requests (id, catalog_item_id, submitted_by, change_type, status, proposed_data_json)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
    [id, catalogItemId || null, submittedBy || null, changeType, JSON.stringify(proposedData || {})]
  );
  return id;
}

async function hasRecentPaidCorrection(conn, { catalogItemId, submittedBy }) {
  const [[row]] = await conn.query(
    `SELECT ccr.reviewed_at FROM catalog_change_requests ccr
     JOIN contribution_xp_transactions tx ON tx.change_request_id = ccr.id AND tx.xp_amount > 0
     WHERE ccr.catalog_item_id = ? AND ccr.submitted_by = ? AND ccr.status = 'approved'
       AND ccr.change_type IN ('minor_correction', 'major_correction')
       AND ccr.reviewed_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
     ORDER BY ccr.reviewed_at DESC LIMIT 1`,
    [catalogItemId, submittedBy, CORRECTION_COOLDOWN_HOURS]
  );
  return !!row;
}

// Corrections to an existing, already-approved item. Classifies the type
// from the diff and bundles into any still-open request from the same user
// on the same item (spec: "künstliches Aufteilen verhindern"). The cooldown
// itself is NOT enforced here — a submission is never blocked, only its XP
// eligibility is decided at approval time (see decideChangeRequest), so an
// urgent or safety-relevant fix can always get in front of a moderator.
async function proposeCorrection(pool, { catalogItemId, submittedBy, proposedFields }) {
  const [[entry]] = await pool.query('SELECT * FROM catalog_entries WHERE id = ?', [catalogItemId]);
  if (!entry) throw Object.assign(new Error('Katalogeintrag nicht gefunden'), { status: 404 });
  if (entry.status !== 'approved') {
    throw Object.assign(new Error('Änderungen können nur an genehmigten Katalogeinträgen vorgeschlagen werden.'), { status: 400 });
  }

  const before = {
    name: entry.name, brand: entry.brand, category: entry.category, releaseYear: entry.release_year,
    ean: entry.ean, isbn: entry.isbn, manufacturerNumber: entry.manufacturer_number
  };
  const diff = computeDiff(before, proposedFields);
  if (!Object.keys(diff).length) {
    throw Object.assign(new Error('Diese Änderung enthält keine tatsächlichen Unterschiede.'), { status: 400 });
  }
  const changeType = classifyChangeType(diff);

  // Bundle into any still-open request from the same user on the same item
  // instead of creating a second one — an OPEN (not-yet-decided) request is
  // never itself a source of duplicate XP, so this is safe regardless of
  // the cooldown, which only applies at approval time.
  const [[openRequest]] = await pool.query(
    `SELECT * FROM catalog_change_requests
     WHERE catalog_item_id = ? AND submitted_by = ? AND status = 'pending'
       AND change_type IN ('minor_correction', 'major_correction', 'identifier')
     ORDER BY submitted_at DESC LIMIT 1`,
    [catalogItemId, submittedBy]
  );

  if (openRequest) {
    // mysql2 auto-parses JSON columns into objects already.
    const mergedProposed = { ...openRequest.proposed_data_json, ...proposedFields };
    const mergedDiff = computeDiff(before, mergedProposed);
    const mergedType = classifyChangeType(mergedDiff);
    await pool.query(
      `UPDATE catalog_change_requests SET proposed_data_json = ?, calculated_diff_json = ?, change_type = ?, updated_at = NOW()
       WHERE id = ?`,
      [JSON.stringify(mergedProposed), JSON.stringify(mergedDiff), mergedType, openRequest.id]
    );
    return openRequest.id;
  }

  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO catalog_change_requests (id, catalog_item_id, submitted_by, change_type, status, original_data_json, proposed_data_json, calculated_diff_json)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [id, catalogItemId, submittedBy, changeType, JSON.stringify(before), JSON.stringify(proposedFields), JSON.stringify(diff)]
  );
  return id;
}

// Resubmission after 'needs_changes': updates the SAME row and puts it
// back to 'pending' — it must never become a second, independent XP
// source. Only the original submitter, and only from needs_changes.
async function resubmitChangeRequest(pool, { changeRequestId, submittedBy, proposedFields }) {
  const [[request]] = await pool.query('SELECT * FROM catalog_change_requests WHERE id = ? AND submitted_by = ?', [changeRequestId, submittedBy]);
  if (!request) throw Object.assign(new Error('Vorschlag nicht gefunden'), { status: 404 });
  if (request.status !== 'needs_changes') {
    throw Object.assign(new Error('Dieser Vorschlag kann in seinem aktuellen Status nicht bearbeitet werden.'), { status: 400 });
  }
  const merged = { ...request.proposed_data_json, ...proposedFields };
  let diff = request.calculated_diff_json;
  let changeType = request.change_type;
  if (request.catalog_item_id) {
    const [[entry]] = await pool.query('SELECT * FROM catalog_entries WHERE id = ?', [request.catalog_item_id]);
    const before = entry ? {
      name: entry.name, brand: entry.brand, category: entry.category, releaseYear: entry.release_year,
      ean: entry.ean, isbn: entry.isbn, manufacturerNumber: entry.manufacturer_number
    } : null;
    diff = computeDiff(before, merged);
    changeType = classifyChangeType(diff) || request.change_type;
  }
  await pool.query(
    `UPDATE catalog_change_requests SET proposed_data_json = ?, calculated_diff_json = ?, change_type = ?,
       status = 'pending', moderator_reason = NULL, updated_at = NOW() WHERE id = ?`,
    [JSON.stringify(merged), JSON.stringify(diff), changeType, changeRequestId]
  );
  return changeRequestId;
}

// Applies a decision atomically: the change_request's own status/audit
// fields, the catalog_entries field update, the history log entry, and the
// XP award all commit together or not at all (spec feedback: these must
// never be allowed to diverge). Once decided, calculated_diff_json,
// change_type and moderator_reason are frozen — a second decide on the
// same request is refused, not overwritten.
async function decideChangeRequest(pool, { changeRequestId, moderatorId, decision, reason, xpTypeOverride }) {
  return withTransaction(pool, async (conn) => {
    // Row-level lock: a concurrent decide on the same request blocks here
    // until this transaction commits or rolls back, then cleanly sees the
    // already-decided status instead of racing on it.
    const [[request]] = await conn.query('SELECT * FROM catalog_change_requests WHERE id = ? FOR UPDATE', [changeRequestId]);
    if (!request) throw Object.assign(new Error('Änderungsvorschlag nicht gefunden'), { status: 404 });
    if (request.status !== 'pending') throw Object.assign(new Error('Dieser Vorschlag wurde bereits entschieden.'), { status: 400 });
    if (xpTypeOverride && xpTypeOverride !== request.change_type && !reason) {
      throw Object.assign(new Error('Eine Abweichung von der vorgeschlagenen Kategorie erfordert eine Begründung.'), { status: 400 });
    }

    const finalType = xpTypeOverride || request.change_type;
    await conn.query(
      'UPDATE catalog_change_requests SET status = ?, moderator_id = ?, moderator_reason = ?, change_type = ?, reviewed_at = NOW() WHERE id = ?',
      [decision, moderatorId, reason || null, finalType, changeRequestId]
    );

    if (decision !== 'approved') return { applied: false };

    // Only a correction-type request writes proposed fields directly here —
    // new_item/new_image apply their data through their own existing flows
    // in admin.js.
    if (['minor_correction', 'major_correction', 'identifier'].includes(request.change_type) && request.catalog_item_id) {
      const proposed = request.proposed_data_json;
      const diff = request.calculated_diff_json || computeDiff(null, proposed);
      const setClauses = [];
      const params = [];
      for (const field of Object.keys(diff)) {
        setClauses.push(`${fieldToColumn(field)} = ?`);
        params.push(proposed[field] ?? null);
      }
      if (setClauses.length) {
        params.push(request.catalog_item_id);
        await conn.query(`UPDATE catalog_entries SET ${setClauses.join(', ')} WHERE id = ?`, params);
        await logCatalogHistory(conn, {
          catalogItemId: request.catalog_item_id, fromStatus: 'approved', toStatus: 'approved',
          reason: `Korrektur übernommen (${finalType}): ${Object.keys(diff).join(', ')}`, actorUserId: moderatorId
        });
      }
    }

    if (request.submitted_by) {
      // Cooldown decides XP eligibility at approval time, not submission
      // time — a fix is never refused, but a second paid correction on the
      // same item within 24h of the last one is booked at 0 XP instead of
      // being rejected outright (spec feedback: don't block urgent/safety
      // fixes, just don't double-pay for them).
      const onCooldown = ['minor_correction', 'major_correction'].includes(finalType)
        && await hasRecentPaidCorrection(conn, { catalogItemId: request.catalog_item_id, submittedBy: request.submitted_by });
      const xpAmount = onCooldown ? 0 : CHANGE_TYPE_XP[finalType];
      const xpReason = onCooldown
        ? `0 XP – Cooldown (${finalType}, Vorschlag ${changeRequestId})`
        : `${finalType} (Vorschlag ${changeRequestId})`;
      try {
        await awardXp(conn, {
          userId: request.submitted_by, sourceType: 'ManualCorrection', sourceId: changeRequestId,
          xpAmount, reason: xpReason, approvedBy: moderatorId, changeRequestId
        });
      } catch (e) {
        if (e.code !== 'ER_DUP_ENTRY') throw e; // already funded — the unique key did its job
      }
    }

    return { applied: true, changeType: finalType };
  });
}

module.exports = {
  CHANGE_TYPE_XP, CORRECTABLE_FIELDS, computeDiff, classifyChangeType,
  createDirectRequest, proposeCorrection, resubmitChangeRequest, decideChangeRequest
};

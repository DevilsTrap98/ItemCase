// Unified contribution/review model — every catalog contribution (new
// item, new photo, or a correction to an already-approved item) is first a
// catalog_change_requests row. XP is only ever created here, from a
// confirmed moderation decision on a request — never directly from a user
// action. change_type is classified server-side from the actual diff, per
// field, never chosen by the submitter.

const crypto = require('crypto');
const { awardXp } = require('./collectorXp');
const { logCatalogHistory } = require('./catalogHistory');

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

// The server decides the category — never the submitter — so nobody can
// declare a one-word typo fix a "major correction" for more XP.
function classifyChangeType(diff) {
  const changedFields = Object.keys(diff);
  if (!changedFields.length) return null;

  const onlyIdentifiers = changedFields.every((f) => IDENTIFIER_FIELDS.includes(f));
  if (onlyIdentifiers) return 'identifier';

  if (changedFields.length === 1) {
    const { before, after } = diff[changedFields[0]];
    const beforeStr = String(before ?? '');
    const afterStr = String(after ?? '');
    // A single field, newly filled in from empty, or a short edit relative
    // to its length, reads as a minor correction; anything larger — a
    // rename, a different value entirely — is major.
    if (!beforeStr) return 'minor_correction';
    const distance = levenshtein(beforeStr, afterStr);
    if (distance <= Math.max(3, Math.ceil(beforeStr.length * 0.3))) return 'minor_correction';
    return 'major_correction';
  }
  return 'major_correction';
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

// Corrections to an existing, already-approved item. Classifies the type
// from the diff, bundles into any still-open request from the same user on
// the same item (spec: "künstliches Aufteilen verhindern"), and enforces a
// cooldown after a recently-approved correction on the same item.
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

  // Cooldown: no further minor/major correction from this user on this
  // item within 24h of their last approved one — stops "one field per day
  // for extra XP" gaming without blocking a genuinely new, distinct fix.
  const [[recentApproved]] = await pool.query(
    `SELECT reviewed_at FROM catalog_change_requests
     WHERE catalog_item_id = ? AND submitted_by = ? AND status = 'approved'
       AND change_type IN ('minor_correction', 'major_correction')
       AND reviewed_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
     ORDER BY reviewed_at DESC LIMIT 1`,
    [catalogItemId, submittedBy, CORRECTION_COOLDOWN_HOURS]
  );
  if (recentApproved) {
    throw Object.assign(new Error('Du hast an diesem Eintrag kürzlich bereits eine Korrektur vorgenommen. Bitte warte, bevor du eine weitere Korrektur vorschlägst.'), { status: 429 });
  }

  // Bundle into any still-open request from the same user on the same item
  // instead of creating a second one — this is what actually prevents
  // splitting one edit into several XP-earning submissions.
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

// Applies a decision. On approve: writes the proposed fields onto the
// catalog entry (corrections only — new_item/new_image have their own
// existing apply logic in admin.js) and awards XP exactly once via the
// change_request_id unique key. xpTypeOverride lets a moderator recategorize
// the contribution, but requires a reason (spec: "muss eine Abweichung
// begründen").
async function decideChangeRequest(pool, { changeRequestId, moderatorId, decision, reason, xpTypeOverride }) {
  const [[request]] = await pool.query('SELECT * FROM catalog_change_requests WHERE id = ?', [changeRequestId]);
  if (!request) throw Object.assign(new Error('Änderungsvorschlag nicht gefunden'), { status: 404 });
  if (request.status !== 'pending') throw Object.assign(new Error('Dieser Vorschlag wurde bereits entschieden.'), { status: 400 });
  if (request.submitted_by && request.submitted_by === moderatorId) {
    throw Object.assign(new Error('Du kannst deinen eigenen Vorschlag nicht selbst moderieren.'), { status: 403 });
  }
  if (xpTypeOverride && xpTypeOverride !== request.change_type && !reason) {
    throw Object.assign(new Error('Eine Abweichung von der vorgeschlagenen Kategorie erfordert eine Begründung.'), { status: 400 });
  }

  const finalType = xpTypeOverride || request.change_type;
  await pool.query(
    'UPDATE catalog_change_requests SET status = ?, moderator_id = ?, moderator_reason = ?, change_type = ?, reviewed_at = NOW() WHERE id = ?',
    [decision, moderatorId, reason || null, finalType, changeRequestId]
  );

  if (decision !== 'approved') return { applied: false };

  // Only a correction-type request writes proposed fields directly here —
  // new_item/new_image apply their data through their own existing flows
  // in admin.js, which call this only for the XP side (proposed_data_json
  // is informational there).
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
      await pool.query(`UPDATE catalog_entries SET ${setClauses.join(', ')} WHERE id = ?`, params);
      await logCatalogHistory(pool, {
        catalogItemId: request.catalog_item_id, fromStatus: 'approved', toStatus: 'approved',
        reason: `Korrektur übernommen (${finalType}): ${Object.keys(diff).join(', ')}`, actorUserId: moderatorId
      });
    }
  }

  if (request.submitted_by) {
    const xpAmount = CHANGE_TYPE_XP[finalType];
    try {
      await awardXp(pool, {
        userId: request.submitted_by, sourceType: 'ManualCorrection', sourceId: changeRequestId,
        xpAmount, reason: `${finalType} (Vorschlag ${changeRequestId})`, approvedBy: moderatorId,
        changeRequestId
      });
    } catch (e) {
      if (e.code !== 'ER_DUP_ENTRY') throw e; // already funded — the unique key did its job
    }
  }

  return { applied: true, changeType: finalType };
}

module.exports = {
  CHANGE_TYPE_XP, CORRECTABLE_FIELDS, computeDiff, classifyChangeType,
  createDirectRequest, proposeCorrection, decideChangeRequest
};

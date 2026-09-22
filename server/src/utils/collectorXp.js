// XP-Kern + Level/Slots (spec "ItemCase Gesamtanleitung für Sammlerlevel und
// Belohnungen"). The transaction ledger, idempotent awarding on approval,
// reversals, and the level/slot calculation. Pro+ milestone unlocking lives
// in entitlements.js and is triggered here on every recompute; activation
// itself (and the entitlement it creates) is a separate, explicit step —
// see server/src/routes/catalog.js's reward endpoints.

const crypto = require('crypto');
const { unlockDueMilestones } = require('./entitlements');

const XP_VALUES = {
  CatalogItemApproved: 10,
  VariantApproved: 6,
  ImageApproved: 4,
  CorrectionApproved: 3,
  IdentifierApproved: 2,
  DuplicateConfirmed: 1
};

const SLOT_XP_CAP = 2500; // spec section 9
const XP_PER_LEVEL = 50;
const SLOT_REWARD_LEVEL_CAP = 50;
const SLOTS_PER_LEVEL = 2;
const BASE_FREE_LIMIT = 100;
// Lean Phase 3 abuse protection: XP is never deleted or refused past this,
// it's just held back as 'withheld' until an admin releases it.
const DAILY_XP_CAP = 50;

function levelForXp(xp) {
  return Math.floor(Math.max(0, xp) / XP_PER_LEVEL);
}

function slotsForXp(xp) {
  const slotEligibleXp = Math.min(Math.max(0, xp), SLOT_XP_CAP);
  return Math.floor(slotEligibleXp / XP_PER_LEVEL) * SLOTS_PER_LEVEL;
}

async function recomputeProgress(pool, userId) {
  // Only 'confirmed' XP counts toward level/slots — 'withheld' rows exist
  // in the ledger (for transparency and later release) but don't affect
  // standing until an admin releases them.
  const [[row]] = await pool.query(
    "SELECT COALESCE(SUM(xp_amount), 0) AS total FROM contribution_xp_transactions WHERE user_id = ? AND status = 'confirmed'",
    [userId]
  );
  const confirmedLifetimeXp = Number(row.total) || 0;
  const collectorLevel = levelForXp(confirmedLifetimeXp);
  const slotEligibleXp = Math.min(Math.max(0, confirmedLifetimeXp), SLOT_XP_CAP);
  const earnedCollectionSlots = slotsForXp(confirmedLifetimeXp);

  await pool.query(
    `INSERT INTO collector_progress (user_id, confirmed_lifetime_xp, collector_level, slot_eligible_xp, earned_collection_slots, updated_at)
     VALUES (?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE confirmed_lifetime_xp = VALUES(confirmed_lifetime_xp), collector_level = VALUES(collector_level),
       slot_eligible_xp = VALUES(slot_eligible_xp), earned_collection_slots = VALUES(earned_collection_slots), updated_at = NOW()`,
    [userId, confirmedLifetimeXp, collectorLevel, slotEligibleXp, earnedCollectionSlots]
  );
  await unlockDueMilestones(pool, userId, collectorLevel);
  return { confirmedLifetimeXp, collectorLevel, slotEligibleXp, earnedCollectionSlots };
}

async function awardXp(pool, { userId, sourceType, sourceId, reason, approvedBy, xpAmount, changeRequestId }) {
  if (!userId) return null; // legacy/anonymous submissions have no one to credit
  const amount = xpAmount ?? XP_VALUES[sourceType];
  if (!Number.isFinite(amount)) throw new Error(`Unknown XP source type: ${sourceType}`);

  // Daily cap: XP is never lost, just withheld once the day's confirmed
  // total would go over the cap. A 0-amount booking (e.g. a cooldown
  // correction) never needs withholding either way.
  let status = 'confirmed';
  let finalReason = reason || null;
  if (amount > 0) {
    const [[today]] = await pool.query(
      "SELECT COALESCE(SUM(xp_amount), 0) AS total FROM contribution_xp_transactions WHERE user_id = ? AND status = 'confirmed' AND created_at >= NOW() - INTERVAL 24 HOUR",
      [userId]
    );
    if (Number(today.total) + amount > DAILY_XP_CAP) {
      status = 'withheld';
      finalReason = `${finalReason || ''} [Tageslimit erreicht — zurückgehalten bis Prüfung]`.trim();
    }
  }

  // changeRequestId (when given) is the real idempotency guard — a unique
  // DB constraint, not just an app-level flag (see schema.sql). A duplicate
  // insert throws ER_DUP_ENTRY, which callers treat as "already funded".
  await pool.query(
    'INSERT INTO contribution_xp_transactions (id, user_id, source_type, source_id, change_request_id, xp_amount, status, reason, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [crypto.randomUUID(), userId, sourceType, sourceId || null, changeRequestId || null, amount, status, finalReason, approvedBy || null]
  );
  return recomputeProgress(pool, userId);
}

// Admin releases a withheld transaction after review — it becomes
// 'confirmed' and counts toward the ledger from that point on. Never
// silent: released_by/released_at are recorded.
async function releaseWithheldXp(pool, { transactionId, releasedBy }) {
  const [[tx]] = await pool.query('SELECT * FROM contribution_xp_transactions WHERE id = ?', [transactionId]);
  if (!tx) throw Object.assign(new Error('Transaktion nicht gefunden'), { status: 404 });
  if (tx.status !== 'withheld') throw Object.assign(new Error('Diese Transaktion ist nicht zurückgehalten.'), { status: 400 });
  await pool.query(
    "UPDATE contribution_xp_transactions SET status = 'confirmed', released_by = ?, released_at = NOW() WHERE id = ?",
    [releasedBy, transactionId]
  );
  return recomputeProgress(pool, tx.user_id);
}

// Reverses a specific transaction with its own counter-booking (spec
// section 20/21: never overwrite an existing transaction). Refuses to
// double-reverse the same transaction.
async function reverseXp(pool, { transactionId, reason, actorUserId }) {
  const [[original]] = await pool.query('SELECT * FROM contribution_xp_transactions WHERE id = ?', [transactionId]);
  if (!original) throw Object.assign(new Error('Transaktion nicht gefunden'), { status: 404 });
  const [[alreadyReversed]] = await pool.query(
    "SELECT id FROM contribution_xp_transactions WHERE source_type = 'RewardReversed' AND source_id = ?",
    [transactionId]
  );
  if (alreadyReversed) throw Object.assign(new Error('Diese Transaktion wurde bereits zurückgenommen'), { status: 400 });

  await pool.query(
    'INSERT INTO contribution_xp_transactions (id, user_id, source_type, source_id, xp_amount, reason, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [crypto.randomUUID(), original.user_id, 'RewardReversed', transactionId, -original.xp_amount, reason || null, actorUserId || null]
  );
  return recomputeProgress(pool, original.user_id);
}

// Auto-reversal for "RemovedForViolation" (spec section 4/21): finds the
// CatalogItemApproved transaction for this entry, if any, and reverses it.
async function reverseCatalogItemXp(pool, { catalogItemId, reason, actorUserId }) {
  const [[tx]] = await pool.query(
    "SELECT id FROM contribution_xp_transactions WHERE source_type = 'CatalogItemApproved' AND source_id = ?",
    [catalogItemId]
  );
  if (!tx) return null;
  try {
    return await reverseXp(pool, { transactionId: tx.id, reason, actorUserId });
  } catch (e) {
    if (e.status === 400) return null; // already reversed — nothing to do
    throw e;
  }
}

// Always returns the same snake_case DB-row shape — recomputeProgress()
// returns a differently-shaped (camelCase) object for its own callers, so
// this re-reads the row after ensuring it exists rather than returning
// that object directly (a shape mismatch here previously made a brand-new
// user's very first limit check silently compute NaN instead of 100).
async function getProgress(pool, userId) {
  const [[row]] = await pool.query('SELECT * FROM collector_progress WHERE user_id = ?', [userId]);
  if (row) return row;
  await recomputeProgress(pool, userId);
  const [[created]] = await pool.query('SELECT * FROM collector_progress WHERE user_id = ?', [userId]);
  return created;
}

function effectiveFreeItemLimit(earnedCollectionSlots) {
  return BASE_FREE_LIMIT + Math.min(earnedCollectionSlots, SLOTS_PER_LEVEL * SLOT_REWARD_LEVEL_CAP);
}

module.exports = {
  XP_VALUES, awardXp, reverseXp, reverseCatalogItemXp, releaseWithheldXp, recomputeProgress, getProgress,
  levelForXp, slotsForXp, effectiveFreeItemLimit, BASE_FREE_LIMIT, SLOT_XP_CAP, XP_PER_LEVEL, SLOT_REWARD_LEVEL_CAP, DAILY_XP_CAP
};

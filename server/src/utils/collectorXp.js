// XP-Kern (spec "ItemCase Gesamtanleitung für Sammlerlevel und Belohnungen").
// Only Phase 1 here: the transaction ledger, idempotent awarding on
// approval, reversals, and the level/slot calculation those need. The
// progress UI, Pro+ milestone rewards and abuse detection are later phases
// per the user's own staged plan — not implemented yet, not silently
// dropped.

const crypto = require('crypto');

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

function levelForXp(xp) {
  return Math.floor(Math.max(0, xp) / XP_PER_LEVEL);
}

function slotsForXp(xp) {
  const slotEligibleXp = Math.min(Math.max(0, xp), SLOT_XP_CAP);
  return Math.floor(slotEligibleXp / XP_PER_LEVEL) * SLOTS_PER_LEVEL;
}

async function recomputeProgress(pool, userId) {
  const [[row]] = await pool.query(
    'SELECT COALESCE(SUM(xp_amount), 0) AS total FROM contribution_xp_transactions WHERE user_id = ?',
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
  return { confirmedLifetimeXp, collectorLevel, slotEligibleXp, earnedCollectionSlots };
}

async function awardXp(pool, { userId, sourceType, sourceId, reason, approvedBy, xpAmount }) {
  if (!userId) return null; // legacy/anonymous submissions have no one to credit
  const amount = xpAmount ?? XP_VALUES[sourceType];
  if (!Number.isFinite(amount)) throw new Error(`Unknown XP source type: ${sourceType}`);
  await pool.query(
    'INSERT INTO contribution_xp_transactions (id, user_id, source_type, source_id, xp_amount, reason, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [crypto.randomUUID(), userId, sourceType, sourceId || null, amount, reason || null, approvedBy || null]
  );
  return recomputeProgress(pool, userId);
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
  XP_VALUES, awardXp, reverseXp, reverseCatalogItemXp, recomputeProgress, getProgress,
  levelForXp, slotsForXp, effectiveFreeItemLimit, BASE_FREE_LIMIT, SLOT_XP_CAP, XP_PER_LEVEL, SLOT_REWARD_LEVEL_CAP
};

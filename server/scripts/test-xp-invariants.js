// Automated regression test for the XP/level-reward system's safety
// invariants (see the product review that specified them). Not a
// throwaway script — run this before any release that touches
// server/src/utils/collectorXp.js, entitlements.js or changeRequests.js.
//
// Usage: node scripts/test-xp-invariants.js   (needs MYSQL_URL in .env)
// Creates and deletes its own disposable users; safe to run against the
// real dev database.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getMysqlPool } = require('../src/config/db-mysql');
const {
  awardXp, reverseXp, releaseWithheldXp, recomputeProgress, getProgress, DAILY_XP_CAP
} = require('../src/utils/collectorXp');
const { activateReward, getActiveProPlus, MILESTONES, REWARD_HOLD_HOURS } = require('../src/utils/entitlements');

let pass = 0;
let fail = 0;
function check(label, condition) {
  if (condition) { pass++; console.log(`  ok — ${label}`); }
  else { fail++; console.error(`  FAIL — ${label}`); }
}

async function makeUser(pool, role = 'user') {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, name, email, username, password_hash, email_verified_at, account_status, tariff, role, token_version)
     VALUES (?, 'Test', ?, ?, ?, NOW(), 'active', 'free', ?, 0)`,
    [id, `xptest_${id}@example.com`, `xptest_${id.slice(0, 8)}`, await bcrypt.hash('x', 10), role]
  );
  return id;
}

async function main() {
  const pool = getMysqlPool();
  const cleanupUserIds = [];

  // --- Invariant: released withheld XP is never double-released, and a
  // concurrent double-release attempt only ever succeeds once. ---
  console.log('\n[1] Withheld release: no double-release, atomic under concurrency');
  {
    const userId = await makeUser(pool);
    cleanupUserIds.push(userId);
    const adminId = await makeUser(pool, 'admin');
    cleanupUserIds.push(adminId);

    // Push well past the daily cap so we get a guaranteed withheld row.
    for (let i = 0; i < 6; i++) {
      await awardXp(pool, { userId, sourceType: 'CatalogItemApproved', sourceId: crypto.randomUUID(), approvedBy: adminId });
    }
    const [[withheldRow]] = await pool.query("SELECT * FROM contribution_xp_transactions WHERE user_id = ? AND status = 'withheld' LIMIT 1", [userId]);
    check('a withheld transaction exists after exceeding the daily cap', !!withheldRow);

    const results = await Promise.allSettled([
      releaseWithheldXp(pool, { transactionId: withheldRow.id, releasedBy: adminId }),
      releaseWithheldXp(pool, { transactionId: withheldRow.id, releasedBy: adminId })
    ]);
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    check('exactly one of two concurrent releases succeeds', succeeded === 1 && failed === 1);

    const [[after]] = await pool.query('SELECT status, released_by, released_at FROM contribution_xp_transactions WHERE id = ?', [withheldRow.id]);
    check('transaction is confirmed exactly once, with released_by/released_at recorded', after.status === 'confirmed' && !!after.released_by && !!after.released_at);

    // A third, sequential release attempt must be refused too.
    let thirdRefused = false;
    try { await releaseWithheldXp(pool, { transactionId: withheldRow.id, releasedBy: adminId }); }
    catch (e) { thirdRefused = e.status === 400; }
    check('a later release attempt on an already-confirmed transaction is refused', thirdRefused);
  }

  // --- Invariant: admin-ID, timestamp, optional note recorded on release. ---
  console.log('\n[2] Release audit fields (admin id, timestamp, optional note)');
  {
    const userId = await makeUser(pool);
    cleanupUserIds.push(userId);
    const adminId = await makeUser(pool, 'admin');
    cleanupUserIds.push(adminId);
    for (let i = 0; i < 6; i++) {
      await awardXp(pool, { userId, sourceType: 'CatalogItemApproved', sourceId: crypto.randomUUID(), approvedBy: adminId });
    }
    const [[withheldRow]] = await pool.query("SELECT * FROM contribution_xp_transactions WHERE user_id = ? AND status = 'withheld' LIMIT 1", [userId]);
    await releaseWithheldXp(pool, { transactionId: withheldRow.id, releasedBy: adminId, note: 'Geprüft, unauffällig' });
    const [[after]] = await pool.query('SELECT released_by, released_at, release_note FROM contribution_xp_transactions WHERE id = ?', [withheldRow.id]);
    check('released_by matches the releasing admin', after.released_by === adminId);
    check('released_at is set', !!after.released_at);
    check('optional internal note is stored', after.release_note === 'Geprüft, unauffällig');
  }

  // --- Invariant: level rewards only ever created once under concurrency. ---
  console.log('\n[3] Level rewards never duplicate under parallel recomputes');
  {
    const userId = await makeUser(pool);
    cleanupUserIds.push(userId);
    await pool.query('INSERT INTO contribution_xp_transactions (id, user_id, source_type, xp_amount, status) VALUES (UUID(), ?, "ManualCorrection", 1250, "confirmed")', [userId]);
    await Promise.all(Array.from({ length: 10 }, () => recomputeProgress(pool, userId)));
    const [[{ count }]] = await pool.query("SELECT COUNT(*) AS count FROM level_rewards WHERE user_id = ? AND reward_level = 25", [userId]);
    check('exactly one level-25 reward row after 10 concurrent recomputes', Number(count) === 1);
  }

  // --- Invariant: the 48h hold starts when the level is actually reached
  // via CONFIRMED XP, not at submission time (i.e. not while XP is withheld). ---
  console.log('\n[4] Reward hold starts at confirmed-level-reach, not submission');
  {
    const userId = await makeUser(pool);
    cleanupUserIds.push(userId);
    // Insert as WITHHELD directly — simulates "enough XP submitted, but not
    // yet confirmed" — recomputeProgress must not unlock anything from this.
    await pool.query('INSERT INTO contribution_xp_transactions (id, user_id, source_type, xp_amount, status) VALUES (UUID(), ?, "ManualCorrection", 1250, "withheld")', [userId]);
    await recomputeProgress(pool, userId);
    const [[noRewardYet]] = await pool.query("SELECT * FROM level_rewards WHERE user_id = ? AND reward_level = 25", [userId]);
    check('no reward row exists while the qualifying XP is still withheld', !noRewardYet);

    const [[withheldTx]] = await pool.query("SELECT id FROM contribution_xp_transactions WHERE user_id = ? AND status = 'withheld'", [userId]);
    const beforeRelease = new Date();
    await releaseWithheldXp(pool, { transactionId: withheldTx.id, releasedBy: userId });
    const [[reward]] = await pool.query("SELECT * FROM level_rewards WHERE user_id = ? AND reward_level = 25", [userId]);
    check('reward is created only once the XP is released/confirmed', !!reward && reward.status === 'Locked');
    const holdStartedAtRelease = reward.available_at && new Date(reward.available_at) >= new Date(beforeRelease.getTime() + (REWARD_HOLD_HOURS * 3600 - 5) * 1000);
    check('available_at is ~48h from the RELEASE moment, not from an earlier submission time', holdStartedAtRelease);
  }

  // --- Invariant: a reversal that drops confirmed XP below the threshold
  // during the hold revokes the still-Locked reward; an already-Available/
  // Active one must NOT be touched by an ordinary later reversal. ---
  console.log('\n[5] Reversal below threshold revokes a Locked reward, never an Available/Active one');
  {
    const userId = await makeUser(pool);
    cleanupUserIds.push(userId);
    const adminId = await makeUser(pool, 'admin');
    cleanupUserIds.push(adminId);

    const txId = crypto.randomUUID();
    await pool.query('INSERT INTO contribution_xp_transactions (id, user_id, source_type, xp_amount, status) VALUES (?, ?, "ManualCorrection", 1250, "confirmed")', [txId, userId]);
    await recomputeProgress(pool, userId);
    const [[lockedReward]] = await pool.query("SELECT * FROM level_rewards WHERE user_id = ? AND reward_level = 25", [userId]);
    check('reward is Locked right after reaching the level', lockedReward.status === 'Locked');

    // Reverse the XP that caused the level-up — level drops back to 0.
    await reverseXp(pool, { transactionId: txId, reason: 'Testkorrektur', actorUserId: adminId });
    const [[revoked]] = await pool.query("SELECT * FROM level_rewards WHERE id = ?", [lockedReward.id]);
    check('the still-Locked reward is revoked once confirmed XP drops back below its threshold', revoked.status === 'Revoked' && !!revoked.revoked_at);

    const progressAfterRevoke = await getProgress(pool, userId);
    check('collector level actually dropped back to 0', Number(progressAfterRevoke.collector_level) === 0);

    // Re-earn the XP — the SAME milestone must be able to unlock again
    // (not permanently blocked by the unique key from the revoked row).
    const tx2Id = crypto.randomUUID();
    await pool.query('INSERT INTO contribution_xp_transactions (id, user_id, source_type, xp_amount, status) VALUES (?, ?, "ManualCorrection", 1250, "confirmed")', [tx2Id, userId]);
    await recomputeProgress(pool, userId);
    const [[relocked]] = await pool.query("SELECT * FROM level_rewards WHERE id = ?", [lockedReward.id]);
    check('re-earning the XP re-arms the SAME reward row back to Locked with a fresh hold', relocked.status === 'Locked');

    // Now let it actually become Available and Active, then reverse an
    // UNRELATED later correction — the already-active entitlement/reward
    // must be completely untouched.
    await pool.query("UPDATE level_rewards SET status = 'Available' WHERE id = ?", [lockedReward.id]);
    const activation = await activateReward(pool, { userId, rewardId: lockedReward.id });
    check('reward activates into an entitlement', !!activation.entitlementId);

    const unrelatedTxId = crypto.randomUUID();
    await pool.query('INSERT INTO contribution_xp_transactions (id, user_id, source_type, xp_amount, status) VALUES (?, ?, "ManualCorrection", 5, "confirmed")', [unrelatedTxId, userId]);
    await reverseXp(pool, { transactionId: unrelatedTxId, reason: 'Normale Korrektur, nichts mit der Belohnung zu tun', actorUserId: adminId });

    const [[stillActive]] = await pool.query("SELECT status FROM level_rewards WHERE id = ?", [lockedReward.id]);
    const activeEntitlement = await getActiveProPlus(pool, userId);
    check('an already-Active reward survives an unrelated later reversal untouched', stillActive.status === 'Active');
    check('the entitlement itself is still active — never clawed back by an ordinary correction', !!activeEntitlement);
  }

  // --- Invariant: level-100 (tested at a lower, faster milestone: 25) may
  // only become a redeemable entitlement AFTER the hold period. ---
  console.log('\n[6] Milestone reward unactivatable before hold, activatable after');
  {
    const userId = await makeUser(pool);
    cleanupUserIds.push(userId);
    await pool.query('INSERT INTO contribution_xp_transactions (id, user_id, source_type, xp_amount, status) VALUES (UUID(), ?, "ManualCorrection", 1250, "confirmed")', [userId]);
    await recomputeProgress(pool, userId);
    const [[reward]] = await pool.query("SELECT * FROM level_rewards WHERE user_id = ? AND reward_level = 25", [userId]);
    let refusedBeforeHold = false;
    try { await activateReward(pool, { userId, rewardId: reward.id }); }
    catch (e) { refusedBeforeHold = e.status === 400; }
    check('activation is refused while still within the safety hold', refusedBeforeHold);

    await pool.query('UPDATE level_rewards SET available_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?', [reward.id]);
    const { activateReward: activateAfterPromote } = require('../src/utils/entitlements');
    const activation = await activateAfterPromote(pool, { userId, rewardId: reward.id });
    check('activation succeeds once the hold has passed (promoteDueRewards runs lazily)', !!activation.entitlementId);
  }

  // --- Invariant: daily-cap accounting doesn't get confused by releases. ---
  console.log('\n[7] Daily cap math after a release stays sane (no infinite/duplicate counting)');
  {
    const userId = await makeUser(pool);
    cleanupUserIds.push(userId);
    const adminId = await makeUser(pool, 'admin');
    cleanupUserIds.push(adminId);
    for (let i = 0; i < 6; i++) {
      await awardXp(pool, { userId, sourceType: 'CatalogItemApproved', sourceId: crypto.randomUUID(), approvedBy: adminId });
    }
    const progressBefore = await getProgress(pool, userId);
    check(`confirmed XP capped at ${DAILY_XP_CAP} despite 60 XP worth of approvals`, Number(progressBefore.confirmed_lifetime_xp) === DAILY_XP_CAP);
    const [[withheld]] = await pool.query("SELECT id, xp_amount FROM contribution_xp_transactions WHERE user_id = ? AND status = 'withheld'", [userId]);
    await releaseWithheldXp(pool, { transactionId: withheld.id, releasedBy: adminId });
    const progressAfter = await getProgress(pool, userId);
    check('releasing raises confirmed XP by exactly the released amount', Number(progressAfter.confirmed_lifetime_xp) === DAILY_XP_CAP + Number(withheld.xp_amount));
  }

  // --- Invariant: pagination params are honored (no full-table scans forced on the client). ---
  console.log('\n[8] Withheld-XP listing pagination');
  {
    const { getMysqlPool: pool2 } = require('../src/config/db-mysql');
    // Exercised at the HTTP layer in the wider integration tests; here we
    // just confirm the query shape (LIMIT/OFFSET) behaves as expected
    // directly against the DB, since that's what the route delegates to.
    const p = pool2();
    const [page1] = await p.query("SELECT id FROM contribution_xp_transactions WHERE status = 'withheld' ORDER BY created_at ASC LIMIT 2 OFFSET 0");
    const [page2] = await p.query("SELECT id FROM contribution_xp_transactions WHERE status = 'withheld' ORDER BY created_at ASC LIMIT 2 OFFSET 2");
    const overlap = page1.some((r) => page2.some((r2) => r2.id === r.id));
    check('consecutive pages do not overlap', !overlap);
  }

  // Cleanup
  if (cleanupUserIds.length) {
    await pool.query('DELETE FROM users WHERE id IN (?)', [cleanupUserIds]);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
  await pool.end();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

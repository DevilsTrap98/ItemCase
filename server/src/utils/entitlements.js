// Pro+ level-reward entitlements (spec sections 10-15). A reward is
// unlocked automatically (see collectorXp.js) but never auto-activated —
// activation is what creates the time-boxed row here, and it's the only
// thing that grants the temporary Pro+ standing.

const crypto = require('crypto');

const MILESTONES = {
  25: { rewardType: 'ProPlus', durationDays: 7 },
  50: { rewardType: 'ProPlus', durationDays: 21 },
  100: { rewardType: 'ProPlus', durationDays: 28 }
};

// Called from recomputeProgress whenever XP changes. Unlocks (but does not
// activate) any milestone the user has newly reached. INSERT IGNORE is the
// exactly-once guard — the unique key never lets the same milestone unlock twice.
async function unlockDueMilestones(pool, userId, collectorLevel) {
  for (const [levelStr, milestone] of Object.entries(MILESTONES)) {
    const level = Number(levelStr);
    if (collectorLevel < level) continue;
    await pool.query(
      `INSERT IGNORE INTO level_rewards (id, user_id, reward_level, reward_type, duration_days, status)
       VALUES (?, ?, ?, ?, ?, 'Available')`,
      [crypto.randomUUID(), userId, level, milestone.rewardType, milestone.durationDays]
    );
  }
}

async function expireDueEntitlements(pool, userId) {
  const [due] = await pool.query(
    "SELECT * FROM entitlements WHERE user_id = ? AND status = 'active' AND ends_at <= NOW()",
    [userId]
  );
  for (const row of due) {
    await pool.query("UPDATE entitlements SET status = 'expired' WHERE id = ?", [row.id]);
    if (row.source === 'LevelReward' && row.source_reference_id) {
      await pool.query(
        "UPDATE level_rewards SET status = 'Expired' WHERE id = ? AND status = 'Active'",
        [row.source_reference_id]
      );
    }
  }
}

// The one currently-active Pro+ entitlement for a user, if any (spec: only
// one free period active at a time). Also lazily expires anything overdue.
async function getActiveProPlus(pool, userId) {
  await expireDueEntitlements(pool, userId);
  const [[row]] = await pool.query(
    "SELECT * FROM entitlements WHERE user_id = ? AND status = 'active' AND plan = 'proPlus' ORDER BY ends_at DESC LIMIT 1",
    [userId]
  );
  return row || null;
}

async function activateReward(pool, { userId, rewardId }) {
  const [[reward]] = await pool.query('SELECT * FROM level_rewards WHERE id = ? AND user_id = ?', [rewardId, userId]);
  if (!reward) throw Object.assign(new Error('Belohnung nicht gefunden'), { status: 404 });
  if (reward.status !== 'Available') {
    throw Object.assign(new Error('Diese Belohnung ist nicht aktivierbar (bereits aktiviert, abgelaufen oder vorgemerkt).'), { status: 400 });
  }
  const active = await getActiveProPlus(pool, userId);
  if (active) {
    throw Object.assign(new Error('Es kann nur ein Gratiszeitraum gleichzeitig aktiv sein. Diese Belohnung bleibt verfügbar, bis der aktuelle Zeitraum endet.'), { status: 409 });
  }

  const entitlementId = crypto.randomUUID();
  const endsAt = new Date(Date.now() + reward.duration_days * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO entitlements (id, user_id, plan, source, source_reference_id, ends_at) VALUES (?, ?, 'proPlus', 'LevelReward', ?, ?)`,
    [entitlementId, userId, reward.id, endsAt]
  );
  await pool.query(
    "UPDATE level_rewards SET status = 'Active', activated_at = NOW(), expires_at = ? WHERE id = ?",
    [endsAt, reward.id]
  );
  return { entitlementId, endsAt };
}

module.exports = { MILESTONES, unlockDueMilestones, expireDueEntitlements, getActiveProPlus, activateReward };

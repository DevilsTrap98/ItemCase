// Community-Schätzwert: weighted-median aggregation over voluntary user
// estimates. Pure functions here are unit-testable without a DB; the DB
// I/O wrapper (recalculate) is the only part that touches MySQL.
//
// This intentionally implements the calculation spec ("ItemCase Anleitung
// für den Community Schätzwert") as closely as practical for a first pass:
// recency weighting, IQR outlier trimming from >=5 estimates, weighted
// median + quartile range, friendly rounding, and four confidence levels.
// Not yet implemented: the daily full-recalculation sweep and the 12-month
// "still current?" reconfirmation prompt (phases 4/5 of the spec) — noted
// as follow-up work, not silently skipped.

const RECENT_DAYS = 180;
const MAX_AGE_DAYS = 365;

function daysBetween(a, b) {
  return (a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
}

function recencyWeight(createdAt, now) {
  const age = daysBetween(now, createdAt);
  if (age <= RECENT_DAYS) return 1.0;
  if (age <= MAX_AGE_DAYS) return 0.5;
  return 0; // older than 365 days — not considered in the current value
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return null;
  const idx = (sortedValues.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo];
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (idx - lo);
}

function weightedMedian(entries) {
  // entries: [{ value, weight }], weight > 0
  const sorted = [...entries].sort((a, b) => a.value - b.value);
  const totalWeight = sorted.reduce((s, e) => s + e.weight, 0);
  if (totalWeight <= 0) return null;
  let cumulative = 0;
  const half = totalWeight / 2;
  for (const e of sorted) {
    cumulative += e.weight;
    if (cumulative >= half) return e.value;
  }
  return sorted[sorted.length - 1].value;
}

// Friendly rounding, spec section 11 step 5. Value is in minor units (cents).
function roundFriendly(minorValue) {
  const major = minorValue / 100;
  let rounded;
  if (major < 100) rounded = Math.round(major);
  else if (major <= 1000) rounded = Math.round(major / 5) * 5;
  else rounded = Math.round(major / 10) * 10;
  return Math.round(rounded * 100);
}

function confidenceLevel({ estimateCount, contributorCount, freshCount }) {
  if (estimateCount >= 10 && contributorCount >= 5 && freshCount >= 3) return 'High';
  if (estimateCount >= 5 && contributorCount >= 3 && freshCount >= 2) return 'Medium';
  if (estimateCount >= 3 && contributorCount >= 2) return 'Low';
  return 'Insufficient';
}

// rows: [{ value_minor, user_id, created_at (Date) }] — already filtered to
// Active status, verified/active users, matching currency & 365-day window.
function computeAggregate(rows, now = new Date()) {
  const estimateCount = rows.length;
  const contributorCount = new Set(rows.map((r) => r.user_id)).size;
  const freshCount = rows.filter((r) => daysBetween(now, r.created_at) <= RECENT_DAYS).length;
  const confidence = confidenceLevel({ estimateCount, contributorCount, freshCount });

  if (confidence === 'Insufficient') {
    return {
      medianValueMinor: null, lowerValueMinor: null, upperValueMinor: null,
      estimateCount, contributorCount, freshCount, confidenceLevel: confidence
    };
  }

  let weighted = rows
    .map((r) => ({ value: r.value_minor, weight: recencyWeight(r.created_at, now), user_id: r.user_id }))
    .filter((e) => e.weight > 0);

  // Outlier trimming (IQR) only kicks in from 5+ valid estimates.
  if (weighted.length >= 5) {
    const sortedValues = weighted.map((e) => e.value).sort((a, b) => a - b);
    const q1 = percentile(sortedValues, 0.25);
    const q3 = percentile(sortedValues, 0.75);
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;
    const trimmed = weighted.filter((e) => e.value >= lowerBound && e.value <= upperBound);
    if (trimmed.length) weighted = trimmed;
  }

  const median = weightedMedian(weighted);
  const sortedFinal = weighted.map((e) => e.value).sort((a, b) => a - b);
  const lower = percentile(sortedFinal, 0.25);
  const upper = percentile(sortedFinal, 0.75);

  return {
    medianValueMinor: median === null ? null : roundFriendly(median),
    lowerValueMinor: lower === null ? null : roundFriendly(lower),
    upperValueMinor: upper === null ? null : roundFriendly(upper),
    estimateCount, contributorCount, freshCount, confidenceLevel: confidence
  };
}

async function recalculate(pool, catalogItemId, conditionCode, currencyCode = 'EUR') {
  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  const [rows] = await pool.query(
    `SELECT cve.estimated_value_minor AS value_minor, cve.user_id, cve.created_at
     FROM community_value_estimates cve
     JOIN users u ON u.id = cve.user_id
     WHERE cve.catalog_item_id = ? AND cve.condition_code = ? AND cve.currency_code = ?
       AND cve.status = 'Active' AND cve.created_at >= ?
       AND u.account_status = 'active' AND u.email_verified_at IS NOT NULL`,
    [catalogItemId, conditionCode, currencyCode, cutoff]
  );
  const result = computeAggregate(rows);
  await pool.query(
    `INSERT INTO community_value_aggregates
       (catalog_item_id, condition_code, currency_code, median_value_minor, lower_value_minor, upper_value_minor,
        estimate_count, contributor_count, fresh_estimate_count, confidence_level, calculated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       median_value_minor = VALUES(median_value_minor), lower_value_minor = VALUES(lower_value_minor),
       upper_value_minor = VALUES(upper_value_minor), estimate_count = VALUES(estimate_count),
       contributor_count = VALUES(contributor_count), fresh_estimate_count = VALUES(fresh_estimate_count),
       confidence_level = VALUES(confidence_level), calculated_at = NOW()`,
    [
      catalogItemId, conditionCode, currencyCode, result.medianValueMinor, result.lowerValueMinor, result.upperValueMinor,
      result.estimateCount, result.contributorCount, result.freshCount, result.confidenceLevel
    ]
  );
  return result;
}

const CONDITION_CODES = ['NewSealed', 'LikeNew', 'VeryGood', 'Good', 'Used', 'Damaged'];

module.exports = { computeAggregate, recalculate, roundFriendly, CONDITION_CODES };

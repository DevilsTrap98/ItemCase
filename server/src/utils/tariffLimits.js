// Server-side mirror of the item limits in src/tariff-defaults.js. Until
// now the limit was enforced only client-side (the "new item" button was
// just disabled) — anyone calling the API directly could add items past
// their plan's limit. This is the actual enforcement; the client-side
// block is only ever UX on top of it.
const BASE_LIMITS = {
  free: 100,
  collectorPlus: 2500,
  collectorPro: 10000,
  business: Infinity
};

function baseLimitFor(tariff) {
  return BASE_LIMITS[tariff] ?? BASE_LIMITS.free;
}

module.exports = { baseLimitFor, BASE_LIMITS };

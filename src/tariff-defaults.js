export const TARIFF_IDS = ['free', 'collectorPlus', 'collectorPro', 'business'];
// 'business' (Händlermodus) is feature-flagged off for V1 — not offered as
// a selectable plan for now, though the tariff itself still exists for
// anyone already on it / set by an admin.
export const VISIBLE_TARIFF_IDS = TARIFF_IDS.filter((id) => id !== 'business');

export const TARIFFS = {
  // 100 base + up to 100 earned via the Community-Katalog contribution
  // level (see collectorXp.js) = 200 max, per the "Sammlerlevel und
  // Belohnungen" spec. getTariff() below overrides itemLimit per-user with
  // the real server-computed effective limit when it's known.
  free: { id: 'free', priceMonth: 0, priceYear: 0, itemLimit: 100 },
  collectorPlus: { id: 'collectorPlus', priceMonth: 2.99, priceYear: 29.99, itemLimit: 2500 },
  collectorPro: { id: 'collectorPro', priceMonth: 5.99, priceYear: 59.99, itemLimit: 10000 },
  business: { id: 'business', priceMonth: null, priceYear: 0, pricePerItemSlot: 0.05, itemLimit: Infinity, publicInventory: true }
};

export function tariffPriceLabel(info, t) {
  if (info.id === 'business') return t('tariff.business.slotPrice', { price: info.pricePerItemSlot.toFixed(2).replace('.', ',') });
  return info.priceMonth === 0 ? t('tariff.free.price') : `${info.priceMonth.toFixed(2)} €/${t('tariff.perMonth')}`;
}

export function getTariff(id) {
  return TARIFFS[id] || TARIFFS.free;
}

// Free-tier item limit adjusted by earned Community-Katalog contribution
// slots (max +100, per spec — see server/src/utils/collectorXp.js, the
// actual enforcement). Other tariffs are unaffected; the spec only extends
// the Free base limit this way.
export function effectiveTariff(id, earnedCollectionSlots = 0) {
  const info = getTariff(id);
  if (info.id !== 'free' || info.itemLimit === Infinity) return info;
  return { ...info, itemLimit: info.itemLimit + Math.min(Math.max(0, earnedCollectionSlots), 100) };
}

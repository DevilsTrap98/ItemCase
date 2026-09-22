export const TARIFF_IDS = ['free', 'collectorPlus', 'collectorPro', 'business'];

export const TARIFFS = {
  free: { id: 'free', priceMonth: 0, priceYear: 0, itemLimit: 150 },
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

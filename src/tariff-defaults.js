export const TARIFF_IDS = ['free', 'collectorPlus', 'collectorPro'];

export const TARIFFS = {
  free: { id: 'free', priceMonth: 0, priceYear: 0, itemLimit: 150 },
  collectorPlus: { id: 'collectorPlus', priceMonth: 2.99, priceYear: 29.99, itemLimit: 2500 },
  collectorPro: { id: 'collectorPro', priceMonth: 5.99, priceYear: 59.99, itemLimit: 25000 }
};

export function getTariff(id) {
  return TARIFFS[id] || TARIFFS.free;
}

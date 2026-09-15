import React, { useMemo } from 'react';
import { useI18n } from './i18n.jsx';

const DNA_COLORS = ['#6c8cff', '#34d399', '#f472b6', '#f5a524', '#38bdf8', '#a78bfa', '#94a3b8', '#fb7185'];

const BRAND_KEYWORDS = ['marke', 'brand', 'hersteller', 'manufacturer'];
const YEAR_KEYWORDS = ['jahr', 'year', 'erscheinungsjahr', 'release'];
const COLOR_KEYWORDS = ['farbe', 'color', 'colour'];
const COUNTRY_KEYWORDS = ['land', 'country', 'herkunft', 'origin'];

function topEntry(counts) {
  const entries = Object.entries(counts).filter(([k]) => k);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return { value: entries[0][0], count: entries[0][1] };
}

function decadeOf(raw) {
  const match = String(raw).match(/\d{4}/);
  if (!match) return null;
  const y = parseInt(match[0], 10);
  if (y < 1000 || y > 3000) return null;
  return `${Math.floor(y / 10) * 10}er`;
}

function collectFieldCounts(items, categoryFields, keywords, transform) {
  const matchingKeys = new Set();
  Object.values(categoryFields || {}).forEach((fields) => {
    (fields || []).forEach((f) => {
      const label = (f.label || '').toLowerCase();
      if (keywords.some((k) => label.includes(k))) matchingKeys.add(f.key);
    });
  });
  const counts = {};
  items.forEach((item) => {
    matchingKeys.forEach((key) => {
      const raw = item.customFields?.[key];
      if (!raw) return;
      const value = transform ? transform(raw) : raw;
      if (!value) return;
      counts[value] = (counts[value] || 0) + 1;
    });
  });
  return counts;
}

export default function CollectionDNA({ items, categoryFields, onClose }) {
  const { lang, t } = useI18n();

  const dna = useMemo(() => {
    const total = items.length;
    const categoryCounts = {};
    items.forEach((i) => {
      const cat = i.category || t('dna.uncategorized');
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });
    const categoryBreakdown = Object.entries(categoryCounts)
      .map(([category, count], idx) => ({
        category, count,
        pct: total ? Math.round((count / total) * 100) : 0,
        color: DNA_COLORS[idx % DNA_COLORS.length]
      }))
      .sort((a, b) => b.count - a.count);

    const purchasePrices = items.map((i) => Number(i.purchasePrice) || 0).filter((v) => v > 0);
    const avgPurchasePrice = purchasePrices.length
      ? purchasePrices.reduce((s, v) => s + v, 0) / purchasePrices.length
      : null;

    const shelfCounts = {};
    items.forEach((i) => {
      const shelf = (i.location?.shelf || '').trim();
      if (shelf) shelfCounts[shelf] = (shelfCounts[shelf] || 0) + 1;
    });
    const topShelf = topEntry(shelfCounts);

    const createdDates = items.map((i) => i.createdAt).filter(Boolean).sort();
    const collectingSince = createdDates.length ? createdDates[0] : null;

    const giftCount = items.filter((i) => i.story?.isGift).length;
    const firstPieceItem = items.find((i) => i.story?.isFirstPiece);

    const brandCounts = collectFieldCounts(items, categoryFields, BRAND_KEYWORDS);
    const colorCounts = collectFieldCounts(items, categoryFields, COLOR_KEYWORDS);
    const countryCounts = collectFieldCounts(items, categoryFields, COUNTRY_KEYWORDS);
    const decadeCounts = collectFieldCounts(items, categoryFields, YEAR_KEYWORDS, decadeOf);

    return {
      total,
      categoryBreakdown,
      avgPurchasePrice,
      topShelf,
      collectingSince,
      giftCount,
      firstPieceItem,
      topBrand: topEntry(brandCounts),
      topColor: topEntry(colorCounts),
      topCountry: topEntry(countryCounts),
      topDecade: topEntry(decadeCounts)
    };
  }, [items, categoryFields, t]);

  const currencyFmt = (n) => n.toLocaleString(lang === 'en' ? 'en-US' : 'de-DE', { style: 'currency', currency: 'EUR' });
  const dateFmt = (iso) => new Date(iso).toLocaleDateString(lang === 'en' ? 'en-US' : 'de-DE');

  const traits = [
    dna.topBrand && { icon: '🏷️', label: t('dna.topBrand'), value: `${dna.topBrand.value} (${dna.topBrand.count}×)` },
    dna.topDecade && { icon: '📅', label: t('dna.topDecade'), value: `${dna.topDecade.value} (${dna.topDecade.count}×)` },
    dna.topColor && { icon: '🎨', label: t('dna.topColor'), value: `${dna.topColor.value} (${dna.topColor.count}×)` },
    dna.topCountry && { icon: '🌍', label: t('dna.topCountry'), value: `${dna.topCountry.value} (${dna.topCountry.count}×)` }
  ].filter(Boolean);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal level-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>🧬 {t('dna.title')}</h2>
          <button className="icon-btn" onClick={onClose} title="✕">✕</button>
        </div>

        <div className="level-content">
          {dna.total === 0 ? (
            <p className="field-hint">{t('dna.empty')}</p>
          ) : (
            <>
              <div>
                <h3 className="level-section-title">{t('dna.categorySplit')}</h3>
                <div className="dna-bar">
                  {dna.categoryBreakdown.map((c) => (
                    <div
                      key={c.category}
                      className="dna-bar-segment"
                      style={{ width: `${c.pct}%`, background: c.color }}
                      title={`${c.category} · ${c.pct}%`}
                    />
                  ))}
                </div>
                <div className="dna-legend">
                  {dna.categoryBreakdown.map((c) => (
                    <div key={c.category} className="dna-legend-item">
                      <span className="dna-legend-dot" style={{ background: c.color }} />
                      {c.category} · {c.pct}%
                    </div>
                  ))}
                </div>
              </div>

              <div className="level-stats-row">
                <div className="level-stat">
                  <span className="stat-value">{dna.avgPurchasePrice != null ? currencyFmt(dna.avgPurchasePrice) : '–'}</span>
                  <span className="stat-label">{t('dna.avgPurchasePrice')}</span>
                </div>
                <div className="level-stat">
                  <span className="stat-value">{dna.collectingSince ? dateFmt(dna.collectingSince) : '–'}</span>
                  <span className="stat-label">{t('dna.collectingSince')}</span>
                </div>
                <div className="level-stat">
                  <span className="stat-value">{dna.topShelf ? dna.topShelf.value : '–'}</span>
                  <span className="stat-label">{t('dna.favoriteShelf')}</span>
                </div>
              </div>

              {(dna.giftCount > 0 || dna.firstPieceItem) && (
                <div className="level-stats-row">
                  {dna.giftCount > 0 && (
                    <div className="level-stat">
                      <span className="stat-value">🎁 {dna.giftCount}</span>
                      <span className="stat-label">{t('dna.giftsReceived')}</span>
                    </div>
                  )}
                  {dna.firstPieceItem && (
                    <div className="level-stat">
                      <span className="stat-value">🥇 {dna.firstPieceItem.name}</span>
                      <span className="stat-label">{t('dna.firstPiece')}</span>
                    </div>
                  )}
                </div>
              )}

              {traits.length > 0 && (
                <div>
                  <h3 className="level-section-title">{t('dna.discoveredTraits')}</h3>
                  <div className="dna-traits">
                    {traits.map((trait) => (
                      <div key={trait.label} className="dna-trait">
                        <span>{trait.icon}</span>
                        <span className="dna-trait-label">{trait.label}</span>
                        <span className="dna-trait-value">{trait.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {traits.length === 0 && (
                <p className="field-hint">{t('dna.traitsHint')}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

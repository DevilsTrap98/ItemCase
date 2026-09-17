import React, { useMemo } from 'react';
import { useI18n } from './i18n.jsx';
import { levelFromXp } from './collectorLevel.js';

const ACHIEVEMENT_DEFS = [
  { id: 'firstItem', icon: '🎉', check: (s) => s.uniqueItems >= 1 },
  { id: 'items10', icon: '📦', check: (s) => s.totalItems >= 10 },
  { id: 'items50', icon: '🗂️', check: (s) => s.totalItems >= 50 },
  { id: 'items100', icon: '🏛️', check: (s) => s.totalItems >= 100 },
  { id: 'items500', icon: '👑', check: (s) => s.totalItems >= 500 },
  { id: 'categories3', icon: '🎨', check: (s) => s.categoryCount >= 3 },
  { id: 'photos5', icon: '📸', check: (s) => s.itemsWithImages >= 5 },
  { id: 'completeSet', icon: '🏆', check: (s) => s.hasCompleteSet }
];

export default function CollectorLevel({ items, categories, categoryTargets, onClose }) {
  const { lang, t } = useI18n();

  const stats = useMemo(() => {
    const totalItems = items.reduce((sum, i) => sum + (Number(i.quantity) || 1), 0);
    const uniqueItems = items.length;
    const categoryCount = categories.length;
    const itemsWithImages = items.filter((i) => i.imagePath).length;
    const totalValue = items.reduce((sum, i) => sum + (Number(i.value) || 0) * (Number(i.quantity) || 1), 0);
    const totalProfit = items.reduce((sum, i) => {
      const purchase = Number(i.purchasePrice) || 0;
      const value = Number(i.value) || 0;
      const qty = Number(i.quantity) || 1;
      return sum + (value - purchase) * qty;
    }, 0);

    const setProgress = categories
      .filter((cat) => categoryTargets[cat] > 0)
      .map((cat) => {
        const count = items
          .filter((i) => i.category === cat)
          .reduce((sum, i) => sum + (Number(i.quantity) || 1), 0);
        const target = categoryTargets[cat];
        const pct = Math.min(100, (count / target) * 100);
        return { category: cat, count, target, pct };
      });

    const hasCompleteSet = setProgress.some((s) => s.pct >= 100);

    return { totalItems, uniqueItems, categoryCount, itemsWithImages, totalValue, totalProfit, setProgress, hasCompleteSet };
  }, [items, categories, categoryTargets]);

  const xp = stats.totalItems * 10 + stats.categoryCount * 15 + stats.itemsWithImages * 5;
  const { level, currentFloor, nextCeil } = levelFromXp(xp);
  const levelProgressPct = Math.min(100, ((xp - currentFloor) / (nextCeil - currentFloor)) * 100);

  const currencyFmt = (n) => n.toLocaleString(lang === 'en' ? 'en-US' : 'de-DE', { style: 'currency', currency: 'EUR' });
  const approxCurrencyFmt = (n) => `~${Math.round(n).toLocaleString(lang === 'en' ? 'en-US' : 'de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal level-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>🏆 {t('level.title')}</h2>
          <button className="icon-btn" onClick={onClose} title="✕">✕</button>
        </div>

        <div className="level-content">
          <div className="level-hero">
            <div className="level-badge">{level}</div>
            <div className="level-hero-info">
              <div className="level-hero-label">{t('level.level')} {level}</div>
              <div className="level-bar">
                <div className="level-bar-fill" style={{ width: `${levelProgressPct}%` }} />
              </div>
              <div className="level-hero-sub">{nextCeil - xp} XP {t('level.xpToNext')}</div>
            </div>
          </div>

          <div className="level-stats-row">
            <div className="level-stat">
              <span className="stat-value">{stats.totalItems}</span>
              <span className="stat-label">{t('sidebar.totalItems')}</span>
            </div>
            <div className="level-stat">
              <span className="stat-value">{currencyFmt(stats.totalValue)}</span>
              <span className="stat-label">{t('sidebar.totalValue')}</span>
            </div>
            <div className="level-stat">
              <span className={stats.totalProfit >= 0 ? 'stat-value positive' : 'stat-value negative'}>
                {stats.totalProfit >= 0 ? '+' : ''}{approxCurrencyFmt(stats.totalProfit)}
              </span>
              <span className="stat-label">{t('level.totalProfit')}</span>
              <span className="stat-hint">{t('level.totalProfitEstimate')}</span>
            </div>
          </div>

          <h3 className="level-section-title">{t('level.achievements')}</h3>
          <div className="achievement-grid">
            {ACHIEVEMENT_DEFS.map((a) => {
              const unlocked = a.check(stats);
              return (
                <div key={a.id} className={unlocked ? 'achievement-badge unlocked' : 'achievement-badge'}>
                  <div className="achievement-icon">{a.icon}</div>
                  <div className="achievement-title">{t(`achievement.${a.id}.title`)}</div>
                  <div className="achievement-desc">{t(`achievement.${a.id}.desc`)}</div>
                </div>
              );
            })}
          </div>

          <h3 className="level-section-title">{t('level.setsProgress')}</h3>
          {stats.setProgress.length === 0 ? (
            <p className="field-hint">{t('level.noTargets')}</p>
          ) : (
            <div className="set-progress-list">
              {stats.setProgress.map((s) => (
                <div key={s.category} className="set-progress-row">
                  <div className="set-progress-header">
                    <span>{s.category}</span>
                    <span>{s.count} / {s.target} · {s.pct.toFixed(1)}% {t('level.complete')}</span>
                  </div>
                  <div className="level-bar">
                    <div className="level-bar-fill" style={{ width: `${s.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

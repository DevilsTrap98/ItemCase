import React, { useEffect, useMemo, useState } from 'react';
import { useI18n } from './i18n.jsx';
const REWARD_DURATION_LABEL = { 25: '1 Woche', 50: '3 Wochen', 100: '4 Wochen' };
const LAST_SEEN_LEVEL_KEY = 'itemcase_last_seen_collector_level';

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

  // The Sammlerlevel is one thing, server-computed from confirmed Community-
  // Katalog-Beitrags-XP (server/src/utils/collectorXp.js) — this is also
  // what Sammlungsplätze and Pro+-Belohnungen are based on. No separate,
  // differently-named level anywhere else in the app.
  const [progress, setProgress] = useState(null);
  const [rewards, setRewards] = useState([]);
  const [leveledUp, setLeveledUp] = useState(false);
  const [busyRewardId, setBusyRewardId] = useState(null);
  const [rewardError, setRewardError] = useState('');

  const load = () => {
    window.api.getCollectorProgress?.().then((p) => {
      if (!p) return;
      setProgress(p);
      try {
        const lastSeen = Number(localStorage.getItem(LAST_SEEN_LEVEL_KEY) || 0);
        if (p.collectorLevel > lastSeen) setLeveledUp(true);
        localStorage.setItem(LAST_SEEN_LEVEL_KEY, String(p.collectorLevel));
      } catch (e) { /* ignore */ }
    });
    window.api.getMyRewards?.().then((r) => setRewards(r || []));
  };
  useEffect(load, []);

  const activateReward = async (rewardId) => {
    setBusyRewardId(rewardId);
    setRewardError('');
    const res = await window.api.activateReward(rewardId);
    setBusyRewardId(null);
    if (!res?.ok) { setRewardError(res?.error || 'Aktivierung fehlgeschlagen.'); return; }
    load();
  };

  const stats = useMemo(() => {
    const totalItems = items.reduce((sum, i) => sum + (Number(i.quantity) || 1), 0);
    const uniqueItems = items.length;
    const categoryCount = categories.length;
    const itemsWithImages = items.filter((i) => i.imagePath).length;
    const totalValue = items.reduce((sum, i) => sum + (Number(i.value) || 0) * (Number(i.quantity) || 1), 0);

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

    return { totalItems, uniqueItems, categoryCount, itemsWithImages, totalValue, setProgress, hasCompleteSet };
  }, [items, categories, categoryTargets]);

  const currencyFmt = (n) => n.toLocaleString(lang === 'en' ? 'en-US' : 'de-DE', { style: 'currency', currency: 'EUR' });

  const serverLevel = progress?.collectorLevel ?? 0;
  const xpIntoLevel = progress?.xpIntoCurrentLevel ?? 0;
  const xpPerLevel = progress?.xpPerLevel ?? 50;
  const levelProgressPct = Math.min(100, (xpIntoLevel / xpPerLevel) * 100);
  const availableRewards = rewards.filter((r) => r.status === 'Available');
  const otherRewards = rewards.filter((r) => r.status !== 'Available');
  const slotsCapped = (progress?.earnedCollectionSlots ?? 0) >= 100;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal level-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>🏆 {t('level.title')}</h2>
          <button className="icon-btn" onClick={onClose} title="✕">✕</button>
        </div>

        <div className="level-content">
          {leveledUp && (
            <div className="contribution-levelup" onClick={() => setLeveledUp(false)}>
              🎉 {t('catalog.levelUpBanner', { level: serverLevel })}
            </div>
          )}
          <div className="level-hero">
            <div className="level-badge">{serverLevel}</div>
            <div className="level-hero-info">
              <div className="level-hero-label">{t('level.level')} {serverLevel}</div>
              <div className="level-bar">
                <div className="level-bar-fill" style={{ width: `${levelProgressPct}%` }} />
              </div>
              <div className="level-hero-sub">{xpPerLevel - xpIntoLevel} XP {t('level.xpToNext')}</div>
            </div>
          </div>
          <p className="field-hint" style={{ marginTop: -6 }}>{t('level.earnedByContribution')}</p>

          {progress && (
            <div className="field-hint contribution-slots">
              {slotsCapped ? t('catalog.contribSlotsComplete') : t('catalog.contribSlots', { earned: progress.earnedCollectionSlots, limit: progress.effectiveFreeItemLimit })}
            </div>
          )}
          {progress?.proPlus?.active && (
            <div className="field-hint contribution-proplus-active">
              ⭐ {t('catalog.proPlusActiveUntil', { date: new Date(progress.proPlus.endsAt).toLocaleDateString('de-DE') })}
            </div>
          )}
          {progress?.pendingWithheldXp?.count > 0 && (
            <div className="contribution-withheld-notice">⏳ {t('catalog.withheldXpNotice', { xp: progress.pendingWithheldXp.totalAmount })}</div>
          )}

          {availableRewards.length > 0 && (
            <>
              <h3 className="level-section-title">{t('catalog.rewardsAvailableTitle')}</h3>
              {rewardError && <p className="field-hint cv-error">{rewardError}</p>}
              {availableRewards.map((r) => (
                <div className="admin-row" key={r.id}>
                  <div><strong>{t('catalog.rewardLevel', { level: r.reward_level })}</strong><small> · {REWARD_DURATION_LABEL[r.reward_level] || `${r.duration_days} Tage`} ItemCase Pro+</small></div>
                  <button type="button" className="btn-primary" disabled={busyRewardId === r.id} onClick={() => activateReward(r.id)}>{t('catalog.activateReward')}</button>
                </div>
              ))}
            </>
          )}
          {otherRewards.length > 0 && (
            <>
              <h3 className="level-section-title">{t('catalog.rewardsTitle')}</h3>
              {otherRewards.map((r) => (
                <div className="admin-row" key={r.id}>
                  <div><strong>{t('catalog.rewardLevel', { level: r.reward_level })}</strong></div>
                  <span className={`admin-status admin-status-${r.status}`}>{r.status}</span>
                </div>
              ))}
            </>
          )}

          <div className="level-stats-row">
            <div className="level-stat">
              <span className="stat-value">{stats.totalItems}</span>
              <span className="stat-label">{t('sidebar.totalItems')}</span>
            </div>
            <div className="level-stat">
              <span className="stat-value">{currencyFmt(stats.totalValue)}</span>
              <span className="stat-label">{t('sidebar.totalValue')}</span>
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

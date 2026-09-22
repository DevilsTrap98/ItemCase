import React, { useEffect, useState } from 'react';
import { useI18n } from './i18n.jsx';
import ReportModal from './ReportModal.jsx';

const CONDITION_CODES = ['NewSealed', 'LikeNew', 'VeryGood', 'Good', 'Used', 'Damaged'];

function money(v) {
  return v === null || v === undefined ? '–' : Number(v).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

// Shared everywhere a Community-Schätzwert is shown: the public catalog
// detail view and a private collection item's detail view. Both only ever
// display a value this component fetched from the server — nothing here
// computes an estimate itself (spec: "Der Client zeigt ausschließlich das
// gespeicherte Ergebnis").
export default function CommunityValueBox({ catalogItemId, initialCondition, isGuest, itemName }) {
  const { t } = useI18n();
  const [values, setValues] = useState(null);
  const [condition, setCondition] = useState(initialCondition && CONDITION_CODES.includes(initialCondition) ? initialCondition : '');
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState('');
  const [showHow, setShowHow] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    if (!catalogItemId) return;
    window.api.getCommunityValues(catalogItemId).then((data) => data && setValues(data));
  };
  useEffect(load, [catalogItemId]);

  if (!catalogItemId) return null;
  if (!values) return null;

  const current = condition ? values[condition] : null;

  const submit = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;
    setBusy(true);
    setError('');
    const res = await window.api.submitCommunityValueEstimate({ catalogItemId, conditionCode: condition, value });
    setBusy(false);
    if (!res?.ok) { setError(res?.error || t('cv.limitReached')); return; }
    setShowForm(false);
    setAmount('');
    load();
  };

  const withdraw = async () => {
    setBusy(true);
    await window.api.withdrawCommunityValueEstimate({ catalogItemId, conditionCode: condition });
    setBusy(false);
    load();
  };

  const confirm = async () => {
    setBusy(true);
    await window.api.confirmCommunityValueEstimate({ catalogItemId, conditionCode: condition });
    setBusy(false);
    load();
  };

  return (
    <div className="cv-box">
      <div className="cv-header">
        <h4>{t('cv.title')}</h4>
        <select value={condition} onChange={(e) => { setCondition(e.target.value); setShowForm(false); }}>
          <option value="">{t('cv.condition')}…</option>
          {CONDITION_CODES.map((c) => <option key={c} value={c}>{t(`cv.condition.${c}`)}</option>)}
        </select>
      </div>

      {!condition && <p className="field-hint">{t('cv.chooseCondition')}</p>}

      {condition && current && current.confidenceLevel === 'Insufficient' && (
        <p className="field-hint">{t('cv.confidence.Insufficient')}</p>
      )}

      {condition && current && current.confidenceLevel !== 'Insufficient' && (
        <div className="cv-result">
          <div className="cv-median">{money(current.medianValue)}</div>
          <div className="cv-range">{t('cv.range')}: {money(current.lowerValue)} – {money(current.upperValue)}</div>
          <div className="cv-meta">
            {current.estimateCount} {t('cv.estimates')} · {current.contributorCount} {t('cv.contributors')} · {t(`cv.confidence.${current.confidenceLevel}`)}
          </div>
        </div>
      )}

      {condition && <p className="cv-disclaimer field-hint">{t('cv.disclaimer')}</p>}

      {condition && !isGuest && (
        <div className="cv-actions">
          {!current?.myEstimate && !showForm && (
            <button type="button" className="btn-secondary" onClick={() => setShowForm(true)}>{t('cv.give')}</button>
          )}
          {current?.myEstimate && !showForm && (
            <div className="cv-mine">
              <span>{t('cv.yourEstimate')}: {money(current.myEstimate.value)}</span>
              <button type="button" className="btn-secondary" onClick={confirm} disabled={busy}>{t('cv.confirm')}</button>
              <button type="button" className="btn-secondary" onClick={() => { setAmount(String(current.myEstimate.value)); setShowForm(true); }}>{t('cv.change')}</button>
              <button type="button" className="btn-secondary" onClick={withdraw} disabled={busy}>{t('cv.withdraw')}</button>
            </div>
          )}
          {showForm && (
            <div className="cv-form">
              <p className="field-hint">{t('cv.submitHint')}</p>
              <input type="number" min="0" step="0.01" placeholder={t('cv.value')} value={amount} onChange={(e) => setAmount(e.target.value)} />
              {error && <p className="field-hint cv-error">{error}</p>}
              <div className="cv-form-actions">
                <button type="button" className="btn-primary" onClick={submit} disabled={busy}>{t('cv.submit')}</button>
                <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>✕</button>
              </div>
            </div>
          )}
          <button type="button" className="btn-secondary" onClick={() => setShowReport(true)}>🚩 {t('cv.report')}</button>
        </div>
      )}

      <button type="button" className="cv-how-link" onClick={() => setShowHow((v) => !v)}>{t('cv.howItWorks')}</button>
      {showHow && <p className="field-hint">{t('cv.howItWorksText')}</p>}

      {showReport && (
        <ReportModal
          targetName={itemName}
          onClose={() => setShowReport(false)}
          onSubmit={async (payload) => {
            await window.api.reportCatalogEntry({ targetType: 'community_value', targetId: `${catalogItemId}:${condition}`, targetName: itemName, ...payload });
            setShowReport(false);
          }}
        />
      )}
    </div>
  );
}

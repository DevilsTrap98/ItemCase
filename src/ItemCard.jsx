import React, { useEffect, useState } from 'react';
import { useI18n } from './i18n.jsx';
import useImagePath from './useImagePath.js';

const CONDITION_TONE = {
  mint: 'mint', nearMint: 'mint', excellent: 'teal', good: 'blue', played: 'amber', poor: 'red'
};

export default function ItemCard({ item, onEdit, onDelete, onUpdateValue, caseDesignSrc, readOnly }) {
  const { lang, t } = useI18n();
  const imgSrc = useImagePath(item.imagePath);
  const [menuOpen, setMenuOpen] = useState(false);

  const value = Number(item.value) || 0;
  const purchasePrice = Number(item.purchasePrice) || 0;
  const quantity = Number(item.quantity) || 1;
  const delta = (value - purchasePrice) * quantity;
  const currencyFmt = (n) => n.toLocaleString(lang === 'en' ? 'en-US' : 'de-DE', { style: 'currency', currency: 'EUR' });

  const [valueDraft, setValueDraft] = useState(String(item.value ?? ''));
  useEffect(() => { setValueDraft(String(item.value ?? '')); }, [item.value, item.id]);

  const commitValue = () => {
    const num = parseFloat(String(valueDraft).replace(',', '.'));
    if (!Number.isNaN(num) && num !== value) {
      onUpdateValue(item, num);
    } else {
      setValueDraft(String(value));
    }
  };

  return (
    <div className="card item-card-v2">
      <div className="card-image">
        {imgSrc ? (
          <img src={imgSrc} alt={item.name} />
        ) : (
          <div className="card-image-placeholder">{t('card.noImage')}</div>
        )}
        {caseDesignSrc && <img src={caseDesignSrc} alt="" className="card-case-overlay" />}
        {quantity > 1 && <span className="badge-qty">x{quantity}</span>}
        {item.showcase && <span className="badge-showcase">★ {t('card.showcaseBadge')}</span>}

        {!readOnly && (
          <div className="item-card-menu-wrap" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="item-card-menu-btn" onClick={() => setMenuOpen((v) => !v)} title={t('card.edit')}>⋮</button>
            {menuOpen && (
              <>
                <div className="item-card-menu-backdrop" onClick={() => setMenuOpen(false)} />
                <div className="item-card-menu">
                  <button type="button" onClick={() => { setMenuOpen(false); onEdit(item); }}>✎ {t('card.edit')}</button>
                  <button type="button" className="danger" onClick={() => { setMenuOpen(false); onDelete(item); }}>🗑 {t('card.delete')}</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <div className="card-body">
        <div className="item-card-title" title={item.name}>{item.name}</div>
        <div className="item-card-category">{item.category}</div>

        {(item.story?.isFirstPiece || item.story?.isGift) && (
          <div className="card-meta">
            {item.story?.isFirstPiece && <span className="chip chip-outline">🥇 {t('card.firstPiece')}</span>}
            {item.story?.isGift && <span className="chip chip-outline">🎁 {t('card.gift')}</span>}
          </div>
        )}
        {!readOnly && item.notes && <div className="card-notes">{item.notes}</div>}
        {readOnly && item.story?.text && (
          <div className="card-story">“{item.story.text}”</div>
        )}

        <div className="item-card-footer-row">
          {item.condition && (
            <span className={`condition-pill tone-${CONDITION_TONE[item.condition] || 'blue'}`}>
              {t(`condition.${item.condition}`)}
            </span>
          )}
          <span className="item-card-footer-spacer" />
          {readOnly ? (
            <span className="item-card-price">{currencyFmt(value)}</span>
          ) : (
            <div className="item-card-value-block">
              <label className="card-value-edit" onClick={(e) => e.stopPropagation()} title={t('card.currentValueHint')}>
                <span className="card-value-currency">€</span>
                <input
                  type="number"
                  step="0.01"
                  className="card-value-input"
                  value={valueDraft}
                  onChange={(e) => setValueDraft(e.target.value)}
                  onBlur={commitValue}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                />
              </label>
              {value > 0 && purchasePrice > 0 && delta !== 0 && (
                <span className={delta > 0 ? 'card-delta positive' : 'card-delta negative'}>
                  {delta > 0 ? '▲' : '▼'} {currencyFmt(Math.abs(delta))}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

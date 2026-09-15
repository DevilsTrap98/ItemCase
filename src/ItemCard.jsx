import React from 'react';
import { useI18n } from './i18n.jsx';
import useImagePath from './useImagePath.js';

function locationBreadcrumb(location) {
  if (!location) return '';
  return ['shelf', 'box', 'folder', 'page', 'slot']
    .map((key) => location[key])
    .filter(Boolean)
    .join(' › ');
}

export default function ItemCard({ item, onEdit, onDelete, readOnly }) {
  const { lang, t } = useI18n();
  const imgSrc = useImagePath(item.imagePath);

  const value = Number(item.value) || 0;
  const purchasePrice = Number(item.purchasePrice) || 0;
  const quantity = Number(item.quantity) || 1;
  const delta = (value - purchasePrice) * quantity;
  const breadcrumb = locationBreadcrumb(item.location);
  const currencyFmt = (n) => n.toLocaleString(lang === 'en' ? 'en-US' : 'de-DE', { style: 'currency', currency: 'EUR' });

  return (
    <div className="card">
      <div className="card-image">
        {imgSrc ? (
          <img src={imgSrc} alt={item.name} />
        ) : (
          <div className="card-image-placeholder">{t('card.noImage')}</div>
        )}
        {quantity > 1 && <span className="badge-qty">x{quantity}</span>}
        {item.showcase && <span className="badge-showcase">★ {t('card.showcaseBadge')}</span>}
      </div>
      <div className="card-body">
        <div className="card-title" title={item.name}>{item.name}</div>
        <div className="card-meta">
          <span className="chip">{item.category}</span>
          {item.condition && <span className="chip chip-outline">{t(`condition.${item.condition}`)}</span>}
          {item.story?.isFirstPiece && <span className="chip chip-outline">🥇 {t('card.firstPiece')}</span>}
          {item.story?.isGift && <span className="chip chip-outline">🎁 {t('card.gift')}</span>}
        </div>
        {!readOnly && breadcrumb && <div className="card-location" title={breadcrumb}>📍 {breadcrumb}</div>}
        {!readOnly && item.notes && <div className="card-notes">{item.notes}</div>}
        {readOnly && item.story?.text && (
          <div className="card-story">“{item.story.text}”</div>
        )}
        {readOnly ? (
          <div className="card-footer">
            <span className="card-value">{currencyFmt(value)}</span>
          </div>
        ) : (
          <div className="card-footer">
            <div className="card-value-block">
              <span className="card-value">{currencyFmt(value)}</span>
              {purchasePrice > 0 && delta !== 0 && (
                <span className={delta > 0 ? 'card-delta positive' : 'card-delta negative'}>
                  {delta > 0 ? '▲' : '▼'} {currencyFmt(Math.abs(delta))}
                </span>
              )}
            </div>
            <div className="card-actions">
              <button className="icon-btn" onClick={() => onEdit(item)} title={t('card.edit')}>✎</button>
              <button className="icon-btn danger" onClick={() => onDelete(item)} title={t('card.delete')}>🗑</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

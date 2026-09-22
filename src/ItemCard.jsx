import React, { useState } from 'react';
import { useI18n } from './i18n.jsx';
import useImagePath from './useImagePath.js';
import LogoPlaceholder from './LogoPlaceholder.jsx';

const CONDITION_TONE = {
  sealed: 'mint', mint: 'mint', nearMint: 'mint', excellent: 'teal', veryGood: 'teal', good: 'blue', incomplete: 'amber', played: 'amber', poor: 'red', damaged: 'red'
};

const STATUS_TONE = { duplicate: 'amber', tradable: 'teal', for_sale: 'blue', looking_for: 'red' };
const STATUS_ICON = { duplicate: '👯', tradable: '🔄', for_sale: '💰', looking_for: '🔎' };

export default function ItemCard({ item, onOpen, onEdit, onDelete, caseDesignSrc, readOnly }) {
  const { lang, t } = useI18n();
  const imgSrc = useImagePath(item.imagePath);
  const [menuOpen, setMenuOpen] = useState(false);

  const value = Number(item.value) || 0;
  const quantity = Number(item.quantity) || 1;
  const currencyFmt = (n) => n.toLocaleString(lang === 'en' ? 'en-US' : 'de-DE', { style: 'currency', currency: 'EUR' });

  return (
    <div className="card item-card-v2" role="button" tabIndex="0" onClick={() => onOpen?.(item)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpen?.(item); }}>
      <div className={caseDesignSrc ? 'card-image has-case-design' : 'card-image'}>
        {imgSrc ? (
          <img src={imgSrc} alt={item.name} className="card-artwork" />
        ) : (
          <div className="card-image-placeholder"><LogoPlaceholder compact={Boolean(caseDesignSrc)} /></div>
        )}
        {caseDesignSrc && <img src={caseDesignSrc} alt="" className="card-case-overlay" />}
        {quantity > 1 && <span className="badge-qty">x{quantity}</span>}
        {item.showcase && <span className="badge-showcase">★ {t('card.showcaseBadge')}</span>}
        {item.ownershipStatus && item.ownershipStatus !== 'keep' && (
          <span className={`condition-pill tone-${STATUS_TONE[item.ownershipStatus] || 'blue'} item-card-status-badge`}>
            {STATUS_ICON[item.ownershipStatus]} {t(`ownershipStatus.${item.ownershipStatus}`)}
          </span>
        )}

        {!readOnly && (
          <div className={menuOpen ? 'item-card-menu-wrap menu-open' : 'item-card-menu-wrap'} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="item-card-edit-btn" onClick={() => onEdit(item)} title={t('card.edit')} aria-label={t('card.edit')}>✎</button>
            <button type="button" className="item-card-menu-btn" onClick={() => setMenuOpen((v) => !v)} title={t('card.delete')}>⋮</button>
            {menuOpen && (
              <>
                <div className="item-card-menu-backdrop" onClick={() => setMenuOpen(false)} />
                <div className="item-card-menu">
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
          <span className="item-card-price">{currencyFmt(value)}</span>
        </div>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { useI18n } from './i18n.jsx';
import useImagePath from './useImagePath.js';
import { CASE_DESIGNS, CASE_DESIGN_IDS } from './theme-defaults.js';
import LogoPlaceholder from './LogoPlaceholder.jsx';
import CommunityValueBox from './CommunityValueBox.jsx';

const CV_CODES = ['NewSealed', 'LikeNew', 'VeryGood', 'Good', 'Used', 'Damaged'];

export default function ItemDetailModal({ item, categoryCaseDesign, isGuest, onSaveFrame, onEdit, onClose }) {
  const { lang, t } = useI18n();
  const imageSrc = useImagePath(item.imagePath);
  const [frame, setFrame] = useState(item.caseDesign || '');
  const [saving, setSaving] = useState(false);
  const effectiveFrame = frame || categoryCaseDesign || '';
  const currency = (value) => Number(value || 0).toLocaleString(lang === 'en' ? 'en-US' : 'de-DE', { style: 'currency', currency: 'EUR' });

  const chooseFrame = async (next) => {
    if (saving || next === frame) return;
    const previous = frame;
    setFrame(next);
    setSaving(true);
    try { await onSaveFrame(next); } catch (error) { setFrame(previous); } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay item-detail-overlay">
      <div className="modal modal-xwide item-detail-modal">
        <button type="button" className="icon-btn item-detail-close" onClick={onClose} aria-label={t('itemDetail.close')}>✕</button>
        <div className="item-detail-layout">
          <div className="item-detail-visual">
            <div className={effectiveFrame ? 'item-detail-image has-case-design' : 'item-detail-image'}>
              {imageSrc ? <img src={imageSrc} alt={item.name} className="item-detail-artwork" /> : <div className="card-image-placeholder"><LogoPlaceholder compact={Boolean(effectiveFrame)} /></div>}
              {effectiveFrame && <img src={CASE_DESIGNS[effectiveFrame]} alt="" className="item-detail-case-overlay" />}
            </div>
          </div>

          <div className="item-detail-content">
            <span className="item-detail-category">{item.category}</span>
            <h2>{item.name}</h2>
            <div className="item-detail-facts">
              <div><span>{t('itemDetail.condition')}</span><strong>{item.condition ? t(`condition.${item.condition}`) : '—'}</strong></div>
              <div><span>{t('itemDetail.quantity')}</span><strong>{Number(item.quantity) || 1}</strong></div>
              <div><span>{t('itemDetail.value')}</span><strong>{currency(item.value)}</strong></div>
              <div><span>{t('itemDetail.purchasePrice')}</span><strong>{currency(item.purchasePrice)}</strong></div>
              <div><span>{t('itemDetail.status')}</span><strong>{t(`ownershipStatus.${item.ownershipStatus || 'keep'}`)}</strong></div>
              {item.catalogInfo?.brand && <div><span>{t('form.catalogBrand')}</span><strong>{item.catalogInfo.brand}</strong></div>}
              {item.catalogInfo?.releaseYear && <div><span>{t('form.catalogReleaseYear')}</span><strong>{item.catalogInfo.releaseYear}</strong></div>}
              {item.catalogInfo?.manufacturerNumber && <div><span>{t('form.catalogManufacturerNumber')}</span><strong>{item.catalogInfo.manufacturerNumber}</strong></div>}
            </div>

            {item.catalogItemId && (
              <CommunityValueBox
                catalogItemId={item.catalogItemId}
                initialCondition={CV_CODES.find((c) => c.toLowerCase() === String(item.condition || '').toLowerCase()) || ''}
                isGuest={isGuest}
                itemName={item.name}
              />
            )}

            {(item.story?.place || item.story?.date || item.story?.text || item.story?.isGift || item.story?.isFirstPiece) && (
              <section className="item-detail-story">
                <h3>{t('itemDetail.story')}</h3>
                <div>{[item.story?.place, item.story?.date].filter(Boolean).join(' · ')}</div>
                {(item.story?.isGift || item.story?.isFirstPiece) && <div>{item.story.isGift ? '🎁 ' : ''}{item.story.isFirstPiece ? '🥇' : ''}</div>}
                {item.story?.text && <p>“{item.story.text}”</p>}
              </section>
            )}

            <section className="item-detail-frames">
              <div className="item-detail-section-head">
                <div><h3>{t('itemDetail.frame')}</h3><p>{t('itemDetail.frameHint')}</p></div>
                {saving && <span>{t('itemDetail.saving')}</span>}
              </div>
              <div className="item-frame-picker">
                <button type="button" disabled={saving} className={!frame ? 'item-frame-option active' : 'item-frame-option'} onClick={() => chooseFrame('')}>
                  <span className="item-frame-none">↩</span><small>{t('itemDetail.categoryDefault')}</small>
                </button>
                {CASE_DESIGN_IDS.map((id) => (
                  <button type="button" disabled={saving} key={id} className={frame === id ? 'item-frame-option active' : 'item-frame-option'} onClick={() => chooseFrame(id)}>
                    <span style={{ backgroundImage: `url(${CASE_DESIGNS[id]})` }} /><small>{t(`catFields.caseDesign.${id}`)}</small>
                  </button>
                ))}
              </div>
            </section>

            <div className="modal-actions item-detail-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>{t('itemDetail.close')}</button>
              <button type="button" className="btn-primary" onClick={onEdit}>✎ {t('itemDetail.edit')}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { useI18n } from './i18n.jsx';
import { TERMS_SECTIONS, TERMS_LAST_UPDATED, PRIVACY_SECTIONS, PRIVACY_LAST_UPDATED } from './legal-content.js';

export default function LegalModal({ onClose, initialTab = 'terms' }) {
  const { t } = useI18n();
  const [tab, setTab] = useState(initialTab);
  const sections = tab === 'terms' ? TERMS_SECTIONS : PRIVACY_SECTIONS;
  const lastUpdated = tab === 'terms' ? TERMS_LAST_UPDATED : PRIVACY_LAST_UPDATED;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal legal-modal" onClick={(e) => e.stopPropagation()}>
        <div className="legal-modal-header">
          <div>
            <h2 className="legal-modal-title">{tab === 'terms' ? '📜' : '🔒'} {tab === 'terms' ? t('legal.title') : t('legal.privacyTitle')}</h2>
            <p className="field-hint legal-modal-updated">{t('legal.lastUpdated', { date: lastUpdated })}</p>
          </div>
          <button type="button" className="icon-btn catalog-close-btn" onClick={onClose} title={t('catalog.close')}>✕</button>
        </div>

        <div className="legal-modal-tabs">
          <button type="button" className={tab === 'terms' ? 'active' : ''} onClick={() => setTab('terms')}>{t('legal.tabTerms')}</button>
          <button type="button" className={tab === 'privacy' ? 'active' : ''} onClick={() => setTab('privacy')}>{t('legal.tabPrivacy')}</button>
        </div>

        <div className="legal-modal-body">
          {tab === 'terms' && <p className="field-hint legal-placeholder-note">{t('legal.placeholderNote')}</p>}

          {sections.map((section) => (
            <section key={section.title} className="legal-section">
              <h3>{section.title}</h3>
              {section.body.map((block, i) =>
                Array.isArray(block) ? (
                  <ul key={i}>
                    {block.map((item, j) => <li key={j}>{item}</li>)}
                  </ul>
                ) : (
                  <p key={i}>{block}</p>
                )
              )}
            </section>
          ))}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-primary" onClick={onClose}>{t('catalog.close')}</button>
        </div>
      </div>
    </div>
  );
}

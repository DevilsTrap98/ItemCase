import React from 'react';
import { useI18n } from './i18n.jsx';
import { TERMS_SECTIONS, TERMS_LAST_UPDATED } from './legal-content.js';

export default function LegalModal({ onClose }) {
  const { t } = useI18n();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal legal-modal" onClick={(e) => e.stopPropagation()}>
        <div className="legal-modal-header">
          <div>
            <h2 className="legal-modal-title">📜 {t('legal.title')}</h2>
            <p className="field-hint legal-modal-updated">{t('legal.lastUpdated', { date: TERMS_LAST_UPDATED })}</p>
          </div>
          <button type="button" className="icon-btn catalog-close-btn" onClick={onClose} title={t('catalog.close')}>✕</button>
        </div>

        <div className="legal-modal-body">
          <p className="field-hint legal-placeholder-note">{t('legal.placeholderNote')}</p>

          {TERMS_SECTIONS.map((section) => (
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

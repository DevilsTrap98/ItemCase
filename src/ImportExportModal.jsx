import React from 'react';
import { useI18n } from './i18n.jsx';

// Reduced to the two actions that actually matter: importing from an
// arbitrary spreadsheet (the smart import handles column-mapping/dedup
// itself) and a full backup export. The ZIP-import, CSV-import/export and
// PDF-report options were removed on request to declutter this modal.
export default function ImportExportModal({ onExportZip, onSmartImport, onClose }) {
  const { t } = useI18n();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t('ie.title')}</h2>

        <div className="form-fieldset" style={{ marginBottom: 14 }}>
          <div className="ie-row-title">🧠 {t('ie.smartTitle')}</div>
          <p className="field-hint" style={{ marginTop: -4 }}>{t('ie.smartHint')}</p>
          <div className="ie-actions">
            <button type="button" className="ie-btn ie-btn-primary" onClick={onSmartImport}>
              <span className="ie-btn-icon">📂</span> {t('ie.smartAction')}
            </button>
          </div>
        </div>

        <div className="form-fieldset">
          <div className="ie-row-title">📦 {t('ie.zipTitle')}</div>
          <p className="field-hint" style={{ marginTop: -4 }}>{t('ie.zipHint')}</p>
          <div className="ie-actions">
            <button type="button" className="ie-btn ie-btn-primary" onClick={onExportZip}>
              <span className="ie-btn-icon">⬆️</span> {t('sidebar.export')}
            </button>
          </div>
        </div>

        <div className="modal-actions" style={{ marginTop: 14 }}>
          <button type="button" className="btn-secondary" onClick={onClose}>{t('feedback.cancel')}</button>
        </div>
      </div>
    </div>
  );
}

import React from 'react';
import { useI18n } from './i18n.jsx';

export default function ImportExportModal({ onExportZip, onImportZip, onExportCsv, onImportCsv, onClose }) {
  const { t } = useI18n();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t('ie.title')}</h2>

        <div className="form-fieldset" style={{ marginBottom: 14 }}>
          <div className="ie-row-title">📦 {t('ie.zipTitle')}</div>
          <p className="field-hint" style={{ marginTop: -4 }}>{t('ie.zipHint')}</p>
          <div className="ie-actions">
            <button type="button" className="ie-btn ie-btn-secondary" onClick={onImportZip}>
              <span className="ie-btn-icon">⬇️</span> {t('sidebar.import')}
            </button>
            <button type="button" className="ie-btn ie-btn-primary" onClick={onExportZip}>
              <span className="ie-btn-icon">⬆️</span> {t('sidebar.export')}
            </button>
          </div>
        </div>

        <div className="form-fieldset">
          <div className="ie-row-title">📄 {t('ie.csvTitle')}</div>
          <p className="field-hint" style={{ marginTop: -4 }}>{t('ie.csvHint')}</p>
          <div className="ie-actions">
            <button type="button" className="ie-btn ie-btn-secondary" onClick={onImportCsv}>
              <span className="ie-btn-icon">⬇️</span> {t('sidebar.importCsv')}
            </button>
            <button type="button" className="ie-btn ie-btn-primary" onClick={onExportCsv}>
              <span className="ie-btn-icon">⬆️</span> {t('sidebar.exportCsv')}
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

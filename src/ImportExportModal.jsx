import React, { useState } from 'react';
import { useI18n } from './i18n.jsx';

export default function ImportExportModal({ onExportZip, onImportZip, onExportCsv, onImportCsv, onSmartImport, categories, onClose }) {
  const { t } = useI18n();
  const [pdfScope, setPdfScope] = useState('all');
  const [pdfImages, setPdfImages] = useState(true);
  const [pdfPrices, setPdfPrices] = useState(true);
  const [pdfBusy, setPdfBusy] = useState(false);

  const handleExportPdf = async () => {
    setPdfBusy(true);
    await window.api.exportPdf({ scope: pdfScope, includeImages: pdfImages, includePrices: pdfPrices });
    setPdfBusy(false);
  };

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

        <div className="form-fieldset" style={{ marginTop: 14 }}>
          <div className="ie-row-title">🧾 {t('ie.pdfTitle')}</div>
          <p className="field-hint" style={{ marginTop: -4 }}>{t('ie.pdfHint')}</p>
          <div className="form-grid" style={{ marginBottom: 8 }}>
            <label>
              {t('ie.pdfScope')}
              <select value={pdfScope} onChange={(e) => setPdfScope(e.target.value)}>
                <option value="all">{t('collection.title')}</option>
                {(categories || []).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', gap: 20, marginBottom: 10 }}>
            <label className="checkbox-row">
              <input type="checkbox" checked={pdfImages} onChange={(e) => setPdfImages(e.target.checked)} />
              {t('ie.pdfImages')}
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={pdfPrices} onChange={(e) => setPdfPrices(e.target.checked)} />
              {t('ie.pdfPrices')}
            </label>
          </div>
          <div className="ie-actions">
            <button type="button" className="ie-btn ie-btn-primary" onClick={handleExportPdf} disabled={pdfBusy}>
              <span className="ie-btn-icon">⬆️</span> {pdfBusy ? t('wishlist.loading') : t('ie.pdfExport')}
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

import React, { useState } from 'react';
import { useI18n } from './i18n.jsx';

export default function CatalogPhotoModal({ entry, user, onSubmit, onClose }) {
  const { t } = useI18n();
  const [photoPath, setPhotoPath] = useState(null);
  const [preview, setPreview] = useState(null);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [error, setError] = useState('');

  const handlePick = async () => {
    const fileName = await window.api.pickImage();
    if (fileName) {
      setPhotoPath(fileName);
      const dataUrl = await window.api.getImagePath(fileName);
      setPreview(dataUrl);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!photoPath) {
      setError(t('catalog.addPhotoPickRequired'));
      return;
    }
    if (!rightsConfirmed) {
      setError(t('catalog.rightsRequired'));
      return;
    }
    setError('');
    await onSubmit({
      imagePath: photoPath,
      contributor: user?.name || user?.email || '',
      rightsConfirmed: true,
      licenseVersion: '1.0'
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal catalog-photo-modal" onClick={(e) => e.stopPropagation()}>
        <h2>📷 {t('catalog.addPhoto')}</h2>
        <div className="catalog-photo-modal-target">{entry.name}</div>
        <p className="field-hint" style={{ marginTop: 0 }}>{t('catalog.addPhotoHint')}</p>

        <form className="form" onSubmit={handleSubmit}>
          <div className="image-picker catalog-photo-modal-picker" onClick={handlePick}>
            {preview ? <img src={preview} alt="preview" /> : <span>📷<br />{t('catalog.submitImage')}</span>}
          </div>

          <div className="catalog-rights-box">
            <span className="catalog-rights-icon">🔒</span>
            <label className="checkbox-row catalog-rights-label">
              <input
                type="checkbox"
                checked={rightsConfirmed}
                onChange={(e) => { setRightsConfirmed(e.target.checked); setError(''); }}
              />
              {t('catalog.rightsConfirm')}
            </label>
          </div>
          {error && <p className="field-hint catalog-error">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>{t('catalog.addPhotoCancel')}</button>
            <button type="submit" className="btn-primary">{t('catalog.addPhotoSubmit')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

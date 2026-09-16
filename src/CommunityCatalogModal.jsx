import React, { useState } from 'react';
import { useI18n } from './i18n.jsx';

const emptySubmission = {
  name: '',
  category: '',
  brand: '',
  releaseYear: '',
  ean: '',
  isbn: '',
  manufacturerNumber: '',
  imagePath: null
};

export default function CommunityCatalogModal({ catalog, categories, user, onAdopt, onSubmit, onClose }) {
  const { t } = useI18n();
  const [tab, setTab] = useState('browse');
  const [search, setSearch] = useState('');
  const [adoptedIds, setAdoptedIds] = useState([]);
  const [form, setForm] = useState(emptySubmission);
  const [imgPreview, setImgPreview] = useState(null);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const update = (field, val) => setForm((f) => ({ ...f, [field]: val }));

  const filtered = catalog.filter((entry) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return entry.name.toLowerCase().includes(q) || (entry.brand || '').toLowerCase().includes(q);
  });

  const handleAdopt = (entry) => {
    onAdopt(entry);
    setAdoptedIds((ids) => [...ids, entry.id]);
  };

  const handlePickImage = async () => {
    const fileName = await window.api.pickImage();
    if (fileName) {
      update('imagePath', fileName);
      const dataUrl = await window.api.getImagePath(fileName);
      setImgPreview(dataUrl);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (!rightsConfirmed) {
      setError(t('catalog.rightsRequired'));
      return;
    }
    setError('');
    await onSubmit({
      ...form,
      contributor: user?.name || user?.email || '',
      rightsConfirmed: true,
      licenseVersion: '1.0'
    });
    setForm(emptySubmission);
    setImgPreview(null);
    setRightsConfirmed(false);
    setSubmitted(true);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>📚 {t('catalog.title')}</h2>
        <p className="field-hint" style={{ marginTop: 0 }}>{t('catalog.localNotice')}</p>

        <div className="catalog-tabs">
          <button
            type="button"
            className={tab === 'browse' ? 'catalog-tab active' : 'catalog-tab'}
            onClick={() => setTab('browse')}
          >
            {t('catalog.tabBrowse')}
          </button>
          <button
            type="button"
            className={tab === 'submit' ? 'catalog-tab active' : 'catalog-tab'}
            onClick={() => { setTab('submit'); setSubmitted(false); }}
          >
            {t('catalog.tabSubmit')}
          </button>
        </div>

        {tab === 'browse' && (
          <div>
            <input
              type="text"
              className="search-input"
              style={{ width: '100%', marginBottom: 12 }}
              placeholder={t('catalog.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {filtered.length === 0 && <p className="field-hint">{t('catalog.empty')}</p>}
            <div className="catalog-list">
              {filtered.map((entry) => (
                <div key={entry.id} className="catalog-entry">
                  <div className="catalog-entry-main">
                    <div className="catalog-entry-title">{entry.name}</div>
                    <div className="catalog-entry-meta">
                      {entry.brand && <span className="chip chip-outline">{entry.brand}</span>}
                      {entry.category && <span className="chip chip-outline">{entry.category}</span>}
                      {entry.releaseYear && <span className="chip chip-outline">{entry.releaseYear}</span>}
                      <span className={entry.status === 'approved' ? 'chip catalog-status-approved' : 'chip catalog-status-pending'}>
                        {entry.status === 'approved' ? t('catalog.statusApproved') : t('catalog.statusPending')}
                      </span>
                    </div>
                    {entry.contributor && (
                      <div className="field-hint" style={{ marginTop: 4 }}>
                        {t('catalog.submittedBy', { name: entry.contributor })}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={adoptedIds.includes(entry.id)}
                    onClick={() => handleAdopt(entry)}
                  >
                    {adoptedIds.includes(entry.id) ? t('catalog.adopted') : t('catalog.adopt')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'submit' && (
          <form className="form" onSubmit={handleSubmit}>
            <p className="field-hint" style={{ marginTop: 0 }}>{t('catalog.submitHint')}</p>
            {submitted && <p className="field-hint catalog-success">{t('catalog.submitSuccess')}</p>}

            <div className="form-row">
              <div className="image-picker" onClick={handlePickImage}>
                {imgPreview ? <img src={imgPreview} alt="preview" /> : <span>{t('catalog.submitImage')}</span>}
              </div>
              <div className="form-fields">
                <label>
                  {t('catalog.submitName')}
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => update('name', e.target.value)}
                    required
                  />
                </label>
                <label>
                  {t('catalog.submitCategory')}
                  <input
                    type="text"
                    list="catalog-category-list"
                    value={form.category}
                    onChange={(e) => update('category', e.target.value)}
                  />
                  <datalist id="catalog-category-list">
                    {categories.map((c) => <option key={c} value={c} />)}
                  </datalist>
                </label>
              </div>
            </div>

            <div className="form-grid">
              <label>
                {t('catalog.submitBrand')}
                <input type="text" value={form.brand} onChange={(e) => update('brand', e.target.value)} />
              </label>
              <label>
                {t('catalog.submitReleaseYear')}
                <input type="number" value={form.releaseYear} onChange={(e) => update('releaseYear', e.target.value)} />
              </label>
              <label>
                {t('catalog.submitEan')}
                <input type="text" value={form.ean} onChange={(e) => update('ean', e.target.value)} />
              </label>
              <label>
                {t('catalog.submitIsbn')}
                <input type="text" value={form.isbn} onChange={(e) => update('isbn', e.target.value)} />
              </label>
              <label>
                {t('catalog.submitManufacturerNumber')}
                <input type="text" value={form.manufacturerNumber} onChange={(e) => update('manufacturerNumber', e.target.value)} />
              </label>
            </div>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={rightsConfirmed}
                onChange={(e) => { setRightsConfirmed(e.target.checked); setError(''); }}
              />
              {t('catalog.rightsConfirm')}
            </label>
            {error && <p className="field-hint catalog-error">{error}</p>}

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>{t('catalog.close')}</button>
              <button type="submit" className="btn-primary">{t('catalog.submitAction')}</button>
            </div>
          </form>
        )}

        {tab === 'browse' && (
          <div className="modal-actions" style={{ marginTop: 14 }}>
            <button type="button" className="btn-secondary" onClick={onClose}>{t('catalog.close')}</button>
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useMemo, useState } from 'react';
import { useI18n } from './i18n.jsx';
import useImagePath from './useImagePath.js';
import CatalogPhotoModal from './CatalogPhotoModal.jsx';

const ALL_CAT = '__all__';

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

function CatalogCard({ entry, onAdopt, adopted, onOpenPhotoForm, photoSubmitted, t }) {
  const imgSrc = useImagePath(entry.imagePath);

  return (
    <div className="card catalog-card">
      <div className="card-image">
        {imgSrc ? <img src={imgSrc} alt={entry.name} /> : <div className="card-image-placeholder">📦</div>}
        <span className={entry.status === 'approved' ? 'catalog-status-pill approved' : 'catalog-status-pill pending'}>
          {entry.status === 'approved' ? t('catalog.statusApproved') : t('catalog.statusPending')}
        </span>
      </div>
      <div className="card-body">
        <div className="card-title" title={entry.name}>{entry.name}</div>
        <div className="card-meta">
          {entry.brand && <span className="chip chip-outline">{entry.brand}</span>}
          {entry.category && <span className="chip chip-outline">{entry.category}</span>}
          {entry.releaseYear && <span className="chip chip-outline">{entry.releaseYear}</span>}
        </div>
        {entry.contributor && (
          <div className="card-notes">{t('catalog.submittedBy', { name: entry.contributor })}</div>
        )}

        {!entry.imagePath && !photoSubmitted && (
          <button type="button" className="link-btn catalog-add-photo-link" onClick={() => onOpenPhotoForm(entry)}>
            📷 {t('catalog.addPhoto')}
          </button>
        )}

        {!entry.imagePath && photoSubmitted && (
          <p className="field-hint catalog-success">{t('catalog.addPhotoSubmitted')}</p>
        )}

        <div className="card-footer">
          <button
            type="button"
            className="btn-primary catalog-adopt-btn"
            disabled={adopted}
            onClick={() => onAdopt(entry)}
          >
            {adopted ? t('catalog.adopted') : t('catalog.adopt')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CommunityCatalogModal({ catalog, catalogCategories, items, user, onAdopt, onSubmit, onProposePhoto, onProposeCategory, onClose }) {
  const { t } = useI18n();
  const [tab, setTab] = useState('browse');
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState(ALL_CAT);
  const [adoptedIds, setAdoptedIds] = useState([]);
  const [form, setForm] = useState(emptySubmission);
  const [imgPreview, setImgPreview] = useState(null);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [imageRightsConfirmed, setImageRightsConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [photoContributeEntry, setPhotoContributeEntry] = useState(null);
  const [photoSubmittedIds, setPhotoSubmittedIds] = useState([]);
  const [selectedItemId, setSelectedItemId] = useState('');

  const update = (field, val) => setForm((f) => ({ ...f, [field]: val }));

  const handleSelectOwnItem = async (itemId) => {
    setSelectedItemId(itemId);
    if (!itemId) return;
    const item = (items || []).find((i) => i.id === itemId);
    if (!item) return;
    const info = item.catalogInfo || {};
    setForm({
      name: item.name || '',
      category: item.category || '',
      brand: info.brand || '',
      releaseYear: info.releaseYear || '',
      ean: info.ean || '',
      isbn: info.isbn || '',
      manufacturerNumber: info.manufacturerNumber || '',
      imagePath: item.imagePath || null
    });
    if (item.imagePath) {
      const dataUrl = await window.api.getImagePath(item.imagePath);
      setImgPreview(dataUrl);
    } else {
      setImgPreview(null);
    }
    setImageRightsConfirmed(false);
  };

  const filterCategories = useMemo(() => {
    const set = new Set();
    catalog.forEach((entry) => { if (entry.category) set.add(entry.category); });
    (catalogCategories || []).forEach((cat) => set.add(cat));
    return Array.from(set).sort();
  }, [catalog, catalogCategories]);

  const handleProposeCategorySubmit = (e) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    onProposeCategory(newCategoryName);
    setNewCategoryName('');
    setShowCategoryForm(false);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog.filter((entry) => {
      if (activeCat !== ALL_CAT && entry.category !== activeCat) return false;
      if (!q) return true;
      return entry.name.toLowerCase().includes(q) || (entry.brand || '').toLowerCase().includes(q);
    });
  }, [catalog, search, activeCat]);

  const handleAdopt = (entry) => {
    onAdopt(entry);
    setAdoptedIds((ids) => [...ids, entry.id]);
  };

  const handlePhotoSubmit = async (payload) => {
    await onProposePhoto(photoContributeEntry, payload);
    setPhotoSubmittedIds((ids) => [...ids, photoContributeEntry.id]);
    setPhotoContributeEntry(null);
  };

  const handlePickImage = async () => {
    const fileName = await window.api.pickImage();
    if (fileName) {
      update('imagePath', fileName);
      const dataUrl = await window.api.getImagePath(fileName);
      setImgPreview(dataUrl);
      setImageRightsConfirmed(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (!rightsConfirmed) {
      setError(t('catalog.rightsRequired'));
      return;
    }
    if (form.imagePath && !imageRightsConfirmed) {
      setError(t('catalog.imageRightsRequired'));
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
    setImageRightsConfirmed(false);
    setSelectedItemId('');
    setSubmitted(true);
  };

  return (
    <>
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal catalog-modal" onClick={(e) => e.stopPropagation()}>
        <div className="catalog-modal-header">
          <div>
            <h2 className="catalog-modal-title">📚 {t('catalog.title')}</h2>
            <p className="field-hint catalog-header-hint">{t('catalog.localNotice')}</p>
          </div>
          <button type="button" className="icon-btn catalog-close-btn" onClick={onClose} title={t('catalog.close')}>✕</button>
        </div>

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

        <div className="catalog-modal-body">
          {tab === 'browse' && (
            <>
              <div className="catalog-filter-bar">
                <input
                  type="text"
                  className="search-input catalog-search"
                  placeholder={t('catalog.searchPlaceholder')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="catalog-category-chips">
                  <button
                    type="button"
                    className={activeCat === ALL_CAT ? 'catalog-chip active' : 'catalog-chip'}
                    onClick={() => setActiveCat(ALL_CAT)}
                  >
                    {t('sidebar.all')}
                  </button>
                  {filterCategories.map((cat) => (
                    <button
                      type="button"
                      key={cat}
                      className={activeCat === cat ? 'catalog-chip active' : 'catalog-chip'}
                      onClick={() => setActiveCat(cat)}
                    >
                      {cat}
                    </button>
                  ))}
                  {!showCategoryForm && (
                    <button type="button" className="catalog-chip catalog-chip-add" onClick={() => setShowCategoryForm(true)}>
                      + {t('catalog.proposeCategory')}
                    </button>
                  )}
                  {showCategoryForm && (
                    <form className="catalog-propose-category-form" onSubmit={handleProposeCategorySubmit}>
                      <input
                        type="text"
                        autoFocus
                        className="catalog-propose-category-input"
                        placeholder={t('catalog.proposeCategoryPlaceholder')}
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') { setShowCategoryForm(false); setNewCategoryName(''); } }}
                      />
                      <button type="submit" className="btn-primary catalog-propose-category-btn">{t('catalog.proposeCategoryAction')}</button>
                      <button type="button" className="btn-secondary catalog-propose-category-btn" onClick={() => { setShowCategoryForm(false); setNewCategoryName(''); }}>{t('catalog.proposeCategoryCancel')}</button>
                    </form>
                  )}
                </div>
              </div>

              {filtered.length === 0 ? (
                <div className="empty-state catalog-empty-state">
                  <p>{t('catalog.empty')}</p>
                </div>
              ) : (
                <div className="grid catalog-grid">
                  {filtered.map((entry) => (
                    <CatalogCard
                      key={entry.id}
                      entry={entry}
                      adopted={adoptedIds.includes(entry.id)}
                      onAdopt={handleAdopt}
                      onOpenPhotoForm={setPhotoContributeEntry}
                      photoSubmitted={photoSubmittedIds.includes(entry.id)}
                      t={t}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'submit' && (
            <form className="form catalog-submit-form" onSubmit={handleSubmit}>
              <p className="field-hint" style={{ marginTop: 0 }}>{t('catalog.submitHint')}</p>
              {submitted && <p className="field-hint catalog-success">{t('catalog.submitSuccess')}</p>}

              {items && items.length > 0 && (
                <label>
                  {t('catalog.submitFromItem')}
                  <select value={selectedItemId} onChange={(e) => handleSelectOwnItem(e.target.value)}>
                    <option value="">{t('catalog.submitFromItemBlank')}</option>
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>{item.name} ({item.category})</option>
                    ))}
                  </select>
                </label>
              )}

              <div className="form-row">
                <div className="image-picker catalog-image-picker" onClick={handlePickImage}>
                  {imgPreview ? <img src={imgPreview} alt="preview" /> : <span>📷<br />{t('catalog.submitImage')}</span>}
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
                      {filterCategories.map((c) => <option key={c} value={c} />)}
                    </datalist>
                  </label>
                </div>
              </div>

              <fieldset className="form-fieldset">
                <legend>🏷️ {t('form.catalogTitle')}</legend>
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
              </fieldset>

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

              {form.imagePath && (
                <div className="catalog-rights-box">
                  <span className="catalog-rights-icon">📷</span>
                  <label className="checkbox-row catalog-rights-label">
                    <input
                      type="checkbox"
                      checked={imageRightsConfirmed}
                      onChange={(e) => { setImageRightsConfirmed(e.target.checked); setError(''); }}
                    />
                    {t('catalog.imageRightsConfirm')}
                  </label>
                </div>
              )}
              {error && <p className="field-hint catalog-error">{error}</p>}

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={onClose}>{t('catalog.close')}</button>
                <button type="submit" className="btn-primary">{t('catalog.submitAction')}</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>

    {photoContributeEntry && (
      <CatalogPhotoModal
        entry={photoContributeEntry}
        user={user}
        onSubmit={handlePhotoSubmit}
        onClose={() => setPhotoContributeEntry(null)}
      />
    )}
    </>
  );
}

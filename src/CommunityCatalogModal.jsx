import React, { useEffect, useMemo, useState } from 'react';
import { useI18n } from './i18n.jsx';
import useImagePath from './useImagePath.js';
import CatalogPhotoModal from './CatalogPhotoModal.jsx';
import ReportModal from './ReportModal.jsx';
import CommunityValueBox from './CommunityValueBox.jsx';
import { SUGGESTED_CATEGORIES } from './category-defaults.js';
import TitleBar from './TitleBar.jsx';
import UiIcon from './UiIcon.jsx';
import LogoPlaceholder from './LogoPlaceholder.jsx';

const ALL_CAT = '__all__';
const CONDITION_ORDER = ['sealed', 'mint', 'nearMint', 'excellent', 'veryGood', 'good', 'incomplete', 'played', 'poor', 'damaged'];

const emptySubmission = {
  name: '',
  category: '',
  brand: '',
  releaseYear: '',
  ean: '',
  isbn: '',
  manufacturerNumber: '',
  imagePath: null,
  marketValue: '',
  conditionValues: {}
};

function CatalogDetailImage({ entry }) {
  const src = useImagePath(entry.imagePath);
  return (
    <div className="catalog-detail-image">
      {src ? <img src={src} alt={entry.name} /> : <LogoPlaceholder />}
    </div>
  );
}

function CatalogCard({ entry, onAdopt, adopted, onOpenPhotoForm, photoSubmitted, onOpenReport, onOpenDetails, t }) {
  const imgSrc = useImagePath(entry.imagePath);

  return (
    <article className="catalog-card" role="button" tabIndex="0" onClick={() => onOpenDetails(entry)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpenDetails(entry); }}>
      <div className="catalog-card-image">
        {imgSrc ? <img src={imgSrc} alt={entry.name} /> : <div className="catalog-card-placeholder"><LogoPlaceholder /></div>}
        <div className="catalog-card-shade" />
        {entry.category && <span className="catalog-card-category">{entry.category}</span>}
        <button type="button" className="catalog-card-report" title={t('report.action')} onClick={(e) => { e.stopPropagation(); onOpenReport(entry); }}><UiIcon name="flag" size={15} /></button>
      </div>
      <div className="catalog-card-body">
        <div className="catalog-card-title" title={entry.name}>{entry.name}</div>
        <div className="catalog-card-meta">
          {entry.brand && <span>{entry.brand}</span>}
          {entry.releaseYear && <span>{entry.releaseYear}</span>}
        </div>
        <div className="catalog-card-info">
          {entry.marketValue ? <div><small>{t('catalog.marketValueLabel')}</small><strong>{Number(entry.marketValue).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</strong></div> : <span />}
          {entry.contributor && <small className="catalog-card-contributor">{t('catalog.submittedBy', { name: entry.contributor })}</small>}
        </div>

        {!entry.imagePath && !photoSubmitted && (
          <button type="button" className="link-btn catalog-add-photo-link" onClick={(e) => { e.stopPropagation(); onOpenPhotoForm(entry); }}>
            <UiIcon name="camera" size={14} /> {t('catalog.addPhoto')}
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
            onClick={(e) => { e.stopPropagation(); onAdopt(entry); }}
          >
            {!adopted && <UiIcon name="plus" size={16} />}{adopted ? t('catalog.adopted') : t('catalog.adopt').replace(/^\+\s*/, '')}
          </button>
        </div>
      </div>
    </article>
  );
}

// Beitragslevel: earned strictly from approved Community-Katalog
// contributions (see server/src/utils/collectorXp.js) — a different system
// from the collection-completeness "Level" shown elsewhere via the trophy
// icon, named distinctly here on purpose to avoid confusing the two.
function MyContributions({ t }) {
  const [progress, setProgress] = useState(null);
  const [submissions, setSubmissions] = useState([]);

  useEffect(() => {
    window.api.getCollectorProgress?.().then((p) => p && setProgress(p));
    window.api.getMySubmissions?.().then((s) => setSubmissions(s || []));
  }, []);

  if (!progress) return null;
  const xpToNext = progress.xpPerLevel - progress.xpIntoCurrentLevel;
  const progressPct = Math.round((progress.xpIntoCurrentLevel / progress.xpPerLevel) * 100);
  const slotsCapped = progress.earnedCollectionSlots >= 100;

  return (
    <div className="contribution-progress">
      <div className="contribution-progress-head">
        <div className="contribution-level">{t('catalog.contribLevel', { level: progress.collectorLevel })}</div>
        <div className="field-hint">{t('catalog.contribXpToNext', { xp: xpToNext })}</div>
      </div>
      <div className="contribution-bar"><div className="contribution-bar-fill" style={{ width: `${progressPct}%` }} /></div>
      <div className="field-hint contribution-slots">
        {slotsCapped ? t('catalog.contribSlotsComplete') : t('catalog.contribSlots', { earned: progress.earnedCollectionSlots, limit: progress.effectiveFreeItemLimit })}
      </div>

      <h3 className="contribution-submissions-title">{t('catalog.mySubmissionsTitle')}</h3>
      {!submissions.length && <p className="field-hint">{t('catalog.noSubmissionsYet')}</p>}
      {submissions.map((s) => (
        <div className="admin-row" key={s.id}>
          <div><strong>{s.name}</strong>{s.moderationReason && <small> · {s.moderationReason}</small>}{s.mergedIntoId && <small> · {t('catalog.mergedNotice')}</small>}</div>
          <span className={`admin-status admin-status-${s.status}`}>{t(`catalog.status.${s.status}`)}</span>
        </div>
      ))}
    </div>
  );
}

export default function CommunityCatalogModal({ catalog, catalogCategories, items, user, onAdopt, onSubmit, onProposePhoto, onProposeCategory, onClose }) {
  const { t } = useI18n();
  const isGuest = !user?.id || !!user?.guest;
  const [tab, setTab] = useState('browse');
  const [search, setSearch] = useState('');
  const [activeCat, setActiveCat] = useState(ALL_CAT);
  const [adoptedIds, setAdoptedIds] = useState([]);
  const [form, setForm] = useState(emptySubmission);
  const [imgPreview, setImgPreview] = useState(null);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [photoContributeEntry, setPhotoContributeEntry] = useState(null);
  const [photoSubmittedIds, setPhotoSubmittedIds] = useState([]);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [reportEntry, setReportEntry] = useState(null);
  const [detailEntry, setDetailEntry] = useState(null);

  const update = (field, val) => setForm((f) => ({ ...f, [field]: val }));

  const handleReportSubmit = async ({ reason, comment }) => {
    await window.api.reportCatalogEntry({
      targetType: 'catalogItem',
      targetId: reportEntry.id,
      targetName: reportEntry.name,
      reason,
      comment
    });
  };

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
      imagePath: item.imagePath || null,
      marketValue: item.value || '',
      conditionValues: item.value ? { [item.condition || 'nearMint']: item.value } : {}
    });
    if (item.imagePath) {
      const dataUrl = await window.api.getImagePath(item.imagePath);
      setImgPreview(dataUrl);
    } else {
      setImgPreview(null);
    }
  };

  const filterCategories = useMemo(() => {
    const extra = new Set();
    catalog.forEach((entry) => {
      if (entry.category && !SUGGESTED_CATEGORIES.includes(entry.category)) extra.add(entry.category);
    });
    (catalogCategories || []).forEach((cat) => {
      if (!SUGGESTED_CATEGORIES.includes(cat)) extra.add(cat);
    });
    return [...SUGGESTED_CATEGORIES, ...Array.from(extra).sort()];
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
    setSelectedItemId('');
    setSubmitted(true);
  };

  return (
    <>
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal catalog-modal catalog-modal-fullscreen" onClick={(e) => e.stopPropagation()}>
        <TitleBar />
        <div className="catalog-modal-header">
          <div className="catalog-title-block">
            <span className="catalog-title-icon"><UiIcon name="book" size={24} /></span>
            <div>
            <span className="catalog-eyebrow"><UiIcon name="sparkles" size={13} /> {t('catalog.communityEyebrow')}</span>
            <h2 className="catalog-modal-title">{t('catalog.title')}</h2>
            <p className="field-hint catalog-header-hint">{t('catalog.localNotice')}</p>
            </div>
          </div>
          <span className="catalog-total-count">{catalog.length} {t('catalog.entries')}</span>
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
          {!isGuest && (
            <button type="button" className={tab === 'mine' ? 'catalog-tab active' : 'catalog-tab'} onClick={() => setTab('mine')}>
              {t('catalog.tabMine')}
            </button>
          )}
        </div>

        <div className="catalog-modal-body">
          {tab === 'mine' && !isGuest && <MyContributions t={t} />}
          {tab === 'browse' && (
            <>
              <div className="catalog-filter-bar">
                <label className="catalog-search-wrap">
                <UiIcon name="search" size={19} />
                <input
                  type="text"
                  className="search-input catalog-search"
                  placeholder={t('catalog.searchPlaceholder')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                </label>
                <div className="catalog-category-filter">
                  <div className={categoriesExpanded ? 'catalog-category-chips expanded' : 'catalog-category-chips'}>
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
                  </div>
                  <button
                    type="button"
                    className="link-btn catalog-category-toggle"
                    onClick={() => setCategoriesExpanded((v) => !v)}
                  >
                    {categoriesExpanded ? `▴ ${t('catalog.categoriesCollapse')}` : `▾ ${t('catalog.categoriesExpand')}`}
                  </button>

                  <div className="catalog-category-propose">
                    {!showCategoryForm && (
                      <button type="button" className="catalog-chip catalog-chip-add" onClick={() => setShowCategoryForm(true)}>
                        + {t('catalog.proposeCategory')}
                      </button>
                    )}
                    {showCategoryForm && (
                      <form className="catalog-propose-category-form" onSubmit={handleProposeCategorySubmit}>
                        <input
                          type="text"
                          list="catalog-category-suggestions"
                          autoFocus
                          className="catalog-propose-category-input"
                          placeholder={t('catalog.proposeCategoryPlaceholder')}
                          value={newCategoryName}
                          onChange={(e) => setNewCategoryName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Escape') { setShowCategoryForm(false); setNewCategoryName(''); } }}
                        />
                        <datalist id="catalog-category-suggestions">
                          {SUGGESTED_CATEGORIES.filter((c) => !filterCategories.includes(c)).map((c) => (
                            <option key={c} value={c} />
                          ))}
                        </datalist>
                        <button type="submit" className="btn-primary catalog-propose-category-btn">{t('catalog.proposeCategoryAction')}</button>
                        <button type="button" className="btn-secondary catalog-propose-category-btn" onClick={() => { setShowCategoryForm(false); setNewCategoryName(''); }}>{t('catalog.proposeCategoryCancel')}</button>
                      </form>
                    )}
                  </div>
                </div>
              </div>

              {filtered.length === 0 ? (
                <div className="empty-state catalog-empty-state">
                  <p>{t('catalog.empty')}</p>
                </div>
              ) : (
                <>
                <div className="catalog-results-head">
                  <div><span>{activeCat === ALL_CAT ? t('catalog.allDiscoveries') : activeCat}</span><strong>{filtered.length} {t('catalog.entries')}</strong></div>
                  <span>{t('catalog.openHint')}</span>
                </div>
                <div className="grid catalog-grid">
                  {filtered.map((entry) => (
                    <CatalogCard
                      key={entry.id}
                      entry={entry}
                      adopted={adoptedIds.includes(entry.id)}
                      onAdopt={handleAdopt}
                      onOpenPhotoForm={setPhotoContributeEntry}
                      photoSubmitted={photoSubmittedIds.includes(entry.id)}
                      onOpenReport={setReportEntry}
                      onOpenDetails={setDetailEntry}
                      t={t}
                    />
                  ))}
                </div>
                </>
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
                  <label>
                    {t('catalog.submitMarketValue')}
                    <input type="number" min="0" step="0.01" value={form.marketValue} onChange={(e) => update('marketValue', e.target.value)} />
                  </label>
                </div>
                <p className="field-hint catalog-market-hint">{t('catalog.marketValueHint')}</p>
                <div className="catalog-condition-editor">
                  <h4>{t('catalog.conditionValues')}</h4>
                  <p className="field-hint">{t('catalog.conditionValuesHint')}</p>
                  <div className="catalog-condition-inputs">
                    {CONDITION_ORDER.map((condition) => (
                      <label key={condition}>
                        {t(`condition.${condition}`)}
                        <input type="number" min="0" step="0.01" value={form.conditionValues?.[condition] || ''} onChange={(e) => update('conditionValues', { ...form.conditionValues, [condition]: e.target.value })} placeholder="–" />
                      </label>
                    ))}
                  </div>
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

    {reportEntry && (
      <ReportModal
        targetName={reportEntry.name}
        onSubmit={handleReportSubmit}
        onClose={() => setReportEntry(null)}
      />
    )}
    {detailEntry && (
      <div className="modal-overlay catalog-detail-overlay" onClick={() => setDetailEntry(null)}>
        <div className="modal catalog-detail-modal" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="icon-btn catalog-detail-close" onClick={() => setDetailEntry(null)}>✕</button>
          <div className="catalog-detail-layout">
            <CatalogDetailImage entry={detailEntry} />
            <div className="catalog-detail-content">
              <span className="catalog-detail-eyebrow">{detailEntry.category || t('catalog.title')}</span>
              <h2>{detailEntry.name}</h2>
              <p>{[detailEntry.brand, detailEntry.releaseYear].filter(Boolean).join(' · ')}</p>
              <h3>{t('catalog.variantsAndValues')}</h3>
              <div className="catalog-variant-list">
                {CONDITION_ORDER.filter((condition) => Number(detailEntry.conditionValues?.[condition]) > 0).map((condition) => (
                  <div key={condition}><span>{t(`condition.${condition}`)}</span><strong>{Number(detailEntry.conditionValues[condition]).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</strong></div>
                ))}
                {!CONDITION_ORDER.some((condition) => Number(detailEntry.conditionValues?.[condition]) > 0) && detailEntry.marketValue && (
                  <div><span>{t('catalog.marketValueLabel')}</span><strong>{Number(detailEntry.marketValue).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}</strong></div>
                )}
                {!CONDITION_ORDER.some((condition) => Number(detailEntry.conditionValues?.[condition]) > 0) && !detailEntry.marketValue && <div className="admin-empty">{t('catalog.noVariantValues')}</div>}
              </div>
              <CommunityValueBox catalogItemId={detailEntry.id} isGuest={!user?.id || !!user?.guest} itemName={detailEntry.name} />
              <button type="button" className="btn-primary" disabled={adoptedIds.includes(detailEntry.id)} onClick={() => handleAdopt(detailEntry)}>{adoptedIds.includes(detailEntry.id) ? t('catalog.adopted') : t('catalog.adopt')}</button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

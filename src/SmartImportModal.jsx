import React, { useMemo, useState } from 'react';
import { useI18n } from './i18n.jsx';
import { FIELD_TYPES, guessHasHeader, detectColumns, needsPriceClarification, buildItemDrafts, mappingSignature } from './smartImport.js';

const CONFIDENCE_LABEL = { high: '✅', medium: '❓', low: '❓', none: '➖' };
const MAPPING_STORAGE_KEY = 'itemcase_smart_import_mappings';

function loadSavedMapping(signature) {
  try {
    const all = JSON.parse(localStorage.getItem(MAPPING_STORAGE_KEY) || '{}');
    return all[signature] || null;
  } catch (e) { return null; }
}

function saveMapping(signature, columns) {
  try {
    const all = JSON.parse(localStorage.getItem(MAPPING_STORAGE_KEY) || '{}');
    all[signature] = columns.map((c) => ({ index: c.index, type: c.type }));
    localStorage.setItem(MAPPING_STORAGE_KEY, JSON.stringify(all));
  } catch (e) { /* localStorage unavailable — saved mapping is a convenience, not required */ }
}

export default function SmartImportModal({ existingItems, onClose, onImported }) {
  const { t } = useI18n();
  const [step, setStep] = useState('pick');
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [hasHeader, setHasHeader] = useState(true);
  const [columns, setColumns] = useState([]);
  const [priceMeaning, setPriceMeaning] = useState('value');
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [importedIds, setImportedIds] = useState([]);
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);
  const [rememberMapping, setRememberMapping] = useState(false);
  const [appliedSavedMapping, setAppliedSavedMapping] = useState(false);
  const [error, setError] = useState('');

  const rows = sheets[sheetIndex]?.rows || [];

  const rebuildColumns = (nextRows, nextHasHeader, allowSavedMapping) => {
    const detected = detectColumns(nextRows, nextHasHeader);
    if (allowSavedMapping) {
      const saved = loadSavedMapping(mappingSignature(nextRows, nextHasHeader));
      if (saved) {
        setColumns(detected.map((c) => {
          const match = saved.find((s) => s.index === c.index);
          return match ? { ...c, type: match.type, confidence: 'high' } : c;
        }));
        setAppliedSavedMapping(true);
        return;
      }
    }
    setAppliedSavedMapping(false);
    setColumns(detected);
  };

  const handlePickFile = async () => {
    setError('');
    const result = await window.api.pickImportSpreadsheet();
    if (!result.ok) {
      if (result.reason !== 'canceled') setError(t('smartImport.invalidFile'));
      return;
    }
    const guessedHeader = guessHasHeader(result.sheets[0].rows);
    setFileName(result.fileName);
    setSheets(result.sheets);
    setSheetIndex(0);
    setHasHeader(guessedHeader);
    rebuildColumns(result.sheets[0].rows, guessedHeader, true);
    setStep('map');
  };

  const handleSheetChange = (idx) => {
    setSheetIndex(idx);
    const guessedHeader = guessHasHeader(sheets[idx].rows);
    setHasHeader(guessedHeader);
    rebuildColumns(sheets[idx].rows, guessedHeader);
  };

  const handleHeaderToggle = (checked) => {
    setHasHeader(checked);
    rebuildColumns(rows, checked);
  };

  const updateColumnType = (index, type) => {
    setColumns((cols) => cols.map((c) => (c.index === index ? { ...c, type, confidence: 'high' } : c)));
  };

  const priceClarificationNeeded = useMemo(() => needsPriceClarification(columns), [columns]);

  const drafts = useMemo(() => {
    if (step !== 'preview') return [];
    return buildItemDrafts(rows, hasHeader, columns, priceMeaning, existingItems);
  }, [step, rows, hasHeader, columns, priceMeaning, existingItems]);

  const summary = useMemo(() => {
    const ready = drafts.filter((d) => !d.excluded && !d.isDuplicate && d.issues.length === 0);
    const duplicates = drafts.filter((d) => d.isDuplicate && !d.excluded);
    const needsCorrection = drafts.filter((d) => !d.excluded && d.issues.length > 0 && !d.isDuplicate);
    const excluded = drafts.filter((d) => d.excluded);
    return { total: drafts.length, ready, duplicates, needsCorrection, excluded };
  }, [drafts]);

  const goToPreview = () => {
    if (!columns.some((c) => c.type === 'name')) {
      setError(t('smartImport.needName'));
      return;
    }
    if (rememberMapping) saveMapping(mappingSignature(rows, hasHeader), columns);
    setError('');
    setStep('preview');
  };

  const handleConfirmImport = async () => {
    setImporting(true);
    const toImport = [...summary.ready, ...summary.duplicates, ...summary.needsCorrection.filter((d) => d.name)];
    const knownIds = new Set((existingItems || []).map((i) => i.id));
    const newIds = [];
    let count = 0;
    for (const draft of toImport) {
      try {
        const db = await window.api.saveItem({
          name: draft.name,
          category: draft.category,
          condition: draft.condition || 'nearMint',
          quantity: draft.quantity || 1,
          purchasePrice: draft.purchasePrice ?? '',
          value: draft.value ?? '',
          notes: draft.notes || '',
          catalogInfo: draft.catalogInfo,
          ownershipStatus: 'keep'
        });
        count++;
        (db?.items || []).forEach((it) => {
          if (!knownIds.has(it.id)) { knownIds.add(it.id); newIds.push(it.id); }
        });
      } catch (e) { /* keep going — one bad row shouldn't abort the whole import */ }
    }
    setImportedCount(count);
    setImportedIds(newIds);
    setImporting(false);
    setStep('done');
    onImported();
  };

  const handleUndo = async () => {
    setUndoing(true);
    for (const id of importedIds) {
      try { await window.api.deleteItem(id); } catch (e) { /* best-effort */ }
    }
    setUndoing(false);
    setUndone(true);
    onImported();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>🧠 {t('smartImport.title')}</h2>
        <p className="field-hint" style={{ marginTop: -8, marginBottom: 14 }}>{t('smartImport.intro')}</p>

        {step === 'pick' && (
          <>
            <div className="ie-actions" style={{ marginBottom: 10 }}>
              <button type="button" className="ie-btn ie-btn-primary" onClick={handlePickFile}>
                <span className="ie-btn-icon">📂</span> {t('smartImport.pickFile')}
              </button>
            </div>
            {error && <div className="auth-error">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>{t('form.cancel')}</button>
            </div>
          </>
        )}

        {step === 'map' && (
          <>
            <div className="form-grid" style={{ marginBottom: 10 }}>
              {sheets.length > 1 && (
                <label>
                  {t('smartImport.sheet')}
                  <select value={sheetIndex} onChange={(e) => handleSheetChange(Number(e.target.value))}>
                    {sheets.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}
                  </select>
                </label>
              )}
              <label className="checkbox-row" style={{ alignSelf: 'end' }}>
                <input type="checkbox" checked={hasHeader} onChange={(e) => handleHeaderToggle(e.target.checked)} />
                {t('smartImport.hasHeader')}
              </label>
            </div>

            {appliedSavedMapping && (
              <div className="field-hint" style={{ marginBottom: 8, color: 'var(--accent)' }}>✅ {t('smartImport.savedMappingApplied')}</div>
            )}
            <div className="field-hint" style={{ marginBottom: 8 }}>{t('smartImport.mapHint')}</div>

            <div className="wishlist-list" style={{ maxHeight: 320 }}>
              {columns.map((col) => (
                <div key={col.index} className="wishlist-row" style={{ alignItems: 'flex-start' }}>
                  <div className="wishlist-row-body">
                    <div className="wishlist-row-title">
                      {CONFIDENCE_LABEL[col.confidence]} {col.header || `${t('smartImport.column')} ${col.index + 1}`}
                    </div>
                    <div className="field-hint" style={{ margin: '2px 0 6px 0' }}>
                      {col.values.slice(0, 3).join(', ') || '–'}
                    </div>
                    <select value={col.type} onChange={(e) => updateColumnType(col.index, e.target.value)}>
                      {FIELD_TYPES.map((ft) => (
                        <option key={ft} value={ft}>{t(`smartImport.field.${ft}`)}</option>
                      ))}
                      <option value="price_ambiguous">{t('smartImport.field.price_ambiguous')}</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>

            {priceClarificationNeeded && (
              <div className="form-fieldset" style={{ marginTop: 12 }}>
                <legend>{t('smartImport.priceQuestion')}</legend>
                <div style={{ display: 'flex', gap: 20 }}>
                  <label className="checkbox-row">
                    <input type="radio" name="priceMeaning" checked={priceMeaning === 'purchasePrice'} onChange={() => setPriceMeaning('purchasePrice')} />
                    {t('form.purchasePrice')}
                  </label>
                  <label className="checkbox-row">
                    <input type="radio" name="priceMeaning" checked={priceMeaning === 'value'} onChange={() => setPriceMeaning('value')} />
                    {t('form.value')}
                  </label>
                </div>
              </div>
            )}

            <label className="checkbox-row" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={rememberMapping} onChange={(e) => setRememberMapping(e.target.checked)} />
              {t('smartImport.rememberMapping')}
            </label>

            {error && <div className="auth-error">{error}</div>}

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>{t('form.cancel')}</button>
              <button type="button" className="btn-primary" onClick={goToPreview}>{t('smartImport.toPreview')}</button>
            </div>
          </>
        )}

        {step === 'preview' && (
          <>
            <div className="form-grid" style={{ marginBottom: 14 }}>
              <div className="stat"><span className="stat-value">{summary.total}</span><span className="stat-label">{t('smartImport.foundCount')}</span></div>
              <div className="stat"><span className="stat-value">{summary.ready.length}</span><span className="stat-label">{t('smartImport.readyCount')}</span></div>
              <div className="stat"><span className="stat-value">{summary.duplicates.length}</span><span className="stat-label">{t('smartImport.duplicateCount')}</span></div>
              <div className="stat"><span className="stat-value">{summary.needsCorrection.length + summary.excluded.length}</span><span className="stat-label">{t('smartImport.correctionCount')}</span></div>
            </div>

            <div className="wishlist-list" style={{ maxHeight: 280 }}>
              {drafts.slice(0, 50).map((d) => (
                <div key={d.rowIndex} className="wishlist-row">
                  <div className="wishlist-row-body">
                    <div className="wishlist-row-title">
                      {d.name || <em>{t('smartImport.noName')}</em>}
                      {d.isDuplicate && (
                        <span className="condition-pill tone-amber" style={{ marginLeft: 8 }}>
                          {d.duplicateSource === 'file' ? t('smartImport.duplicateInFileBadge') : t('smartImport.duplicateBadge')}
                        </span>
                      )}
                      {d.excluded && <span className="condition-pill tone-red" style={{ marginLeft: 8 }}>{t('smartImport.excludedBadge')}</span>}
                      {!d.excluded && d.issues.length > 0 && <span className="condition-pill tone-blue" style={{ marginLeft: 8 }}>{t('smartImport.correctionBadge')}</span>}
                    </div>
                    <div className="field-hint" style={{ margin: 0 }}>
                      {d.category} {d.condition ? `· ${t(`condition.${d.condition}`)}` : ''} {d.value != null ? `· ${d.value} €` : ''}
                    </div>
                  </div>
                </div>
              ))}
              {drafts.length > 50 && <div className="field-hint">{t('smartImport.andMore', { count: drafts.length - 50 })}</div>}
            </div>

            {error && <div className="auth-error">{error}</div>}

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setStep('map')}>{t('smartImport.back')}</button>
              <button type="button" className="btn-primary" onClick={handleConfirmImport} disabled={importing || summary.ready.length + summary.duplicates.length + summary.needsCorrection.length === 0}>
                {importing ? t('wishlist.loading') : t('smartImport.confirmImport')}
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <p>{undone ? t('smartImport.undone') : t('smartImport.done', { count: importedCount })}</p>
            <div className="modal-actions">
              {!undone && importedIds.length > 0 && (
                <button type="button" className="btn-secondary" onClick={handleUndo} disabled={undoing}>
                  {undoing ? t('wishlist.loading') : t('smartImport.undo')}
                </button>
              )}
              <button type="button" className="btn-primary" onClick={onClose}>{t('catFields.close')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

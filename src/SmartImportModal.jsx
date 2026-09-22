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

export default function SmartImportModal({ existingItems, categories, catalog, onClose, onImported }) {
  const { t } = useI18n();
  const [step, setStep] = useState('pick');
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [selectedSheetIndexes, setSelectedSheetIndexes] = useState([]);
  const [sheetConfigs, setSheetConfigs] = useState([]);
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
  const [acceptedMatches, setAcceptedMatches] = useState({});
  const [draftOverrides, setDraftOverrides] = useState({});
  const [error, setError] = useState('');
  const [selectedDraftKey, setSelectedDraftKey] = useState(null);
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkCondition, setBulkCondition] = useState('');

  const rows = sheets[sheetIndex]?.rows || [];

  const buildSheetConfig = (nextRows, allowSavedMapping = true) => {
    const nextHasHeader = guessHasHeader(nextRows);
    const detected = detectColumns(nextRows, nextHasHeader);
    const saved = allowSavedMapping ? loadSavedMapping(mappingSignature(nextRows, nextHasHeader)) : null;
    if (!saved) return { hasHeader: nextHasHeader, columns: detected, appliedSavedMapping: false };
    return {
      hasHeader: nextHasHeader,
      columns: detected.map((c) => {
        const match = saved.find((s) => s.index === c.index);
        return match ? { ...c, type: match.type, confidence: 'high' } : c;
      }),
      appliedSavedMapping: true
    };
  };

  const handlePickFile = async () => {
    setError('');
    const result = await window.api.pickImportSpreadsheet();
    if (!result.ok) {
      if (result.reason !== 'canceled') setError(t('smartImport.invalidFile'));
      return;
    }
    const configs = result.sheets.map((sheet) => buildSheetConfig(sheet.rows));
    setFileName(result.fileName);
    setSheets(result.sheets);
    setSelectedSheetIndexes(result.sheets.map((_, index) => index));
    setSheetConfigs(configs);
    setSheetIndex(0);
    setHasHeader(configs[0].hasHeader);
    setColumns(configs[0].columns);
    setAppliedSavedMapping(configs[0].appliedSavedMapping);
    setStep('map');
  };

  const handleSheetChange = (idx) => {
    const config = sheetConfigs[idx];
    setSheetIndex(idx);
    setHasHeader(config.hasHeader);
    setColumns(config.columns);
    setAppliedSavedMapping(config.appliedSavedMapping);
  };

  const updateCurrentSheetConfig = (changes) => {
    setSheetConfigs((configs) => configs.map((config, index) => (
      index === sheetIndex ? { ...config, ...changes } : config
    )));
  };

  const toggleSheetSelection = (idx) => {
    setSelectedSheetIndexes((selected) => (
      selected.includes(idx) ? selected.filter((i) => i !== idx) : [...selected, idx].sort((a, b) => a - b)
    ));
  };

  const handleHeaderToggle = (checked) => {
    setHasHeader(checked);
    const nextColumns = detectColumns(rows, checked);
    setColumns(nextColumns);
    setAppliedSavedMapping(false);
    updateCurrentSheetConfig({ hasHeader: checked, columns: nextColumns, appliedSavedMapping: false });
  };

  const updateColumnType = (index, type) => {
    const nextColumns = columns.map((c) => (c.index === index ? { ...c, type, confidence: 'high' } : c));
    setColumns(nextColumns);
    updateCurrentSheetConfig({ columns: nextColumns });
  };

  const priceClarificationNeeded = useMemo(() => (
    selectedSheetIndexes.some((idx) => needsPriceClarification(sheetConfigs[idx]?.columns || []))
  ), [selectedSheetIndexes, sheetConfigs]);

  const drafts = useMemo(() => {
    if (step !== 'map') return [];
    const allDrafts = [];
    selectedSheetIndexes.forEach((idx) => {
      const config = sheetConfigs[idx];
      buildItemDrafts(sheets[idx].rows, config.hasHeader, config.columns, priceMeaning, existingItems, catalog)
        .forEach((draft) => {
          const draftKey = `${idx}:${draft.rowIndex}`;
          const overrides = draftOverrides[draftKey] || {};
          const correctedIssues = (draft.issues || []).filter((issue) => !(
            (issue === 'missingName' && Object.hasOwn(overrides, 'name'))
            || (issue === 'invalidQuantity' && Object.hasOwn(overrides, 'quantity'))
            || (issue === 'invalidPurchasePrice' && Object.hasOwn(overrides, 'purchasePrice'))
            || (issue === 'invalidValue' && Object.hasOwn(overrides, 'value'))
          ));
          allDrafts.push({
            ...draft,
            ...overrides,
            issues: correctedIssues,
            draftKey,
            sheetIndex: idx,
            sheetName: sheets[idx].name,
            catalogItemId: acceptedMatches[draftKey] ? draft.catalogMatch?.catalogItemId || null : draft.catalogItemId
          });
        });
    });
    const existingKeys = new Set((existingItems || []).map((item) => (
      `${(item.name || '').trim().toLowerCase()}|${(item.category || '').trim().toLowerCase()}`
    )));
    const seenInFile = new Set();
    return allDrafts.map((draft) => {
      const name = (draft.name || '').trim();
      const category = (draft.category || 'Sonstiges').trim();
      const key = name ? `${name.toLowerCase()}|${category.toLowerCase()}` : null;
      const duplicateSource = key && existingKeys.has(key) ? 'existing' : (key && seenInFile.has(key) ? 'file' : null);
      if (key) seenInFile.add(key);
      const issues = (draft.issues || []).filter((issue) => issue !== 'missingName');
      if (!name) issues.push('missingName');
      return {
        ...draft,
        name,
        category,
        issues,
        excluded: !name,
        isDuplicate: Boolean(duplicateSource),
        duplicateSource
      };
    });
  }, [step, sheets, selectedSheetIndexes, sheetConfigs, priceMeaning, existingItems, catalog, acceptedMatches, draftOverrides]);

  const updateDraft = (draftKey, field, value) => {
    setDraftOverrides((overrides) => ({
      ...overrides,
      [draftKey]: { ...(overrides[draftKey] || {}), [field]: value }
    }));
  };

  const applyBulkValues = () => {
    if (!bulkCategory && !bulkCondition) return;
    setDraftOverrides((overrides) => {
      const next = { ...overrides };
      drafts.forEach((draft) => {
        next[draft.draftKey] = {
          ...(next[draft.draftKey] || {}),
          ...(bulkCategory ? { category: bulkCategory } : {}),
          ...(bulkCondition ? { condition: bulkCondition } : {})
        };
      });
      return next;
    });
  };

  const summary = useMemo(() => {
    const ready = drafts.filter((d) => !d.excluded && !d.isDuplicate && d.issues.length === 0);
    const duplicates = drafts.filter((d) => d.isDuplicate && !d.excluded);
    const needsCorrection = drafts.filter((d) => !d.excluded && d.issues.length > 0 && !d.isDuplicate);
    const excluded = drafts.filter((d) => d.excluded);
    return { total: drafts.length, ready, duplicates, needsCorrection, excluded };
  }, [drafts]);

  const goToPreview = () => {
    if (selectedSheetIndexes.length === 0) {
      setError(t('smartImport.needSheet'));
      return;
    }
    if (selectedSheetIndexes.some((idx) => !sheetConfigs[idx].columns.some((c) => c.type === 'name'))) {
      setError(t('smartImport.needName'));
      return;
    }
    if (rememberMapping) selectedSheetIndexes.forEach((idx) => {
      const config = sheetConfigs[idx];
      saveMapping(mappingSignature(sheets[idx].rows, config.hasHeader), config.columns);
    });
    setError('');
    setStep('preview');
  };

  const handleConfirmImport = async () => {
    if (selectedSheetIndexes.length === 0 || selectedSheetIndexes.some((idx) => !sheetConfigs[idx].columns.some((c) => c.type === 'name'))) {
      setError(selectedSheetIndexes.length === 0 ? t('smartImport.needSheet') : t('smartImport.needName'));
      return;
    }
    if (rememberMapping) selectedSheetIndexes.forEach((idx) => {
      const config = sheetConfigs[idx];
      saveMapping(mappingSignature(sheets[idx].rows, config.hasHeader), config.columns);
    });
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
          catalogItemId: draft.catalogItemId || undefined,
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
      <div className="modal modal-xwide smart-import-modal" onClick={(e) => e.stopPropagation()}>
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

            {sheets.length > 1 && (
              <fieldset className="form-fieldset" style={{ marginBottom: 12 }}>
                <legend>{t('smartImport.sheetsToImport')}</legend>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px' }}>
                  {sheets.map((sheet, idx) => (
                    <label key={sheet.name} className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={selectedSheetIndexes.includes(idx)}
                        onChange={() => toggleSheetSelection(idx)}
                      />
                      {sheet.name}
                    </label>
                  ))}
                </div>
                <div className="field-hint">{t('smartImport.configureSheetsHint')}</div>
              </fieldset>
            )}

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

          </>
        )}

        {step === 'map' && (
          <>
            <div className="smart-import-section-divider"><span>{t('smartImport.livePreview')}</span></div>
            <div className="form-grid" style={{ marginBottom: 14 }}>
              <div className="stat"><span className="stat-value">{summary.total}</span><span className="stat-label">{t('smartImport.foundCount')}</span></div>
              <div className="stat"><span className="stat-value">{summary.ready.length}</span><span className="stat-label">{t('smartImport.readyCount')}</span></div>
              <div className="stat"><span className="stat-value">{summary.duplicates.length}</span><span className="stat-label">{t('smartImport.duplicateCount')}</span></div>
              <div className="stat"><span className="stat-value">{summary.needsCorrection.length + summary.excluded.length}</span><span className="stat-label">{t('smartImport.correctionCount')}</span></div>
            </div>

            <div className="smart-import-bulk-bar">
              <div>
                <strong>{t('smartImport.bulkTitle')}</strong>
                <span>{t('smartImport.bulkHint')}</span>
              </div>
              <label>
                {t('form.category')}
                <input list="smart-import-categories" value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} placeholder={t('smartImport.keepIndividual')} />
              </label>
              <label>
                {t('form.condition')}
                <select value={bulkCondition} onChange={(e) => setBulkCondition(e.target.value)}>
                  <option value="">{t('smartImport.keepIndividual')}</option>
                  {['sealed', 'mint', 'nearMint', 'excellent', 'veryGood', 'good', 'incomplete', 'played', 'poor', 'damaged'].map((condition) => <option key={condition} value={condition}>{t(`condition.${condition}`)}</option>)}
                </select>
              </label>
              <button type="button" className="btn-primary" onClick={applyBulkValues} disabled={!bulkCategory && !bulkCondition}>{t('smartImport.applyAll')}</button>
            </div>

            <div className="smart-import-correction-layout">
              <div className="smart-import-file-preview">
                <div className="smart-import-preview-title">{t('smartImport.filePreview')}</div>
                <div className="smart-import-table-wrap">
                  <table>
                    <tbody>
                      {(sheets[drafts.find((d) => d.draftKey === selectedDraftKey)?.sheetIndex ?? drafts[0]?.sheetIndex ?? 0]?.rows || []).slice(0, 30).map((row, rowIndex) => {
                        const activeDraft = drafts.find((d) => d.draftKey === selectedDraftKey) || drafts[0];
                        const config = sheetConfigs[activeDraft?.sheetIndex || 0];
                        const sourceRow = activeDraft ? activeDraft.rowIndex + (config?.hasHeader ? 1 : 0) : -1;
                        return <tr key={rowIndex} className={rowIndex === sourceRow ? 'active' : (config?.hasHeader && rowIndex === 0 ? 'header' : '')}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell || '–'}</td>)}</tr>;
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            <div className="wishlist-list smart-import-corrections">
              {drafts.slice(0, 50).map((d) => (
                <div key={d.draftKey} className={selectedDraftKey === d.draftKey ? 'wishlist-row active' : 'wishlist-row'} style={{ alignItems: 'stretch' }} onClick={() => setSelectedDraftKey(d.draftKey)} onFocus={() => setSelectedDraftKey(d.draftKey)}>
                  <div className="wishlist-row-body">
                    <div className="wishlist-row-title">
                      {d.name || <em>{t('smartImport.noName')}</em>}
                      {sheets.length > 1 && <span className="condition-pill" style={{ marginLeft: 8 }}>{d.sheetName}</span>}
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
                    <div className="form-grid" style={{ marginTop: 10 }}>
                      <label>
                        {t('form.name')}
                        <input value={d.name} onChange={(e) => updateDraft(d.draftKey, 'name', e.target.value)} />
                      </label>
                      <label>
                        {t('form.category')}
                        <input
                          list="smart-import-categories"
                          value={d.category}
                          onChange={(e) => updateDraft(d.draftKey, 'category', e.target.value)}
                        />
                      </label>
                      <label>
                        {t('form.condition')}
                        <select value={d.condition || 'nearMint'} onChange={(e) => updateDraft(d.draftKey, 'condition', e.target.value)}>
                          {['sealed', 'mint', 'nearMint', 'excellent', 'veryGood', 'good', 'incomplete', 'played', 'poor', 'damaged'].map((condition) => (
                            <option key={condition} value={condition}>{t(`condition.${condition}`)}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {t('form.quantity')}
                        <input type="number" min="1" value={d.quantity} onChange={(e) => updateDraft(d.draftKey, 'quantity', Math.max(1, Number(e.target.value) || 1))} />
                      </label>
                      <label>
                        {t('form.purchasePrice')}
                        <input type="number" min="0" step="0.01" value={d.purchasePrice ?? ''} onChange={(e) => updateDraft(d.draftKey, 'purchasePrice', e.target.value === '' ? null : Number(e.target.value))} />
                      </label>
                      <label>
                        {t('form.value')}
                        <input type="number" min="0" step="0.01" value={d.value ?? ''} onChange={(e) => updateDraft(d.draftKey, 'value', e.target.value === '' ? null : Number(e.target.value))} />
                      </label>
                    </div>
                    {d.catalogMatch && (
                      <div className="field-hint" style={{ margin: '4px 0 0 0' }}>
                        {d.catalogMatch.confidence === 'high' ? (
                          <>📚 {t('smartImport.catalogLinked', { name: d.catalogMatch.name })}</>
                        ) : acceptedMatches[d.draftKey] ? (
                          <>📚 {t('smartImport.catalogLinked', { name: d.catalogMatch.name })}</>
                        ) : (
                          <>
                            📚 {t('smartImport.catalogSuggestion', { name: d.catalogMatch.name })}{' '}
                            <button type="button" className="link-btn" onClick={() => setAcceptedMatches((m) => ({ ...m, [d.draftKey]: true }))}>
                              {t('smartImport.catalogAccept')}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {drafts.length > 50 && <div className="field-hint">{t('smartImport.andMore', { count: drafts.length - 50 })}</div>}
            </div>
            </div>
            <datalist id="smart-import-categories">
              {(categories || []).map((category) => <option key={category} value={category} />)}
            </datalist>

            {error && <div className="auth-error">{error}</div>}

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>{t('form.cancel')}</button>
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

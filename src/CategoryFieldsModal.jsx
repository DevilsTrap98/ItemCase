import React, { useState } from 'react';
import { useI18n } from './i18n.jsx';
import { CASE_DESIGNS, CASE_DESIGN_IDS } from './theme-defaults.js';

let uid = 0;
const nextId = () => `f${Date.now()}_${uid++}`;

export default function CategoryFieldsModal({ category, fields, target, caseDesign, onSave, onClose }) {
  const { t } = useI18n();
  const [items, setItems] = useState(
    (fields || []).map((f) => ({ ...f, _id: nextId() }))
  );
  const [targetValue, setTargetValue] = useState(target || '');
  const [caseDesignValue, setCaseDesignValue] = useState(caseDesign || '');

  const addField = () => {
    setItems((list) => [...list, { _id: nextId(), key: nextId(), label: '', type: 'text' }]);
  };

  const updateField = (id, patch) => {
    setItems((list) => list.map((f) => (f._id === id ? { ...f, ...patch } : f)));
  };

  const removeField = (id) => {
    setItems((list) => list.filter((f) => f._id !== id));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const cleanFields = items
      .filter((f) => f.label.trim())
      .map((f) => ({ key: f.key, label: f.label.trim(), type: f.type }));
    onSave(cleanFields, targetValue, caseDesignValue);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t('catFields.title')} — {category}</h2>
        <form onSubmit={handleSubmit} className="form">
          <label>
            {t('catFields.fieldsLabel')}
            <div className="field-hint" style={{ marginTop: 0, marginBottom: 6 }}>{t('catFields.fieldsHint')}</div>
          </label>

          <div className="custom-field-rows">
            {items.map((f) => (
              <div key={f._id} className="custom-field-row">
                <input
                  type="text"
                  value={f.label}
                  onChange={(e) => updateField(f._id, { label: e.target.value })}
                  placeholder={t('catFields.fieldNamePlaceholder')}
                />
                <select value={f.type} onChange={(e) => updateField(f._id, { type: e.target.value })}>
                  <option value="text">{t('catFields.typeText')}</option>
                  <option value="number">{t('catFields.typeNumber')}</option>
                  <option value="date">{t('catFields.typeDate')}</option>
                </select>
                <button type="button" className="icon-btn danger" onClick={() => removeField(f._id)} title={t('catFields.removeField')}>🗑</button>
              </div>
            ))}
          </div>

          <button type="button" className="category-add-btn" onClick={addField}>
            {t('catFields.addField')}
          </button>

          <label>
            {t('catFields.targetLabel')}
            <input
              type="number"
              min="0"
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              placeholder={t('catFields.targetPlaceholder')}
            />
          </label>
          <div className="field-hint">{t('catFields.targetHint')}</div>

          <label>
            {t('catFields.caseDesignLabel')}
            <div className="field-hint" style={{ marginTop: 0, marginBottom: 6 }}>{t('catFields.caseDesignHint')}</div>
          </label>
          <div className="color-theme-grid background-grid case-design-grid">
            <button
              type="button"
              className={!caseDesignValue ? 'color-swatch bg-swatch case-swatch active' : 'color-swatch bg-swatch case-swatch'}
              onClick={() => setCaseDesignValue('')}
            >
              <span className="case-swatch-none">✕</span>
              <span className="bg-swatch-label bg-swatch-label-plain">{t('catFields.caseDesignNone')}</span>
              {!caseDesignValue && <span className="color-swatch-check">✓</span>}
            </button>
            {CASE_DESIGN_IDS.map((id) => (
              <button
                type="button"
                key={id}
                className={caseDesignValue === id ? 'color-swatch bg-swatch case-swatch active' : 'color-swatch bg-swatch case-swatch'}
                style={{ backgroundImage: `url(${CASE_DESIGNS[id]})` }}
                onClick={() => setCaseDesignValue(id)}
              >
                <span className="bg-swatch-label">{t(`catFields.caseDesign.${id}`)}</span>
                {caseDesignValue === id && <span className="color-swatch-check">✓</span>}
              </button>
            ))}
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>{t('catFields.close')}</button>
            <button type="submit" className="btn-primary">{t('catFields.save')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

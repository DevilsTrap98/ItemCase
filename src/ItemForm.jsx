import React, { useEffect, useState } from 'react';
import { useI18n } from './i18n.jsx';

const emptyItem = {
  id: null,
  name: '',
  category: '',
  condition: 'nearMint',
  quantity: 1,
  value: '',
  purchasePrice: '',
  notes: '',
  imagePath: null,
  showcase: false,
  location: { shelf: '', box: '', folder: '', page: '', slot: '' },
  customFields: {}
};

const conditionValues = ['mint', 'nearMint', 'excellent', 'good', 'played', 'poor'];

export default function ItemForm({ item, categories, categoryFields, onSave, onClose }) {
  const { t } = useI18n();
  const [form, setForm] = useState(emptyItem);
  const [imgPreview, setImgPreview] = useState(null);
  const [newCategory, setNewCategory] = useState('');
  const [showNewCategory, setShowNewCategory] = useState(false);

  useEffect(() => {
    if (item) {
      setForm({
        ...emptyItem,
        ...item,
        location: { ...emptyItem.location, ...(item.location || {}) },
        customFields: { ...(item.customFields || {}) }
      });
      if (item.imagePath) {
        window.api.getImagePath(item.imagePath).then((dataUrl) => {
          if (dataUrl) setImgPreview(dataUrl);
        });
      }
    } else {
      setForm({ ...emptyItem, category: categories[0] || '' });
      setImgPreview(null);
    }
  }, [item]);

  const update = (field, val) => setForm((f) => ({ ...f, [field]: val }));
  const updateLocation = (field, val) => setForm((f) => ({ ...f, location: { ...f.location, [field]: val } }));
  const updateCustomField = (key, val) => setForm((f) => ({ ...f, customFields: { ...f.customFields, [key]: val } }));

  const handlePickImage = async () => {
    const fileName = await window.api.pickImage();
    if (fileName) {
      update('imagePath', fileName);
      const dataUrl = await window.api.getImagePath(fileName);
      setImgPreview(dataUrl);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const finalCategory = showNewCategory && newCategory.trim() ? newCategory.trim() : form.category;
    onSave({ ...form, category: finalCategory || categories[0] || 'Sonstiges' });
  };

  const activeCategoryFields = (categoryFields && categoryFields[form.category]) || [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>{item ? t('form.titleEdit') : t('form.titleNew')}</h2>
        <form onSubmit={handleSubmit} className="form">
          <div className="form-row">
            <div className="image-picker" onClick={handlePickImage}>
              {imgPreview ? <img src={imgPreview} alt="preview" /> : <span>{t('form.pickImage')}</span>}
            </div>
            <div className="form-fields">
              <label>
                {t('form.name')}
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  placeholder={t('form.namePlaceholder')}
                  autoFocus
                  required
                />
              </label>

              <label>
                {t('form.category')}
                {!showNewCategory ? (
                  <div className="inline-row">
                    <select value={form.category} onChange={(e) => update('category', e.target.value)}>
                      {categories.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <button type="button" className="link-btn" onClick={() => setShowNewCategory(true)}>{t('form.newCategoryAction')}</button>
                  </div>
                ) : (
                  <div className="inline-row">
                    <input
                      type="text"
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      placeholder={t('form.newCategoryPlaceholder')}
                    />
                    <button type="button" className="link-btn" onClick={() => setShowNewCategory(false)}>{t('form.cancelNewCategory')}</button>
                  </div>
                )}
              </label>
            </div>
          </div>

          <div className="form-grid">
            <label>
              {t('form.condition')}
              <select value={form.condition} onChange={(e) => update('condition', e.target.value)}>
                {conditionValues.map((c) => (
                  <option key={c} value={c}>{t(`condition.${c}`)}</option>
                ))}
              </select>
            </label>

            <label>
              {t('form.quantity')}
              <input
                type="number"
                min="1"
                value={form.quantity}
                onChange={(e) => update('quantity', e.target.value)}
              />
            </label>

            <label>
              {t('form.purchasePrice')}
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.purchasePrice}
                onChange={(e) => update('purchasePrice', e.target.value)}
                placeholder="0.00"
              />
            </label>
          </div>

          <label>
            {t('form.value')}
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.value}
              onChange={(e) => update('value', e.target.value)}
              placeholder="0.00"
            />
          </label>
          <div className="field-hint">{t('form.valueHint')}</div>

          {activeCategoryFields.length > 0 && (
            <fieldset className="form-fieldset">
              <legend>{t('form.customFieldsTitle', { category: form.category })}</legend>
              <div className="form-grid">
                {activeCategoryFields.map((field) => (
                  <label key={field.key}>
                    {field.label}
                    <input
                      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                      value={form.customFields[field.key] || ''}
                      onChange={(e) => updateCustomField(field.key, e.target.value)}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset className="form-fieldset">
            <legend>{t('form.locationTitle')}</legend>
            <div className="form-grid form-grid-5">
              <label>
                {t('form.locationShelf')}
                <input type="text" value={form.location.shelf} onChange={(e) => updateLocation('shelf', e.target.value)} />
              </label>
              <label>
                {t('form.locationBox')}
                <input type="text" value={form.location.box} onChange={(e) => updateLocation('box', e.target.value)} />
              </label>
              <label>
                {t('form.locationFolder')}
                <input type="text" value={form.location.folder} onChange={(e) => updateLocation('folder', e.target.value)} />
              </label>
              <label>
                {t('form.locationPage')}
                <input type="text" value={form.location.page} onChange={(e) => updateLocation('page', e.target.value)} />
              </label>
              <label>
                {t('form.locationSlot')}
                <input type="text" value={form.location.slot} onChange={(e) => updateLocation('slot', e.target.value)} />
              </label>
            </div>
          </fieldset>

          <label>
            {t('form.notes')}
            <textarea
              rows="3"
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              placeholder={t('form.notesPlaceholder')}
            />
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={!!form.showcase}
              onChange={(e) => update('showcase', e.target.checked)}
            />
            {t('form.showcase')}
          </label>

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>{t('form.cancel')}</button>
            <button type="submit" className="btn-primary">{t('form.save')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

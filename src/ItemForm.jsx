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
  story: { place: '', date: '', isGift: false, isFirstPiece: false, text: '' },
  customFields: {},
  catalogInfo: { brand: '', releaseYear: '', ean: '', isbn: '', manufacturerNumber: '' }
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
        story: { ...emptyItem.story, ...(item.story || {}) },
        customFields: { ...(item.customFields || {}) },
        catalogInfo: { ...emptyItem.catalogInfo, ...(item.catalogInfo || {}) }
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
  const updateStory = (field, val) => setForm((f) => ({ ...f, story: { ...f.story, [field]: val } }));
  const updateCustomField = (key, val) => setForm((f) => ({ ...f, customFields: { ...f.customFields, [key]: val } }));
  const updateCatalogInfo = (field, val) => setForm((f) => ({ ...f, catalogInfo: { ...f.catalogInfo, [field]: val } }));

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
            <legend>🏷️ {t('form.catalogTitle')}</legend>
            <div className="field-hint" style={{ marginTop: 0 }}>{t('form.catalogHint')}</div>
            <div className="form-grid">
              <label>
                {t('form.catalogBrand')}
                <input
                  type="text"
                  value={form.catalogInfo.brand}
                  onChange={(e) => updateCatalogInfo('brand', e.target.value)}
                />
              </label>
              <label>
                {t('form.catalogReleaseYear')}
                <input
                  type="number"
                  value={form.catalogInfo.releaseYear}
                  onChange={(e) => updateCatalogInfo('releaseYear', e.target.value)}
                />
              </label>
              <label>
                {t('form.catalogEan')}
                <input
                  type="text"
                  value={form.catalogInfo.ean}
                  onChange={(e) => updateCatalogInfo('ean', e.target.value)}
                />
              </label>
              <label>
                {t('form.catalogIsbn')}
                <input
                  type="text"
                  value={form.catalogInfo.isbn}
                  onChange={(e) => updateCatalogInfo('isbn', e.target.value)}
                />
              </label>
              <label>
                {t('form.catalogManufacturerNumber')}
                <input
                  type="text"
                  value={form.catalogInfo.manufacturerNumber}
                  onChange={(e) => updateCatalogInfo('manufacturerNumber', e.target.value)}
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="form-fieldset">
            <legend>📜 {t('form.storyTitle')}</legend>
            <div className="form-grid">
              <label>
                {t('form.storyPlace')}
                <input
                  type="text"
                  value={form.story.place}
                  onChange={(e) => updateStory('place', e.target.value)}
                  placeholder={t('form.storyPlacePlaceholder')}
                />
              </label>
              <label>
                {t('form.storyDate')}
                <input
                  type="date"
                  value={form.story.date}
                  onChange={(e) => updateStory('date', e.target.value)}
                />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 20, marginTop: 4 }}>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={!!form.story.isGift}
                  onChange={(e) => updateStory('isGift', e.target.checked)}
                />
                🎁 {t('form.storyGift')}
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={!!form.story.isFirstPiece}
                  onChange={(e) => updateStory('isFirstPiece', e.target.checked)}
                />
                🥇 {t('form.storyFirstPiece')}
              </label>
            </div>
            <label style={{ marginTop: 10 }}>
              {t('form.storyText')}
              <textarea
                rows="3"
                value={form.story.text}
                onChange={(e) => updateStory('text', e.target.value)}
                placeholder={t('form.storyTextPlaceholder')}
              />
            </label>
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

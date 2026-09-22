import React, { useEffect, useState } from 'react';
import { useI18n } from './i18n.jsx';
import { SUGGESTED_CATEGORIES } from './category-defaults.js';

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
  caseDesign: '',
  showcase: false,
  ownershipStatus: 'keep',
  story: { place: '', date: '', isGift: false, isFirstPiece: false, text: '' },
  customFields: {},
  catalogInfo: { brand: '', releaseYear: '', ean: '', isbn: '', manufacturerNumber: '' }
};

const SHIPPING_OPTIONS = ['pickup', 'shipping', 'both'];

const conditionValues = ['sealed', 'mint', 'nearMint', 'excellent', 'veryGood', 'good', 'incomplete', 'played', 'poor', 'damaged'];
const ownershipStatusValues = ['keep', 'duplicate', 'tradable', 'for_sale', 'looking_for'];

export default function ItemForm({ item, categories, categoryFields, onSave, onClose, onPrevious, onNext, positionLabel, businessMode = false }) {
  const { t } = useI18n();
  const [form, setForm] = useState(emptyItem);
  const [imgPreview, setImgPreview] = useState(null);
  const [newCategory, setNewCategory] = useState('');
  const [showNewCategory, setShowNewCategory] = useState(false);
  // Publishing to the CommunityMarkt is always this item's own separate,
  // deliberate choice — never implied by account tariff. businessMode may
  // pre-select it as a convenience for dealers, but never forces it (a
  // draft, an already-sold piece, or private stock must stay unlisted).
  const [publishTarget, setPublishTarget] = useState(businessMode ? 'market' : 'private');
  const [marketFields, setMarketFields] = useState({
    price: '', priceOnRequest: false, shippingOption: 'both', shippingCost: '', location: '', description: ''
  });

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
    const marketOptions = publishTarget === 'market' ? {
      price: marketFields.priceOnRequest ? null : (marketFields.price || null),
      priceOnRequest: marketFields.priceOnRequest,
      shippingOption: marketFields.shippingOption,
      shippingCost: marketFields.shippingCost || null,
      location: marketFields.location,
      description: marketFields.description
    } : null;
    onSave({ ...form, category: finalCategory || categories[0] || 'Sonstiges' }, marketOptions);
  };

  const activeCategoryFields = (categoryFields && categoryFields[form.category]) || [];

  return (
    <div className="modal-overlay">
      <div className="modal modal-xwide item-form-modal">
        <h2>{item ? t('form.titleEdit') : t('form.titleNew')}</h2>
        <form onSubmit={handleSubmit} className="form">
          <div className="item-form-columns">
            <div className="item-form-col">
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
                          list="new-category-suggestions"
                          value={newCategory}
                          onChange={(e) => setNewCategory(e.target.value)}
                          placeholder={t('form.newCategoryPlaceholder')}
                          autoFocus
                        />
                        <datalist id="new-category-suggestions">
                          {SUGGESTED_CATEGORIES.filter((c) => !categories.includes(c)).map((c) => (
                            <option key={c} value={c} />
                          ))}
                        </datalist>
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
                  {t('form.ownershipStatus')}
                  <select value={form.ownershipStatus} onChange={(e) => update('ownershipStatus', e.target.value)}>
                    {ownershipStatusValues.map((s) => (
                      <option key={s} value={s}>{t(`ownershipStatus.${s}`)}</option>
                    ))}
                  </select>
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
              </div>
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

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={!!form.showcase}
                  onChange={(e) => update('showcase', e.target.checked)}
                />
                {t('form.showcase')}
              </label>
            </div>

            <div className="item-form-col">
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
                    rows="2"
                    value={form.story.text}
                    onChange={(e) => updateStory('text', e.target.value)}
                    placeholder={t('form.storyTextPlaceholder')}
                  />
                </label>
              </fieldset>

              <fieldset className="form-fieldset market-publish-fieldset">
                <legend>🛍️ {t('form.marketTitle')}</legend>
                <div className="market-publish-choice">
                  <label className="checkbox-row">
                    <input type="radio" name="publishTarget" checked={publishTarget === 'private'} onChange={() => setPublishTarget('private')} />
                    {t('form.marketPrivateOnly')}
                  </label>
                  <label className="checkbox-row">
                    <input type="radio" name="publishTarget" checked={publishTarget === 'market'} onChange={() => setPublishTarget('market')} />
                    {t('form.marketOffer')}
                  </label>
                </div>

                {publishTarget === 'market' && (
                  <>
                    <div className="field-hint">{t('form.marketHint')}</div>
                    <div className="form-grid">
                      <label>
                        {t('form.value')}
                        <input
                          type="number" min="0" step="0.01" disabled={marketFields.priceOnRequest}
                          value={marketFields.price}
                          onChange={(e) => setMarketFields((f) => ({ ...f, price: e.target.value }))}
                        />
                      </label>
                      <label>
                        {t('market.shippingOption')}
                        <select value={marketFields.shippingOption} onChange={(e) => setMarketFields((f) => ({ ...f, shippingOption: e.target.value }))}>
                          {SHIPPING_OPTIONS.map((o) => <option key={o} value={o}>{t(`market.shipping.${o}`)}</option>)}
                        </select>
                      </label>
                      <label>
                        {t('market.shippingCostLabel')}
                        <input type="number" min="0" step="0.01" value={marketFields.shippingCost} onChange={(e) => setMarketFields((f) => ({ ...f, shippingCost: e.target.value }))} />
                      </label>
                      <label>
                        {t('market.locationPlaceholder')}
                        <input type="text" value={marketFields.location} onChange={(e) => setMarketFields((f) => ({ ...f, location: e.target.value }))} />
                      </label>
                    </div>
                    <label className="checkbox-row">
                      <input type="checkbox" checked={marketFields.priceOnRequest} onChange={(e) => setMarketFields((f) => ({ ...f, priceOnRequest: e.target.checked }))} />
                      {t('market.priceOnRequestLabel')}
                    </label>
                    <label>
                      {t('market.description')}
                      <textarea rows="2" value={marketFields.description} onChange={(e) => setMarketFields((f) => ({ ...f, description: e.target.value }))} placeholder={t('form.marketDescriptionPlaceholder')} />
                    </label>
                  </>
                )}
              </fieldset>

            </div>
          </div>

          <div className="modal-actions item-form-actions">
            {item && (
              <div className="item-edit-navigation">
                <button type="button" className="btn-secondary" onClick={onPrevious} disabled={!onPrevious}>← {t('form.previousItem')}</button>
                {positionLabel && <span>{positionLabel}</span>}
                <button type="button" className="btn-secondary" onClick={onNext} disabled={!onNext}>{t('form.nextItem')} →</button>
              </div>
            )}
            <button type="button" className="btn-secondary" onClick={onClose}>{t('form.cancel')}</button>
            <button type="submit" className="btn-primary">{item ? t('form.save') : t('form.add')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

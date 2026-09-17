import React, { useEffect, useState } from 'react';
import { useI18n } from './i18n.jsx';

const PRIORITY_TONE = { low: 'blue', medium: 'amber', high: 'red' };

export default function WishlistModal({ onClose }) {
  const { lang, t } = useI18n();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ privateName: '', desiredCondition: '', maxPrice: '', priority: 'medium', notes: '', visibility: 'private' });

  const load = async () => {
    setLoading(true);
    const result = await window.api.wishlistList();
    setItems(Array.isArray(result) ? result : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const currencyFmt = (n) => Number(n).toLocaleString(lang === 'en' ? 'en-US' : 'de-DE', { style: 'currency', currency: 'EUR' });

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.privateName.trim()) return;
    const res = await window.api.wishlistAdd({ ...form, maxPrice: form.maxPrice || null });
    if (res.ok) {
      setItems(res.items);
      setForm({ privateName: '', desiredCondition: '', maxPrice: '', priority: 'medium', notes: '', visibility: 'private' });
      setShowForm(false);
    }
  };

  const handleRemove = async (id) => {
    const res = await window.api.wishlistRemove(id);
    if (res.ok) setItems(res.items);
  };

  const visibleItems = priorityFilter === 'all' ? items : items.filter((i) => i.priority === priorityFilter);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>❤️ {t('wishlist.title')}</h2>
        <p className="field-hint" style={{ marginTop: -8, marginBottom: 14 }}>{t('wishlist.intro')}</p>

        <div className="inline-row" style={{ marginBottom: 14 }}>
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
            <option value="all">{t('wishlist.priorityAll')}</option>
            <option value="high">{t('wishlist.priorityHigh')}</option>
            <option value="medium">{t('wishlist.priorityMedium')}</option>
            <option value="low">{t('wishlist.priorityLow')}</option>
          </select>
          <button type="button" className="btn-primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? t('form.cancel') : `+ ${t('wishlist.add')}`}
          </button>
        </div>

        {showForm && (
          <form onSubmit={handleAdd} className="form" style={{ marginBottom: 18, borderBottom: '1px solid var(--border)', paddingBottom: 16 }}>
            <label>
              {t('wishlist.itemName')}
              <input type="text" value={form.privateName} onChange={(e) => setForm((f) => ({ ...f, privateName: e.target.value }))} autoFocus required />
            </label>
            <div className="form-grid">
              <label>
                {t('wishlist.desiredCondition')}
                <input type="text" value={form.desiredCondition} onChange={(e) => setForm((f) => ({ ...f, desiredCondition: e.target.value }))} />
              </label>
              <label>
                {t('wishlist.maxPrice')}
                <input type="number" min="0" step="0.01" value={form.maxPrice} onChange={(e) => setForm((f) => ({ ...f, maxPrice: e.target.value }))} />
              </label>
              <label>
                {t('wishlist.priority')}
                <select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
                  <option value="low">{t('wishlist.priorityLow')}</option>
                  <option value="medium">{t('wishlist.priorityMedium')}</option>
                  <option value="high">{t('wishlist.priorityHigh')}</option>
                </select>
              </label>
            </div>
            <label>
              {t('wishlist.notes')}
              <textarea rows="2" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={form.visibility === 'friends'} onChange={(e) => setForm((f) => ({ ...f, visibility: e.target.checked ? 'friends' : 'private' }))} />
              {t('wishlist.visibleToFriends')}
            </label>
            <div className="field-hint">{t('wishlist.privacyHint')}</div>
            <div className="modal-actions">
              <button type="submit" className="btn-primary">{t('form.save')}</button>
            </div>
          </form>
        )}

        {loading ? (
          <p className="field-hint">{t('wishlist.loading')}</p>
        ) : visibleItems.length === 0 ? (
          <p className="field-hint">{t('wishlist.empty')}</p>
        ) : (
          <div className="wishlist-list">
            {visibleItems.map((item) => (
              <div key={item.id} className="wishlist-row">
                {item.catalogImage && <img src={item.catalogImage} alt="" className="wishlist-row-image" />}
                <div className="wishlist-row-body">
                  <div className="wishlist-row-title">
                    {item.catalogName || item.privateName}
                    <span className={`condition-pill tone-${PRIORITY_TONE[item.priority] || 'blue'}`} style={{ marginLeft: 8 }}>
                      {t(`wishlist.priority${item.priority.charAt(0).toUpperCase() + item.priority.slice(1)}`)}
                    </span>
                  </div>
                  <div className="field-hint" style={{ margin: 0 }}>
                    {item.desiredCondition && `${t('wishlist.desiredCondition')}: ${item.desiredCondition}`}
                    {item.maxPrice ? `  ·  ${t('wishlist.maxPrice')}: ${currencyFmt(item.maxPrice)}` : ''}
                  </div>
                  {item.notes && <div className="card-notes">{item.notes}</div>}
                </div>
                <button type="button" className="icon-btn" onClick={() => handleRemove(item.id)} title={t('card.delete')}>🗑</button>
              </div>
            ))}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>{t('catFields.close')}</button>
        </div>
      </div>
    </div>
  );
}

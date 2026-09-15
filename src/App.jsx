import React, { useEffect, useMemo, useState } from 'react';
import ItemCard from './ItemCard.jsx';
import ItemForm from './ItemForm.jsx';
import AuthScreen from './AuthScreen.jsx';
import SettingsModal from './SettingsModal.jsx';
import CategoryFieldsModal from './CategoryFieldsModal.jsx';
import CollectorLevel from './CollectorLevel.jsx';
import QuoteOfTheDay from './QuoteOfTheDay.jsx';
import FeedbackModal from './FeedbackModal.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import { useI18n } from './i18n.jsx';
import logoMark from './assets/logo-mark.png';
import useImagePath from './useImagePath.js';
import { BACKGROUND_PATTERNS, DESIGN_THEME_BACKGROUND_MAP } from './theme-defaults.js';

const USER_STORAGE_KEY = 'collectorapp_user';
const ALL_CATEGORY = '__all__';

function CategoryThumb({ fileName, onClick, title }) {
  const src = useImagePath(fileName);
  return (
    <button type="button" className="category-thumb" onClick={onClick} title={title}>
      {src ? <img src={src} alt="" /> : <span className="category-thumb-placeholder">🖼</span>}
    </button>
  );
}

export default function App() {
  const { lang, t } = useI18n();
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem(USER_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [categoryImages, setCategoryImages] = useState({});
  const [categoryFields, setCategoryFields] = useState({});
  const [categoryTargets, setCategoryTargets] = useState({});
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORY);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategory, setEditingCategory] = useState(null);
  const [editingCategoryValue, setEditingCategoryValue] = useState('');
  const [managingFieldsFor, setManagingFieldsFor] = useState(null);
  const [showLevel, setShowLevel] = useState(false);
  const [showShowcase, setShowShowcase] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [dialog, setDialog] = useState(null);

  const askConfirm = (message, onConfirm) => setDialog({ message, onConfirm, alertOnly: false });
  const showAlert = (message) => setDialog({ message, onConfirm: null, alertOnly: true });

  const handleLogin = (userData) => {
    setUser(userData);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userData));
  };

  const handleSaveUser = (updatedUser) => {
    setUser(updatedUser);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(updatedUser));
  };

  const handleLogout = () => {
    localStorage.removeItem(USER_STORAGE_KEY);
    setUser(null);
    setShowSettings(false);
    setShowUserMenu(false);
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-color-theme', user?.colorTheme || 'indigo');
  }, [user?.colorTheme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-design-theme', user?.designTheme || 'classic');
  }, [user?.designTheme]);

  useEffect(() => {
    const pref = user?.theme || 'dark';
    const applyResolved = () => {
      const resolved = pref === 'system'
        ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
        : pref;
      document.documentElement.setAttribute('data-theme', resolved);
    };
    applyResolved();
    if (pref === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      mq.addEventListener('change', applyResolved);
      return () => mq.removeEventListener('change', applyResolved);
    }
  }, [user?.theme]);

  useEffect(() => {
    const designTheme = user?.designTheme || 'classic';
    const backgroundChoice = user?.background || 'auto';
    const key = backgroundChoice === 'auto' ? DESIGN_THEME_BACKGROUND_MAP[designTheme] : backgroundChoice;
    const pattern = BACKGROUND_PATTERNS[key];
    const root = document.documentElement;
    if (!pattern) {
      root.style.removeProperty('--app-bg-pattern');
      root.style.removeProperty('--app-bg-size');
      root.style.removeProperty('--app-bg-position');
      root.style.removeProperty('--app-bg-repeat');
    } else {
      root.style.setProperty('--app-bg-pattern', pattern.image);
      root.style.setProperty('--app-bg-size', pattern.size);
      root.style.setProperty('--app-bg-position', pattern.position || '0 0');
      root.style.setProperty('--app-bg-repeat', pattern.repeat || 'repeat');
    }
  }, [user?.designTheme, user?.background]);

  const loadData = async () => {
    const db = await window.api.getAll();
    setItems(db.items || []);
    setCategories(db.categories || []);
    setCategoryImages(db.categoryImages || {});
    setCategoryFields(db.categoryFields || {});
    setCategoryTargets(db.categoryTargets || {});
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSave = async (item) => {
    await window.api.saveItem(item);
    setShowForm(false);
    setEditingItem(null);
    loadData();
  };

  const handleDelete = (item) => {
    askConfirm(`"${item.name}" ${t('card.deleteConfirm')}`, async () => {
      await window.api.deleteItem(item.id);
      loadData();
    });
  };

  const handleImport = async () => {
    const result = await window.api.importZip();
    if (result.ok) {
      showAlert(`${result.count} ${t('import.success')}`);
      loadData();
    } else if (result.reason === 'invalid') {
      showAlert(t('import.invalid'));
    }
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setShowForm(true);
  };

  const handleAddCategory = async (e) => {
    e.preventDefault();
    const name = newCategoryName.trim();
    if (name) {
      await window.api.addCategory(name);
      loadData();
    }
    setNewCategoryName('');
    setAddingCategory(false);
  };

  const startEditCategory = (cat) => {
    setEditingCategory(cat);
    setEditingCategoryValue(cat);
  };

  const handleRenameCategory = async (e) => {
    e.preventDefault();
    const oldName = editingCategory;
    const newName = editingCategoryValue.trim();
    setEditingCategory(null);
    if (!newName || newName === oldName) return;
    await window.api.renameCategory(oldName, newName);
    if (activeCategory === oldName) setActiveCategory(newName);
    loadData();
  };

  const handleDeleteCategory = (cat) => {
    askConfirm(`"${cat}" ${t('sidebar.deleteCategoryConfirm')}`, async () => {
      await window.api.deleteCategory(cat);
      if (activeCategory === cat) setActiveCategory(ALL_CATEGORY);
      loadData();
    });
  };

  const handleSetCategoryImage = async (cat) => {
    const fileName = await window.api.pickImage();
    if (fileName) {
      await window.api.setCategoryImage(cat, fileName);
      loadData();
    }
  };

  const handleSaveCategoryFields = async (fields, target) => {
    const cat = managingFieldsFor;
    setManagingFieldsFor(null);
    await window.api.setCategoryFields(cat, fields);
    await window.api.setCategoryTarget(cat, target);
    loadData();
  };

  const filteredItems = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter((item) => {
      const matchesCategory = activeCategory === ALL_CATEGORY || item.category === activeCategory;
      const locationText = item.location ? Object.values(item.location).filter(Boolean).join(' ').toLowerCase() : '';
      const matchesSearch = !q || item.name.toLowerCase().includes(q) ||
        (item.notes || '').toLowerCase().includes(q) ||
        locationText.includes(q);
      return matchesCategory && matchesSearch;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [items, activeCategory, search]);

  const showcaseItems = useMemo(() => items.filter((i) => i.showcase), [items]);

  const stats = useMemo(() => {
    const totalItems = items.reduce((sum, i) => sum + (Number(i.quantity) || 1), 0);
    const totalValue = items.reduce((sum, i) => sum + (Number(i.value) || 0) * (Number(i.quantity) || 1), 0);
    return { totalItems, totalValue, uniqueItems: items.length };
  }, [items]);

  const categoryCounts = useMemo(() => {
    const counts = {};
    items.forEach((i) => { counts[i.category] = (counts[i.category] || 0) + 1; });
    return counts;
  }, [items]);

  const categoryBgFile = activeCategory !== ALL_CATEGORY ? categoryImages[activeCategory] : null;
  const categoryBgSrc = useImagePath(categoryBgFile);
  const mainStyle = categoryBgSrc ? {
    backgroundImage: `radial-gradient(ellipse 80% 55% at 50% -10%, var(--accent-soft), transparent 60%), linear-gradient(rgba(15,16,20,0.55), rgba(15,16,20,0.75)), url(${categoryBgSrc})`,
    backgroundSize: 'auto, cover, cover',
    backgroundPosition: '0 0, center, center',
    backgroundRepeat: 'no-repeat, no-repeat, no-repeat'
  } : undefined;
  const avatarSrc = useImagePath(user?.avatarImage);

  if (!user) {
    return <AuthScreen onLogin={handleLogin} />;
  }

  const initials = (user.name || 'U').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          <img src={logoMark} alt="" className="logo-icon" />
          {t('app.brand')}
        </div>

        <div className="stats-box">
          <div className="stat">
            <span className="stat-value">{stats.totalItems}</span>
            <span className="stat-label">{t('sidebar.totalItems')}</span>
          </div>
          <div className="stat">
            <span className="stat-value">
              {stats.totalValue.toLocaleString(lang === 'en' ? 'en-US' : 'de-DE', { style: 'currency', currency: user.currency || 'EUR' })}
            </span>
            <span className="stat-label">{t('sidebar.totalValue')}</span>
          </div>
        </div>

        <nav className="category-list">
          <button
            className={activeCategory === ALL_CATEGORY ? 'category-item active' : 'category-item'}
            onClick={() => setActiveCategory(ALL_CATEGORY)}
          >
            {t('sidebar.all')} <span className="count">{items.length}</span>
          </button>
          {categories.map((cat) => (
            editingCategory === cat ? (
              <form key={cat} className="category-edit-row" onSubmit={handleRenameCategory}>
                <input
                  type="text"
                  autoFocus
                  value={editingCategoryValue}
                  onChange={(e) => setEditingCategoryValue(e.target.value)}
                  onBlur={handleRenameCategory}
                  onKeyDown={(e) => { if (e.key === 'Escape') setEditingCategory(null); }}
                />
              </form>
            ) : (
              <div key={cat} className="category-row">
                <CategoryThumb
                  fileName={categoryImages[cat]}
                  title={t('sidebar.categoryImage')}
                  onClick={() => handleSetCategoryImage(cat)}
                />
                <button
                  className={activeCategory === cat ? 'category-item active' : 'category-item'}
                  onClick={() => setActiveCategory(cat)}
                >
                  <span className="category-item-label">{cat}</span>
                  <span className="count">{categoryCounts[cat] || 0}</span>
                </button>
                <div className="category-row-actions">
                  <button
                    className="category-icon-btn"
                    title={t('sidebar.manageFields')}
                    onClick={(e) => { e.stopPropagation(); setManagingFieldsFor(cat); }}
                  >
                    ⚙
                  </button>
                  <button
                    className="category-icon-btn"
                    title={t('sidebar.renameCategory')}
                    onClick={(e) => { e.stopPropagation(); startEditCategory(cat); }}
                  >
                    ✎
                  </button>
                  <button
                    className="category-icon-btn danger"
                    title={t('sidebar.deleteCategory')}
                    onClick={(e) => { e.stopPropagation(); handleDeleteCategory(cat); }}
                  >
                    🗑
                  </button>
                </div>
              </div>
            )
          ))}

          {addingCategory ? (
            <form className="category-edit-row" onSubmit={handleAddCategory}>
              <input
                type="text"
                autoFocus
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder={t('sidebar.newCategoryPlaceholder')}
                onBlur={handleAddCategory}
                onKeyDown={(e) => { if (e.key === 'Escape') { setAddingCategory(false); setNewCategoryName(''); } }}
              />
            </form>
          ) : (
            <button className="category-add-btn" onClick={() => setAddingCategory(true)}>
              + {t('sidebar.addCategory')}
            </button>
          )}
        </nav>

        <QuoteOfTheDay />
      </aside>

      <main className="main" style={mainStyle}>
        <div className="topbar">
          <input
            type="text"
            className="search-input"
            placeholder={t('topbar.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn-primary" onClick={() => { setEditingItem(null); setShowForm(true); }}>
            {t('topbar.newItem')}
          </button>

          <button
            className={showShowcase ? 'btn-secondary active' : 'btn-secondary'}
            onClick={() => setShowShowcase((v) => !v)}
            title={showShowcase ? t('topbar.backToCollection') : t('topbar.showcase')}
          >
            {showShowcase ? '🗂️' : '🌐'} {showShowcase ? t('topbar.backToCollection') : t('topbar.showcase')}
          </button>

          <button className="icon-btn topbar-icon-btn" onClick={() => setShowLevel(true)} title={t('topbar.level')}>
            🏆
          </button>

          <div className="user-menu-wrap">
            <button className="avatar avatar-btn" onClick={() => setShowUserMenu((v) => !v)}>
              {avatarSrc ? <img src={avatarSrc} alt="" /> : initials}
            </button>
            {showUserMenu && (
              <>
                <div className="user-menu-backdrop" onClick={() => setShowUserMenu(false)} />
                <div className="user-menu">
                  <div className="user-menu-header">
                    <div className="settings-user-name">{user.name}</div>
                    <div className="settings-user-email">{user.email}</div>
                  </div>
                  <button onClick={() => { setShowSettings(true); setShowUserMenu(false); }}>
                    ⚙️ {t('userMenu.settings')}
                  </button>
                  <button onClick={() => { setShowFeedback(true); setShowUserMenu(false); }}>
                    💬 {t('userMenu.feedback')}
                  </button>
                  <div className="user-menu-divider" />
                  <button onClick={() => { window.api.exportZip(); setShowUserMenu(false); }}>
                    ⬆️ {t('sidebar.export')}
                  </button>
                  <button onClick={() => { handleImport(); setShowUserMenu(false); }}>
                    ⬇️ {t('sidebar.import')}
                  </button>
                  <div className="user-menu-divider" />
                  <button className="danger" onClick={handleLogout}>
                    ⏻ {t('userMenu.logout')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {showShowcase ? (
          showcaseItems.length === 0 ? (
            <div className="empty-state">
              <p>{t('showcase.empty')}</p>
            </div>
          ) : (
            <div className="grid showcase-grid">
              {showcaseItems.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  readOnly
                />
              ))}
            </div>
          )
        ) : filteredItems.length === 0 ? (
          <div className="empty-state">
            <p>{t('empty.noItems')}</p>
            <button className="btn-primary" onClick={() => { setEditingItem(null); setShowForm(true); }}>
              {t('empty.addFirst')}
            </button>
          </div>
        ) : (
          <div className="grid">
            {filteredItems.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </main>

      {showForm && (
        <ItemForm
          item={editingItem}
          categories={categories.length ? categories : ['Sonstiges']}
          categoryFields={categoryFields}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditingItem(null); }}
        />
      )}

      {showSettings && (
        <SettingsModal
          user={user}
          onSave={handleSaveUser}
          onLogout={handleLogout}
          onClose={() => setShowSettings(false)}
        />
      )}

      {managingFieldsFor && (
        <CategoryFieldsModal
          category={managingFieldsFor}
          fields={categoryFields[managingFieldsFor]}
          target={categoryTargets[managingFieldsFor]}
          onSave={handleSaveCategoryFields}
          onClose={() => setManagingFieldsFor(null)}
        />
      )}

      {showLevel && (
        <CollectorLevel
          items={items}
          categories={categories}
          categoryTargets={categoryTargets}
          onClose={() => setShowLevel(false)}
        />
      )}

      {showFeedback && (
        <FeedbackModal
          user={user}
          onClose={() => setShowFeedback(false)}
        />
      )}

      {dialog && (
        <ConfirmDialog
          message={dialog.message}
          alertOnly={dialog.alertOnly}
          onConfirm={() => { const fn = dialog.onConfirm; setDialog(null); fn && fn(); }}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}

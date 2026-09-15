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
import CollectionDNA from './CollectionDNA.jsx';
import ImportExportModal from './ImportExportModal.jsx';
import { useI18n } from './i18n.jsx';
import logoMark from './assets/logo-mark.png';
import useImagePath from './useImagePath.js';
import { BACKGROUND_PATTERNS, DESIGN_THEME_BACKGROUND_MAP, COLOR_THEME_HEX, CASE_DESIGNS } from './theme-defaults.js';

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

function CategoryOverviewCard({
  name, fileName, onClick, countLabel, valueLabel,
  onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd, isDragging, isDropTarget
}) {
  const src = useImagePath(fileName);
  const classNames = ['category-overview-card'];
  if (isDragging) classNames.push('dragging');
  if (isDropTarget) classNames.push('drop-target');
  return (
    <button
      type="button"
      draggable
      className={classNames.join(' ')}
      onClick={onClick}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={src ? { backgroundImage: `linear-gradient(rgba(15,16,20,0.35), rgba(15,16,20,0.78)), url(${src})` } : undefined}
    >
      <span className="category-overview-name">{name}</span>
      <span className="category-overview-meta">
        <span className="category-overview-count">{countLabel}</span>
        <span className="category-overview-value">{valueLabel}</span>
      </span>
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
  const [categoryCaseDesigns, setCategoryCaseDesigns] = useState({});
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
  const [showDNA, setShowDNA] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [draggedCategory, setDraggedCategory] = useState(null);
  const [dragOverCategory, setDragOverCategory] = useState(null);
  const [dialog, setDialog] = useState(null);

  const askConfirm = (message, onConfirm, danger = false) => setDialog({ message, onConfirm, alertOnly: false, danger });
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
    const hex = COLOR_THEME_HEX[user?.colorTheme] || COLOR_THEME_HEX.indigo;
    window.api?.setTitleBarColor?.(hex, '#ffffff');
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
    setCategoryCaseDesigns(db.categoryCaseDesigns || {});
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
    }, true);
  };

  const handleUpdateValue = async (item, newValue) => {
    await window.api.saveItem({ ...item, value: newValue });
    loadData();
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

  const handleImportCsv = async () => {
    const result = await window.api.importCsv();
    if (result.ok) {
      showAlert(`${result.count} ${t('import.csvSuccess')}`);
      loadData();
    } else if (result.reason === 'invalid') {
      showAlert(t('import.csvInvalid'));
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
    const count = categoryCounts[cat] || 0;
    const message = count > 0
      ? `"${cat}" ${t('sidebar.deleteCategoryConfirmWithItems', { count })}`
      : `"${cat}" ${t('sidebar.deleteCategoryConfirm')}`;
    askConfirm(message, async () => {
      await window.api.deleteCategory(cat);
      if (activeCategory === cat) setActiveCategory(ALL_CATEGORY);
      loadData();
    }, true);
  };

  const handleReorderCategories = async (newOrder) => {
    setCategories(newOrder);
    await window.api.setCategoryOrder(newOrder);
  };

  const handleCategoryDrop = (targetCat) => {
    setDragOverCategory(null);
    if (!draggedCategory || draggedCategory === targetCat) { setDraggedCategory(null); return; }
    const newOrder = [...categories];
    const fromIdx = newOrder.indexOf(draggedCategory);
    const toIdx = newOrder.indexOf(targetCat);
    if (fromIdx === -1 || toIdx === -1) { setDraggedCategory(null); return; }
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, draggedCategory);
    setDraggedCategory(null);
    handleReorderCategories(newOrder);
  };

  const handleSetCategoryImage = async (cat) => {
    const fileName = await window.api.pickImage();
    if (fileName) {
      await window.api.setCategoryImage(cat, fileName);
      loadData();
    }
  };

  const handleSaveCategoryFields = async (fields, target, caseDesign) => {
    const cat = managingFieldsFor;
    setManagingFieldsFor(null);
    await window.api.setCategoryFields(cat, fields);
    await window.api.setCategoryTarget(cat, target);
    await window.api.setCategoryCaseDesign(cat, caseDesign);
    loadData();
  };

  const filteredItems = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter((item) => {
      const matchesCategory = activeCategory === ALL_CATEGORY || item.category === activeCategory;
      const matchesSearch = !q || item.name.toLowerCase().includes(q) ||
        (item.notes || '').toLowerCase().includes(q);
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

  const categoryValues = useMemo(() => {
    const totals = {};
    items.forEach((i) => {
      totals[i.category] = (totals[i.category] || 0) + (Number(i.value) || 0) * (Number(i.quantity) || 1);
    });
    return totals;
  }, [items]);

  const showCategoryOverview = activeCategory === ALL_CATEGORY && !search.trim() && !showShowcase && categories.length > 0;

  const categoryBgFile = activeCategory !== ALL_CATEGORY ? categoryImages[activeCategory] : null;
  const categoryBgSrc = useImagePath(categoryBgFile);
  const mainStyle = categoryBgSrc ? {
    backgroundImage: `radial-gradient(ellipse 80% 55% at 50% -10%, var(--accent-soft), transparent 60%), linear-gradient(rgba(15,16,20,0.55), rgba(15,16,20,0.75)), url(${categoryBgSrc})`,
    backgroundSize: 'auto, cover, cover',
    backgroundPosition: '0 0, center, center',
    backgroundRepeat: 'no-repeat, no-repeat, no-repeat'
  } : undefined;
  const avatarSrc = useImagePath(user?.avatarImage);

  const titleBar = (
    <div className="titlebar">
      <img src={logoMark} alt="" className="titlebar-logo" />
    </div>
  );

  if (!user) {
    return (
      <>
        {titleBar}
        <AuthScreen onLogin={handleLogin} />
      </>
    );
  }

  const initials = (user.name || 'U').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  const currencyFmt = (n) => n.toLocaleString(lang === 'en' ? 'en-US' : 'de-DE', { style: 'currency', currency: user.currency || 'EUR' });

  return (
    <>
      {titleBar}
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
            <span className="stat-value">{currencyFmt(stats.totalValue)}</span>
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

          <button className="icon-btn topbar-icon-btn" onClick={() => setShowDNA(true)} title={t('topbar.dna')}>
            🧬
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
                  <button onClick={() => { setShowImportExport(true); setShowUserMenu(false); }}>
                    📦 {t('userMenu.importExport')}
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
                  caseDesignSrc={CASE_DESIGNS[categoryCaseDesigns[item.category]]}
                  readOnly
                />
              ))}
            </div>
          )
        ) : showCategoryOverview ? (
          <div className="category-overview-grid">
            {categories.map((cat) => (
              <CategoryOverviewCard
                key={cat}
                name={cat}
                fileName={categoryImages[cat]}
                countLabel={t('category.itemCount', { count: categoryCounts[cat] || 0 })}
                valueLabel={currencyFmt(categoryValues[cat] || 0)}
                onClick={() => setActiveCategory(cat)}
                isDragging={draggedCategory === cat}
                isDropTarget={dragOverCategory === cat && draggedCategory !== cat}
                onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDraggedCategory(cat); }}
                onDragOver={(e) => { e.preventDefault(); if (dragOverCategory !== cat) setDragOverCategory(cat); }}
                onDragLeave={() => setDragOverCategory((c) => (c === cat ? null : c))}
                onDrop={(e) => { e.preventDefault(); handleCategoryDrop(cat); }}
                onDragEnd={() => { setDraggedCategory(null); setDragOverCategory(null); }}
              />
            ))}
          </div>
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
                caseDesignSrc={CASE_DESIGNS[categoryCaseDesigns[item.category]]}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onUpdateValue={handleUpdateValue}
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
          caseDesign={categoryCaseDesigns[managingFieldsFor]}
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

      {showDNA && (
        <CollectionDNA
          items={items}
          categoryFields={categoryFields}
          onClose={() => setShowDNA(false)}
        />
      )}

      {showImportExport && (
        <ImportExportModal
          onExportZip={() => { window.api.exportZip(); setShowImportExport(false); }}
          onImportZip={() => { handleImport(); setShowImportExport(false); }}
          onExportCsv={() => { window.api.exportCsv(); setShowImportExport(false); }}
          onImportCsv={() => { handleImportCsv(); setShowImportExport(false); }}
          onClose={() => setShowImportExport(false)}
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
          danger={dialog.danger}
          onConfirm={() => { const fn = dialog.onConfirm; setDialog(null); fn && fn(); }}
          onCancel={() => setDialog(null)}
        />
      )}
      </div>
    </>
  );
}

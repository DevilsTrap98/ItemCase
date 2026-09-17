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
import CommunityCatalogModal from './CommunityCatalogModal.jsx';
import UpgradeModal from './UpgradeModal.jsx';
import FriendsPanel from './FriendsPanel.jsx';
import LegalModal from './LegalModal.jsx';
import ChatWindow from './ChatWindow.jsx';
import GroupsModal from './GroupsModal.jsx';
import ForumHubModal from './ForumHubModal.jsx';
import { computeCollectorLevel } from './collectorLevel.js';
import NotificationBell from './NotificationBell.jsx';
import Toast from './Toast.jsx';
import { playNotificationSound } from './sound.js';
import { useI18n } from './i18n.jsx';
import logoMark from './assets/logo-mark.png';
import useImagePath from './useImagePath.js';
import { BACKGROUND_PATTERNS, DESIGN_THEME_BACKGROUND_MAP, CASE_DESIGNS } from './theme-defaults.js';
import { SUGGESTED_CATEGORIES } from './category-defaults.js';
import { getTariff } from './tariff-defaults.js';

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
  const [communityCatalog, setCommunityCatalog] = useState([]);
  const [catalogCategories, setCatalogCategories] = useState([]);
  const [friendsData, setFriendsData] = useState({ friends: [], incoming: [], outgoing: [] });
  const [showCommunityCatalog, setShowCommunityCatalog] = useState(false);
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
  const [showLegal, setShowLegal] = useState(false);
  const [showDNA, setShowDNA] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [openChats, setOpenChats] = useState([]); // [{ conversationId, title, initials, isGroup, peerId }]
  const [messagesByConversation, setMessagesByConversation] = useState({});
  const [conversationMeta, setConversationMeta] = useState({});
  const [notifications, setNotifications] = useState([]);
  const [toast, setToast] = useState(null);
  const [showGroups, setShowGroups] = useState(false);
  const [showForumHub, setShowForumHub] = useState(false);
  const [showCommunityMenu, setShowCommunityMenu] = useState(false);
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

  const initialsOf = (name) => (name || '?').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();

  const appendMessage = (msg) => {
    setMessagesByConversation((m) => {
      const list = m[msg.conversationId] || [];
      if (list.some((x) => x.id === msg.id)) return m;
      return { ...m, [msg.conversationId]: [...list, msg] };
    });
  };

  const refreshConversationMeta = async () => {
    const list = await window.api.conversationsList();
    const meta = {};
    list.forEach((c) => {
      if (c.type === 'direct' && c.peer) {
        meta[c.id] = { title: c.peer.name, initials: initialsOf(c.peer.name), isGroup: false, peerId: c.peer.id };
      } else if (c.type === 'group') {
        meta[c.id] = { title: c.groupName, initials: initialsOf(c.groupName), isGroup: true };
      }
    });
    setConversationMeta(meta);
    return meta;
  };

  const openChatByConversation = async (conversationId, metaHint) => {
    const meta = metaHint || conversationMeta[conversationId] || { title: '?', initials: '?', isGroup: false };
    setOpenChats((chats) => (chats.some((c) => c.conversationId === conversationId) ? chats : [...chats, { conversationId, ...meta }]));
    if (!messagesByConversation[conversationId]) {
      const history = await window.api.conversationsHistory(conversationId);
      setMessagesByConversation((m) => ({ ...m, [conversationId]: history }));
    }
    window.api.conversationsMarkRead(conversationId);
  };

  const handleOpenChat = async (friend) => {
    const result = await window.api.conversationsOpenDirect(friend.id);
    if (!result.ok) return;
    await openChatByConversation(result.id, { title: friend.name, initials: initialsOf(friend.name), isGroup: false, peerId: friend.id });
  };

  const handleOpenGroupChat = (group) => {
    openChatByConversation(group.conversationId, { title: group.name, initials: initialsOf(group.name), isGroup: true });
  };

  const handleCloseChat = (conversationId) => {
    setOpenChats((chats) => chats.filter((c) => c.conversationId !== conversationId));
  };

  const handleSendMessage = async (conversationId, body) => {
    const result = await window.api.conversationsSend(conversationId, body);
    if (result.ok) appendMessage(result.message);
    else showAlert(result.error || t('groups.errorGeneric'));
  };

  const handleBlockUser = (userId) => {
    askConfirm(t('friends.block') + '?', async () => {
      await window.api.blockUser(userId);
      setOpenChats((chats) => chats.filter((c) => c.peerId !== userId));
      loadFriends();
    }, true);
  };

  const loadNotifications = async () => {
    if (isGuest) { setNotifications([]); return; }
    setNotifications(await window.api.notificationsList());
  };

  const handleMarkNotificationRead = async (id) => {
    await window.api.notificationsMarkRead(id);
    setNotifications((list) => list.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
  };

  const handleMarkAllNotificationsRead = async () => {
    await window.api.notificationsMarkAllRead();
    setNotifications((list) => list.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
  };

  const handleLogout = async () => {
    await window.api.logout();
    localStorage.removeItem(USER_STORAGE_KEY);
    setUser(null);
    setShowSettings(false);
    setShowUserMenu(false);
  };

  const isGuest = !user?.id || !!user?.guest;

  const loadFriends = async () => {
    if (isGuest) {
      setFriendsData({ friends: [], incoming: [], outgoing: [] });
      return;
    }
    const data = await window.api.friendsList();
    setFriendsData(data);
  };

  const handleSendFriendRequest = async (toUsername) => {
    const result = await window.api.friendsSendRequest(toUsername);
    if (result.ok) loadFriends();
    return result;
  };

  const handleAcceptFriendRequest = async (id) => {
    await window.api.friendsAcceptRequest(id);
    loadFriends();
  };

  const handleDeclineFriendRequest = async (id) => {
    await window.api.friendsDeclineRequest(id);
    loadFriends();
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
    const applyTitleBarColor = () => {
      const styles = getComputedStyle(document.documentElement);
      const bg = styles.getPropertyValue('--bg-elevated').trim() || '#1c1e25';
      const text = styles.getPropertyValue('--text').trim() || '#ffffff';
      window.api?.setTitleBarColor?.(bg, text);
    };
    const raf = requestAnimationFrame(applyTitleBarColor);
    return () => cancelAnimationFrame(raf);
  }, [user?.colorTheme, user?.designTheme, user?.theme]);

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
    setCommunityCatalog(db.communityCatalog || []);
    setCatalogCategories(db.catalogCategories || []);
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    loadFriends();
    loadNotifications();
    if (!isGuest) refreshConversationMeta();
  }, [user?.id, user?.guest]);

  useEffect(() => {
    if (isGuest) return undefined;

    const unsubMessage = window.api.onNewMessage((msg) => {
      appendMessage(msg);
      if (msg.senderId !== user.id) {
        playNotificationSound();
        const meta = conversationMeta[msg.conversationId];
        setToast({
          title: meta?.title || msg.senderName,
          body: msg.body,
          onClick: () => openChatByConversation(msg.conversationId, meta)
        });
      }
    });

    const unsubNotification = window.api.onNewNotification((notification) => {
      setNotifications((list) => [notification, ...list]);
      playNotificationSound();
    });

    return () => { unsubMessage(); unsubNotification(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGuest, user?.id, conversationMeta]);

  const handleSave = async (item) => {
    if (!item.id && isOverItemLimit) {
      showAlert(t('tariff.overLimitBlocked', { limit: tariff.itemLimit }));
      return;
    }
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

  const handleAdoptCatalogItem = async (entry) => {
    await window.api.saveItem({
      name: entry.name,
      category: entry.category || categories[0] || 'Sonstiges',
      condition: 'nearMint',
      quantity: 1,
      value: '',
      purchasePrice: '',
      notes: '',
      imagePath: entry.imagePath || null,
      showcase: false,
      story: { place: '', date: '', isGift: false, isFirstPiece: false, text: '' },
      customFields: {},
      catalogInfo: {
        brand: entry.brand || '',
        releaseYear: entry.releaseYear || '',
        ean: entry.ean || '',
        isbn: entry.isbn || '',
        manufacturerNumber: entry.manufacturerNumber || ''
      },
      catalogItemId: entry.id
    });
    loadData();
  };

  const handleSubmitToCatalog = async (payload) => {
    await window.api.submitToCatalog(payload);
    loadData();
  };

  const handleProposePhoto = async (entry, payload) => {
    await window.api.proposeCatalogPhoto({ ...payload, catalogItemId: entry.id });
    loadData();
  };

  const handleProposeCategory = (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    askConfirm(t('catalog.proposeCategoryConfirm', { name: trimmed }), async () => {
      await window.api.proposeCatalogCategory(trimmed);
      loadData();
    });
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

  const tariff = getTariff(user?.tariff);
  const isOverItemLimit = items.length > tariff.itemLimit;

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
        <div className="logo-tagline">
          <div>{t('app.tagline')}</div>
          <div>{t('app.taglineSub')}</div>
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
                list="sidebar-category-suggestions"
                autoFocus
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder={t('sidebar.newCategoryPlaceholder')}
                onBlur={handleAddCategory}
                onKeyDown={(e) => { if (e.key === 'Escape') { setAddingCategory(false); setNewCategoryName(''); } }}
              />
              <datalist id="sidebar-category-suggestions">
                {SUGGESTED_CATEGORIES.filter((c) => !categories.includes(c)).map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </form>
          ) : (
            <button className="category-add-btn" onClick={() => setAddingCategory(true)}>
              + {t('sidebar.addCategory')}
            </button>
          )}
        </nav>

        <QuoteOfTheDay />
      </aside>

      <div className="content-column">
        <div className="topbar">
          <input
            type="text"
            className="search-input"
            placeholder={t('topbar.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            className="btn-primary"
            disabled={isOverItemLimit}
            title={isOverItemLimit ? t('tariff.overLimitBlocked', { limit: tariff.itemLimit }) : undefined}
            onClick={() => { setEditingItem(null); setShowForm(true); }}
          >
            {t('topbar.newItem')}
          </button>

          <div className="user-menu-wrap">
            <button className="btn-secondary" onClick={() => setShowCommunityMenu((v) => !v)}>
              🌍 {t('topbar.community')} ▾
            </button>
            {showCommunityMenu && (
              <>
                <div className="user-menu-backdrop" onClick={() => setShowCommunityMenu(false)} />
                <div className="user-menu">
                  <button onClick={() => { setShowCommunityCatalog(true); setShowCommunityMenu(false); }}>
                    📚 {t('topbar.communityCatalog')}
                  </button>
                  {!isGuest && (
                    <button onClick={() => { setShowForumHub(true); setShowCommunityMenu(false); }}>
                      💬 {t('topbar.forum')}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

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

          {!isGuest && (
            <>
              <button className="icon-btn topbar-icon-btn" onClick={() => setShowGroups(true)} title={t('topbar.groups')}>
                👥
              </button>
              <NotificationBell
                notifications={notifications}
                onMarkRead={handleMarkNotificationRead}
                onMarkAllRead={handleMarkAllNotificationsRead}
              />
            </>
          )}

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
                  <button onClick={() => { setShowUpgrade(true); setShowUserMenu(false); }}>
                    ⭐ {t('userMenu.upgrade')}
                  </button>
                  <button onClick={() => { setShowFeedback(true); setShowUserMenu(false); }}>
                    💬 {t('userMenu.feedback')}
                  </button>
                  <div className="user-menu-divider" />
                  <button onClick={() => { setShowImportExport(true); setShowUserMenu(false); }}>
                    📦 {t('userMenu.importExport')}
                  </button>
                  <div className="user-menu-divider" />
                  <button onClick={() => { setShowLegal(true); setShowUserMenu(false); }}>
                    📜 {t('userMenu.legal')}
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

        {isOverItemLimit && (
          <div className="tariff-banner">
            <span>{t('tariff.overLimitBanner', { count: items.length, limit: tariff.itemLimit })}</span>
            <button type="button" className="btn-primary tariff-banner-btn" onClick={() => setShowUpgrade(true)}>
              ⭐ {t('userMenu.upgrade')}
            </button>
          </div>
        )}

        <div className="content-row">
        <main className="main" style={mainStyle}>
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

        <FriendsPanel
          friends={friendsData.friends}
          incoming={friendsData.incoming}
          isGuest={isGuest}
          onOpenChat={handleOpenChat}
          onSendRequest={handleSendFriendRequest}
          onAccept={handleAcceptFriendRequest}
          onDecline={handleDeclineFriendRequest}
          onBlock={handleBlockUser}
        />
        </div>
      </div>

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
          itemCount={items.length}
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

      {showCommunityCatalog && (
        <CommunityCatalogModal
          catalog={communityCatalog}
          catalogCategories={catalogCategories}
          items={items}
          user={user}
          onAdopt={handleAdoptCatalogItem}
          onSubmit={handleSubmitToCatalog}
          onProposePhoto={handleProposePhoto}
          onProposeCategory={handleProposeCategory}
          onClose={() => setShowCommunityCatalog(false)}
        />
      )}

      {showUpgrade && (
        <UpgradeModal
          user={user}
          itemCount={items.length}
          onSelectTariff={(id) => handleSaveUser({ ...user, tariff: id })}
          onClose={() => setShowUpgrade(false)}
        />
      )}

      {showFeedback && (
        <FeedbackModal
          user={user}
          onClose={() => setShowFeedback(false)}
        />
      )}

      {showLegal && (
        <LegalModal onClose={() => setShowLegal(false)} />
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

      {openChats.length > 0 && (
        <div className="chat-dock">
          {openChats.map((chat) => (
            <ChatWindow
              key={chat.conversationId}
              conversationId={chat.conversationId}
              title={chat.title}
              initials={chat.initials}
              isGroup={chat.isGroup}
              messages={messagesByConversation[chat.conversationId]}
              currentUserId={user.id}
              onSend={handleSendMessage}
              onClose={() => handleCloseChat(chat.conversationId)}
              onBlock={chat.peerId ? () => handleBlockUser(chat.peerId) : null}
            />
          ))}
        </div>
      )}

      {showGroups && (
        <GroupsModal
          user={user}
          onClose={() => setShowGroups(false)}
          onOpenGroupChat={(g) => { handleOpenGroupChat(g); setShowGroups(false); }}
        />
      )}

      {showForumHub && (
        <ForumHubModal user={user} myLevel={computeCollectorLevel(items, categories)} onClose={() => setShowForumHub(false)} />
      )}

      {toast && (
        <Toast
          title={toast.title}
          body={toast.body}
          onClick={toast.onClick}
          onDismiss={() => setToast(null)}
        />
      )}
      </div>
    </>
  );
}

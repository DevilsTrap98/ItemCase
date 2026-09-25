const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell } = require('electron');
app.setName('ItemCase');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const sharp = require('sharp');
const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');

const isDev = process.env.NODE_ENV === 'development';
const hasSingleInstanceLock = app.requestSingleInstanceLock();
let mainWindow = null;

if (!hasSingleInstanceLock) app.quit();

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

const userDataDir = app.getPath('userData');
const imagesDir = path.join(userDataDir, 'images');
const feedbackFile = path.join(userDataDir, 'feedback-outbox.json');
const reportsFile = path.join(userDataDir, 'reports-outbox.json');
const authFile = path.join(userDataDir, 'auth.json');
// Local, per-machine backup settings and destination — deliberately not
// synced to the server (see backup:* handlers below): a snapshot of the
// user's own collection as plain JSON, dropped into a folder inside
// ItemCase's own app-data directory.
const backupSettingsFile = path.join(userDataDir, 'backup-settings.json');
const backupsDir = path.join(userDataDir, 'Backups');
let sessionToken = null;

// Development uses the server on this machine. Packaged clients connect to
// the ItemCase host in the local WLAN unless explicitly overridden.
const DEFAULT_API_ORIGIN = isDev ? 'http://localhost:5100' : 'http://192.168.2.39:5100';
const API_BASE_URL = process.env.ITEMCASE_API_URL || `${DEFAULT_API_ORIGIN}/api`;

const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

function fileToDataUrl(fileName) {
  if (!fileName) return null;
  if (fileName.startsWith('data:') || /^https?:\/\//i.test(fileName)) return fileName;
  const fullPath = path.isAbsolute(fileName) ? fileName : path.join(imagesDir, fileName);
  if (!fs.existsSync(fullPath)) return null;
  try {
    const mime = MIME_TYPES[path.extname(fullPath).toLowerCase()] || 'application/octet-stream';
    const data = fs.readFileSync(fullPath).toString('base64');
    return `data:${mime};base64,${data}`;
  } catch (e) {
    return null;
  }
}

function loadAuthToken() {
  if (sessionToken) return sessionToken;
  try {
    const saved = JSON.parse(fs.readFileSync(authFile, 'utf-8'));
    if (saved.encrypted && safeStorage.isEncryptionAvailable()) {
      sessionToken = safeStorage.decryptString(Buffer.from(saved.encrypted, 'base64'));
    } else {
      // One-time migration from older plaintext storage.
      sessionToken = saved.token || null;
      if (sessionToken) saveAuthToken(sessionToken, true);
    }
    return sessionToken;
  } catch (e) {
    return null;
  }
}

function saveAuthToken(token, persistent = false) {
  sessionToken = token;
  if (persistent) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Sichere Token-Speicherung ist auf diesem Gerät nicht verfügbar.');
    const encrypted = safeStorage.encryptString(token).toString('base64');
    fs.writeFileSync(authFile, JSON.stringify({ encrypted }), { mode: 0o600 });
  }
  else try { fs.unlinkSync(authFile); } catch (e) {}
}

async function imageInputToDataUrl(fileName) {
  if (!fileName || fileName.startsWith('data:')) return fileName || null;
  if (/^https?:\/\//i.test(fileName)) {
    const response = await fetch(fileName);
    if (!response.ok) throw new Error(`Bild konnte nicht geladen werden (${response.status}).`);
    const mime = String(response.headers.get('content-type') || '').split(';')[0];
    if (!Object.values(MIME_TYPES).includes(mime)) throw new Error('Nicht unterstütztes Bildformat.');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 6 * 1024 * 1024) throw new Error('Das Bild ist zu groß.');
    return `data:${mime};base64,${buffer.toString('base64')}`;
  }
  return fileToDataUrl(fileName);
}

function clearAuthToken() {
  sessionToken = null;
  try { fs.unlinkSync(authFile); } catch (e) {}
}

// Thin wrapper around the ItemCase backend (server/).
// Identifies this app to the server (see server/src/middleware/clientFilter.js).
// Not a secret — it ships inside the distributed .exe and can be read out
// of it — this only filters generic bots/scanners hitting the API with no
// client at all, never a substitute for the real JWT auth on every route.
const CLIENT_APP_ID = 'itemcase-desktop-v1';

async function apiFetch(urlPath, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-ItemCase-Client': CLIENT_APP_ID };
  if (auth) {
    const token = loadAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  let res;
  try {
    res = await fetch(`${API_BASE_URL}${urlPath}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (cause) {
    const error = new Error('Der ItemCase-Server ist nicht erreichbar. Bitte prüfe die Serververbindung und versuche es erneut.');
    error.code = 'API_UNREACHABLE';
    error.cause = cause;
    throw error;
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const error = new Error(data?.error || `API request failed (${res.status})`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

// Calls a /collection endpoint and returns the shape the renderer expects.
async function remoteCollectionCall(urlPath, options) {
  const remote = await apiFetch(`/collection${urlPath}`, { auth: true, ...options });
  const db = defaultDb();
  Object.assign(db, remote);
  return db;
}

// Live updates (new messages, notifications) by plain HTTP polling of
// GET /api/realtime/poll (server/src/realtime.js) — shared web hosting
// can't keep WebSockets open. One poller per app instance, shared by every
// renderer window; events are re-broadcast to all of them. Every ~10s is
// snappy enough for notifications/chat and doubles as the presence
// heartbeat ("online" = polled recently).
const REALTIME_POLL_MS = 10 * 1000;
const REALTIME_CHANNELS = { 'message:new': 'rt:message', 'notification:new': 'rt:notification', typing: 'rt:typing' };

let realtimeTimer = null;
let realtimeCursor = null;
let realtimeBusy = false;

function broadcast(channel, payload) {
  BrowserWindow.getAllWindows().forEach((win) => win.webContents.send(channel, payload));
}

async function pollRealtime() {
  if (realtimeBusy || !loadAuthToken()) return;
  realtimeBusy = true;
  try {
    const query = realtimeCursor === null ? '' : `?since=${realtimeCursor}`;
    const data = await apiFetch(`/realtime/poll${query}`, { auth: true });
    realtimeCursor = data.cursor;
    (data.events || []).forEach(({ event, payload }) => {
      if (REALTIME_CHANNELS[event]) broadcast(REALTIME_CHANNELS[event], payload);
    });
  } catch (err) {
    console.error('[itemcase-realtime] poll failed', err.message);
  } finally {
    realtimeBusy = false;
  }
}

function connectRealtime() {
  if (!loadAuthToken() || realtimeTimer) return;
  realtimeCursor = null;
  pollRealtime();
  realtimeTimer = setInterval(pollRealtime, REALTIME_POLL_MS);
}

function disconnectRealtime() {
  if (realtimeTimer) {
    clearInterval(realtimeTimer);
    realtimeTimer = null;
  }
  realtimeCursor = null;
}

function demoCatalogEntries() {
  const now = new Date().toISOString();
  return [
    {
      id: 'demo-switch-oled',
      name: 'Nintendo Switch OLED',
      brand: 'Nintendo',
      category: 'Konsolen',
      releaseYear: 2021,
      ean: '045496453435',
      isbn: '',
      manufacturerNumber: 'HEG-001',
      imagePath: null,
      status: 'approved',
      contributor: 'ItemCase Team',
      rightsConfirmed: true,
      licenseVersion: '1.0',
      submittedAt: now
    },
    {
      id: 'demo-lego-falcon',
      name: 'LEGO Star Wars Millennium Falcon',
      brand: 'LEGO',
      category: 'Bausets',
      releaseYear: 2020,
      ean: '',
      isbn: '',
      manufacturerNumber: '75257',
      imagePath: null,
      status: 'approved',
      contributor: 'ItemCase Team',
      rightsConfirmed: true,
      licenseVersion: '1.0',
      submittedAt: now
    },
    {
      id: 'demo-zelda-botw',
      name: 'The Legend of Zelda: Breath of the Wild',
      brand: 'Nintendo',
      category: 'Spiele',
      releaseYear: 2017,
      ean: '045496590420',
      isbn: '',
      manufacturerNumber: '',
      imagePath: null,
      status: 'approved',
      contributor: 'ItemCase Team',
      rightsConfirmed: true,
      licenseVersion: '1.0',
      submittedAt: now
    }
  ];
}

function ensureDirs() {
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
}

// This default object is transient. Signed-in users' private collection
// state always comes from the database-backed API.
function defaultDb() {
  return {
    items: [],
    categories: ['🎬 Filme & Serien', '🎮 Videospiele', '🃏 Trading Cards', '📚 Comics & Manga', '📦 Sonstige Sammlerstücke'],
    categoryImages: {},
    categoryFields: {},
    categoryTargets: {},
    categoryCaseDesigns: {},
    communityCatalog: demoCatalogEntries(),
    catalogPhotoProposals: [],
    catalogCategories: []
  };
}

function readDb() {
  return defaultDb();
}

function writeDb() {}

const isWindows = process.platform === 'win32';
const TITLEBAR_HEIGHT = 36;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: true,
    title: 'ItemCase',
    backgroundColor: '#1b1d22',
    icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    ...(isWindows ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#1c1e25', symbolColor: '#ffffff', height: TITLEBAR_HEIGHT }
    } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    },
    autoHideMenuBar: true
  });
  mainWindow = win;
  win.maximize();

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev ? url.startsWith('http://localhost:5173') : url.startsWith('file:');
    if (!allowed) event.preventDefault();
  });

  // Maximized (not OS fullscreen) — fills the screen but keeps the taskbar
  // and normal window chrome visible, unlike true fullscreen/kiosk mode.
  // `ready-to-show` is not guaranteed on every Windows/GPU combination.
  // The window is created visibly above; this event only focuses it once
  // the renderer has painted its first frame.
  win.once('ready-to-show', () => win.focus());
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
  win.webContents.on('did-fail-load', (_event, code, description) => {
    console.error('[itemcase] renderer failed to load', code, description);
    if (!win.isDestroyed()) { win.show(); win.focus(); }
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  ensureDirs();
  createWindow();
  connectRealtime();

  // maybeRunScheduledBackup() is a no-op until logged in and until enabled,
  // so it's safe to just always check shortly after startup, then hourly —
  // catches up on a due backup whenever the app next happens to be open,
  // rather than needing a precise OS-level scheduler.
  setTimeout(() => maybeRunScheduledBackup(), 15000);
  setInterval(() => maybeRunScheduledBackup(), 60 * 60 * 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC Handlers ----

function mapRemoteCatalogEntry(entry) {
  return { ...entry, imagePath: entry.imageUrl || null };
}

ipcMain.handle('items:getAll', async () => {
  const db = readDb();

  if (loadAuthToken()) {
    try {
      const remote = await apiFetch('/collection', { auth: true });
      db.items = remote.items;
      db.categories = remote.categories;
      db.categoryImages = remote.categoryImages;
      db.categoryFields = remote.categoryFields;
      db.categoryTargets = remote.categoryTargets;
      db.categoryCaseDesigns = remote.categoryCaseDesigns;
    } catch (e) {
      console.error('[itemcase-api] failed to load collection', e.message);
      // Never turn a failed database request into a valid-looking empty
      // collection. The renderer keeps its last known state and retries.
      throw e;
    }
  }

  try {
    const [catalog, categories] = await Promise.all([
      apiFetch('/catalog'),
      apiFetch('/catalog/categories')
    ]);
    db.communityCatalog = catalog.map(mapRemoteCatalogEntry);
    db.catalogCategories = categories;
  } catch (e) {
    // Offline or server unreachable — keep whatever was cached locally
    // from the last successful fetch/mutation.
    console.error('[itemcase-api] failed to load community catalog', e.message);
  }
  return db;
});

ipcMain.handle('items:save', async (_event, item) => {
  if (loadAuthToken()) {
    // imagePath is either a freshly picked local file (needs converting)
    // or already a data URL from a previous save/load — pass through as-is.
    const imageData = /^https?:\/\//i.test(item.imagePath || '')
      ? (item.id ? undefined : await imageInputToDataUrl(item.imagePath))
      : (item.imagePath && !item.imagePath.startsWith('data:') ? fileToDataUrl(item.imagePath) : (item.imagePath || null));
    const remote = await apiFetch('/collection/items', { method: 'POST', auth: true, body: { ...item, imageData } });
    const db = readDb();
    Object.assign(db, remote);
    writeDb(db);
    return db;
  }

  const db = readDb();
  const now = new Date().toISOString();
  if (item.id) {
    const idx = db.items.findIndex((i) => i.id === item.id);
    if (idx >= 0) {
      const previous = db.items[idx];
      const history = Array.isArray(previous.valueHistory) ? [...previous.valueHistory] : [];
      const oldValue = Number(previous.value) || 0;
      const newValue = Number(item.value) || 0;
      if (newValue !== oldValue) {
        history.push({ date: previous.updatedAt || previous.createdAt || now, value: oldValue });
      }
      db.items[idx] = { ...previous, ...item, valueHistory: history, updatedAt: now };
    }
  } else {
    item.id = crypto.randomUUID();
    item.createdAt = now;
    item.updatedAt = now;
    item.valueHistory = [];
    db.items.push(item);
  }
  if (item.category && !db.categories.includes(item.category)) {
    db.categories.push(item.category);
  }
  writeDb(db);
  return db;
});

ipcMain.handle('items:delete', async (_event, id) => {
  if (loadAuthToken()) {
    const remote = await apiFetch(`/collection/items/${id}`, { method: 'DELETE', auth: true });
    const db = readDb();
    Object.assign(db, remote);
    writeDb(db);
    return db;
  }

  const db = readDb();
  const item = db.items.find((i) => i.id === id);
  if (item && item.imagePath) {
    const fullPath = path.join(imagesDir, path.basename(item.imagePath));
    if (fs.existsSync(fullPath)) {
      try { fs.unlinkSync(fullPath); } catch (e) {}
    }
  }
  db.items = db.items.filter((i) => i.id !== id);
  writeDb(db);
  return db;
});

ipcMain.handle('categories:add', async (_event, category) => {
  if (loadAuthToken()) return remoteCollectionCall('/categories', { method: 'POST', body: { category } });

  const db = readDb();
  if (category && !db.categories.includes(category)) {
    db.categories.push(category);
    writeDb(db);
  }
  return db;
});

ipcMain.handle('categories:rename', async (_event, { oldName, newName }) => {
  if (loadAuthToken()) return remoteCollectionCall('/categories/rename', { method: 'POST', body: { oldName, newName } });

  const db = readDb();
  const trimmed = (newName || '').trim();
  if (!trimmed || !db.categories.includes(oldName)) return db;

  if (trimmed !== oldName && db.categories.includes(trimmed)) {
    // Zielname existiert bereits -> Kategorien zusammenführen
    db.categories = db.categories.filter((c) => c !== oldName);
  } else {
    db.categories = db.categories.map((c) => (c === oldName ? trimmed : c));
  }

  db.items = db.items.map((item) => (
    item.category === oldName ? { ...item, category: trimmed } : item
  ));

  if (trimmed !== oldName) {
    if (db.categoryImages[oldName]) {
      db.categoryImages[trimmed] = db.categoryImages[oldName];
      delete db.categoryImages[oldName];
    }
    if (db.categoryFields[oldName]) {
      db.categoryFields[trimmed] = db.categoryFields[oldName];
      delete db.categoryFields[oldName];
    }
    if (db.categoryTargets[oldName]) {
      db.categoryTargets[trimmed] = db.categoryTargets[oldName];
      delete db.categoryTargets[oldName];
    }
    if (db.categoryCaseDesigns[oldName]) {
      db.categoryCaseDesigns[trimmed] = db.categoryCaseDesigns[oldName];
      delete db.categoryCaseDesigns[oldName];
    }
  }

  writeDb(db);
  return db;
});

ipcMain.handle('categories:delete', async (_event, category) => {
  if (loadAuthToken()) return remoteCollectionCall(`/categories/${encodeURIComponent(category)}`, { method: 'DELETE' });

  const db = readDb();
  db.categories = db.categories.filter((c) => c !== category);

  db.items.forEach((item) => {
    if (item.category !== category) return;
    if (item.imagePath) {
      const fullPath = path.join(imagesDir, item.imagePath);
      if (fs.existsSync(fullPath)) {
        try { fs.unlinkSync(fullPath); } catch (e) {}
      }
    }
  });
  db.items = db.items.filter((item) => item.category !== category);

  const catImage = db.categoryImages[category];
  if (catImage) {
    const fullPath = path.join(imagesDir, catImage);
    if (fs.existsSync(fullPath)) {
      try { fs.unlinkSync(fullPath); } catch (e) {}
    }
    delete db.categoryImages[category];
  }
  delete db.categoryFields[category];
  delete db.categoryTargets[category];
  delete db.categoryCaseDesigns[category];

  writeDb(db);
  return db;
});

// Submissions go straight to the shared server (server/src/routes/catalog.js).
// If it's unreachable, the entry is kept in the local cache only — marked
// pending — so nothing is lost; it isn't retried automatically since there's
// no offline-sync queue yet.
ipcMain.handle('catalog:submit', async (_event, payload) => {
  const db = readDb();
  const now = new Date().toISOString();
  const imageData = payload.imagePath ? await imageInputToDataUrl(payload.imagePath) : null;

  try {
    await apiFetch('/catalog', {
      method: 'POST',
      auth: true,
      body: { ...payload, imageData }
    });
    const catalog = await apiFetch('/catalog');
    db.communityCatalog = catalog.map(mapRemoteCatalogEntry);
  } catch (e) {
    console.error('[itemcase-api] catalog submit failed, keeping locally only', e.message);
    db.communityCatalog.push({
      id: crypto.randomUUID(),
      name: payload.name || '',
      brand: payload.brand || '',
      category: payload.category || '',
      releaseYear: payload.releaseYear || '',
      ean: payload.ean || '',
      isbn: payload.isbn || '',
      manufacturerNumber: payload.manufacturerNumber || '',
      imagePath: payload.imagePath || null,
      marketValue: payload.marketValue || '',
      conditionValues: payload.conditionValues || {},
      status: 'pending',
      contributor: payload.contributor || '',
      rightsConfirmed: !!payload.rightsConfirmed,
      licenseVersion: payload.licenseVersion || '1.0',
      submittedAt: now
    });
  }
  writeDb(db);
  return db.communityCatalog;
});

ipcMain.handle('catalog:proposePhoto', async (_event, payload) => {
  const db = readDb();
  const imageData = payload.imagePath ? await imageInputToDataUrl(payload.imagePath) : null;

  try {
    await apiFetch(`/catalog/${payload.catalogItemId}/photo`, {
      method: 'POST',
      auth: true,
      body: { ...payload, imageData }
    });
  } catch (e) {
    console.error('[itemcase-api] photo proposal failed, keeping locally only', e.message);
    db.catalogPhotoProposals.push({
      id: crypto.randomUUID(),
      catalogItemId: payload.catalogItemId,
      imagePath: payload.imagePath || null,
      contributor: payload.contributor || '',
      rightsConfirmed: !!payload.rightsConfirmed,
      licenseVersion: payload.licenseVersion || '1.0',
      status: 'pending',
      submittedAt: new Date().toISOString()
    });
    writeDb(db);
  }
  return db.catalogPhotoProposals;
});

ipcMain.handle('catalog:proposeCategory', async (_event, name) => {
  const db = readDb();
  const trimmed = (name || '').trim();
  if (!trimmed) return db.catalogCategories;

  try {
    db.catalogCategories = await apiFetch('/catalog/categories', { method: 'POST', auth: true, body: { name: trimmed } });
  } catch (e) {
    console.error('[itemcase-api] category proposal failed, keeping locally only', e.message);
    if (!db.catalogCategories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) {
      db.catalogCategories.push(trimmed);
    }
  }
  writeDb(db);
  return db.catalogCategories;
});

ipcMain.handle('catalog:myProgress', async () => {
  try {
    return await apiFetch('/catalog/mine/progress', { auth: true });
  } catch (e) {
    return null;
  }
});

ipcMain.handle('catalog:proposeCorrection', async (_event, { catalogItemId, fields }) => {
  try {
    return { ok: true, ...(await apiFetch(`/catalog/${catalogItemId}/propose-change`, { method: 'POST', auth: true, body: fields })) };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('catalog:resubmitCorrection', async (_event, { changeRequestId, fields }) => {
  try {
    return { ok: true, ...(await apiFetch(`/catalog/change-requests/${changeRequestId}`, { method: 'PUT', auth: true, body: fields })) };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('catalog:myChangeRequests', async () => {
  try {
    return await apiFetch('/catalog/mine/change-requests', { auth: true });
  } catch (e) {
    return [];
  }
});

ipcMain.handle('catalog:myXpHistory', async () => {
  try {
    return await apiFetch('/catalog/mine/xp-history', { auth: true });
  } catch (e) {
    return [];
  }
});

ipcMain.handle('catalog:myRewards', async () => {
  try {
    return await apiFetch('/catalog/mine/rewards', { auth: true });
  } catch (e) {
    return [];
  }
});

ipcMain.handle('catalog:activateReward', async (_event, rewardId) => {
  try {
    return { ok: true, ...(await apiFetch(`/catalog/mine/rewards/${rewardId}/activate`, { method: 'POST', auth: true })) };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('catalog:mySubmissions', async () => {
  try {
    return await apiFetch('/catalog/mine/submissions', { auth: true });
  } catch (e) {
    return [];
  }
});

ipcMain.handle('catalog:communityValues', async (_event, catalogItemId) => {
  try {
    return await apiFetch(`/catalog/${catalogItemId}/community-values`, { auth: !!loadAuthToken() });
  } catch (e) {
    return null;
  }
});

ipcMain.handle('catalog:submitCommunityValueEstimate', async (_event, { catalogItemId, conditionCode, value }) => {
  try {
    return { ok: true, ...(await apiFetch(`/catalog/${catalogItemId}/community-value-estimate`, { method: 'POST', auth: true, body: { conditionCode, value } })) };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('catalog:confirmCommunityValueEstimate', async (_event, { catalogItemId, conditionCode }) => {
  try {
    return { ok: true, ...(await apiFetch(`/catalog/${catalogItemId}/community-value-estimate/${conditionCode}/confirm`, { method: 'POST', auth: true })) };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('catalog:withdrawCommunityValueEstimate', async (_event, { catalogItemId, conditionCode }) => {
  try {
    return { ok: true, ...(await apiFetch(`/catalog/${catalogItemId}/community-value-estimate/${conditionCode}`, { method: 'DELETE', auth: true })) };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('showcase:getMyProfile', async () => {
  try {
    const profile = await apiFetch('/showcase/profile/mine', { auth: true });
    const origin = API_BASE_URL.replace(/\/api\/?$/, '');
    return { ...profile, publicUrl: profile?.username ? `${origin}/showcase/${profile.username}` : null };
  } catch (e) {
    return null;
  }
});

ipcMain.handle('showcase:saveProfile', async (_event, payload) => {
  try {
    return { ok: true, ...(await apiFetch('/showcase/profile', { method: 'PUT', auth: true, body: payload })) };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('showcase:setOrder', async (_event, itemIds) => {
  try {
    return { ok: true, ...(await apiFetch('/showcase/order', { method: 'PUT', auth: true, body: { itemIds } })) };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('collection:communityValueSummary', async () => {
  try {
    return await apiFetch('/collection/community-value-summary', { auth: true });
  } catch (e) {
    return null;
  }
});

ipcMain.handle('categories:setCaseDesign', async (_event, { name, caseDesign }) => {
  if (loadAuthToken()) return remoteCollectionCall(`/categories/${encodeURIComponent(name)}/case-design`, { method: 'PUT', body: { caseDesign } });

  const db = readDb();
  if (caseDesign) {
    db.categoryCaseDesigns[name] = caseDesign;
  } else {
    delete db.categoryCaseDesigns[name];
  }
  writeDb(db);
  return db;
});

ipcMain.handle('categories:setFields', async (_event, { name, fields }) => {
  if (loadAuthToken()) return remoteCollectionCall(`/categories/${encodeURIComponent(name)}/fields`, { method: 'PUT', body: { fields } });

  const db = readDb();
  if (Array.isArray(fields) && fields.length > 0) {
    db.categoryFields[name] = fields;
  } else {
    delete db.categoryFields[name];
  }
  writeDb(db);
  return db;
});

ipcMain.handle('categories:setTarget', async (_event, { name, target }) => {
  if (loadAuthToken()) return remoteCollectionCall(`/categories/${encodeURIComponent(name)}/target`, { method: 'PUT', body: { target } });

  const db = readDb();
  const num = Number(target);
  if (num > 0) {
    db.categoryTargets[name] = num;
  } else {
    delete db.categoryTargets[name];
  }
  writeDb(db);
  return db;
});

ipcMain.handle('categories:setOrder', async (_event, order) => {
  if (loadAuthToken()) return remoteCollectionCall('/categories/order', { method: 'PUT', body: { order } });

  const db = readDb();
  if (Array.isArray(order)) {
    const known = new Set(db.categories);
    const cleaned = order.filter((c) => known.has(c));
    db.categories.forEach((c) => { if (!cleaned.includes(c)) cleaned.push(c); });
    db.categories = cleaned;
  }
  writeDb(db);
  return db;
});

ipcMain.handle('categories:setImage', async (_event, { name, fileName }) => {
  if (loadAuthToken()) {
    const imageData = fileName ? fileToDataUrl(fileName) : null;
    return remoteCollectionCall(`/categories/${encodeURIComponent(name)}/image`, { method: 'PUT', body: { imageData } });
  }

  const db = readDb();
  const previous = db.categoryImages[name];
  if (previous && previous !== fileName) {
    const fullPath = path.join(imagesDir, previous);
    if (fs.existsSync(fullPath)) {
      try { fs.unlinkSync(fullPath); } catch (e) {}
    }
  }
  if (fileName) {
    db.categoryImages[name] = fileName;
  } else {
    delete db.categoryImages[name];
  }
  writeDb(db);
  return db;
});

ipcMain.handle('window:setTitleBarColor', (event, { color, symbolColor }) => {
  if (!isWindows) return false;
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && typeof win.setTitleBarOverlay === 'function') {
    win.setTitleBarOverlay({ color, symbolColor: symbolColor || '#ffffff', height: TITLEBAR_HEIGHT });
  }
  return true;
});

ipcMain.handle('image:pick', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Bild auswählen',
    properties: ['openFile'],
    filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const srcPath = result.filePaths[0];
  try {
    // Normalize every uploaded image to the same shape the future catalog server will
    // store: resized, EXIF/GPS stripped (sharp drops metadata unless withMetadata() is
    // called), and re-encoded as WebP. fit:'inside' keeps the whole photo, uncropped —
    // correct for item/listing photos, but NOT for an avatar (see image:pickAvatar).
    const buffer = await sharp(srcPath)
      .resize(1400, 1400, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    return `data:image/webp;base64,${buffer.toString('base64')}`;
  } catch (e) {
    return fileToDataUrl(srcPath);
  }
});

// A dedicated picker for avatars specifically: center-cropped to a square
// at pick time, so what's stored already matches the circular frame it's
// always displayed in (CSS object-fit:cover on a non-square source only
// crops for *display*, it never changes what's actually saved — this makes
// the saved file itself square, so there's no surprise between contexts).
ipcMain.handle('image:pickAvatar', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Profilbild auswählen',
    properties: ['openFile'],
    filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const srcPath = result.filePaths[0];
  try {
    const buffer = await sharp(srcPath)
      .resize(512, 512, { fit: 'cover', position: 'attention' })
      .webp({ quality: 85 })
      .toBuffer();
    return `data:image/webp;base64,${buffer.toString('base64')}`;
  } catch (e) {
    return fileToDataUrl(srcPath);
  }
});

ipcMain.handle('image:getPath', (_event, fileName) => fileToDataUrl(fileName));

function queueLocally(file, entry) {
  let entries = [];
  try {
    entries = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    entries = [];
  }
  entries.push(entry);
  fs.writeFileSync(file, JSON.stringify(entries, null, 2));
}

// Sent straight to the server (server/src/routes/feedback.js). Falls back
// to the local outbox file if the server is unreachable — nothing else
// currently drains that file, so a support request would need to pull it
// from the user's machine, same as before the server existed.
ipcMain.handle('feedback:send', async (_event, { type, message }) => {
  const payload = { type, message, appVersion: app.getVersion(), platform: process.platform };
  try {
    await apiFetch('/feedback', { method: 'POST', auth: true, body: payload });
  } catch (e) {
    console.error('[itemcase-api] feedback send failed, queued locally', e.message);
    queueLocally(feedbackFile, { id: crypto.randomUUID(), ...payload, createdAt: new Date().toISOString() });
  }
  return true;
});

ipcMain.handle('catalog:report', async (_event, { targetType, targetId, targetName, reason, comment }) => {
  const payload = { targetType, targetId, targetName, reason, comment: comment || '' };
  try {
    await apiFetch('/reports', { method: 'POST', auth: true, body: payload });
  } catch (e) {
    console.error('[itemcase-api] report send failed, queued locally', e.message);
    queueLocally(reportsFile, { id: crypto.randomUUID(), ...payload, status: 'open', createdAt: new Date().toISOString() });
  }
  return true;
});

// Refreshes the local cache from the server for logged-in users before an
// export, so exportZip/exportCsv never ship stale cached data.
async function freshDb() {
  if (!loadAuthToken()) return readDb();
  return apiFetch('/collection', { auth: true });
}

// ---- Local JSON backups ----
// Opt-in, per-machine scheduled snapshots of the collection as a single
// self-contained JSON file (no separate images/ folder like exportZip) —
// item/category images are fetched and embedded as data: URLs at backup
// time, since /collection returns short-lived signed image URLs (expire
// after ~1h) that would otherwise be dead by the time an old backup is
// ever opened again.
const BACKUP_FREQUENCIES = new Set(['daily', 'weekly', 'monthly']);
const BACKUP_INTERVAL_MS = { daily: 24 * 60 * 60 * 1000, weekly: 7 * 24 * 60 * 60 * 1000, monthly: 30 * 24 * 60 * 60 * 1000 };
const MAX_AUTO_BACKUPS = 20; // retention: oldest files beyond this are pruned after each run

function readBackupSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(backupSettingsFile, 'utf-8'));
    return {
      enabled: !!parsed.enabled,
      frequency: BACKUP_FREQUENCIES.has(parsed.frequency) ? parsed.frequency : 'daily',
      lastBackupAt: parsed.lastBackupAt || null
    };
  } catch (e) {
    return { enabled: false, frequency: 'daily', lastBackupAt: null };
  }
}

function writeBackupSettings(settings) {
  ensureDirs();
  fs.writeFileSync(backupSettingsFile, JSON.stringify(settings, null, 2), 'utf-8');
}

async function embedImagesForBackup(db) {
  const cache = new Map();
  const resolve = async (url) => {
    if (!url) return url;
    if (cache.has(url)) return cache.get(url);
    const promise = imageInputToDataUrl(url).catch((e) => {
      // Fall back to the original (possibly already-expired) URL rather
      // than silently dropping the image from the backup.
      console.error('[backup] could not embed image', e.message);
      return url;
    });
    cache.set(url, promise);
    return promise;
  };
  const items = await Promise.all((db.items || []).map(async (item) => ({ ...item, imagePath: await resolve(item.imagePath) })));
  const categoryImages = {};
  for (const [name, url] of Object.entries(db.categoryImages || {})) {
    categoryImages[name] = await resolve(url);
  }
  return { ...db, items, categoryImages };
}

async function performBackup() {
  ensureDirs();
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
  const db = await embedImagesForBackup(await freshDb());
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `itemcase-backup-${timestamp}.json`;
  fs.writeFileSync(path.join(backupsDir, fileName), JSON.stringify(db, null, 2), 'utf-8');

  const files = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.json')).sort().reverse();
  files.slice(MAX_AUTO_BACKUPS).forEach((f) => { try { fs.unlinkSync(path.join(backupsDir, f)); } catch (e) {} });

  return fileName;
}

// Checked once shortly after startup/login and again every hour while the
// app stays open — the app isn't guaranteed to be running exactly when a
// backup falls due, so this just catches up as soon as it next can, rather
// than needing a precise OS-level scheduler.
async function maybeRunScheduledBackup() {
  if (!loadAuthToken()) return;
  const settings = readBackupSettings();
  if (!settings.enabled) return;
  const intervalMs = BACKUP_INTERVAL_MS[settings.frequency] || BACKUP_INTERVAL_MS.daily;
  const last = settings.lastBackupAt ? new Date(settings.lastBackupAt).getTime() : 0;
  if (Date.now() - last < intervalMs) return;
  try {
    await performBackup();
    writeBackupSettings({ ...settings, lastBackupAt: new Date().toISOString() });
  } catch (e) {
    console.error('[backup] scheduled backup failed', e.message);
  }
}

ipcMain.handle('backup:getSettings', async () => ({ ...readBackupSettings(), folderPath: backupsDir }));

ipcMain.handle('backup:saveSettings', async (_event, { enabled, frequency } = {}) => {
  const current = readBackupSettings();
  const next = {
    ...current,
    enabled: !!enabled,
    frequency: BACKUP_FREQUENCIES.has(frequency) ? frequency : current.frequency
  };
  writeBackupSettings(next);
  // Enabling it now shouldn't require waiting a full cycle for the first one.
  if (next.enabled && !current.lastBackupAt) maybeRunScheduledBackup();
  return { ok: true, settings: next };
});

ipcMain.handle('backup:createNow', async () => {
  if (!loadAuthToken()) return { ok: false, error: 'Backups sind nur für angemeldete Konten verfügbar.' };
  try {
    const fileName = await performBackup();
    writeBackupSettings({ ...readBackupSettings(), lastBackupAt: new Date().toISOString() });
    return { ok: true, fileName };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('backup:list', async () => {
  ensureDirs();
  if (!fs.existsSync(backupsDir)) return [];
  return fs.readdirSync(backupsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const stat = fs.statSync(path.join(backupsDir, f));
      return { fileName: f, size: stat.size, mtime: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
});

ipcMain.handle('backup:openFolder', async () => {
  ensureDirs();
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
  await shell.openPath(backupsDir);
  return { ok: true };
});

ipcMain.handle('backup:restore', async (_event, fileName) => {
  if (!loadAuthToken()) return { ok: false, reason: 'not_logged_in' };

  let filePath;
  if (fileName) {
    const resolved = path.join(backupsDir, fileName);
    if (path.dirname(resolved) !== backupsDir) return { ok: false, reason: 'invalid' };
    filePath = resolved;
  } else {
    ensureDirs();
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
    const result = await dialog.showOpenDialog({
      title: 'Backup auswählen',
      defaultPath: backupsDir,
      properties: ['openFile'],
      filters: [{ name: 'ItemCase-Backup', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, reason: 'canceled' };
    filePath = result.filePaths[0];
  }

  let imported;
  try {
    imported = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    return { ok: false, reason: 'invalid' };
  }
  if (!imported || !Array.isArray(imported.items)) return { ok: false, reason: 'invalid' };

  const importedCategories = Array.isArray(imported.categories) ? [...imported.categories] : [];
  const importedItems = imported.items.map((item) => ({ ...item, id: undefined, updatedAt: new Date().toISOString() }));
  importedItems.forEach((item) => { if (item.category && !importedCategories.includes(item.category)) importedCategories.push(item.category); });

  for (const cat of importedCategories) {
    if (!cat) continue;
    try { await apiFetch('/collection/categories', { method: 'POST', auth: true, body: { category: cat } }); } catch (e) {}
  }
  let restoredCount = 0;
  for (const item of importedItems) {
    // A backup's imagePath is already a data: URL (embedded at backup time)
    // or, for an older/foreign file, possibly still a bare local filename —
    // never re-fetched from a URL here since restoring shouldn't depend on
    // that URL (likely someone else's signed link, or long expired) still
    // being reachable.
    const imageData = item.imagePath && !item.imagePath.startsWith('data:') && !/^https?:\/\//i.test(item.imagePath)
      ? fileToDataUrl(item.imagePath)
      : (item.imagePath && item.imagePath.startsWith('data:') ? item.imagePath : null);
    try {
      await apiFetch('/collection/items', { method: 'POST', auth: true, body: { ...item, imageData } });
      restoredCount += 1;
    } catch (e) {
      console.error('[backup] failed to restore item', item.name, e.message);
    }
  }
  await freshDb();
  return { ok: true, count: restoredCount };
});

ipcMain.handle('data:exportZip', async () => {
  const result = await dialog.showSaveDialog({
    title: 'Sammlung exportieren',
    defaultPath: 'sammlung-export.zip',
    filters: [{ name: 'ZIP-Archiv', extensions: ['zip'] }]
  });
  if (result.canceled || !result.filePath) return false;

  const db = await freshDb();
  const zip = new AdmZip();

  zip.addFile('collection.json', Buffer.from(JSON.stringify(db, null, 2), 'utf-8'));

  const addedImages = new Set();
  db.items.forEach((item) => {
    if (!item.imagePath || addedImages.has(item.imagePath)) return;
    const fullPath = path.join(imagesDir, item.imagePath);
    if (fs.existsSync(fullPath)) {
      zip.addLocalFile(fullPath, 'images');
      addedImages.add(item.imagePath);
    }
  });
  Object.values(db.categoryImages || {}).forEach((fileName) => {
    if (!fileName || addedImages.has(fileName)) return;
    const fullPath = path.join(imagesDir, fileName);
    if (fs.existsSync(fullPath)) {
      zip.addLocalFile(fullPath, 'images');
      addedImages.add(fileName);
    }
  });

  zip.writeZip(result.filePath);
  return true;
});

ipcMain.handle('data:importZip', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Sammlung importieren',
    properties: ['openFile'],
    filters: [{ name: 'ZIP-Archiv', extensions: ['zip'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, reason: 'canceled' };

  let zip;
  try {
    zip = new AdmZip(result.filePaths[0]);
  } catch (e) {
    return { ok: false, reason: 'invalid' };
  }

  const collectionEntry = zip.getEntry('collection.json');
  if (!collectionEntry) return { ok: false, reason: 'invalid' };

  let imported;
  try {
    imported = JSON.parse(zip.readAsText(collectionEntry));
  } catch (e) {
    return { ok: false, reason: 'invalid' };
  }
  if (!imported || !Array.isArray(imported.items)) return { ok: false, reason: 'invalid' };

  // Import images in memory as data URLs; collection data is never written
  // into ItemCase's local application-data directory.
  const imageNameMap = {};
  zip.getEntries().forEach((entry) => {
    if (entry.isDirectory || !entry.entryName.startsWith('images/')) return;
    const originalName = path.basename(entry.entryName);
    const mime = MIME_TYPES[path.extname(originalName).toLowerCase()] || 'application/octet-stream';
    imageNameMap[originalName] = `data:${mime};base64,${entry.getData().toString('base64')}`;
  });

  const importedItems = imported.items.map((item) => ({
    ...item,
    id: crypto.randomUUID(),
    // A pre-existing data URL (server-backed export) needs no remapping;
    // a plain filename (older local export) is resolved via imageNameMap.
    imagePath: item.imagePath && item.imagePath.startsWith('data:')
      ? item.imagePath
      : (item.imagePath && imageNameMap[item.imagePath] ? imageNameMap[item.imagePath] : null),
    updatedAt: new Date().toISOString()
  }));

  const importedCategories = Array.isArray(imported.categories) ? imported.categories : [];
  importedItems.forEach((item) => {
    if (item.category && !importedCategories.includes(item.category)) importedCategories.push(item.category);
  });

  if (loadAuthToken()) {
    for (const cat of importedCategories) {
      if (!cat) continue;
      try { await apiFetch('/collection/categories', { method: 'POST', auth: true, body: { category: cat } }); } catch (e) {}
    }
    for (const item of importedItems) {
      const imageData = item.imagePath && !item.imagePath.startsWith('data:') ? fileToDataUrl(item.imagePath) : (item.imagePath || null);
      try {
        await apiFetch('/collection/items', { method: 'POST', auth: true, body: { ...item, id: undefined, imageData } });
      } catch (e) {
        console.error('[itemcase-api] failed to import item', item.name, e.message);
      }
    }
    await freshDb();
    return { ok: true, count: importedItems.length };
  }

  const db = readDb();
  db.items = [...db.items, ...importedItems];
  importedCategories.forEach((cat) => {
    if (cat && !db.categories.includes(cat)) db.categories.push(cat);
  });

  if (imported.categoryImages && typeof imported.categoryImages === 'object') {
    Object.entries(imported.categoryImages).forEach(([catName, oldFileName]) => {
      const newFileName = imageNameMap[oldFileName];
      if (newFileName && db.categories.includes(catName) && !db.categoryImages[catName]) {
        db.categoryImages[catName] = newFileName;
      }
    });
  }

  if (imported.categoryFields && typeof imported.categoryFields === 'object') {
    Object.entries(imported.categoryFields).forEach(([catName, fields]) => {
      if (Array.isArray(fields) && db.categories.includes(catName) && !db.categoryFields[catName]) {
        db.categoryFields[catName] = fields;
      }
    });
  }

  if (imported.categoryTargets && typeof imported.categoryTargets === 'object') {
    Object.entries(imported.categoryTargets).forEach(([catName, target]) => {
      if (Number(target) > 0 && db.categories.includes(catName) && !db.categoryTargets[catName]) {
        db.categoryTargets[catName] = Number(target);
      }
    });
  }

  if (imported.categoryCaseDesigns && typeof imported.categoryCaseDesigns === 'object') {
    Object.entries(imported.categoryCaseDesigns).forEach(([catName, caseDesign]) => {
      if (caseDesign && db.categories.includes(catName) && !db.categoryCaseDesigns[catName]) {
        db.categoryCaseDesigns[catName] = caseDesign;
      }
    });
  }

  writeDb(db);
  return { ok: true, count: importedItems.length };
});

// ---- CSV Import/Export ----

const CSV_FIXED_COLUMNS = [
  'name', 'category', 'condition', 'quantity', 'purchasePrice', 'value', 'notes',
  'storyPlace', 'storyDate', 'storyGift', 'storyFirstPiece', 'storyText', 'showcase', 'caseDesign'
];

function csvEscape(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function parseCsv(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field); field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function csvToBool(v) {
  return ['true', '1', 'ja', 'yes', 'x'].includes(String(v).trim().toLowerCase());
}

function csvToNumber(v) {
  if (v === undefined || v === null || v === '') return '';
  const str = String(v).trim();
  const normalized = /\./.test(str) ? str : str.replace(',', '.');
  const n = parseFloat(normalized);
  return Number.isNaN(n) ? '' : n;
}

ipcMain.handle('data:exportCsv', async () => {
  const result = await dialog.showSaveDialog({
    title: 'Sammlung als CSV exportieren',
    defaultPath: 'sammlung-export.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (result.canceled || !result.filePath) return false;

  const db = await freshDb();

  const customLabels = {};
  Object.values(db.categoryFields || {}).forEach((fields) => {
    (fields || []).forEach((f) => { customLabels[f.key] = f.label; });
  });
  const customKeyList = Object.keys(customLabels);

  const header = [...CSV_FIXED_COLUMNS, ...customKeyList.map((k) => customLabels[k])];
  const lines = [header.map(csvEscape).join(',')];

  db.items.forEach((item) => {
    const row = [
      item.name || '', item.category || '', item.condition || '', item.quantity ?? 1,
      item.purchasePrice ?? '', item.value ?? '', item.notes || '',
      item.story?.place || '', item.story?.date || '', item.story?.isGift ? 'true' : 'false', item.story?.isFirstPiece ? 'true' : 'false', item.story?.text || '',
      item.showcase ? 'true' : 'false', item.caseDesign || '',
      ...customKeyList.map((k) => item.customFields?.[k] ?? '')
    ];
    lines.push(row.map(csvEscape).join(','));
  });

  fs.writeFileSync(result.filePath, `﻿${lines.join('\r\n')}`, 'utf-8');
  return true;
});

function dataUrlToBuffer(dataUrl) {
  if (!dataUrl || !dataUrl.startsWith('data:')) return null;
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  try { return Buffer.from(base64, 'base64'); } catch (e) { return null; }
}

function fmtMoney(value) {
  const num = Number(value);
  if (!num) return '';
  return num.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

// Simple, synchronous main-process PDF generation (mirrors data:exportCsv's
// direct save-dialog flow) rather than the concept doc's async ExportJobs
// queue — there's no server-side job to track for a desktop app that already
// has the collection in hand and direct filesystem access.
ipcMain.handle('data:exportPdf', async (_event, options = {}) => {
  const { scope = 'all', includeImages = true, includePrices = true } = options;

  const result = await dialog.showSaveDialog({
    title: 'Sammlungsbericht als PDF exportieren',
    defaultPath: scope === 'all' ? 'sammlungsbericht.pdf' : `sammlungsbericht-${scope}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (result.canceled || !result.filePath) return false;

  const db = await freshDb();
  const items = scope === 'all' ? db.items : db.items.filter((i) => i.category === scope);

  const doc = new PDFDocument({ margin: 50 });
  const stream = fs.createWriteStream(result.filePath);
  doc.pipe(stream);

  // Cover page
  doc.fontSize(26).text('ItemCase Sammlungsbericht', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(12).fillColor('#666').text(scope === 'all' ? 'Gesamte Sammlung' : `Kategorie: ${scope}`, { align: 'center' });
  doc.text(new Date().toLocaleDateString('de-DE'), { align: 'center' });
  doc.moveDown(2);

  const categories = [...new Set(items.map((i) => i.category).filter(Boolean))];
  const totalValue = items.reduce((sum, i) => sum + (Number(i.value) || 0), 0);

  doc.fillColor('#000').fontSize(14).text('Zusammenfassung', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(11).text(`Anzahl Items: ${items.length}`);
  doc.text(`Kategorien: ${categories.length > 0 ? categories.join(', ') : '–'}`);
  if (includePrices) doc.text(`Gesamtwert: ${fmtMoney(totalValue) || '–'}`);

  doc.addPage();
  doc.fontSize(16).text('Items', { underline: true });
  doc.moveDown();

  for (const item of items) {
    if (doc.y > 680) doc.addPage();

    const startY = doc.y;
    const imageBuffer = includeImages ? dataUrlToBuffer(item.imagePath) : null;
    const textX = imageBuffer ? 130 : 50;

    if (imageBuffer) {
      try { doc.image(imageBuffer, 50, startY, { fit: [70, 70] }); } catch (e) {}
    }

    doc.fontSize(12).fillColor('#000').text(item.name || '(ohne Namen)', textX, startY, { width: 400 });
    doc.fontSize(10).fillColor('#555');
    doc.text(`Kategorie: ${item.category || '–'}   Zustand: ${item.condition || '–'}`, textX);
    if (includePrices && item.value) doc.text(`Wert: ${fmtMoney(item.value)}`, textX);

    doc.y = Math.max(doc.y, startY + 80);
    doc.moveDown(0.5);
  }

  doc.end();
  await new Promise((resolve) => stream.on('finish', resolve));
  return true;
});

function rowsFromXlsx(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  // raw: false formats numbers/dates as displayed strings, matching how
  // values already arrive from CSV text — the rest of the import logic
  // works on plain strings regardless of source format.
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  return rows
    .map((row) => row.map((cell) => String(cell ?? '')))
    .filter((r) => !(r.length === 0 || (r.length === 1 && r[0] === '')));
}

function rowsFromXlsxSheet(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  return rows
    .map((row) => row.map((cell) => String(cell ?? '')))
    .filter((r) => !(r.length === 0 || (r.length === 1 && r[0] === '')));
}

// Reads a spreadsheet's raw rows (no ItemCase header-name assumptions) for
// the smart-import wizard's own column detection in the renderer — unlike
// data:importCsv above, which requires ItemCase's own column names.
ipcMain.handle('data:pickImportSpreadsheet', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Datei für den intelligenten Import wählen',
    properties: ['openFile'],
    filters: [{ name: 'CSV / Excel', extensions: ['csv', 'xlsx', 'xls'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, reason: 'canceled' };

  const filePath = result.filePaths[0];
  const ext = path.extname(filePath).toLowerCase();

  try {
    if (ext === '.csv') {
      const text = fs.readFileSync(filePath, 'utf-8').replace(/^﻿/, '');
      const rows = parseCsv(text);
      if (rows.length === 0) return { ok: false, reason: 'invalid' };
      return { ok: true, fileName: path.basename(filePath), sheets: [{ name: 'CSV', rows }] };
    }

    const workbook = XLSX.readFile(filePath, { cellDates: false });
    const sheets = workbook.SheetNames
      .map((name) => ({ name, rows: rowsFromXlsxSheet(workbook, name) }))
      .filter((s) => s.rows.length > 0);
    if (sheets.length === 0) return { ok: false, reason: 'invalid' };
    return { ok: true, fileName: path.basename(filePath), sheets };
  } catch (e) {
    return { ok: false, reason: 'invalid' };
  }
});

ipcMain.handle('data:importCsv', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Sammlung aus CSV oder Excel importieren',
    properties: ['openFile'],
    filters: [{ name: 'CSV / Excel', extensions: ['csv', 'xlsx', 'xls'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, reason: 'canceled' };

  const filePath = result.filePaths[0];
  const isExcel = ['.xlsx', '.xls'].includes(path.extname(filePath).toLowerCase());

  let rows;
  try {
    if (isExcel) {
      rows = rowsFromXlsx(filePath);
    } else {
      const text = fs.readFileSync(filePath, 'utf-8').replace(/^﻿/, '');
      rows = parseCsv(text);
    }
  } catch (e) {
    return { ok: false, reason: 'invalid' };
  }

  if (rows.length < 2) return { ok: false, reason: 'invalid' };

  const header = rows[0].map((h) => h.trim());
  const fixedIndex = {};
  CSV_FIXED_COLUMNS.forEach((col) => {
    const idx = header.findIndex((h) => h.toLowerCase() === col.toLowerCase());
    if (idx >= 0) fixedIndex[col] = idx;
  });
  const usedIndexes = new Set(Object.values(fixedIndex));
  const extraColumns = header
    .map((h, idx) => ({ h, idx }))
    .filter(({ h, idx }) => h && !usedIndexes.has(idx));

  if (fixedIndex.name === undefined) return { ok: false, reason: 'invalid' };

  const isLoggedIn = !!loadAuthToken();
  const db = isLoggedIn ? await apiFetch('/collection', { auth: true }) : readDb();
  const originalCategories = new Set(db.categories);
  const now = new Date().toISOString();
  const newItems = [];
  const changedCategoryFields = new Set();

  rows.slice(1).forEach((cols) => {
    const get = (col) => (fixedIndex[col] !== undefined ? (cols[fixedIndex[col]] || '').trim() : '');
    const name = get('name');
    if (!name) return;

    const category = get('category') || 'Sonstiges';
    if (!db.categories.includes(category)) db.categories.push(category);

    const customFields = {};
    if (extraColumns.length > 0) {
      const existingFields = db.categoryFields[category] || [];
      extraColumns.forEach(({ h, idx }) => {
        const rawVal = (cols[idx] || '').trim();
        if (!rawVal) return;
        let field = existingFields.find((f) => f.label === h);
        if (!field) {
          const key = h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `feld_${idx}`;
          field = { key, label: h, type: 'text' };
          if (!existingFields.some((f) => f.key === field.key)) existingFields.push(field);
        }
        customFields[field.key] = rawVal;
      });
      db.categoryFields[category] = existingFields;
      changedCategoryFields.add(category);
    }

    const item = {
      id: crypto.randomUUID(),
      name,
      category,
      condition: get('condition') || 'nearMint',
      quantity: csvToNumber(get('quantity')) || 1,
      purchasePrice: csvToNumber(get('purchasePrice')),
      value: csvToNumber(get('value')),
      notes: get('notes'),
      imagePath: null,
      caseDesign: get('caseDesign'),
      showcase: csvToBool(get('showcase')),
      story: {
        place: get('storyPlace'), date: get('storyDate'),
        isGift: csvToBool(get('storyGift')), isFirstPiece: csvToBool(get('storyFirstPiece')),
        text: get('storyText')
      },
      customFields,
      createdAt: now,
      updatedAt: now,
      valueHistory: []
    };
    db.items.push(item);
    newItems.push(item);
  });

  if (isLoggedIn) {
    for (const cat of db.categories) {
      if (!originalCategories.has(cat)) {
        try { await apiFetch('/collection/categories', { method: 'POST', auth: true, body: { category: cat } }); } catch (e) {}
      }
    }
    for (const cat of changedCategoryFields) {
      try { await apiFetch(`/collection/categories/${encodeURIComponent(cat)}/fields`, { method: 'PUT', auth: true, body: { fields: db.categoryFields[cat] } }); } catch (e) {}
    }
    for (const item of newItems) {
      try { await apiFetch('/collection/items', { method: 'POST', auth: true, body: { ...item, id: undefined, imageData: null } }); } catch (e) {
        console.error('[itemcase-api] failed to import item', item.name, e.message);
      }
    }
    await freshDb();
  } else {
    writeDb(db);
  }

  return { ok: true, count: newItems.length };
});

// ---- Auth & Friends (server/src/routes/auth.js, friends.js) ----

// Public, unauthenticated — the client asks this once at startup to decide
// which nav entries to render. The server's own requireFeature() gates are
// what actually block a disabled feature; this only drives the UI.
ipcMain.handle('config:features', async () => {
  try {
    return await apiFetch('/config/features');
  } catch (e) {
    // If the server can't be reached yet, fail safe: show nothing extra.
    return { forum: false, friends: false, groups: false, chat: false, market: false, dealer: false };
  }
});

ipcMain.handle('auth:getCaptcha', async () => {
  try {
    return { ok: true, ...(await apiFetch('/auth/captcha')) };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('auth:register', async (_event, { name, email, username, password, captchaId, captchaAnswer }) => {
  try {
    const data = await apiFetch('/auth/register', { method: 'POST', body: { name, email, username, password, captchaId, captchaAnswer } });
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message, code: e.data?.code };
  }
});

ipcMain.handle('auth:resendVerification', async (_event, email) => {
  try {
    return { ok: true, ...(await apiFetch('/auth/resend-verification', { method: 'POST', body: { email } })) };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('auth:login', async (_event, { identifier, password, rememberMe = false }) => {
  try {
    const data = await apiFetch('/auth/login', { method: 'POST', body: { identifier, password, rememberMe } });
    saveAuthToken(data.token, rememberMe);
    connectRealtime();
    return { ok: true, user: data.user };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('auth:saveProfile', async (_event, payload) => {
  try {
    const data = await apiFetch('/auth/profile', { method: 'PATCH', auth: true, body: payload });
    if (data.token) {
      saveAuthToken(data.token, fs.existsSync(authFile));
      disconnectRealtime();
      connectRealtime();
    }
    return { ok: true, user: data.user };
  } catch (e) { return { ok: false, error: e.data?.error || e.message }; }
});

ipcMain.handle('auth:forgotPassword', async (_event, email) => {
  try {
    const data = await apiFetch('/auth/forgot-password', { method: 'POST', body: { email } });
    return { ok: true, message: data.message };
  } catch (e) { return { ok: false, error: e.data?.error || e.message }; }
});

ipcMain.handle('auth:changePassword', async (_event, { currentPassword, newPassword }) => {
  try {
    const data = await apiFetch('/auth/change-password', { method: 'POST', auth: true, body: { currentPassword, newPassword } });
    // Password changes revoke every previous token and continue only this session.
    saveAuthToken(data.token, fs.existsSync(authFile));
    disconnectRealtime();
    connectRealtime();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message, code: e.data?.code };
  }
});

ipcMain.handle('auth:setTariff', async (_event, tariff) => {
  try {
    const data = await apiFetch('/auth/tariff', { method: 'PATCH', auth: true, body: { tariff } });
    saveAuthToken(data.token, fs.existsSync(authFile));
    disconnectRealtime();
    connectRealtime();
    return { ok: true, user: data.user };
  } catch (e) { return { ok: false, error: e.data?.error || e.message }; }
});

ipcMain.handle('auth:exportData', async () => {
  try {
    const data = await apiFetch('/auth/export', { auth: true });
    const result = await dialog.showSaveDialog({
      title: 'Meine Daten exportieren',
      defaultPath: 'itemcase-daten-export.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true, filePath: result.filePath };
  } catch (e) { return { ok: false, error: e.data?.error || e.message }; }
});

ipcMain.handle('auth:deleteAccount', async (_event, { password, captchaId, captchaAnswer }) => {
  try {
    await apiFetch('/auth/account', { method: 'DELETE', auth: true, body: { password, captchaId, captchaAnswer } });
    clearAuthToken();
    disconnectRealtime();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('auth:logout', () => {
  clearAuthToken();
  disconnectRealtime();
  return true;
});

// Restores the session on app start by asking the server to confirm the
// stored token is still valid, rather than trusting a cached user forever.
ipcMain.handle('auth:getSession', async () => {
  if (!loadAuthToken()) return null;
  try {
    const data = await apiFetch('/auth/me', { auth: true });
    return data.user;
  } catch (e) {
    clearAuthToken();
    return null;
  }
});

ipcMain.handle('friends:list', async () => {
  try {
    return await apiFetch('/friends', { auth: true });
  } catch (e) {
    console.error('[itemcase-api] friends list failed', e.message);
    return { friends: [], incoming: [], outgoing: [] };
  }
});

ipcMain.handle('friends:sendRequest', async (_event, identifier) => {
  try {
    await apiFetch('/friends/requests', { method: 'POST', auth: true, body: { identifier } });
    return { ok: true };
  } catch (e) {
    return { ok: false, notFound: e.status === 404, error: e.data?.error || e.message };
  }
});

ipcMain.handle('friends:acceptRequest', async (_event, id) => {
  try {
    await apiFetch(`/friends/requests/${id}/accept`, { method: 'POST', auth: true });
    return true;
  } catch (e) {
    return false;
  }
});

ipcMain.handle('friends:declineRequest', async (_event, id) => {
  try {
    await apiFetch(`/friends/requests/${id}/decline`, { method: 'POST', auth: true });
    return true;
  } catch (e) {
    return false;
  }
});

// ---- Blocks (server/src/routes/blocks.js) ----

ipcMain.handle('blocks:list', async () => {
  try {
    return await apiFetch('/blocks', { auth: true });
  } catch (e) {
    return [];
  }
});

ipcMain.handle('blocks:block', async (_event, userId) => {
  try {
    await apiFetch('/blocks', { method: 'POST', auth: true, body: { userId } });
    return true;
  } catch (e) {
    return false;
  }
});

ipcMain.handle('blocks:unblock', async (_event, userId) => {
  try {
    await apiFetch(`/blocks/${userId}`, { method: 'DELETE', auth: true });
    return true;
  } catch (e) {
    return false;
  }
});

// ---- Groups (server/src/routes/groups.js) ----

ipcMain.handle('groups:list', async () => {
  try {
    return await apiFetch('/groups', { auth: true });
  } catch (e) {
    return [];
  }
});

ipcMain.handle('groups:discover', async () => {
  try {
    return await apiFetch('/groups/discover', { auth: true });
  } catch (e) {
    return [];
  }
});

ipcMain.handle('groups:create', async (_event, payload) => {
  try {
    return { ok: true, group: await apiFetch('/groups', { method: 'POST', auth: true, body: payload }) };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('groups:get', async (_event, id) => {
  try {
    return await apiFetch(`/groups/${id}`, { auth: true });
  } catch (e) {
    return null;
  }
});

ipcMain.handle('groups:join', async (_event, id) => {
  try {
    await apiFetch(`/groups/${id}/join`, { method: 'POST', auth: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('groups:addMember', async (_event, { id, username }) => {
  try {
    await apiFetch(`/groups/${id}/members`, { method: 'POST', auth: true, body: { username } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('groups:setRole', async (_event, { id, userId, role }) => {
  try {
    await apiFetch(`/groups/${id}/members/${userId}`, { method: 'PATCH', auth: true, body: { role } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('groups:kick', async (_event, { id, userId }) => {
  try {
    await apiFetch(`/groups/${id}/members/${userId}`, { method: 'DELETE', auth: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('groups:ban', async (_event, { id, userId }) => {
  try {
    await apiFetch(`/groups/${id}/ban/${userId}`, { method: 'POST', auth: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('groups:delete', async (_event, id) => {
  try {
    await apiFetch(`/groups/${id}`, { method: 'DELETE', auth: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

// ---- Conversations & messages (server/src/routes/conversations.js) ----

ipcMain.handle('conversations:list', async () => {
  try {
    return await apiFetch('/conversations', { auth: true });
  } catch (e) {
    return [];
  }
});

ipcMain.handle('conversations:openDirect', async (_event, friendId) => {
  try {
    const data = await apiFetch('/conversations/direct', { method: 'POST', auth: true, body: { friendId } });
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('conversations:history', async (_event, { id, before }) => {
  try {
    const query = before ? `?before=${encodeURIComponent(before)}` : '';
    return await apiFetch(`/conversations/${id}/messages${query}`, { auth: true });
  } catch (e) {
    return [];
  }
});

ipcMain.handle('conversations:send', async (_event, { id, body }) => {
  try {
    return { ok: true, message: await apiFetch(`/conversations/${id}/messages`, { method: 'POST', auth: true, body: { body } }) };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('conversations:markRead', async (_event, id) => {
  try {
    await apiFetch(`/conversations/${id}/read`, { method: 'POST', auth: true });
    return true;
  } catch (e) {
    return false;
  }
});

// ---- Notifications (server/src/routes/notifications.js) ----

ipcMain.handle('notifications:list', async () => {
  try {
    return await apiFetch('/notifications', { auth: true });
  } catch (e) {
    return [];
  }
});

ipcMain.handle('notifications:markRead', async (_event, id) => {
  try {
    await apiFetch(`/notifications/${id}/read`, { method: 'POST', auth: true });
    return true;
  } catch (e) {
    return false;
  }
});

ipcMain.handle('notifications:markAllRead', async () => {
  try {
    await apiFetch('/notifications/read-all', { method: 'POST', auth: true });
    return true;
  } catch (e) {
    return false;
  }
});

// ---- Wishlist (server/src/routes/wishlist.js) ----

ipcMain.handle('wishlist:list', async () => {
  try {
    return await apiFetch('/wishlist', { auth: true });
  } catch (e) {
    return [];
  }
});

ipcMain.handle('wishlist:add', async (_event, payload) => {
  try {
    return { ok: true, items: await apiFetch('/wishlist', { method: 'POST', auth: true, body: payload }) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('wishlist:update', async (_event, { id, ...patch }) => {
  try {
    return { ok: true, items: await apiFetch(`/wishlist/${id}`, { method: 'PUT', auth: true, body: patch }) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('wishlist:remove', async (_event, id) => {
  try {
    return { ok: true, items: await apiFetch(`/wishlist/${id}`, { method: 'DELETE', auth: true }) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ---- CommunityMarkt (server/src/routes/market.js) — separate, opt-in
// public marketplace. Browsing/detail/dealer-profile calls don't require a
// token; they're kept behind the auth-bearing apiFetch when logged in
// anyway so is_favorite/isMine can be resolved, but work anonymously too. ----

// Mirrors items:save's imagePath handling: an http(s) path is already a
// stored image URL from a previous save (leave untouched when editing, or
// re-fetch it for a first save so the market API gets its own copy), a
// data: URL passes straight through, anything else is a freshly picked
// local file path that still needs converting.
async function marketImageData(imagePath, isExisting) {
  if (imagePath === undefined) return undefined;
  if (imagePath === null) return null;
  if (/^https?:\/\//i.test(imagePath)) return isExisting ? undefined : imageInputToDataUrl(imagePath);
  return imagePath.startsWith('data:') ? imagePath : fileToDataUrl(imagePath);
}

ipcMain.handle('market:browse', async (_event, filters = {}) => {
  try {
    const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
    return await apiFetch(`/market${query ? `?${query}` : ''}`, { auth: !!loadAuthToken() });
  } catch (e) {
    return [];
  }
});

ipcMain.handle('market:featuredDealers', async () => {
  try {
    return await apiFetch('/market/dealers/featured');
  } catch (e) {
    return [];
  }
});

ipcMain.handle('market:getListing', async (_event, id) => {
  try {
    return { ok: true, listing: await apiFetch(`/market/listings/${id}`, { auth: !!loadAuthToken() }) };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('market:getDealer', async (_event, username) => {
  try {
    return { ok: true, ...(await apiFetch(`/market/dealers/${encodeURIComponent(username)}`)) };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('market:favorite', async (_event, { id, favorite }) => {
  try {
    await apiFetch(`/market/listings/${id}/favorite`, { method: favorite ? 'POST' : 'DELETE', auth: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('market:contactSeller', async (_event, { id, message }) => {
  try {
    await apiFetch(`/market/listings/${id}/contact`, { method: 'POST', auth: true, body: { message } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('market:mineContactRequests', async () => {
  try {
    return await apiFetch('/market/mine/contact-requests', { auth: true });
  } catch (e) {
    return [];
  }
});

ipcMain.handle('market:acceptContactRequest', async (_event, id) => {
  try {
    const data = await apiFetch(`/market/contact-requests/${id}/accept`, { method: 'POST', auth: true });
    return { ok: true, conversationId: data.conversationId };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('market:declineContactRequest', async (_event, id) => {
  try {
    await apiFetch(`/market/contact-requests/${id}/decline`, { method: 'POST', auth: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('market:blockContactRequest', async (_event, id) => {
  try {
    await apiFetch(`/market/contact-requests/${id}/block`, { method: 'POST', auth: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('market:mineListings', async () => {
  try {
    return await apiFetch('/market/mine/listings', { auth: true });
  } catch (e) {
    return [];
  }
});

ipcMain.handle('market:mineStats', async () => {
  try {
    return await apiFetch('/market/mine/stats', { auth: true });
  } catch (e) {
    return null;
  }
});

ipcMain.handle('market:saveListing', async (_event, payload) => {
  try {
    const imageData = await marketImageData(payload.imagePath, !!payload.id);
    const listing = await apiFetch('/market/listings', { method: 'POST', auth: true, body: { ...payload, imagePath: undefined, imageData } });
    return { ok: true, listing };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('market:setListingStatus', async (_event, { id, status }) => {
  try {
    await apiFetch(`/market/listings/${id}/status`, { method: 'PATCH', auth: true, body: { status } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('market:deleteListing', async (_event, id) => {
  try {
    await apiFetch(`/market/listings/${id}`, { method: 'DELETE', auth: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('market:getProfile', async () => {
  try {
    return await apiFetch('/market/profile', { auth: true });
  } catch (e) {
    return null;
  }
});

ipcMain.handle('market:saveProfile', async (_event, payload) => {
  try {
    const logoData = await marketImageData(payload.logoPath, true);
    const profile = await apiFetch('/market/profile', { method: 'PUT', auth: true, body: { ...payload, logoPath: undefined, logoData } });
    return { ok: true, profile };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

// ---- Forum (server/src/routes/forum.js) — standalone community feed ----

ipcMain.handle('forum:listThreads', async (_event, category) => {
  try {
    const query = category ? `?category=${encodeURIComponent(category)}` : '';
    return await apiFetch(`/forum/threads${query}`, { auth: true });
  } catch (e) {
    return [];
  }
});

ipcMain.handle('forum:createThread', async (_event, { title, body, category, imagePath, level }) => {
  try {
    const imageData = imagePath ? fileToDataUrl(imagePath) : null;
    return { ok: true, ...(await apiFetch('/forum/threads', { method: 'POST', auth: true, body: { title, body, category, imageData, level } })) };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('forum:getThread', async (_event, threadId) => {
  try {
    return await apiFetch(`/forum/threads/${threadId}`, { auth: true });
  } catch (e) {
    return null;
  }
});

ipcMain.handle('forum:reply', async (_event, { threadId, body, level }) => {
  try {
    return { ok: true, post: await apiFetch(`/forum/threads/${threadId}/posts`, { method: 'POST', auth: true, body: { body, level } }) };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('forum:trending', async () => {
  try {
    return await apiFetch('/forum/trending', { auth: true });
  } catch (e) {
    return [];
  }
});

ipcMain.handle('forum:leaderboard', async () => {
  try {
    return await apiFetch('/forum/leaderboard', { auth: true });
  } catch (e) {
    return [];
  }
});

ipcMain.handle('forum:activeCollectors', async () => {
  try {
    return await apiFetch('/forum/active-collectors', { auth: true });
  } catch (e) {
    return [];
  }
});

ipcMain.handle('forum:activity', async () => {
  try {
    return await apiFetch('/forum/activity', { auth: true });
  } catch (e) {
    return [];
  }
});

ipcMain.handle('forum:closeThread', async (_event, threadId) => {
  try {
    return await apiFetch(`/forum/threads/${threadId}/close`, { method: 'POST', auth: true });
  } catch (e) {
    return null;
  }
});

ipcMain.handle('forum:deleteThread', async (_event, threadId) => {
  try {
    await apiFetch(`/forum/threads/${threadId}`, { method: 'DELETE', auth: true });
    return true;
  } catch (e) {
    return false;
  }
});

ipcMain.handle('forum:deletePost', async (_event, postId) => {
  try {
    await apiFetch(`/forum/posts/${postId}`, { method: 'DELETE', auth: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('forum:likePost', async (_event, postId) => {
  try {
    return await apiFetch(`/forum/posts/${postId}/like`, { method: 'POST', auth: true });
  } catch (e) {
    return null;
  }
});

// ---- Admin dashboard ----
ipcMain.handle('admin:load', async () => {
  // A moderator only has server-side access to /catalog, /catalog/duplicates,
  // /catalog/entries/:id/merge and /change-requests* (see requireModerator in
  // server/src/routes/admin.js) — every other admin-only route below 403s
  // for them, on purpose, so each of those is fetched leniently and falls
  // back to an empty shape instead of failing the whole dashboard load.
  const orEmpty = (promise, fallback) => promise.catch(() => fallback);
  try {
    const [summary, inbox, catalog, forum, users, dealers, duplicates, changeRequests, withheldXp, riskOverview] = await Promise.all([
      orEmpty(apiFetch('/admin/summary', { auth: true }), {}),
      orEmpty(apiFetch('/admin/inbox', { auth: true }), { feedback: [], reports: [] }),
      apiFetch('/admin/catalog', { auth: true }),
      orEmpty(apiFetch('/admin/forum', { auth: true }), []),
      orEmpty(apiFetch('/admin/users', { auth: true }), []),
      orEmpty(apiFetch('/admin/dealers', { auth: true }), []),
      apiFetch('/admin/catalog/duplicates', { auth: true }),
      apiFetch('/admin/change-requests?status=pending', { auth: true }),
      orEmpty(apiFetch('/admin/xp/withheld/list', { auth: true }), { rows: [] }),
      orEmpty(apiFetch('/admin/risk-overview', { auth: true }), { highVelocity: [], withheldByUser: [] })
    ]);
    return { ok: true, summary, inbox, catalog, forum, users, dealers, duplicates, changeRequests, withheldXp, riskOverview };
  } catch (e) { return { ok: false, error: e.data?.error || e.message }; }
});

ipcMain.handle('admin:action', async (_event, { action, payload = {} }) => {
  const routes = {
    feedbackStatus: [`/admin/feedback/${payload.id}`, 'PATCH', { status: payload.status }],
    reportStatus: [`/admin/reports/${payload.id}`, 'PATCH', { status: payload.status }],
    catalogStatus: [`/admin/catalog/${payload.kind}/${payload.id}`, 'PATCH', { status: payload.status, reason: payload.reason }],
    deleteThread: [`/admin/forum/threads/${payload.id}`, 'DELETE'],
    userRole: [`/admin/users/${payload.id}/role`, 'PATCH', { role: payload.role }],
    userStatus: [`/admin/users/${payload.id}/status`, 'PATCH', { status: payload.status }],
    dealerVerification: [`/admin/dealers/${payload.ownerId}/verification`, 'PATCH', { status: payload.status, reason: payload.reason }],
    mergeCatalogEntries: [`/admin/catalog/entries/${payload.sourceId}/merge`, 'POST', { intoId: payload.intoId, reason: payload.reason }],
    reverseXp: [`/admin/xp-transactions/${payload.transactionId}/reverse`, 'POST', { reason: payload.reason }],
    releaseXp: [`/admin/xp-transactions/${payload.transactionId}/release`, 'POST', { note: payload.note }],
    decideChangeRequest: [`/admin/change-requests/${payload.id}/decide`, 'POST', { decision: payload.decision, reason: payload.reason, xpTypeOverride: payload.xpTypeOverride }]
  };
  const route = routes[action];
  if (!route) return { ok: false, error: 'Unbekannte Admin-Aktion' };
  try {
    await apiFetch(route[0], { method: route[1], auth: true, body: route[2] });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.data?.error || e.message }; }
});

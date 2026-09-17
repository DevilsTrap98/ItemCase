const { app, BrowserWindow, ipcMain, dialog } = require('electron');
app.setName('ItemCase');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const sharp = require('sharp');
const XLSX = require('xlsx');
const { io } = require('socket.io-client');

const isDev = process.env.NODE_ENV === 'development';

const userDataDir = app.getPath('userData');
const imagesDir = path.join(userDataDir, 'images');
const dbFile = path.join(userDataDir, 'collection.json');
const feedbackFile = path.join(userDataDir, 'feedback-outbox.json');
const reportsFile = path.join(userDataDir, 'reports-outbox.json');
const authFile = path.join(userDataDir, 'auth.json');

const API_BASE_URL = process.env.ITEMCASE_API_URL || 'http://localhost:5100/api';

const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

function fileToDataUrl(fileName) {
  if (!fileName) return null;
  const fullPath = path.join(imagesDir, fileName);
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
  try {
    return JSON.parse(fs.readFileSync(authFile, 'utf-8')).token || null;
  } catch (e) {
    return null;
  }
}

function saveAuthToken(token) {
  fs.writeFileSync(authFile, JSON.stringify({ token }, null, 2));
}

function clearAuthToken() {
  try { fs.unlinkSync(authFile); } catch (e) {}
}

// Thin wrapper around the ItemCase backend (server/) — the community
// catalog, reports, feedback and friends all live there now rather than
// only in the local collection.json (see server/src/app.js for routes).
async function apiFetch(urlPath, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = loadAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE_URL}${urlPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
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

// Real-time push (new messages, notifications, typing) — the socket layer
// is server/src/realtime.js. One connection per app instance, shared by
// every renderer window; events are re-broadcast to all of them.
const REALTIME_URL = process.env.ITEMCASE_API_URL
  ? process.env.ITEMCASE_API_URL.replace(/\/api\/?$/, '')
  : 'http://localhost:5100';

let socket = null;

function broadcast(channel, payload) {
  BrowserWindow.getAllWindows().forEach((win) => win.webContents.send(channel, payload));
}

function connectRealtime() {
  const token = loadAuthToken();
  if (!token || socket) return;

  socket = io(REALTIME_URL, { auth: { token } });
  socket.on('message:new', (message) => broadcast('rt:message', message));
  socket.on('notification:new', (notification) => broadcast('rt:notification', notification));
  socket.on('typing', (payload) => broadcast('rt:typing', payload));
  socket.on('connect_error', (err) => console.error('[itemcase-realtime] connect error', err.message));
}

function disconnectRealtime() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
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
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
  if (!fs.existsSync(dbFile)) {
    fs.writeFileSync(dbFile, JSON.stringify({
      items: [],
      categories: ['🎬 Filme & Serien', '🎮 Videospiele', '🃏 Trading Cards', '📚 Comics & Manga', '📦 Sonstige Sammlerstücke'],
      categoryImages: {},
      categoryFields: {},
      categoryTargets: {},
      categoryCaseDesigns: {},
      communityCatalog: demoCatalogEntries(),
      catalogPhotoProposals: [],
      catalogCategories: []
    }, null, 2));
  }
}

function readDb() {
  ensureDirs();
  try {
    const db = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
    if (!db.categoryImages) db.categoryImages = {};
    if (!db.categoryFields) db.categoryFields = {};
    if (!db.categoryTargets) db.categoryTargets = {};
    if (!db.categoryCaseDesigns) db.categoryCaseDesigns = {};
    if (!db.communityCatalog) db.communityCatalog = demoCatalogEntries();
    if (!db.catalogPhotoProposals) db.catalogPhotoProposals = [];
    if (!db.catalogCategories) db.catalogCategories = [];
    return db;
  } catch (e) {
    return { items: [], categories: [], categoryImages: {}, categoryFields: {}, categoryTargets: {}, categoryCaseDesigns: {}, communityCatalog: [], catalogPhotoProposals: [], catalogCategories: [] };
  }
}

function writeDb(data) {
  fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
}

const isWindows = process.platform === 'win32';
const TITLEBAR_HEIGHT = 36;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
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
      nodeIntegration: false
    },
    autoHideMenuBar: true
  });

  // Maximized (not OS fullscreen) — fills the screen but keeps the taskbar
  // and normal window chrome visible, unlike true fullscreen/kiosk mode.
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  ensureDirs();
  createWindow();
  connectRealtime();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC Handlers ----

function mapRemoteCatalogEntry(entry) {
  return { ...entry, imagePath: entry.imageData || null };
}

ipcMain.handle('items:getAll', async () => {
  const db = readDb();
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

ipcMain.handle('items:save', (_event, item) => {
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

ipcMain.handle('items:delete', (_event, id) => {
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

ipcMain.handle('categories:add', (_event, category) => {
  const db = readDb();
  if (category && !db.categories.includes(category)) {
    db.categories.push(category);
    writeDb(db);
  }
  return db;
});

ipcMain.handle('categories:rename', (_event, { oldName, newName }) => {
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

ipcMain.handle('categories:delete', (_event, category) => {
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
  const imageData = payload.imagePath ? fileToDataUrl(payload.imagePath) : null;

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
  const imageData = payload.imagePath ? fileToDataUrl(payload.imagePath) : null;

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

ipcMain.handle('categories:setCaseDesign', (_event, { name, caseDesign }) => {
  const db = readDb();
  if (caseDesign) {
    db.categoryCaseDesigns[name] = caseDesign;
  } else {
    delete db.categoryCaseDesigns[name];
  }
  writeDb(db);
  return db;
});

ipcMain.handle('categories:setFields', (_event, { name, fields }) => {
  const db = readDb();
  if (Array.isArray(fields) && fields.length > 0) {
    db.categoryFields[name] = fields;
  } else {
    delete db.categoryFields[name];
  }
  writeDb(db);
  return db;
});

ipcMain.handle('categories:setTarget', (_event, { name, target }) => {
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

ipcMain.handle('categories:setOrder', (_event, order) => {
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

ipcMain.handle('categories:setImage', (_event, { name, fileName }) => {
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
  const destName = `${crypto.randomUUID()}.webp`;
  const destPath = path.join(imagesDir, destName);
  try {
    // Normalize every uploaded image to the same shape the future catalog server will
    // store: resized, EXIF/GPS stripped (sharp drops metadata unless withMetadata() is
    // called), and re-encoded as WebP.
    await sharp(srcPath)
      .resize(1400, 1400, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(destPath);
  } catch (e) {
    // Fall back to a plain copy if the file can't be processed (e.g. unsupported format).
    const ext = path.extname(srcPath);
    const fallbackName = `${crypto.randomUUID()}${ext}`;
    fs.copyFileSync(srcPath, path.join(imagesDir, fallbackName));
    return fallbackName;
  }
  return destName;
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

ipcMain.handle('data:exportZip', async () => {
  const result = await dialog.showSaveDialog({
    title: 'Sammlung exportieren',
    defaultPath: 'sammlung-export.zip',
    filters: [{ name: 'ZIP-Archiv', extensions: ['zip'] }]
  });
  if (result.canceled || !result.filePath) return false;

  const db = readDb();
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

  // Bilder aus dem Archiv unter neuen Dateinamen ablegen, um Kollisionen
  // mit bereits vorhandenen Bildern zu vermeiden. Mapping alter -> neuer Name.
  const imageNameMap = {};
  zip.getEntries().forEach((entry) => {
    if (entry.isDirectory || !entry.entryName.startsWith('images/')) return;
    const originalName = path.basename(entry.entryName);
    const ext = path.extname(originalName);
    const newName = `${crypto.randomUUID()}${ext}`;
    fs.writeFileSync(path.join(imagesDir, newName), entry.getData());
    imageNameMap[originalName] = newName;
  });

  const db = readDb();

  const importedItems = imported.items.map((item) => ({
    ...item,
    id: crypto.randomUUID(),
    imagePath: item.imagePath && imageNameMap[item.imagePath] ? imageNameMap[item.imagePath] : null,
    updatedAt: new Date().toISOString()
  }));

  db.items = [...db.items, ...importedItems];

  const importedCategories = Array.isArray(imported.categories) ? imported.categories : [];
  importedItems.forEach((item) => {
    if (item.category && !importedCategories.includes(item.category)) importedCategories.push(item.category);
  });
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
  'storyPlace', 'storyDate', 'storyGift', 'storyFirstPiece', 'storyText', 'showcase'
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

  const db = readDb();

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
      item.showcase ? 'true' : 'false',
      ...customKeyList.map((k) => item.customFields?.[k] ?? '')
    ];
    lines.push(row.map(csvEscape).join(','));
  });

  fs.writeFileSync(result.filePath, `﻿${lines.join('\r\n')}`, 'utf-8');
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

  const db = readDb();
  const now = new Date().toISOString();
  let count = 0;

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
    }

    db.items.push({
      id: crypto.randomUUID(),
      name,
      category,
      condition: get('condition') || 'nearMint',
      quantity: csvToNumber(get('quantity')) || 1,
      purchasePrice: csvToNumber(get('purchasePrice')),
      value: csvToNumber(get('value')),
      notes: get('notes'),
      imagePath: null,
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
    });
    count++;
  });

  writeDb(db);
  return { ok: true, count };
});

// ---- Auth & Friends (server/src/routes/auth.js, friends.js) ----

ipcMain.handle('auth:register', async (_event, { name, email, username, password }) => {
  try {
    const data = await apiFetch('/auth/register', { method: 'POST', body: { name, email, username, password } });
    saveAuthToken(data.token);
    connectRealtime();
    return { ok: true, user: data.user };
  } catch (e) {
    return { ok: false, error: e.data?.error || e.message };
  }
});

ipcMain.handle('auth:login', async (_event, { email, password }) => {
  try {
    const data = await apiFetch('/auth/login', { method: 'POST', body: { email, password } });
    saveAuthToken(data.token);
    connectRealtime();
    return { ok: true, user: data.user };
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

ipcMain.handle('friends:sendRequest', async (_event, toUsername) => {
  try {
    await apiFetch('/friends/requests', { method: 'POST', auth: true, body: { toUsername } });
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

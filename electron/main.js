const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
app.setName('ItemCase');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const isDev = process.env.NODE_ENV === 'development';

const userDataDir = app.getPath('userData');
const imagesDir = path.join(userDataDir, 'images');
const dbFile = path.join(userDataDir, 'collection.json');

function ensureDirs() {
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
  if (!fs.existsSync(dbFile)) {
    fs.writeFileSync(dbFile, JSON.stringify({
      items: [],
      categories: ['Karten', 'Münzen', 'Comics', 'Sonstiges'],
      categoryImages: {},
      categoryFields: {},
      categoryTargets: {}
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
    return db;
  } catch (e) {
    return { items: [], categories: [], categoryImages: {}, categoryFields: {}, categoryTargets: {} };
  }
}

function writeDb(data) {
  fs.writeFileSync(dbFile, JSON.stringify(data, null, 2));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'ItemCase',
    backgroundColor: '#1b1d22',
    icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    autoHideMenuBar: true
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC Handlers ----

ipcMain.handle('items:getAll', () => {
  const db = readDb();
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
  }

  writeDb(db);
  return db;
});

ipcMain.handle('categories:delete', (_event, category) => {
  const db = readDb();
  db.categories = db.categories.filter((c) => c !== category);
  db.items = db.items.map((item) => (
    item.category === category ? { ...item, category: '' } : item
  ));

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

ipcMain.handle('image:pick', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Bild auswählen',
    properties: ['openFile'],
    filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const srcPath = result.filePaths[0];
  const ext = path.extname(srcPath);
  const destName = `${crypto.randomUUID()}${ext}`;
  const destPath = path.join(imagesDir, destName);
  fs.copyFileSync(srcPath, destPath);
  return destName;
});

const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

ipcMain.handle('image:getPath', (_event, fileName) => {
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
});

// TODO: durch die tatsächliche Support-/Feedback-Adresse ersetzen
const FEEDBACK_EMAIL = 'feedback@itemcase.app';

ipcMain.handle('feedback:send', (_event, { type, message, contact }) => {
  const subject = `ItemCase ${type}`;
  const bodyLines = [
    message,
    '',
    '---',
    `Typ: ${type}`,
    contact ? `Kontakt: ${contact}` : null,
    `App-Version: ${app.getVersion()}`,
    `Plattform: ${process.platform}`
  ].filter(Boolean);
  const mailto = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join('\n'))}`;
  shell.openExternal(mailto);
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

  writeDb(db);
  return { ok: true, count: importedItems.length };
});

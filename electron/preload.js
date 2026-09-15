const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getAll: () => ipcRenderer.invoke('items:getAll'),
  saveItem: (item) => ipcRenderer.invoke('items:save', item),
  deleteItem: (id) => ipcRenderer.invoke('items:delete', id),
  addCategory: (category) => ipcRenderer.invoke('categories:add', category),
  renameCategory: (oldName, newName) => ipcRenderer.invoke('categories:rename', { oldName, newName }),
  deleteCategory: (category) => ipcRenderer.invoke('categories:delete', category),
  setCategoryImage: (name, fileName) => ipcRenderer.invoke('categories:setImage', { name, fileName }),
  setCategoryFields: (name, fields) => ipcRenderer.invoke('categories:setFields', { name, fields }),
  setCategoryTarget: (name, target) => ipcRenderer.invoke('categories:setTarget', { name, target }),
  pickImage: () => ipcRenderer.invoke('image:pick'),
  getImagePath: (fileName) => ipcRenderer.invoke('image:getPath', fileName),
  sendFeedback: (payload) => ipcRenderer.invoke('feedback:send', payload),
  exportZip: () => ipcRenderer.invoke('data:exportZip'),
  importZip: () => ipcRenderer.invoke('data:importZip')
});

'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const subscribe = (channel) => (callback) => {
  const handler = (_event, data) => callback(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('pinlet', {
  // Shared state (Pinlet window + toolbar popover)
  getState: () => ipcRenderer.invoke('state:get'),
  onState: subscribe('state'),
  onOpen: subscribe('pinlet:open'),
  addToScreen: (markerId, source) => ipcRenderer.invoke('marker:add-to-screen', markerId, source),
  createMarker: (data) => ipcRenderer.invoke('library:create', data),
  updateMarker: (id, data) => ipcRenderer.invoke('library:update', id, data),
  deleteMarker: (id) => ipcRenderer.invoke('library:delete', id),
  pickImage: () => ipcRenderer.invoke('image:pick'),
  importImagePath: (filePath) => ipcRenderer.invoke('image:import-path', filePath),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  clearMarkers: () => ipcRenderer.invoke('markers:clear'),
  openPinlet: (options) => ipcRenderer.send('pinlet:open', options),
  hideWindow: () => ipcRenderer.send('pinlet:hide'),
  quit: () => ipcRenderer.send('app:quit'),
  popoverSize: (height) => ipcRenderer.send('popover:size', height),
  hidePopover: () => ipcRenderer.send('popover:hide'),

  // Marker windows
  onMarker: subscribe('marker:data'),
  setIgnoreMouse: (ignore) => ipcRenderer.send('marker:ignore', ignore),
  dragStart: (x, y) => ipcRenderer.send('marker:drag-start', x, y),
  dragMove: (x, y) => ipcRenderer.send('marker:drag-move', x, y),
  dragEnd: () => ipcRenderer.send('marker:drag-end'),
  openMenu: () => ipcRenderer.send('marker:menu'),
  lockedNotice: () => ipcRenderer.send('marker:locked'),

  // Right-click menu
  onMenu: subscribe('menu:data'),
  menuSize: (width, height) => ipcRenderer.send('menu:size', width, height),
  closeMenu: () => ipcRenderer.send('menu:close'),
  updateInstance: (id, patch) => ipcRenderer.send('instance:update', id, patch),
  duplicateInstance: (id) => ipcRenderer.send('instance:duplicate', id),
  removeInstance: (id) => ipcRenderer.send('instance:remove', id),
  editMarker: (markerId) => ipcRenderer.send('menu:edit', markerId)
});

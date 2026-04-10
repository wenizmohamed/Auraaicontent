const { contextBridge, ipcRenderer } = require('electron');

const defaultApiBaseUrl = 'http://127.0.0.1:8080';
const apiBaseUrl = (process.env.RADIX_API_URL || defaultApiBaseUrl).replace(/\/+$/, '');

contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  isDesktop: true,
  apiBaseUrl,
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
});

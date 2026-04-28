const { contextBridge, ipcRenderer } = require('electron');

// Lazy port resolution — main.cjs starts the server async; renderer awaits via getServerPort().
let cachedPort = null;
async function getServerPort() {
  if (cachedPort) return cachedPort;
  cachedPort = await ipcRenderer.invoke('radix:get-server-port');
  return cachedPort;
}

contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  isDesktop: true,
  // Synchronous getter for the cascade in backend-api.ts. Returns the localhost
  // URL once main.cjs has resolved the port; null otherwise (renderer falls back to VPS).
  apiBaseUrl: null, // set by backend-api.ts after awaiting getServerPort()
  getServerPort,
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
});

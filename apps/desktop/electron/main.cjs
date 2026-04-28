const { app, BrowserWindow, shell, Menu, Tray, nativeImage, ipcMain } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('update-available', (info) => {
  console.log(`[radix-updater] update available: v${info.version}`);
});
autoUpdater.on('update-downloaded', (info) => {
  console.log(`[radix-updater] update downloaded: v${info.version} — will install on quit`);
  // Optional: prompt user via dialog
});
autoUpdater.on('error', (err) => {
  console.error('[radix-updater] error:', err.message);
});

let serverChild = null;
let serverPort = null;
let serverReadyPromise = null;

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function getOrCreateJwtSecret() {
  // Persist a random JWT secret per-install in userData so tokens survive restarts.
  const file = path.join(app.getPath('userData'), 'jwt.secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(48).toString('hex');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

async function forkServer() {
  if (serverReadyPromise) return serverReadyPromise;

  // In dev: server is at ../../../server/dist/index.js (workspace root)
  // In packaged: extraResources places it at process.resourcesPath/server/dist/index.js
  const serverEntry = app.isPackaged
    ? path.join(process.resourcesPath, 'server', 'dist', 'index.js')
    : path.join(__dirname, '..', '..', '..', 'server', 'dist', 'index.js');

  if (!fs.existsSync(serverEntry)) {
    throw new Error(`[radix] backend bundle not found at ${serverEntry} — did you run pnpm build:desktop in /server?`);
  }

  const port = await pickFreePort();
  const dbPath = path.join(app.getPath('userData'), 'radix.db');

  serverChild = fork(serverEntry, [], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DB_TARGET: 'sqlite',
      DATABASE_URL: `file:${dbPath}`,
      PORT: String(port),
      HOST: '127.0.0.1',
      JWT_SECRET: getOrCreateJwtSecret(),
      // Disable BullMQ/Redis dependence — desktop has no Redis. Server falls back to in-memory.
      DISABLE_BULLMQ: '1',
    },
    silent: false,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });

  serverChild.on('exit', (code, signal) => {
    console.error(`[radix] backend exited (code=${code} signal=${signal})`);
    serverChild = null;
    serverPort = null;
    serverReadyPromise = null;
  });

  serverReadyPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('[radix] backend ready handshake timed out (10s)')), 10_000);
    serverChild.on('message', (msg) => {
      if (msg && msg.type === 'radix:ready') {
        clearTimeout(timeout);
        serverPort = msg.port;
        console.log(`[radix] backend ready on port ${serverPort}`);
        resolve(serverPort);
      }
    });
  });

  return serverReadyPromise;
}

let mainWindow = null;
let tray = null;
const isDev = !app.isPackaged;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'RADIX — AI Content Planner',
    icon: path.join(__dirname, '..', 'public', 'radix-icon.png'),
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#050505',
      symbolColor: '#ffffff',
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  // Graceful show
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Load app
  if (isDev) {
    const devUrl = process.env.VITE_DEV_URL || 'http://localhost:3200';
    mainWindow.loadURL(devUrl);
    // Open DevTools in dev
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Handle close to tray
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'public', 'radix-icon.png');
  tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open RADIX', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: 'New Brief', click: () => { mainWindow?.show(); mainWindow?.webContents.executeJavaScript("window.location.hash = '/brief'"); } },
    { label: 'Review Content', click: () => { mainWindow?.show(); mainWindow?.webContents.executeJavaScript("window.location.hash = '/content-review'"); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);

  tray.setToolTip('RADIX AI Content Planner');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

// IPC handlers for window controls
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

ipcMain.handle('radix:get-server-port', async () => {
  if (serverPort) return serverPort;
  if (serverReadyPromise) return await serverReadyPromise;
  return null; // fallback — renderer cascades to VPS
});

// App lifecycle
app.whenReady().then(async () => {
  try {
    await forkServer();
  } catch (err) {
    console.error('[radix] failed to start backend:', err);
    // Fall through — frontend will degrade to VPS via existing cascade in backend-api.ts
  }
  createWindow();
  createTray();

  if (app.isPackaged) {
    // Wait 5s post-launch so the user sees the app, then check for updates
    setTimeout(() => autoUpdater.checkForUpdatesAndNotify().catch(console.error), 5000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Don't quit, stay in tray
  }
});

app.on('before-quit', async () => {
  app.isQuitting = true;
  if (serverChild) {
    serverChild.kill('SIGTERM');
    // Force-kill after 5s if still alive
    setTimeout(() => { if (serverChild) serverChild.kill('SIGKILL'); }, 5000);
  }
});

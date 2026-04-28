const { app, BrowserWindow, shell, Menu, Tray, nativeImage, ipcMain } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');

// Load AI provider keys baked into the build at compile time. The keys-baked.env
// file is gitignored — only the developer who builds the installer knows the
// values. End users never see plaintext, but a determined attacker COULD extract
// them from the asar — rotate keys after wide distribution.
function loadBakedKeys() {
  const candidates = [
    path.join(__dirname, 'keys-baked.env'),                   // dev mode
    path.join(process.resourcesPath || '', 'app.asar', 'electron', 'keys-baked.env'), // packaged (asar)
    path.join(process.resourcesPath || '', 'electron', 'keys-baked.env'), // packaged (unpacked)
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const env = {};
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
      console.log(`[radix] loaded ${Object.keys(env).length} baked AI provider keys`);
      return env;
    } catch {}
  }
  console.warn('[radix] keys-baked.env not found — AI features will fail');
  return {};
}
const BAKED_AI_KEYS = loadBakedKeys();

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

// First-launch detector + migration applier. Runs ONCE per install, before
// the server is forked. Uses sql.js (pure-JS WASM SQLite, no native binding,
// no electron-rebuild) to exec the bundled 0_init/migration.sql, then writes
// the resulting db buffer to userData/radix.db. Subsequent reads/writes go
// through Prisma's own SQLite engine inside the forked server.
//
// Why not better-sqlite3? No prebuilt binary exists for Electron 41 + node-gyp
// can't rebuild on this machine (no VS Build Tools, project path has spaces).
// Why not Prisma's `migrate deploy`? It collides with the Postgres
// migration_lock since both schemas live in server/prisma/ — Prisma can't tell
// them apart at the migrations-folder resolution layer.
async function applyFirstLaunchMigrationIfNeeded(dbPath) {
  if (fs.existsSync(dbPath)) return false; // already migrated, not first launch
  console.log('[radix] first launch detected — applying SQLite migration');
  const migrationSqlPath = app.isPackaged
    ? path.join(process.resourcesPath, 'server', 'prisma', 'migrations-sqlite', '0_init', 'migration.sql')
    : path.join(__dirname, '..', '..', '..', 'server', 'prisma', 'migrations-sqlite', '0_init', 'migration.sql');
  if (!fs.existsSync(migrationSqlPath)) {
    throw new Error(`[radix] migration SQL missing at ${migrationSqlPath}`);
  }
  const sql = fs.readFileSync(migrationSqlPath, 'utf8');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  try {
    db.exec(sql);
    const buffer = db.export();
    fs.writeFileSync(dbPath, Buffer.from(buffer));
    console.log(`[radix] migration applied → ${dbPath} (${buffer.length} bytes)`);
  } finally {
    db.close();
  }
  return true; // first launch, server should auto-seed demo-admin
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
  const isFirstLaunch = await applyFirstLaunchMigrationIfNeeded(dbPath);

  serverChild = fork(serverEntry, [], {
    env: {
      ...process.env,
      ...BAKED_AI_KEYS, // GEMINI/XAI/MOONSHOT keys + AI_*_PRIMARY routing — baked at build
      NODE_ENV: 'production',
      DB_TARGET: 'sqlite',
      DATABASE_URL: `file:${dbPath}`,
      PORT: String(port),
      HOST: '127.0.0.1',
      JWT_SECRET: getOrCreateJwtSecret(),
      // Disable BullMQ/Redis dependence — desktop has no Redis. Server falls back to in-memory.
      DISABLE_BULLMQ: '1',
      // First launch: server upserts a demo-admin user so the installer is
      // shareable to anyone with no manual seed step. Subsequent launches: '0'.
      RADIX_AUTOSEED: isFirstLaunch ? '1' : '0',
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

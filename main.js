// main.js
// Electron "main process": opens the window and connects the UI to the backend.
// The UI (renderer) asks for things with  api.invoke('channel', ...)  and this file answers.

const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, Notification } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const store = require('./backend/store');
const platforms = require('./backend/platforms');
const java = require('./backend/java');
const files = require('./backend/files');
const modrinth = require('./backend/modrinth');
const { readProperties, writeProperties } = require('./backend/properties');
const { ServerManager } = require('./backend/servers');
const { Tunnel } = require('./backend/tunnel');
const { Terminals } = require('./backend/terminal');

// ---------- only one copy of the app at a time ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let config = store.loadConfig();
const getConfig = () => config;
const saveConfig = (next) => { config = next; store.saveConfig(config); };

const manager = new ServerManager(getConfig);
const tunnel = new Tunnel(getConfig, saveConfig);
const terminals = new Terminals();

let win = null;
let tray = null;
let quitting = false;
const ICON = path.join(__dirname, 'assets', 'icon.png');

// Send an event to the window (if it's open)
function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function createWindow() {
  const startHidden = process.argv.includes('--hidden') || config.startMinimized;
  win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 1040,
    minHeight: 680,
    frame: false,                       // we draw our own modern title bar
    backgroundColor: '#0d0e12',
    show: false,
    icon: ICON,
    title: 'Boba Minecraft Server Host Tool',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,           // keeps the UI safely separated from Node
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!startHidden) win.show(); });

  // Closing the window hides it to the tray (so servers keep running)
  win.on('close', (event) => {
    if (!quitting && config.closeToTray) {
      event.preventDefault();
      win.hide();
      if (!tray.shownTip) {
        tray.shownTip = true;
        new Notification({ title: 'Boba is still running', body: 'Your servers keep running in the tray. Right-click the icon to quit.' }).show();
      }
    }
  });
  win.on('maximize', () => send('win:maximized', true));
  win.on('unmaximize', () => send('win:maximized', false));

  // Links open in your normal browser, not inside the app
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function createTray() {
  const image = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.setToolTip('Boba Minecraft Server Host Tool');
  const showWindow = () => { win.show(); win.focus(); };
  tray.on('click', showWindow);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Boba', click: showWindow },
    { type: 'separator' },
    { label: 'Quit (stops all servers)', click: () => { quitting = true; app.quit(); } }
  ]));
}

// Start with Windows (runs Electron with this app's folder + --hidden)
function applyLoginItem() {
  try {
    const args = app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'];
    app.setLoginItemSettings({ openAtLogin: !!config.startWithWindows, path: process.execPath, args });
  } catch (err) { /* not supported on this OS */ }
}

// ---------- forward backend events to the UI ----------
manager.on('log', (id, entry) => send('server:log', id, entry));
manager.on('status', (id, status) => {
  send('server:status', id, status);
  updateTrayTooltip();
});
manager.on('players', (id, players) => send('server:players', id, players));
manager.on('stats', (id, stats) => send('server:stats', id, stats));
manager.on('system', (stats) => send('system:stats', stats));
manager.on('changed', () => send('servers:changed'));
manager.on('install', (data) => send('install:progress', data));
manager.on('backup', (data) => send('backup:update', data));
tunnel.on('update', (info) => send('tunnel:update', info));
tunnel.on('download', (percent) => send('tunnel:download', percent));
terminals.on('data', (id, text) => send('terminal:data', id, text));

function updateTrayTooltip() {
  if (!tray) return;
  const online = manager.list().filter((s) => s.status === 'online').length;
  tray.setToolTip(`Boba Minecraft Server Host Tool — ${online} server(s) online`);
}

// Helper so every handler returns { ok, data } or { ok:false, error } to the UI
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
}

// ---------- window buttons ----------
ipcMain.on('win:minimize', () => win.minimize());
ipcMain.on('win:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.on('win:close', () => win.close());

// ---------- app ----------
handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  totalMemMB: Math.round(os.totalmem() / 1024 / 1024),
  cores: os.cpus().length,
  appRoot: store.APP_ROOT,
  localIps: Object.values(os.networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address)
}));
handle('app:getConfig', () => config);
handle('app:setConfig', (changes) => {
  const next = { ...config, ...changes, tunnel: { ...config.tunnel, ...(changes.tunnel || {}) } };
  saveConfig(next);
  if ('startWithWindows' in changes) applyLoginItem();
  return next;
});
handle('dialog:openFile', async (filters) => {
  const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: filters || [] });
  return result.canceled ? null : result.filePaths[0];
});
handle('dialog:openFiles', async () => {
  const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
  return result.canceled ? [] : result.filePaths;
});
handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});
handle('shell:openExternal', (url) => {
  if (!/^https?:\/\//.test(url)) throw new Error('Only web links can be opened.');
  return shell.openExternal(url);
});

// ---------- servers ----------
handle('servers:list', () => manager.list());
handle('servers:get', (id) => manager.summary(id));
handle('servers:platforms', () => platforms.PLATFORMS);
handle('servers:versions', (type, snapshots) => platforms.listVersions(type, snapshots));
handle('servers:create', (options) => manager.create(options));
handle('servers:import', (options) => manager.importExisting(options));
handle('servers:delete', (id) => manager.remove(id, (dir) => shell.trashItem(dir).catch(() => fs.rmSync(dir, { recursive: true, force: true }))));
handle('servers:saveMeta', (id, changes) => manager.saveMeta(id, changes));
handle('servers:start', (id) => manager.start(id));
handle('servers:stop', (id) => manager.stop(id));
handle('servers:kill', (id) => manager.stop(id, true));
handle('servers:restart', (id) => manager.restart(id));
handle('servers:send', (id, command) => manager.send(id, command));
handle('servers:log', (id) => manager.getLog(id));
handle('servers:clearLog', (id) => manager.clearLog(id));
handle('servers:acceptEula', (id) => fs.writeFileSync(path.join(manager.serverDir(id), 'eula.txt'), 'eula=true\n'));
handle('servers:props', (id) => readProperties(path.join(manager.serverDir(id), 'server.properties')));
handle('servers:saveProps', (id, changes) => writeProperties(path.join(manager.serverDir(id), 'server.properties'), changes));
handle('servers:players', (id) => manager.playerLists(id));
handle('servers:openFolder', (id) => shell.openPath(manager.serverDir(id)));
handle('servers:icon', (id) => {
  const file = path.join(manager.serverDir(id), 'server-icon.png');
  return fs.existsSync(file) ? 'data:image/png;base64,' + fs.readFileSync(file).toString('base64') : null;
});
handle('servers:setIcon', (id, imagePath) => {
  // Minecraft wants exactly 64x64 PNG
  const image = nativeImage.createFromPath(imagePath);
  if (image.isEmpty()) throw new Error('That image could not be read.');
  fs.writeFileSync(path.join(manager.serverDir(id), 'server-icon.png'), image.resize({ width: 64, height: 64, quality: 'best' }).toPNG());
});
handle('servers:worlds', (id) => manager.worldFolders(id));

// Create a server from a Modrinth modpack (versionId) or a local .mrpack file (filePath)
handle('servers:createModpack', (options) => manager.create(
  { ...options, type: 'modpack' },
  async (id, dir, log, percent) => {
    let packFile = options.filePath;
    if (!packFile) {
      log('Downloading modpack...');
      packFile = await modrinth.downloadPack(options.versionId, dir);
    }
    const pack = modrinth.readPackInfo(packFile);
    log(`Modpack "${pack.name}" uses Minecraft ${pack.mcVersion} + ${platforms.PLATFORMS[pack.type].name} ${pack.loaderVersion}`);
    manager.saveMeta(id, { type: pack.type, mcVersion: pack.mcVersion });

    const javaMajor = await platforms.requiredJava(pack.mcVersion);
    const javaPath = await java.ensureJava(javaMajor, log, percent);
    const result = await platforms.installServer(dir, {
      type: pack.type, mcVersion: pack.mcVersion, loaderVersion: pack.loaderVersion, javaPath, log, progress: percent
    });
    await modrinth.installPackFiles(dir, pack, log, percent);
    if (!options.filePath) fs.unlinkSync(packFile);
    return {
      ...result,
      type: pack.type,
      mcVersion: pack.mcVersion,
      javaMajor: java.normalizeMajor(javaMajor),
      modpack: { name: pack.name, version: pack.index.versionId, projectId: options.projectId || '', icon: options.icon || '', banner: options.banner || '' }
    };
  }
));

// ---------- backups ----------
handle('backups:list', (id) => manager.listBackups(id));
handle('backups:create', (id, mode) => manager.backup(id, mode));
handle('backups:restore', (id, name) => manager.restoreBackup(id, name));
handle('backups:delete', (id, name) => manager.deleteBackup(id, name));
handle('backups:open', (id) => shell.openPath(manager.backupDir(id)));

// ---------- file explorer ----------
const root = (id) => manager.serverDir(id);
handle('files:list', (id, rel) => files.list(root(id), rel));
handle('files:read', (id, rel) => files.readText(root(id), rel));
handle('files:write', (id, rel, text) => files.writeText(root(id), rel, text));
handle('files:mkdir', (id, rel) => files.createFolder(root(id), rel));
handle('files:touch', (id, rel) => files.createFile(root(id), rel));
handle('files:rename', (id, from, to) => files.rename(root(id), from, to));
handle('files:delete', async (id, rels) => {
  // Deleted files go to the Recycle Bin so mistakes can be undone
  for (const rel of rels) await shell.trashItem(files.resolveInside(root(id), rel));
});
handle('files:import', (id, rel, sources) => files.importFiles(root(id), rel, sources));
handle('files:extract', (id, rel) => files.extract(root(id), rel));
handle('files:compress', (id, rel) => files.compress(root(id), rel));
handle('files:reveal', (id, rel) => shell.showItemInFolder(files.resolveInside(root(id), rel)));
handle('files:openSystem', (id, rel) => shell.openPath(files.resolveInside(root(id), rel)));

// ---------- installed mods / plugins ----------
function contentFolder(id) {
  const meta = manager.getMeta(id);
  const info = platforms.PLATFORMS[meta.type];
  return info && info.folder ? info.folder : null;
}
handle('content:list', (id) => {
  const folder = contentFolder(id);
  if (!folder) return { folder: null, items: [] };
  const dir = path.join(manager.serverDir(id), folder);
  if (!fs.existsSync(dir)) return { folder, items: [] };
  const items = fs.readdirSync(dir)
    .filter((f) => /\.jar(\.disabled)?$/i.test(f))
    .map((f) => ({ file: f, enabled: !f.endsWith('.disabled'), size: fs.statSync(path.join(dir, f)).size }))
    .sort((a, b) => a.file.localeCompare(b.file));
  return { folder, items };
});
handle('content:toggle', (id, file) => {
  const dir = path.join(manager.serverDir(id), contentFolder(id));
  const from = path.join(dir, path.basename(file));
  const to = file.endsWith('.disabled') ? from.replace(/\.disabled$/, '') : from + '.disabled';
  fs.renameSync(from, to);
});
handle('content:delete', (id, file) => shell.trashItem(path.join(manager.serverDir(id), contentFolder(id), path.basename(file))));
handle('content:install', async (id, projectId, versionId) => {
  const meta = manager.getMeta(id);
  const folder = contentFolder(id);
  if (!folder) throw new Error('Vanilla servers can\'t use mods or plugins. Make a Paper or Fabric server instead.');
  const kind = folder === 'plugins' ? 'plugin' : 'mod';
  return modrinth.installContent(manager.serverDir(id), folder, projectId,
    { loader: meta.type, gameVersion: meta.mcVersion, kind, versionId },
    (p) => send('content:progress', { id, projectId, percent: p }));
});

// ---------- Modrinth browsing ----------
handle('modrinth:search', (options) => modrinth.search(options));
handle('modrinth:versions', (projectId, filters) => modrinth.versions(projectId, filters || {}));
handle('modrinth:project', (projectId) => modrinth.project(projectId));

// ---------- Java ----------
handle('java:list', () => java.listAll());
handle('java:install', (major) => java.ensureJava(Number(major), (line) => send('java:log', line), (p) => send('java:progress', p)));
handle('java:required', (mcVersion) => platforms.requiredJava(mcVersion));

// ---------- tunnel ----------
handle('tunnel:info', () => tunnel.info());
handle('tunnel:start', () => { tunnel.start(); return true; });
handle('tunnel:stop', () => tunnel.stop());
handle('tunnel:reset', () => tunnel.reset());
handle('tunnel:setAddress', (address) => tunnel.setAddress(address));

// ---------- system terminal ----------
handle('terminal:start', (id) => terminals.start(id, manager.serverDir(id)));
handle('terminal:write', (id, text) => terminals.write(id, text));
handle('terminal:kill', (id) => terminals.kill(id));

// ---------- app lifecycle ----------
app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });

app.whenReady().then(() => {
  app.setAppUserModelId('com.boba.minecraftserverhost');
  createWindow();
  createTray();
  applyLoginItem();

  // Auto-start the tunnel and any servers marked "start automatically"
  // (only if this PC was already linked to playit once)
  if (config.tunnel.autoStart && (fs.existsSync(path.join(store.DATA_DIR, 'playit-secret.toml')) || config.tunnel.address)) {
    tunnel.start();
  }
  for (const server of manager.list()) {
    if (server.autoStart) manager.start(server.id).catch((err) => manager.addLog(server.id, `[Boba] Auto-start failed: ${err.message}`, 'err'));
  }
});

// Before quitting: stop servers nicely so worlds are saved
app.on('before-quit', async (event) => {
  quitting = true;
  const running = manager.list().filter((s) => s.status !== 'offline' && s.status !== 'installing');
  if (running.length && !app.stoppingServers) {
    event.preventDefault();
    app.stoppingServers = true;
    send('app:quitting');
    tunnel.stop();
    terminals.killAll();
    await Promise.race([manager.stopAll(), new Promise((r) => setTimeout(r, 45000))]);
    app.quit();
  } else {
    tunnel.stop();
    terminals.killAll();
  }
});

app.on('window-all-closed', () => { /* keep running in the tray */ });

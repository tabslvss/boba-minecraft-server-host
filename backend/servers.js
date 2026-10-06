// servers.js
// The heart of the app: creates servers, starts/stops them, reads their console,
// tracks players, measures RAM/CPU, and makes backups.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const AdmZip = require('adm-zip');

const { readJson, writeJson, ensureDir } = require('./store');
const { readProperties, writeProperties } = require('./properties');
const platforms = require('./platforms');
const java = require('./java');

const META_FILE = 'boba.json';     // each server folder has one of these with its Boba settings
const MAX_LOG_LINES = 3000;        // how many console lines we keep in memory per server

// Performance flags made popular by Aikar (used by most big servers)
const AIKAR_FLAGS = [
  '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=200',
  '-XX:+UnlockExperimentalVMOptions', '-XX:+DisableExplicitGC', '-XX:+AlwaysPreTouch',
  '-XX:G1NewSizePercent=30', '-XX:G1MaxNewSizePercent=40', '-XX:G1HeapRegionSize=8M',
  '-XX:G1ReservePercent=20', '-XX:G1HeapWastePercent=5', '-XX:G1MixedGCCountTarget=4',
  '-XX:InitiatingHeapOccupancyPercent=15', '-XX:G1MixedGCLiveThresholdPercent=90',
  '-XX:SurvivorRatio=32', '-XX:+PerfDisableSharedMem', '-XX:MaxTenuringThreshold=1',
  '-Dusing.aikars.flags=https://mcflags.emc.gs', '-Daikars.new.flags=true'
];

// Default Boba settings for a brand new server
function defaultMeta() {
  return {
    id: '', name: 'My Server', type: 'paper', mcVersion: '', loaderVersion: '',
    created: Date.now(),
    launch: { kind: 'auto' },
    memoryMin: 1024,               // MB of RAM at start
    memoryMax: 4096,               // MB of RAM max
    javaMajor: 0,                  // 0 = pick automatically
    javaPath: '',                  // '' = let Boba manage Java
    useAikarFlags: true,
    extraJvmArgs: '',
    serverArgs: 'nogui',
    autoRestart: true,             // restart if it crashes
    maxCrashRestarts: 3,
    autoStart: false,              // start when the app opens
    backup: { enabled: false, everyHours: 6, keep: 10, mode: 'worlds', last: 0 },
    dailyRestart: { enabled: false, time: '04:00' },
    modpack: null,
    color: '#a78bfa'
  };
}

class ServerManager extends EventEmitter {
  constructor(getConfig) {
    super();
    this.getConfig = getConfig;     // function returning the current app config
    this.runtime = new Map();       // id -> live info (process, logs, players...)
    this.lastCpu = os.cpus();
    // Every 2 seconds: send RAM/CPU stats for running servers
    this.statsTimer = setInterval(() => this.collectStats(), 2000);
    // Every 30 seconds: check backup + daily restart schedules
    this.scheduleTimer = setInterval(() => this.runSchedules(), 30000);
  }

  // ---------- folders + settings ----------

  serversDir() {
    return ensureDir(this.getConfig().serversDir);
  }

  serverDir(id) {
    return path.join(this.serversDir(), id);
  }

  backupDir(id) {
    return ensureDir(path.join(this.serversDir(), '_backups', id));
  }

  getMeta(id) {
    const meta = readJson(path.join(this.serverDir(id), META_FILE), null);
    if (!meta) return null;
    // Fill in any settings added in newer versions of the app
    const merged = { ...defaultMeta(), ...meta, id };
    merged.backup = { ...defaultMeta().backup, ...(meta.backup || {}) };
    merged.dailyRestart = { ...defaultMeta().dailyRestart, ...(meta.dailyRestart || {}) };
    return merged;
  }

  saveMeta(id, changes) {
    const current = this.getMeta(id) || { ...defaultMeta(), id };
    const next = { ...current, ...changes, id };
    writeJson(path.join(this.serverDir(id), META_FILE), next);
    return next;
  }

  // Live info for a server (created on first use)
  rt(id) {
    if (!this.runtime.has(id)) {
      this.runtime.set(id, {
        child: null, status: 'offline', log: [], players: new Set(),
        startedAt: 0, stopping: false, crashCount: 0, stats: null, installing: false
      });
    }
    return this.runtime.get(id);
  }

  // All servers (any folder in the servers dir that has a boba.json)
  list() {
    const dir = this.serversDir();
    return fs.readdirSync(dir)
      .filter((name) => !name.startsWith('_') && fs.existsSync(path.join(dir, name, META_FILE)))
      .map((id) => this.summary(id))
      .filter(Boolean)
      .sort((a, b) => a.created - b.created);
  }

  // Everything the UI needs to draw one server
  summary(id) {
    const meta = this.getMeta(id);
    if (!meta) return null;
    const live = this.rt(id);
    const props = readProperties(path.join(this.serverDir(id), 'server.properties'));
    return {
      ...meta,
      status: live.installing ? 'installing' : live.status,
      players: [...live.players],
      maxPlayers: Number(props['max-players'] || 20),
      port: Number(props['server-port'] || 25565),
      motd: props.motd || '',
      startedAt: live.startedAt,
      stats: live.stats,
      dir: this.serverDir(id),
      hasIcon: fs.existsSync(path.join(this.serverDir(id), 'server-icon.png'))
    };
  }

  // ---------- creating servers ----------

  // Turn "My Cool Server!" into "my-cool-server" and make sure it's unique
  makeId(name) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'server';
    let id = base;
    let n = 2;
    while (fs.existsSync(this.serverDir(id))) id = `${base}-${n++}`;
    return id;
  }

  // Send install progress to the UI
  progress(id, data) {
    this.emit('install', { id, ...data });
  }

  // Create + install a normal (non-modpack) server.
  // options: { name, type, mcVersion, loaderVersion, memoryMax, properties: {...}, acceptEula }
  async create(options, installFn) {
    const id = this.makeId(options.name);
    const dir = ensureDir(this.serverDir(id));
    const live = this.rt(id);
    live.installing = true;

    this.saveMeta(id, {
      name: options.name,
      type: options.type,
      mcVersion: options.mcVersion || '',
      memoryMax: options.memoryMax || 4096,
      memoryMin: Math.min(1024, options.memoryMax || 4096),
      color: options.color || '#a78bfa',
      created: Date.now()
    });
    this.emit('changed');

    // Run the install in the background; the UI listens to 'install' events
    (async () => {
      const log = (line) => this.progress(id, { line });
      const percent = (p) => this.progress(id, { percent: p });
      try {
        // installFn lets modpacks plug in their own install steps
        const result = installFn
          ? await installFn(id, dir, log, percent)
          : await this.installPlatform(id, dir, options, log, percent);

        if (options.acceptEula) fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n');
        // Starting server.properties values chosen in the wizard
        writeProperties(path.join(dir, 'server.properties'), {
          'server-port': 25565,
          motd: options.name,
          ...(options.properties || {})
        });
        this.saveMeta(id, result || {});
        live.installing = false;
        this.progress(id, { done: true, line: 'All done! Your server is ready to start.' });
      } catch (err) {
        live.installing = false;
        this.progress(id, { error: err.message, line: `Error: ${err.message}` });
      }
      this.emit('changed');
    })();

    return id;
  }

  // Normal install for Vanilla/Paper/Fabric/... servers
  async installPlatform(id, dir, options, log, percent) {
    const javaMajor = await platforms.requiredJava(options.mcVersion);
    log(`Minecraft ${options.mcVersion} needs Java ${javaMajor}.`);
    const javaPath = await java.ensureJava(javaMajor, log, percent);
    const result = await platforms.installServer(dir, {
      type: options.type, mcVersion: options.mcVersion, loaderVersion: options.loaderVersion,
      javaPath, log, progress: percent
    });
    return { ...result, javaMajor: java.normalizeMajor(javaMajor) };
  }

  // Import an existing server folder / zip / jar the user already has
  async importExisting(options) {
    const id = this.makeId(options.name);
    const dir = ensureDir(this.serverDir(id));
    const source = options.source;
    const stat = fs.statSync(source);

    if (stat.isDirectory()) {
      fs.cpSync(source, dir, { recursive: true });
    } else if (source.toLowerCase().endsWith('.zip')) {
      const zip = new AdmZip(source);
      zip.extractAllTo(dir, true);
      // Many server packs are zipped inside one top folder -> move its contents up
      const entries = fs.readdirSync(dir);
      if (entries.length === 1 && fs.statSync(path.join(dir, entries[0])).isDirectory()) {
        const inner = path.join(dir, entries[0]);
        for (const name of fs.readdirSync(inner)) fs.renameSync(path.join(inner, name), path.join(dir, name));
        fs.rmdirSync(inner);
      }
    } else if (source.toLowerCase().endsWith('.jar')) {
      fs.copyFileSync(source, path.join(dir, 'server.jar'));
    }

    if (options.acceptEula) fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n');
    this.saveMeta(id, {
      name: options.name,
      type: options.type || 'custom',
      mcVersion: options.mcVersion || '',
      javaMajor: Number(options.javaMajor) || 21,
      memoryMax: options.memoryMax || 4096,
      launch: source.toLowerCase().endsWith('.jar') ? { kind: 'jar', jar: 'server.jar' } : { kind: 'auto' },
      created: Date.now()
    });
    this.emit('changed');
    return id;
  }

  // Delete a server folder (sent to the Recycle Bin by main.js when possible)
  async remove(id, trashFn) {
    if (this.rt(id).child) throw new Error('Stop the server before deleting it.');
    const dir = this.serverDir(id);
    if (trashFn) await trashFn(dir);
    else fs.rmSync(dir, { recursive: true, force: true });
    this.runtime.delete(id);
    this.emit('changed');
  }

  // ---------- running ----------

  addLog(id, line, kind = 'out') {
    const live = this.rt(id);
    const entry = { t: Date.now(), line, kind };
    live.log.push(entry);
    if (live.log.length > MAX_LOG_LINES) live.log.splice(0, live.log.length - MAX_LOG_LINES);
    this.emit('log', id, entry);
    this.parseLine(id, line);
  }

  setStatus(id, status) {
    const live = this.rt(id);
    live.status = status;
    this.emit('status', id, status);
    this.emit('changed');
  }

  // Watch console lines for "server ready", players joining/leaving, etc.
  parseLine(id, line) {
    const live = this.rt(id);
    // Remove color codes so the patterns match
    const clean = line.replace(/\x1b\[[0-9;]*m/g, '');

    if (/Done \([\d.,]+s\)! For help/.test(clean)) {
      this.setStatus(id, 'online');
      live.crashCount = 0;
    }
    const joined = clean.match(/\]: (\.?[A-Za-z0-9_]{1,16}) joined the game/);
    if (joined) { live.players.add(joined[1]); this.emit('players', id, [...live.players]); }

    const left = clean.match(/\]: (\.?[A-Za-z0-9_]{1,16}) (left the game|lost connection)/);
    if (left) { live.players.delete(left[1]); this.emit('players', id, [...live.players]); }

    // Answer to the "list" command: "There are 2 of a max of 20 players online: Steve, Alex"
    const listed = clean.match(/There are \d+ (?:of a max of|\/) ?\d+ players online:(.*)$/);
    if (listed) {
      const names = listed[1].split(',').map((n) => n.trim()).filter(Boolean);
      live.players = new Set(names);
      this.emit('players', id, names);
    }

    if (/Saved the game|Saved the world/.test(clean) && live.onSaved) {
      live.onSaved();
      live.onSaved = null;
    }
  }

  // Work out the full Java command for a server
  async buildCommand(id) {
    const meta = this.getMeta(id);
    const dir = this.serverDir(id);

    let javaPath = meta.javaPath;
    if (!javaPath) {
      const major = meta.javaMajor || (await platforms.requiredJava(meta.mcVersion || '1.21'));
      javaPath = await java.ensureJava(major, (line) => this.addLog(id, `[Boba] ${line}`, 'info'));
    }

    const args = [`-Xms${meta.memoryMin}M`, `-Xmx${meta.memoryMax}M`];
    if (meta.useAikarFlags) args.push(...AIKAR_FLAGS);
    if (meta.extraJvmArgs.trim()) args.push(...meta.extraJvmArgs.trim().split(/\s+/));
    args.push(...platforms.findLaunchArgs(dir, meta));
    if (meta.serverArgs.trim()) args.push(...meta.serverArgs.trim().split(/\s+/));
    return { javaPath, args, dir };
  }

  async start(id) {
    const live = this.rt(id);
    if (live.child) return;                          // already running
    if (live.installing) throw new Error('Still installing, please wait.');

    const dir = this.serverDir(id);
    // Minecraft refuses to run until the EULA is accepted
    const eula = path.join(dir, 'eula.txt');
    if (!fs.existsSync(eula) || !/eula\s*=\s*true/i.test(fs.readFileSync(eula, 'utf8'))) {
      throw new Error('EULA_NOT_ACCEPTED');
    }

    // Make sure no other running server uses the same port
    const port = this.summary(id).port;
    for (const [otherId, other] of this.runtime) {
      if (otherId !== id && other.child && this.summary(otherId).port === port) {
        throw new Error(`Port ${port} is already used by "${this.getMeta(otherId).name}". Change the port in Settings.`);
      }
    }

    this.setStatus(id, 'starting');
    live.players = new Set();
    live.stopping = false;

    let command;
    try {
      command = await this.buildCommand(id);
    } catch (err) {
      this.setStatus(id, 'offline');
      throw err;
    }

    this.addLog(id, `[Boba] Starting: ${path.basename(command.javaPath)} ${command.args.join(' ')}`, 'info');
    const child = spawn(command.javaPath, command.args, { cwd: command.dir, windowsHide: true });
    live.child = child;
    live.startedAt = Date.now();

    // Split output into lines (chunks can end in the middle of a line)
    const attach = (stream, kind) => {
      let buffer = '';
      stream.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop();                         // keep the unfinished part
        for (const line of lines) if (line.length) this.addLog(id, line, kind);
      });
    };
    attach(child.stdout, 'out');
    attach(child.stderr, 'err');

    child.on('error', (err) => {
      this.addLog(id, `[Boba] Could not start Java: ${err.message}`, 'err');
    });

    child.on('close', (code) => {
      const wasStopping = live.stopping;
      live.child = null;
      live.startedAt = 0;
      live.players = new Set();
      live.stats = null;
      this.emit('players', id, []);
      this.addLog(id, `[Boba] Server stopped (exit code ${code}).`, code === 0 ? 'info' : 'err');
      this.setStatus(id, 'offline');

      // Crash -> automatic restart (but give up after a few tries in a row)
      const meta = this.getMeta(id);
      if (!wasStopping && code !== 0 && meta && meta.autoRestart) {
        live.crashCount++;
        if (live.crashCount <= meta.maxCrashRestarts) {
          this.addLog(id, `[Boba] Crash detected. Restarting in 5 seconds (try ${live.crashCount}/${meta.maxCrashRestarts})...`, 'warn');
          setTimeout(() => this.start(id).catch((e) => this.addLog(id, `[Boba] ${e.message}`, 'err')), 5000);
        } else {
          this.addLog(id, '[Boba] Crashed too many times. Auto-restart paused. Check the console above for the error.', 'err');
        }
      }
      if (live.afterStop) { const fn = live.afterStop; live.afterStop = null; fn(); }
    });
  }

  // Send a command to the server console, e.g. "say hi"
  send(id, command) {
    const live = this.rt(id);
    if (!live.child) throw new Error('The server is not running.');
    this.addLog(id, `> ${command}`, 'cmd');
    live.child.stdin.write(command + '\n');
  }

  // Ask the server to stop nicely. Force-kill if it takes too long.
  stop(id, force = false) {
    const live = this.rt(id);
    if (!live.child) return Promise.resolve();
    return new Promise((resolve) => {
      live.stopping = true;
      live.afterStop = resolve;
      this.setStatus(id, 'stopping');
      if (force) {
        live.child.kill();
        return;
      }
      try { live.child.stdin.write('stop\n'); } catch (err) { live.child.kill(); }
      // If it hasn't closed in 60s, kill it
      const child = live.child;
      setTimeout(() => { if (live.child === child) { this.addLog(id, '[Boba] Taking too long, force stopping.', 'warn'); child.kill(); } }, 60000);
    });
  }

  async restart(id) {
    await this.stop(id);
    await this.start(id);
  }

  async stopAll() {
    await Promise.all([...this.runtime.keys()].map((id) => this.stop(id)));
  }

  getLog(id) {
    return this.rt(id).log;
  }

  clearLog(id) {
    this.rt(id).log = [];
  }

  // ---------- stats ----------

  // CPU % for the whole PC since the last check
  pcCpuPercent() {
    const now = os.cpus();
    let idle = 0;
    let total = 0;
    now.forEach((cpu, i) => {
      const before = this.lastCpu[i] ? this.lastCpu[i].times : cpu.times;
      const after = cpu.times;
      const sum = (t) => t.user + t.nice + t.sys + t.idle + t.irq;
      total += sum(after) - sum(before);
      idle += after.idle - before.idle;
    });
    this.lastCpu = now;
    return total > 0 ? Math.round(100 - (idle / total) * 100) : 0;
  }

  // RAM used by one process (in MB)
  processMemory(pid) {
    return new Promise((resolve) => {
      if (process.platform === 'win32') {
        // tasklist prints: "java.exe","1234","Console","1","1,234,567 K"
        execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (err, out) => {
          if (err) return resolve(0);
          const cells = out.trim().split('","');
          const kb = Number((cells[4] || '').replace(/[^0-9]/g, ''));
          resolve(Math.round(kb / 1024));
        });
      } else {
        try {
          const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
          const kb = Number((status.match(/VmRSS:\s+(\d+)/) || [])[1] || 0);
          resolve(Math.round(kb / 1024));
        } catch (err) { resolve(0); }
      }
    });
  }

  async collectStats() {
    const cpu = this.pcCpuPercent();
    const totalMem = Math.round(os.totalmem() / 1024 / 1024);
    const freeMem = Math.round(os.freemem() / 1024 / 1024);
    for (const [id, live] of this.runtime) {
      if (!live.child) continue;
      const memory = await this.processMemory(live.child.pid);
      live.stats = { cpu, memory, totalMem, freeMem, uptime: Date.now() - live.startedAt };
      this.emit('stats', id, live.stats);
    }
    this.emit('system', { cpu, totalMem, freeMem, cores: os.cpus().length });
  }

  // ---------- players ----------

  playerLists(id) {
    const dir = this.serverDir(id);
    const live = this.rt(id);
    return {
      online: [...live.players],
      ops: readJson(path.join(dir, 'ops.json'), []).map((p) => p.name),
      whitelist: readJson(path.join(dir, 'whitelist.json'), []).map((p) => p.name),
      banned: readJson(path.join(dir, 'banned-players.json'), []).map((p) => ({ name: p.name, reason: p.reason })),
      bannedIps: readJson(path.join(dir, 'banned-ips.json'), []).map((p) => ({ ip: p.ip, reason: p.reason })),
      known: readJson(path.join(dir, 'usercache.json'), []).map((p) => p.name)
    };
  }

  // ---------- backups ----------

  // Folders that hold a world (they contain level.dat)
  worldFolders(id) {
    const dir = this.serverDir(id);
    return fs.readdirSync(dir).filter((name) => {
      try { return fs.existsSync(path.join(dir, name, 'level.dat')); } catch (err) { return false; }
    });
  }

  listBackups(id) {
    const dir = this.backupDir(id);
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.zip'))
      .map((f) => {
        const stat = fs.statSync(path.join(dir, f));
        return { name: f, size: stat.size, time: stat.mtimeMs };
      })
      .sort((a, b) => b.time - a.time);
  }

  // Tell a running server to save everything to disk and wait for it
  flushWorld(id) {
    const live = this.rt(id);
    if (!live.child || live.status !== 'online') return Promise.resolve(false);
    return new Promise((resolve) => {
      live.onSaved = () => resolve(true);
      this.send(id, 'save-off');
      this.send(id, 'save-all flush');
      setTimeout(() => { if (live.onSaved) { live.onSaved = null; resolve(true); } }, 20000);
    });
  }

  async backup(id, mode) {
    const meta = this.getMeta(id);
    mode = mode || meta.backup.mode || 'worlds';
    const dir = this.serverDir(id);
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const target = path.join(this.backupDir(id), `${mode}-${stamp}.zip`);

    this.emit('backup', { id, state: 'running' });
    const wasFlushed = await this.flushWorld(id);
    try {
      // What to put in the zip
      const skip = new Set(['libraries', 'cache', 'logs', 'crash-reports', '.fabric', 'versions', 'bundler']);
      const items = mode === 'worlds'
        ? [...this.worldFolders(id), 'server.properties', 'ops.json', 'whitelist.json', 'banned-players.json']
        : fs.readdirSync(dir).filter((name) => !skip.has(name));
      const existing = items.filter((name) => fs.existsSync(path.join(dir, name)));
      if (!existing.length) throw new Error('Nothing to back up yet. Start the server once to create a world.');

      await zipItems(dir, existing, target);
    } finally {
      if (wasFlushed) this.send(id, 'save-on');
    }

    // Delete the oldest backups beyond the "keep" count
    const keep = Math.max(1, Number(meta.backup.keep) || 10);
    this.listBackups(id).slice(keep).forEach((b) => fs.unlinkSync(path.join(this.backupDir(id), b.name)));

    this.saveMeta(id, { backup: { ...meta.backup, last: Date.now() } });
    this.emit('backup', { id, state: 'done' });
    return path.basename(target);
  }

  async restoreBackup(id, name) {
    if (this.rt(id).child) throw new Error('Stop the server before restoring a backup.');
    const file = path.join(this.backupDir(id), path.basename(name));
    const dir = this.serverDir(id);
    const zip = new AdmZip(file);
    // Remove the worlds that are inside the backup first, so old chunks don't mix in
    const topFolders = new Set(zip.getEntries().map((e) => e.entryName.split('/')[0]));
    for (const folder of topFolders) {
      const full = path.join(dir, folder);
      if (fs.existsSync(full) && fs.statSync(full).isDirectory()) fs.rmSync(full, { recursive: true, force: true });
    }
    zip.extractAllTo(dir, true);
  }

  deleteBackup(id, name) {
    fs.unlinkSync(path.join(this.backupDir(id), path.basename(name)));
  }

  // ---------- schedules ----------

  async runSchedules() {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    for (const server of this.list()) {
      const live = this.rt(server.id);
      // Automatic backups
      if (server.backup.enabled && live.status === 'online') {
        const due = server.backup.last + server.backup.everyHours * 3600 * 1000;
        if (Date.now() >= due && !live.backingUp) {
          live.backingUp = true;
          this.backup(server.id).catch((e) => this.addLog(server.id, `[Boba] Backup failed: ${e.message}`, 'err'))
            .finally(() => { live.backingUp = false; });
        }
      }
      // Daily restart (once per day at the chosen time)
      if (server.dailyRestart.enabled && live.status === 'online' && hhmm === server.dailyRestart.time) {
        const today = now.toDateString();
        if (live.lastDailyRestart !== today) {
          live.lastDailyRestart = today;
          this.send(server.id, 'say Daily restart in 30 seconds!');
          setTimeout(() => this.restart(server.id).catch(() => {}), 30000);
        }
      }
    }
  }
}

// Zip some files/folders from baseDir into target.zip
// On Windows we use the built-in tar.exe (fast, doesn't freeze the app), otherwise adm-zip.
function zipItems(baseDir, items, target) {
  if (process.platform === 'win32') {
    return new Promise((resolve, reject) => {
      const tar = spawn('tar', ['-a', '-c', '-f', target, ...items], { cwd: baseDir, windowsHide: true });
      let errors = '';
      tar.stderr.on('data', (d) => { errors += d; });
      tar.on('error', reject);
      tar.on('close', (code) => (code === 0 ? resolve() : reject(new Error(errors || `tar exit ${code}`))));
    });
  }
  const zip = new AdmZip();
  for (const item of items) {
    const full = path.join(baseDir, item);
    if (fs.statSync(full).isDirectory()) zip.addLocalFolder(full, item);
    else zip.addLocalFile(full);
  }
  return new Promise((resolve, reject) => zip.writeZip(target, (err) => (err ? reject(err) : resolve())));
}

module.exports = { ServerManager, defaultMeta, AIKAR_FLAGS };

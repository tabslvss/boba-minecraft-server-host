// app.js
// Starts the UI: loads servers, draws the sidebar + top bar, and switches pages.

// Each page file adds itself to this object (Views.dashboard = {...})
window.Views = window.Views || {};

const App = {
  servers: [],          // list of server summaries from the backend
  currentId: null,      // the server you're looking at
  config: null,         // app settings
  info: null,           // PC info (RAM, cores...)
  page: 'dashboard',    // current page name
  activeView: null,     // the page object being shown
  icons: new Map(),     // server id -> server-icon.png as a data URL
  handlers: new Map(),  // tiny event system so pages can listen for updates

  // ---------- simple events ----------
  on(name, fn) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(fn);
    return () => this.handlers.get(name).delete(fn);   // call this to stop listening
  },
  emit(name, ...args) {
    (this.handlers.get(name) || []).forEach((fn) => fn(...args));
  },

  get current() {
    return this.servers.find((s) => s.id === this.currentId) || null;
  },

  // ---------- start up ----------
  async init() {
    this.info = await call('app:info');
    this.config = await call('app:getConfig');
    this.applyTheme();
    this.wireTitleBar();
    this.wireBackendEvents();
    this.drawSidebarStatic();
    await this.refreshServers();

    // Open the last used server (or the welcome screen)
    const last = this.servers.find((s) => s.id === this.config.lastServerId) || this.servers[0];
    if (last) this.selectServer(last.id, 'dashboard');
    else this.go('welcome');
  },

  applyTheme() {
    document.documentElement.dataset.theme = this.config.theme || 'dark';
    document.documentElement.dataset.accent = this.config.accent || 'taro';
  },

  async saveConfig(changes) {
    this.config = await call('app:setConfig', changes);
    this.applyTheme();
  },

  wireTitleBar() {
    $('#tb-min').onclick = () => window.api.window.minimize();
    $('#tb-max').onclick = () => window.api.window.maximize();
    $('#tb-close').onclick = () => window.api.window.close();
    $('#titlebar').addEventListener('dblclick', (e) => { if (!e.target.closest('button')) window.api.window.maximize(); });
  },

  // Listen to everything the backend tells us and pass it on to pages
  wireBackendEvents() {
    window.api.on('server:log', (id, entry) => this.emit('log', id, entry));
    window.api.on('server:status', (id, status) => {
      const server = this.servers.find((s) => s.id === id);
      if (server) server.status = status;
      if (status === 'online') toast(`${server ? server.name : 'Server'} is online!`, 'ok');
      this.drawSwitcher();
      this.drawTopbar();
      this.emit('status', id, status);
    });
    window.api.on('server:players', (id, players) => {
      const server = this.servers.find((s) => s.id === id);
      if (server) server.players = players;
      this.emit('players', id, players);
    });
    window.api.on('server:stats', (id, stats) => {
      const server = this.servers.find((s) => s.id === id);
      if (server) server.stats = stats;
      this.emit('stats', id, stats);
    });
    window.api.on('system:stats', (stats) => this.drawSysMeter(stats));
    window.api.on('servers:changed', () => this.refreshServers());
    window.api.on('install:progress', (data) => this.emit('install', data));
    window.api.on('tunnel:update', (info) => this.emit('tunnel', info));
    window.api.on('tunnel:download', (p) => this.emit('tunnel-download', p));
    window.api.on('backup:update', (data) => this.emit('backup', data));
    window.api.on('terminal:data', (id, text) => this.emit('terminal', id, text));
    window.api.on('content:progress', (data) => this.emit('content-progress', data));
    window.api.on('java:log', (line) => this.emit('java-log', line));
    window.api.on('java:progress', (p) => this.emit('java-progress', p));
    window.api.on('app:quitting', () => toast('Stopping servers safely before closing...', 'info', 60000));
  },

  async refreshServers() {
    this.servers = await call('servers:list');
    // Load server icons we don't have yet
    for (const server of this.servers) {
      if (server.hasIcon && !this.icons.has(server.id)) {
        this.icons.set(server.id, await quietCall('servers:icon', server.id).catch(() => null));
      }
      server._icon = server.hasIcon ? this.icons.get(server.id) : null;
    }
    this.drawSwitcher();
    this.drawNav();
    this.drawTopbar();
    this.emit('servers');
  },

  async reloadIcon(id) {
    this.icons.set(id, await quietCall('servers:icon', id).catch(() => null));
    await this.refreshServers();
  },

  // ---------- navigation ----------
  selectServer(id, page) {
    this.currentId = id;
    this.drawSwitcher();
    if (this.config.lastServerId !== id) this.saveConfig({ lastServerId: id }).catch(() => {});
    this.go(page || this.page || 'dashboard');
  },

  // Show a page by name
  go(page, params) {
    if (this.activeView && this.activeView.destroy) this.activeView.destroy();
    hideContextMenu();
    const view = Views[page];
    if (!view) return;
    // Server pages need a server
    if (view.needsServer && !this.current) { page = this.servers.length ? 'dashboard' : 'welcome'; return this.go(page); }
    this.page = page;
    this.activeView = view;
    const root = $('#view');
    root.className = '';
    void root.offsetWidth;   // forces the browser to restart the fade-in animation
    root.className = (view.fullBleed ? 'no-pad ' : '') + 'view-enter';
    root.innerHTML = '';
    root.scrollTop = 0;
    this.drawNav();
    this.drawTopbar();
    view.render(root, this.current, params);
  },

  // ---------- sidebar ----------
  drawSidebarStatic() {
    const newBtn = $('#btn-new-server');
    newBtn.innerHTML = `${icon('plus')}<span>New server</span>`;
    newBtn.onclick = () => this.go('create');
    const settingsBtn = $('#btn-app-settings');
    settingsBtn.innerHTML = `${icon('sliders')}<span>App settings</span>`;
    settingsBtn.onclick = () => this.go('appSettings');
  },

  drawSwitcher() {
    const box = $('#server-switcher');
    const server = this.current;
    if (!server) {
      box.innerHTML = `
        <div class="switcher" data-open>
          <div class="server-avatar" style="--c:var(--accent)">${icon('coffee')}</div>
          <div class="s-text"><div class="s-name">No server yet</div><div class="s-sub">Create one to begin</div></div>
        </div>`;
      $('[data-open]', box).onclick = () => this.go('create');
      return;
    }
    box.innerHTML = `
      <div class="switcher" data-open>
        ${serverAvatar(server)}
        <div class="s-text">
          <div class="s-name">${esc(server.name)}</div>
          <div class="s-sub row" style="gap:6px"><span class="status-dot ${server.status}"></span>${esc(typeInfo(server.type).name)} ${esc(server.mcVersion)}</div>
        </div>
        ${icon('chevronDown', 'chev')}
      </div>`;
    $('[data-open]', box).onclick = (e) => {
      e.stopPropagation();
      if ($('.dropdown', box)) return $('.dropdown', box).remove();
      const menu = el(`<div class="dropdown">${this.servers.map((s) => `
        <div class="dropdown-item ${s.id === this.currentId ? 'active' : ''}" data-id="${esc(s.id)}">
          ${serverAvatar(s)}
          <div style="flex:1;min-width:0"><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.name)}</div>
          <div class="small muted">${esc(typeInfo(s.type).name)} ${esc(s.mcVersion)}</div></div>
          <span class="status-dot ${s.status}"></span>
        </div>`).join('')}
        <div class="cm-sep"></div>
        <div class="dropdown-item" data-new><span class="s-new">${icon('plus')}</span><span style="font-weight:600">Create new server</span></div>
      </div>`);
      $('.switcher', box).appendChild(menu);
      $$('[data-id]', menu).forEach((item) => (item.onclick = (ev) => { ev.stopPropagation(); menu.remove(); this.selectServer(item.dataset.id); }));
      $('[data-new]', menu).onclick = (ev) => { ev.stopPropagation(); menu.remove(); this.go('create'); };
      setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }));
    };
  },

  drawNav() {
    const nav = $('#nav');
    const server = this.current;
    const contentLabel = server && ['paper', 'purpur'].includes(server.type) ? 'Plugins' : 'Mods';
    const items = [
      ['dashboard', 'Dashboard', 'dashboard'],
      ['console', 'Console', 'terminal'],
      ['files', 'Files', 'folder'],
      ['players', 'Players', 'users'],
      ['content', contentLabel, 'puzzle'],
      ['backups', 'Worlds & Backups', 'archive'],
      ['settings', 'Server Settings', 'settings'],
      ['network', 'Go Public', 'globe']
    ];
    nav.innerHTML = `<div class="nav-label">Server</div>` + items.map(([page, label, ic]) => `
      <button class="nav-item ${this.page === page ? 'active' : ''}" data-page="${page}" ${server ? '' : 'disabled style="opacity:.4;pointer-events:none"'}>
        ${icon(ic)}<span>${label}</span>
        ${page === 'players' && server && server.players.length ? `<span class="badge ok">${server.players.length}</span>` : ''}
      </button>`).join('');
    $$('[data-page]', nav).forEach((btn) => (btn.onclick = () => this.go(btn.dataset.page)));
    $('#btn-new-server').classList.toggle('active', this.page === 'create');
    $('#btn-app-settings').classList.toggle('active', this.page === 'appSettings');
  },

  drawSysMeter(stats) {
    const usedMem = stats.totalMem - stats.freeMem;
    $('#sys-meter').innerHTML = `
      <div class="sys-row"><span>PC CPU</span><span>${stats.cpu}%</span></div>
      <div class="mini-bar"><i style="width:${stats.cpu}%"></i></div>
      <div class="sys-row"><span>PC RAM</span><span>${formatMB(usedMem)} / ${formatMB(stats.totalMem)}</span></div>
      <div class="mini-bar"><i style="width:${Math.round((usedMem / stats.totalMem) * 100)}%"></i></div>`;
  },

  // ---------- top bar (page title + start/stop buttons) ----------
  drawTopbar() {
    const bar = $('#topbar');
    const view = this.activeView;
    const server = this.current;
    if (!view || !view.needsServer || !server) {
      bar.innerHTML = view && view.title ? `<div><div class="page-title">${esc(view.title)}</div>${view.subtitle ? `<div class="page-sub">${esc(view.subtitle)}</div>` : ''}</div>` : '';
      return;
    }
    const status = server.status;
    const running = status === 'online' || status === 'starting';
    const busy = status === 'stopping' || status === 'installing';
    bar.innerHTML = `
      <div>
        <div class="page-title">${esc(view.title)}</div>
        <div class="page-sub">${esc(server.name)} · ${esc(typeInfo(server.type).name)} ${esc(server.mcVersion)}</div>
      </div>
      <div class="topbar-actions">
        <span class="status-pill"><span class="status-dot ${status}"></span>${esc(status)}</span>
        ${running || busy
          ? `<button class="btn icon" data-act="restart" data-tip="Restart the server (stop + start)" ${busy ? 'disabled' : ''}>${icon('restart')}</button>
             <button class="btn danger" data-act="stop" data-tip="Saves the world and stops the server. Right-click to force kill." ${status === 'installing' ? 'disabled' : ''}>${icon('stop')}Stop</button>`
          : `<button class="btn primary" data-act="start" data-tip="Start the server">${icon('play')}Start</button>`}
      </div>`;
    $$('[data-act]', bar).forEach((btn) => {
      btn.onclick = () => this.power(btn.dataset.act);
      if (btn.dataset.act === 'stop') {
        btn.oncontextmenu = (e) => showContextMenu(e.clientX, e.clientY, [
          { label: 'Force kill (may lose progress)', icon: 'power', danger: true, action: () => this.power('kill') }
        ]);
      }
    });
  },

  // Start / stop / restart / kill the current server
  async power(action, id = this.currentId) {
    try {
      await quietCall(`servers:${action}`, id);
    } catch (err) {
      const message = cleanError(err);
      if (message === 'EULA_NOT_ACCEPTED') {
        const ok = await confirmBox('Accept the Minecraft EULA',
          'To run a server you must agree to the <a href="https://aka.ms/MinecraftEULA" target="_blank">Minecraft End User License Agreement</a>.', { okText: 'I agree, start' });
        if (ok) { await call('servers:acceptEula', id); return this.power(action, id); }
        return;
      }
      toast(message, 'bad', 6000);
    }
  }
};

document.addEventListener('DOMContentLoaded', () => App.init().catch((err) => {
  document.body.innerHTML = `<pre style="padding:30px;color:#ff8a9a">Boba failed to start:\n${esc(err.stack || err)}</pre>`;
}));

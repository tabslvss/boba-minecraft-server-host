// app-settings.js — settings for Boba itself (theme, startup, Java, folders)

const ACCENTS = [
  ['taro', 'Taro', '#b18cff'], ['strawberry', 'Strawberry', '#ff7aa2'], ['matcha', 'Matcha', '#6fd39a'],
  ['brownsugar', 'Brown sugar', '#e0a36a'], ['mango', 'Mango', '#ffb54d'], ['blueberry', 'Blueberry', '#7c9cff']
];

Views.appSettings = {
  title: 'App settings',
  subtitle: 'How Boba looks and starts up',

  async render(root) {
    this.root = root;
    this.javas = await quietCall('java:list').catch(() => []);
    this.javaLog = '';
    this.draw();
    this.offs = [
      App.on('java-log', (line) => { this.javaLog = line; const n = $('[data-javalog]', root); if (n) n.textContent = line; }),
      App.on('java-progress', (p) => { const n = $('[data-javalog]', root); if (n && p >= 0) n.textContent = `${this.javaLog} ${p}%`; })
    ];
  },

  destroy() {
    (this.offs || []).forEach((off) => off());
  },

  draw() {
    const c = App.config;
    this.root.innerHTML = `
      <div class="col max-w" style="gap:18px">
        <div>
          <div class="section-head">${icon('sun')}<h3>Appearance</h3></div>
          <div class="card" style="padding:6px 18px">
            <div class="setting">
              <div><div class="setting-label">Theme ${helpIcon('Dark or light colors.', 'Dark is easier on the eyes at night')}</div></div>
              <div class="setting-control"><div class="segmented" data-theme>
                <button data-v="dark" class="${c.theme === 'dark' ? 'active' : ''}">${icon('moon')}Dark</button>
                <button data-v="light" class="${c.theme === 'light' ? 'active' : ''}">${icon('sun')}Light</button>
              </div></div>
            </div>
            <div class="setting">
              <div><div class="setting-label">Boba flavor ${helpIcon('The accent color used for buttons and highlights.', 'Taro = purple')}</div></div>
              <div class="setting-control"><div class="swatches">${ACCENTS.map(([id, name, color]) => `<div class="swatch ${c.accent === id ? 'active' : ''}" data-accent="${id}" data-tip="${name}" style="background:${color}"></div>`).join('')}</div></div>
            </div>
          </div>
        </div>

        <div>
          <div class="section-head">${icon('power')}<h3>Startup</h3></div>
          <div class="card" style="padding:6px 18px">
            ${settingRow({ key: 'startWithWindows', label: 'Start with Windows', type: 'toggle', tip: 'Opens Boba automatically when your PC turns on. Turn on "Start when Boba opens" on a server to make it 24/7.', ex: 'PC boots → Boba → server + tunnel start' }, c.startWithWindows)}
            ${settingRow({ key: 'startMinimized', label: 'Start hidden in tray', type: 'toggle', tip: 'Opens Boba quietly in the system tray (bottom-right icons) instead of showing the window.', ex: 'On for a background server' }, c.startMinimized)}
            ${settingRow({ key: 'closeToTray', label: 'Keep running when closed', type: 'toggle', tip: 'The X button hides Boba to the tray so servers keep running. Quit from the tray icon.', ex: 'On' }, c.closeToTray)}
          </div>
        </div>

        <div>
          <div class="section-head">${icon('folder')}<h3>Storage</h3></div>
          <div class="card" style="padding:6px 18px">
            <div class="setting">
              <div><div class="setting-label">Servers folder ${helpIcon('Where new servers are created. Existing servers in the old folder won\'t show until you move them.', 'D:\\MinecraftServerMaker\\servers')}</div>
              <div class="setting-desc mono">${esc(c.serversDir)}</div></div>
              <div class="setting-control"><button class="btn sm" data-changedir>${icon('folderOpen')}Change</button></div>
            </div>
          </div>
        </div>

        <div>
          <div class="section-head">${icon('brand-openjdk')}<h3>Java</h3></div>
          <div class="card">
            <p class="muted small" style="margin:0 0 12px;line-height:1.5">Boba downloads the right Java (Eclipse Temurin) automatically when a server needs it. You can also grab one now.</p>
            <div class="player-list">${this.javas.length ? this.javas.map((j) => `
              <div class="player-row"><div class="type-icon" style="width:34px;height:34px;color:#f89820">${icon('brand-openjdk')}</div>
              <div style="min-width:0"><div class="name">Java ${j.major}</div><div class="small muted mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(j.path)}</div></div>
              <div class="actions"><span class="badge">${esc(j.source)}</span></div></div>`).join('') : '<div class="muted small">No Java found yet.</div>'}
            </div>
            <div class="row" style="margin-top:14px">
              <select class="select" data-javamajor style="width:160px">${[25, 21, 17, 11, 8].map((v) => `<option value="${v}">Java ${v}</option>`).join('')}</select>
              <button class="btn" data-javainstall>${icon('download')}Download</button>
              <span class="small muted" data-javalog></span>
            </div>
          </div>
        </div>

        <div class="card row">
          <img src="../assets/logo.png" style="width:48px;height:48px" alt=""/>
          <div><b>Boba Minecraft Server Host Tool</b><div class="small muted">Version ${esc(App.info.version)} · Tunnels by playit.gg · Mods by Modrinth · Icons by Lucide & Fluent Emoji</div></div>
          <span class="spacer"></span>
          <span class="small muted">Not affiliated with Mojang or Microsoft.</span>
        </div>
      </div>`;

    $$('[data-theme] button', this.root).forEach((b) => (b.onclick = async () => { await App.saveConfig({ theme: b.dataset.v }); this.draw(); }));
    $$('[data-accent]', this.root).forEach((sw) => (sw.onclick = async () => { await App.saveConfig({ accent: sw.dataset.accent }); this.draw(); }));
    $$('[data-key]', this.root).forEach((input) => (input.onchange = async () => {
      await App.saveConfig({ [input.dataset.key]: readInput(input) });
      toast('Saved', 'ok', 1200);
    }));
    $('[data-changedir]', this.root).onclick = async () => {
      const dir = await call('dialog:openFolder');
      if (!dir) return;
      await App.saveConfig({ serversDir: dir });
      await App.refreshServers();
      this.draw();
    };
    $('[data-javainstall]', this.root).onclick = async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await call('java:install', Number($('[data-javamajor]', this.root).value));
        toast('Java ready!', 'ok');
      } catch (err) { /* toast shown */ }
      this.javas = await quietCall('java:list').catch(() => this.javas);
      this.draw();
    };
  }
};

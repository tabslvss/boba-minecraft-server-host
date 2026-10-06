// settings.js — every server setting (Boba options + server.properties), each with a tooltip

const SERVER_COLORS = ['#b18cff', '#ff8fc7', '#6fd39a', '#7c9cff', '#ffb54d', '#ff7a59', '#4dd4e0', '#e0a36a'];

Views.settings = {
  title: 'Server Settings',
  needsServer: true,

  async render(root, server) {
    this.root = root;
    this.server = server;
    this.props = await quietCall('servers:props', server.id).catch(() => ({}));
    this.javas = await quietCall('java:list').catch(() => []);
    this.changes = {};       // key -> new value (meta keys start with "meta:")
    this.draw();
  },

  // Boba's own settings for this server
  metaSections(s) {
    const maxRam = Math.max(2048, App.info.totalMemMB - 512);
    const javaValue = s.javaPath ? 'custom' : s.javaMajor ? String(s.javaMajor) : 'auto';
    return [
      {
        id: 'basics', title: 'Basics', icon: 'coffee',
        items: [
          { key: 'meta:name', label: 'Name in Boba', type: 'text', tip: 'Only shown in this app.', ex: 'Friends SMP', value: s.name },
          { key: 'meta:color', label: 'Color', type: 'custom', tip: 'Color of this server\'s icon in the sidebar.', value: s.color,
            html: `<div class="swatches">${SERVER_COLORS.map((c) => `<div class="swatch ${c === s.color ? 'active' : ''}" data-color="${c}" style="background:${c}"></div>`).join('')}</div>` },
          { key: 'meta:icon', label: 'Server icon', type: 'custom', tip: 'Picture next to your server in the multiplayer list. Any image works, Boba resizes it to 64×64.', ex: 'logo.png',
            html: `<div class="row">${serverAvatar(s)}<button class="btn sm" data-randomicon data-tip="Instantly try a random Minecraft head">${icon('refresh')}Random</button><button class="btn sm" data-pickicon>${icon('image')}Choose picture</button></div>` }
        ]
      },
      {
        id: 'memory', title: 'Memory & Java', icon: 'memory',
        items: [
          { key: 'meta:memoryMax', label: 'Max RAM', type: 'range', min: 1024, max: maxRam, step: 512, format: formatMB, value: s.memoryMax,
            tip: 'Most memory the server can use. Too little = lag/crashes. Leave 2+ GB for Windows.', ex: 'Vanilla 2-4 GB · Modpacks 6-10 GB' },
          { key: 'meta:memoryMin', label: 'Starting RAM', type: 'range', min: 512, max: maxRam, step: 512, format: formatMB, value: s.memoryMin,
            tip: 'Memory grabbed right away. Lower is fine for most.', ex: '1 GB' },
          { key: 'meta:java', label: 'Java version', type: 'select', value: javaValue,
            options: [['auto', 'Automatic (recommended)'], ['25', 'Java 25'], ['21', 'Java 21'], ['17', 'Java 17'], ['11', 'Java 11'], ['8', 'Java 8'], ['custom', 'Custom java.exe...']],
            tip: 'Which Java runs the server. Automatic picks the right one and downloads it.', ex: 'MC 1.20.5+ needs Java 21' },
          { key: 'meta:javaPath', label: 'Custom Java path', type: 'text', value: s.javaPath, placeholder: 'C:\\Program Files\\Java\\bin\\java.exe',
            tip: 'Full path to java.exe. Only used when Java version is "Custom".', ex: 'C:\\Java\\jdk-21\\bin\\java.exe', hidden: javaValue !== 'custom' },
          { key: 'meta:useAikarFlags', label: 'Performance flags', type: 'toggle', value: s.useAikarFlags,
            tip: 'Adds "Aikar\'s flags" — tuned memory settings used by most big servers. Less lag spikes.', ex: 'Keep On' },
          { key: 'meta:extraJvmArgs', label: 'Extra Java arguments', type: 'text', value: s.extraJvmArgs, placeholder: 'optional',
            tip: 'Advanced: extra options for Java. Leave blank if unsure.', ex: '-Dfile.encoding=UTF-8' },
          { key: 'meta:serverArgs', label: 'Server arguments', type: 'text', value: s.serverArgs,
            tip: 'Options passed to Minecraft itself. "nogui" hides the old Java window.', ex: 'nogui' },
          { key: 'meta:launchJar', label: 'Server jar', type: 'text', value: s.launch && s.launch.kind === 'jar' ? s.launch.jar : '', placeholder: 'Automatic',
            tip: 'Which .jar to run. Blank = Boba finds it (works for Forge/NeoForge too).', ex: 'server.jar' }
        ]
      },
      {
        id: 'automation', title: 'Automation', icon: 'zap',
        items: [
          { key: 'meta:autoStart', label: 'Start when Boba opens', type: 'toggle', value: s.autoStart,
            tip: 'Starts this server as soon as the app opens. Combine with "Start with Windows" in App settings for a 24/7 server.', ex: 'On for always-online servers' },
          { key: 'meta:autoRestart', label: 'Restart after a crash', type: 'toggle', value: s.autoRestart,
            tip: 'If the server crashes, Boba starts it again in 5 seconds.', ex: 'On' },
          { key: 'meta:maxCrashRestarts', label: 'Crash restart limit', type: 'number', min: 1, max: 20, value: s.maxCrashRestarts,
            tip: 'Stop trying after this many crashes in a row (so a broken mod doesn\'t loop forever).', ex: '3' },
          { key: 'meta:dailyRestart.enabled', label: 'Daily restart', type: 'toggle', value: s.dailyRestart.enabled,
            tip: 'Restarts once a day to clear lag. Players get a 30 second warning.', ex: 'On at 4:00 AM' },
          { key: 'meta:dailyRestart.time', label: 'Restart time', type: 'time', value: s.dailyRestart.time,
            tip: 'When the daily restart happens (your PC\'s time).', ex: '04:00' }
        ]
      }
    ];
  },

  draw() {
    const s = App.current || this.server;
    this.server = s;
    const metaSections = this.metaSections(s);
    const allSections = [...metaSections, ...PROPERTY_SECTIONS];

    const sectionHtml = (section, isMeta) => `
      <div class="settings-section" id="sec-${section.id}">
        <div class="section-head">${icon(section.icon)}<h3>${esc(section.title)}</h3>${isMeta ? '<span class="badge accent">Boba</span>' : '<span class="badge">server.properties</span>'}</div>
        <div class="card">${section.items.map((item) => {
          const value = isMeta ? item.value : (item.key in this.props ? this.props[item.key] : item.default);
          if (item.type === 'custom') {
            return `<div class="setting"><div><div class="setting-label">${esc(item.label)} ${helpIcon(item.tip, item.ex, item.label)}</div></div><div class="setting-control">${item.html}</div></div>`;
          }
          const row = settingRow({ ...item, showKey: !isMeta }, value);
          return item.hidden ? row.replace('class="setting', 'class="setting hidden') : row;
        }).join('')}</div>
      </div>`;

    this.root.innerHTML = `
      <div class="settings-layout">
        <nav class="settings-nav">
          ${allSections.map((sec, i) => `<button data-jump="${sec.id}" class="${i === 0 ? 'active' : ''}">${icon(sec.icon)}${esc(sec.title)}</button>`).join('')}
          <div class="divider"></div>
          <button data-jump="danger" style="color:var(--bad)">${icon('alert')}Danger zone</button>
        </nav>
        <div>
          ${metaSections.map((sec) => sectionHtml(sec, true)).join('')}
          ${PROPERTY_SECTIONS.map((sec) => sectionHtml(sec, false)).join('')}
          <div class="settings-section" id="sec-danger">
            <div class="section-head">${icon('alert')}<h3>Danger zone</h3></div>
            <div class="card" style="border-color:color-mix(in srgb, var(--bad) 35%, transparent)">
              <div class="setting">
                <div><div class="setting-label">Delete this server</div><div class="setting-desc">The whole folder goes to the Recycle Bin. Backups are kept.</div></div>
                <div class="setting-control"><button class="btn danger" data-delete>${icon('trash')}Delete server</button></div>
              </div>
            </div>
          </div>
          <div data-savebar></div>
        </div>
      </div>`;

    // MOTD live preview
    const motdRow = $('[data-row="motd"]', this.root);
    if (motdRow) {
      motdRow.appendChild(el(`<div class="motd-preview" data-motd style="grid-column:1/-1"></div>`));
      this.updateMotd(this.props.motd ?? 'A Minecraft Server');
    }

    // Any input change -> remember it and show the save bar
    $$('[data-key]', this.root).forEach((input) => {
      const handler = () => {
        const key = input.dataset.key;
        let value = readInput(input);
        const rangeLabel = input.parentElement.querySelector('.range-value');
        if (rangeLabel) {
          const def = allSections.flatMap((x) => x.items).find((x) => x.key === key);
          rangeLabel.textContent = def && def.format ? def.format(value) : value;
        }
        this.changes[key] = value;
        input.closest('.setting').classList.add('changed');
        if (key === 'motd') this.updateMotd(value);
        if (key === 'meta:java') $('[data-row="meta:javaPath"]', this.root).classList.toggle('hidden', value !== 'custom');
        this.drawSaveBar();
      };
      input.addEventListener('input', handler);
      input.addEventListener('change', handler);
    });

    $$('[data-color]', this.root).forEach((sw) => (sw.onclick = () => {
      this.changes['meta:color'] = sw.dataset.color;
      $$('[data-color]', this.root).forEach((x) => x.classList.toggle('active', x === sw));
      this.drawSaveBar();
    }));
    // Server picture: pick from the picture library, or random
    const applyPicture = async (pick) => {
      if (!pick) return;
      try {
        await saveServerPicture(s.id, pick);
        toast('Server picture updated! Restart the server to show it in the list.', 'ok');
      } catch (err) { /* toast already shown */ }
      this.draw();
    };
    $('[data-pickicon]', this.root).onclick = async () => applyPicture(await openPicturePicker(null));
    $('[data-randomicon]', this.root).onclick = () => applyPicture(randomPicture('minecraft'));
    $('[data-delete]', this.root).onclick = () => this.deleteServer();

    // Section jump links (and highlight the one you're reading)
    $$('[data-jump]', this.root).forEach((b) => (b.onclick = () => $(`#sec-${b.dataset.jump}`, this.root).scrollIntoView({ behavior: 'smooth' })));
    const view = $('#view');
    view.onscroll = () => {
      let current = allSections[0].id;
      for (const sec of [...allSections, { id: 'danger' }]) {
        const node = $(`#sec-${sec.id}`, this.root);
        if (node && node.getBoundingClientRect().top < 200) current = sec.id;
      }
      $$('[data-jump]', this.root).forEach((b) => b.classList.toggle('active', b.dataset.jump === current));
    };
    this.drawSaveBar();
  },

  destroy() {
    $('#view').onscroll = null;
  },

  updateMotd(text) {
    const box = $('[data-motd]', this.root);
    if (box) box.innerHTML = `<div style="color:#fff">${esc(this.server.name)}</div>${mcFormat(text)}`;
  },

  drawSaveBar() {
    const bar = $('[data-savebar]', this.root);
    const count = Object.keys(this.changes).length;
    if (!count) { bar.innerHTML = ''; return; }
    bar.innerHTML = `
      <div class="save-bar">
        ${icon('info').replace('<svg', '<svg style="width:18px;height:18px;color:var(--accent)"')}
        <span><b>${count}</b> unsaved change${count === 1 ? '' : 's'}${this.server.status !== 'offline' ? ' · restart the server to apply' : ''}</span>
        <span class="spacer"></span>
        <button class="btn ghost" data-discard>Discard</button>
        <button class="btn primary" data-save>${icon('save')}Save changes</button>
      </div>`;
    $('[data-discard]', bar).onclick = () => { this.changes = {}; this.draw(); };
    $('[data-save]', bar).onclick = () => this.save();
  },

  async save() {
    const s = this.server;
    const props = {};
    const meta = {};
    for (const [key, value] of Object.entries(this.changes)) {
      if (!key.startsWith('meta:')) { props[key] = value; continue; }
      const name = key.slice(5);
      if (name === 'java') {
        if (value === 'auto') { meta.javaMajor = 0; meta.javaPath = ''; }
        else if (value !== 'custom') { meta.javaMajor = Number(value); meta.javaPath = ''; }
      } else if (name === 'launchJar') {
        meta.launch = value.trim() ? { kind: 'jar', jar: value.trim() } : { kind: 'auto' };
      } else if (name.startsWith('dailyRestart.')) {
        meta.dailyRestart = { ...(meta.dailyRestart || s.dailyRestart), [name.split('.')[1]]: value };
      } else {
        meta[name] = value;
      }
    }
    if (meta.memoryMin && (meta.memoryMax || s.memoryMax) < meta.memoryMin) return toast('Starting RAM can\'t be more than Max RAM.', 'warn');
    if (this.changes['meta:java'] === 'custom' && !(meta.javaPath ?? s.javaPath)) return toast('Enter the path to java.exe for a custom Java.', 'warn');

    try {
      if (Object.keys(props).length) await call('servers:saveProps', s.id, props);
      if (Object.keys(meta).length) await call('servers:saveMeta', s.id, meta);
    } catch (err) { return; }
    this.changes = {};
    this.props = await quietCall('servers:props', s.id).catch(() => this.props);
    await App.refreshServers();
    toast(s.status !== 'offline' ? 'Saved! Restart the server to apply.' : 'Settings saved!', 'ok');
    const scroll = $('#view').scrollTop;
    this.draw();
    $('#view').scrollTop = scroll;
  },

  async deleteServer() {
    const s = this.server;
    if (s.status !== 'offline') return toast('Stop the server before deleting it.', 'warn');
    const typed = await promptBox('Delete server?', {
      label: `This moves "${s.name}" to the Recycle Bin. Type the server name to confirm.`,
      placeholder: s.name, okText: 'Delete forever'
    });
    if (typed !== s.name) { if (typed !== null) toast('Name didn\'t match. Nothing deleted.', 'info'); return; }
    await call('servers:delete', s.id);
    toast(`${s.name} deleted`, 'ok');
    await App.refreshServers();
    if (App.servers[0]) App.selectServer(App.servers[0].id, 'dashboard');
    else { App.currentId = null; App.drawSwitcher(); App.go('welcome'); }
  }
};

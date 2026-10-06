// create.js — the "New server" wizard (pick type -> options -> install)

Views.create = {
  title: 'Create a server',
  subtitle: 'Pick a type, choose options, and Boba does the rest.',

  render(root, _server, params = {}) {
    this.root = root;
    const totalMB = App.info.totalMemMB;
    // Suggest RAM: half your PC's RAM, between 2 GB and 6 GB
    const suggested = Math.max(2048, Math.min(6144, Math.floor(totalMB / 2 / 512) * 512));
    this.state = {
      step: params.type ? 2 : 1,
      type: params.type || 'paper',
      versions: [], version: '', snapshots: false, loadingVersions: false,
      name: '', ram: suggested, eula: false,
      gamemode: 'survival', difficulty: 'easy', maxPlayers: 20,
      packMode: 'browse', packQuery: '', packResults: [], pack: null, packVersions: [], packVersionId: '', packFile: '',
      importSource: '', importJava: 21,
      picture: randomPicture('minecraft'),   // the server's picture (random Minecraft head to start)
      installId: null, installLines: [], installPercent: -1, installDone: false, installError: ''
    };
    this.offInstall = App.on('install', (data) => this.onInstall(data));
    this.draw();
  },

  destroy() {
    if (this.offInstall) this.offInstall();
  },

  // Server types shown on step 1
  types: [
    { id: 'paper', desc: 'Fast and stable. Runs Bukkit & Spigot plugins.', tag: 'Recommended' },
    { id: 'vanilla', desc: 'Pure Minecraft, exactly like singleplayer.' },
    { id: 'purpur', desc: 'Paper + tons of extra settings. Runs plugins.' },
    { id: 'fabric', desc: 'Lightweight mods. Great for performance mods.' },
    { id: 'forge', desc: 'Classic loader for big mods and older modpacks.' },
    { id: 'neoforge', desc: 'Modern Forge. Used by most new modpacks.' },
    { id: 'quilt', desc: 'Fabric-compatible mod loader.' },
    { id: 'modpack', desc: 'One click install from Modrinth (or a .mrpack file).', tag: 'Easy mods' },
    { id: 'import', desc: 'Bring a folder, zip, jar or .mrpack you already have.' }
  ],

  draw() {
    const s = this.state;
    const steps = ['Choose type', 'Options', 'Install'];
    this.root.innerHTML = `
      <div class="wizard">
        <div class="steps">${steps.map((label, i) => `
          <div class="step ${s.step === i + 1 ? 'active' : ''} ${s.step > i + 1 ? 'done' : ''}"><i>${s.step > i + 1 ? '✓' : i + 1}</i>${label}</div>`).join('')}
        </div>
        <div data-body></div>
      </div>`;
    const body = $('[data-body]', this.root);
    if (s.step === 1) this.drawTypes(body);
    if (s.step === 2) this.drawOptions(body);
    if (s.step === 3) this.drawInstall(body);
  },

  // ---------- Step 1 ----------
  drawTypes(body) {
    const s = this.state;
    body.innerHTML = `
      <div class="type-grid">${this.types.map((t) => {
        const info = t.id === 'import' ? { name: 'Import', icon: 'import', color: '#9aa0b4' } : typeInfo(t.id);
        return `
          <div class="type-card ${s.type === t.id ? 'selected' : ''}" data-type="${t.id}">
            <div class="type-icon" style="color:${info.color}">${icon(info.icon)}</div>
            <div><b>${info.name}</b><span>${t.desc}</span>${t.tag ? `<div class="tag"><span class="badge accent">${t.tag}</span></div>` : ''}</div>
          </div>`;
      }).join('')}</div>
      <div class="wizard-footer">
        <span class="muted small row">${icon('info')}<span>Not sure? Pick <b>Paper</b> for plugins or <b>Modpack</b> for mods.</span></span>
        <button class="btn primary" data-next>Continue ${icon('chevronRight')}</button>
      </div>`;
    $$('[data-type]', body).forEach((card) => {
      card.onclick = () => { s.type = card.dataset.type; this.draw(); };
      card.ondblclick = () => { s.type = card.dataset.type; this.toStep2(); };
    });
    $('[data-next]', body).onclick = () => this.toStep2();
  },

  toStep2() {
    const s = this.state;
    s.step = 2;
    s.version = '';
    s.versions = [];
    if (!s.name) s.name = `My ${s.type === 'import' ? 'Imported' : typeInfo(s.type).name} Server`;
    this.draw();
    if (!['modpack', 'import'].includes(s.type)) this.loadVersions();
    if (s.type === 'modpack') this.searchPacks();
  },

  async loadVersions() {
    const s = this.state;
    s.loadingVersions = true;
    this.drawVersionSelect();
    try {
      s.versions = await call('servers:versions', s.type, s.snapshots);
      s.version = s.versions[0] ? s.versions[0].id : '';
    } catch (err) {
      s.versions = [];
    }
    s.loadingVersions = false;
    this.drawVersionSelect();
  },

  drawVersionSelect() {
    const s = this.state;
    const box = $('[data-version-box]', this.root);
    if (!box) return;
    if (s.loadingVersions) { box.innerHTML = `<div class="skeleton" style="height:36px;width:100%"></div>`; return; }
    if (!s.versions.length) {
      box.innerHTML = `<div class="row" style="width:100%"><span class="muted small">Couldn't load versions. Check your internet.</span><button class="btn sm" data-retry>${icon('refresh')}Retry</button></div>`;
      $('[data-retry]', box).onclick = () => this.loadVersions();
      return;
    }
    box.innerHTML = `<select class="select" data-version>${s.versions.map((v) => `<option value="${esc(v.id)}" ${v.id === s.version ? 'selected' : ''}>${esc(v.id)}${v.type === 'snapshot' ? '  (snapshot)' : ''}</option>`).join('')}</select>`;
    $('[data-version]', box).onchange = (e) => { s.version = e.target.value; };
  },

  // ---------- Step 2 ----------
  drawOptions(body) {
    const s = this.state;
    const info = s.type === 'import' ? { name: 'Import', icon: 'import' } : typeInfo(s.type);
    const canSnap = true;   // every type can show test versions
    const maxRam = Math.max(2048, App.info.totalMemMB - 1024);

    let typeSpecific = '';
    if (s.type === 'modpack') typeSpecific = this.modpackHtml();
    else if (s.type === 'import') typeSpecific = this.importHtml();
    else {
      typeSpecific = `
        <div class="setting">
          <div><div class="setting-label">Minecraft version ${helpIcon('The game version players need to join. Newest is usually best.', '1.21.4')}</div>
          ${canSnap ? `<div class="setting-desc"><label class="row small" style="gap:6px;cursor:pointer"><input type="checkbox" class="check" data-snap ${s.snapshots ? 'checked' : ''}/> Show snapshots / betas</label></div>` : ''}</div>
          <div class="setting-control" data-version-box></div>
        </div>`;
    }

    body.innerHTML = `
      <div class="grid" style="grid-template-columns: minmax(0,1fr) 300px; align-items:start">
        <div class="col">
          ${s.type === 'modpack' || s.type === 'import' ? typeSpecific : ''}
          <div class="card" style="padding:6px 18px">
            ${s.type !== 'modpack' && s.type !== 'import' ? typeSpecific : ''}
            <div class="setting">
              <div><div class="setting-label">Server name ${helpIcon('Only shown inside Boba (and as the first message). You can change it later.', 'Friends SMP')}</div></div>
              <div class="setting-control"><input class="input" data-name value="${esc(s.name)}" maxlength="40"/></div>
            </div>
            <div class="setting">
              <div><div class="setting-label">RAM ${helpIcon('Memory the server may use. More players or mods = more RAM. Leave some for your PC!', 'Vanilla: 2-4 GB · Modpacks: 6-10 GB')}</div>
              <div class="setting-desc">Your PC has ${formatMB(App.info.totalMemMB)}.</div></div>
              <div class="setting-control"><input type="range" class="slider" data-ram min="1024" max="${maxRam}" step="512" value="${s.ram}" style="max-width:170px"/><b class="mono" data-ram-label style="min-width:60px;text-align:right">${formatMB(s.ram)}</b></div>
            </div>
            ${s.type !== 'import' ? `
            <div class="setting">
              <div><div class="setting-label">Game mode ${helpIcon('The mode new players start in.', 'survival')}</div></div>
              <div class="setting-control"><div class="segmented" data-seg="gamemode">${['survival', 'creative', 'adventure'].map((m) => `<button data-v="${m}" class="${s.gamemode === m ? 'active' : ''}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div></div>
            </div>
            <div class="setting">
              <div><div class="setting-label">Difficulty ${helpIcon('How dangerous mobs are.', 'normal')}</div></div>
              <div class="setting-control"><div class="segmented" data-seg="difficulty">${['peaceful', 'easy', 'normal', 'hard'].map((m) => `<button data-v="${m}" class="${s.difficulty === m ? 'active' : ''}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div></div>
            </div>
            <div class="setting">
              <div><div class="setting-label">Max players ${helpIcon('How many people can be online at once.', '10')}</div></div>
              <div class="setting-control"><input class="input" type="number" min="1" max="500" data-maxp value="${s.maxPlayers}" style="max-width:100px"/></div>
            </div>` : ''}
          </div>
        </div>
        <div class="card col" style="position:sticky;top:0">
          <div class="row"><div class="type-icon" style="color:${info.color || 'var(--accent)'}">${icon(info.icon)}</div><div><b>${info.name}</b><div class="small muted">Summary</div></div></div>
          <div class="divider" style="margin:4px 0"></div>
          <div class="pfp-row">
            <button class="pfp-preview" data-pfp-open data-tip="Click to choose from lots of pictures">${this.pictureHtml()}</button>
            <div class="col" style="gap:6px;min-width:0">
              <b>Server picture ${helpIcon('Shown next to your server in the Minecraft multiplayer list.', 'A Creeper head')}</b>
              <div class="row" style="gap:6px">
                <button class="btn sm" data-pfp-random data-tip="Get another random picture. Keep clicking!">${icon('refresh')}Random</button>
                <button class="btn sm ghost" data-pfp-open>${icon('image')}More</button>
              </div>
            </div>
          </div>
          <div class="divider" style="margin:4px 0"></div>
          <label class="row small" style="align-items:flex-start;gap:9px;cursor:pointer;line-height:1.45">
            <input type="checkbox" class="check" data-eula ${s.eula ? 'checked' : ''} style="margin-top:2px"/>
            <span>I agree to the <a href="https://aka.ms/MinecraftEULA" target="_blank">Minecraft EULA</a>. (Required to run any server.)</span>
          </label>
          <button class="btn primary lg" data-create style="width:100%">${icon('rocket')}Create server</button>
          <button class="btn ghost" data-back style="width:100%">${icon('arrowLeft')}Back</button>
        </div>
      </div>`;

    // Wire up the inputs
    $('[data-name]', body).oninput = (e) => { s.name = e.target.value; };
    $('[data-ram]', body).oninput = (e) => { s.ram = Number(e.target.value); $('[data-ram-label]', body).textContent = formatMB(s.ram); };
    $('[data-eula]', body).onchange = (e) => { s.eula = e.target.checked; };
    const maxp = $('[data-maxp]', body);
    if (maxp) maxp.oninput = (e) => { s.maxPlayers = Number(e.target.value) || 20; };
    $$('[data-seg]', body).forEach((seg) => $$('button', seg).forEach((b) => (b.onclick = () => {
      s[seg.dataset.seg] = b.dataset.v;
      $$('button', seg).forEach((x) => x.classList.toggle('active', x === b));
    })));
    const snap = $('[data-snap]', body);
    if (snap) snap.onchange = (e) => { s.snapshots = e.target.checked; this.loadVersions(); };
    $('[data-back]', body).onclick = () => { s.step = 1; this.draw(); };
    $('[data-create]', body).onclick = () => this.create();

    // Picture: "Random" swaps to a new one in the same style, "More" opens the big picker
    $('[data-pfp-random]', body).onclick = () => {
      const source = s.picture && PFP_SOURCES[s.picture.source] ? s.picture.source : 'minecraft';
      s.picture = randomPicture(source, s.picture && s.picture.url);
      this.updatePicture();
    };
    $$('[data-pfp-open]', body).forEach((b) => (b.onclick = async () => {
      const pick = await openPicturePicker(s.picture);
      if (pick) { s.picture = pick; this.updatePicture(); }
    }));

    if (s.type === 'modpack') this.wireModpack(body);
    if (s.type === 'import') this.wireImport(body);
    this.drawVersionSelect();
  },

  // ---------- modpack picker ----------
  modpackHtml() {
    const s = this.state;
    return `
      <div class="card">
        <div class="card-title"><span class="brand-row">${icon('brand-modrinth')}</span>Pick a modpack from Modrinth
          <div class="right"><div class="segmented" data-packmode>
            <button data-v="browse" class="${s.packMode === 'browse' ? 'active' : ''}">${icon('search')}Browse Modrinth</button>
            <button data-v="file" class="${s.packMode === 'file' ? 'active' : ''}">${icon('file')}.mrpack file</button>
          </div></div>
        </div>
        ${s.packMode === 'browse' ? `
          <div class="input-icon" style="margin-bottom:12px">${icon('search')}<input class="input" data-packq placeholder="Search modpacks... (e.g. Fabulously Optimized, Cobblemon, Create)" value="${esc(s.packQuery)}"/></div>
          <div class="pack-grid" data-packs></div>
          <div data-packver style="margin-top:12px"></div>` : `
          <div class="row">
            <button class="btn" data-pickpack>${icon('upload')}Choose .mrpack file</button>
            <span class="muted small mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.packFile || 'No file chosen')}</span>
          </div>
          <div class="small muted" style="margin-top:10px">${icon('info')} CurseForge packs: download their <b>Server Pack</b> zip and use <b>Import</b> instead.</div>`}
      </div>`;
  },

  wireModpack(body) {
    const s = this.state;
    $$('[data-packmode] button', body).forEach((b) => (b.onclick = () => { s.packMode = b.dataset.v; this.draw(); if (s.packMode === 'browse') this.searchPacks(); }));
    const q = $('[data-packq]', body);
    if (q) {
      let timer;
      q.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { s.packQuery = q.value; this.searchPacks(); }, 350); };
      this.drawPackResults();
      this.drawPackVersions();
    }
    const pick = $('[data-pickpack]', body);
    if (pick) pick.onclick = async () => {
      const file = await call('dialog:openFile', [{ name: 'Modrinth modpack', extensions: ['mrpack'] }]);
      if (file) { s.packFile = file; if (!s.nameTouched) s.name = file.split(/[\\/]/).pop().replace(/\.mrpack$/i, ''); this.draw(); }
    };
  },

  async searchPacks() {
    const s = this.state;
    const grid = $('[data-packs]', this.root);
    if (grid) grid.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton" style="height:78px"></div>').join('');
    try {
      const result = await call('modrinth:search', { query: s.packQuery, kind: 'modpack', sort: s.packQuery ? 'relevance' : 'downloads' });
      s.packResults = result.hits;
    } catch (err) { s.packResults = []; }
    this.drawPackResults();
  },

  drawPackResults() {
    const s = this.state;
    const grid = $('[data-packs]', this.root);
    if (!grid) return;
    if (!s.packResults.length) { grid.innerHTML = '<div class="muted small">No modpacks found.</div>'; return; }
    grid.innerHTML = s.packResults.map((p) => `
      ${projectCard(p, {
        clickable: true,
        selected: s.pack && s.pack.project_id === p.project_id,
        // Show which mod loader the pack uses, with its icon
        extraHtml: (p.categories || []).filter((c) => TYPE_INFO[c]).map((c) => `<span style="color:${typeInfo(c).color}">${icon(typeInfo(c).icon)} ${typeInfo(c).name}</span>`).join('')
      })}`).join('');
    $$('[data-pid]', grid).forEach((card) => (card.onclick = () => this.selectPack(card.dataset.pid)));
  },

  async selectPack(projectId) {
    const s = this.state;
    s.pack = s.packResults.find((p) => p.project_id === projectId);
    s.name = s.pack.title.slice(0, 40);
    // Use the modpack's own icon as the server picture (you can still shuffle)
    if (s.pack.icon_url) { s.picture = { url: s.pack.icon_url, label: s.pack.title, source: 'modpack' }; this.updatePicture(); }
    const nameInput = $('[data-name]', this.root);
    if (nameInput) nameInput.value = s.name;
    this.drawPackResults();
    s.packVersions = [];
    this.drawPackVersions(true);
    try {
      s.packVersions = (await call('modrinth:versions', projectId)) || [];
      s.packVersionId = s.packVersions[0] ? s.packVersions[0].id : '';
    } catch (err) { /* toast already shown */ }
    this.drawPackVersions();
  },

  drawPackVersions(loading) {
    const s = this.state;
    const box = $('[data-packver]', this.root);
    if (!box || !s.pack) return;
    if (loading) { box.innerHTML = '<div class="skeleton" style="height:36px"></div>'; return; }
    box.innerHTML = `
      <div class="row">
        <span class="small muted" style="white-space:nowrap">Pack version ${helpIcon('Which release of the modpack to install. Newest first.', '1.4.2 for 1.20.1')}</span>
        <select class="select" data-pv>${s.packVersions.map((v) => `<option value="${esc(v.id)}">${esc(v.version_number)} — MC ${esc(v.game_versions.join(', '))} · ${esc(v.loaders.join(', '))}</option>`).join('')}</select>
      </div>`;
    $('[data-pv]', box).onchange = (e) => { s.packVersionId = e.target.value; };
  },

  // ---------- import ----------
  importHtml() {
    const s = this.state;
    return `
      <div class="card">
        <div class="card-title">${icon('import')}What do you want to import?</div>
        <div class="row" style="flex-wrap:wrap">
          <button class="btn" data-src="folder">${icon('folder')}Server folder</button>
          <button class="btn" data-src="zip">${icon('fileZip')}Server .zip</button>
          <button class="btn" data-src="jar">${icon('fileJar')}Just a .jar</button>
          <button class="btn" data-src="mrpack">${icon('package')}.mrpack modpack</button>
        </div>
        <div class="small mono muted" style="margin-top:12px;word-break:break-all">${esc(s.importSource || 'Nothing chosen yet')}</div>
        <div class="divider"></div>
        <div class="setting" style="padding:0;border:0">
          <div><div class="setting-label">Java version ${helpIcon('Which Java the server needs. Boba downloads it for you.', '1.20.5+ → 21 · 1.18-1.20.4 → 17 · 1.16 and older → 8')}</div></div>
          <div class="setting-control"><select class="select" data-ijava style="max-width:160px">${[25, 21, 17, 11, 8].map((j) => `<option value="${j}" ${s.importJava === j ? 'selected' : ''}>Java ${j}</option>`).join('')}</select></div>
        </div>
      </div>`;
  },

  wireImport(body) {
    const s = this.state;
    $('[data-ijava]', body).onchange = (e) => { s.importJava = Number(e.target.value); };
    $$('[data-src]', body).forEach((b) => (b.onclick = async () => {
      const kind = b.dataset.src;
      let path = null;
      if (kind === 'folder') path = await call('dialog:openFolder');
      if (kind === 'zip') path = await call('dialog:openFile', [{ name: 'Zip', extensions: ['zip'] }]);
      if (kind === 'jar') path = await call('dialog:openFile', [{ name: 'Server jar', extensions: ['jar'] }]);
      if (kind === 'mrpack') {
        path = await call('dialog:openFile', [{ name: 'Modrinth modpack', extensions: ['mrpack'] }]);
        if (path) { s.type = 'modpack'; s.packMode = 'file'; s.packFile = path; s.name = path.split(/[\\/]/).pop().replace(/\.mrpack$/i, ''); this.draw(); }
        return;
      }
      if (path) { s.importSource = path; s.name = path.split(/[\\/]/).pop().replace(/\.(zip|jar)$/i, '').slice(0, 40); this.draw(); }
    }));
  },

  // ---------- Create! ----------
  async create() {
    const s = this.state;
    if (!s.name.trim()) return toast('Give your server a name.', 'warn');
    if (!s.eula) return toast('Please tick the EULA box to continue.', 'warn');
    const properties = { gamemode: s.gamemode, difficulty: s.difficulty, 'max-players': s.maxPlayers };

    try {
      if (s.type === 'import') {
        if (!s.importSource) return toast('Choose what to import first.', 'warn');
        const id = await call('servers:import', { name: s.name.trim(), source: s.importSource, javaMajor: s.importJava, memoryMax: s.ram, acceptEula: true });
        await saveServerPicture(id, s.picture).catch(() => {});
        toast('Server imported!', 'ok');
        await App.refreshServers();
        return App.selectServer(id, 'dashboard');
      }
      if (s.type === 'modpack') {
        if (s.packMode === 'file' && !s.packFile) return toast('Choose a .mrpack file first.', 'warn');
        if (s.packMode === 'browse' && !s.packVersionId) return toast('Pick a modpack first.', 'warn');
        s.installId = await call('servers:createModpack', {
          name: s.name.trim(), memoryMax: s.ram, acceptEula: true, properties: { ...properties, 'allow-flight': true },
          versionId: s.packMode === 'browse' ? s.packVersionId : null,
          filePath: s.packMode === 'file' ? s.packFile : null,
          projectId: s.pack ? s.pack.project_id : '', icon: s.pack ? s.pack.icon_url : '',
          banner: s.pack ? (s.pack.featured_gallery || (s.pack.gallery || [])[0] || '') : ''
        });
      } else {
        if (!s.version) return toast('Pick a Minecraft version.', 'warn');
        s.installId = await call('servers:create', {
          name: s.name.trim(), type: s.type, mcVersion: s.version, memoryMax: s.ram, acceptEula: true, properties
        });
      }
      // Save the chosen picture as server-icon.png (the folder already exists now)
      saveServerPicture(s.installId, s.picture).catch(() => toast('Couldn\'t save the server picture. You can set it later in Settings.', 'warn'));
      s.step = 3;
      s.installLines = ['Creating server folder...'];
      this.draw();
    } catch (err) { /* toast already shown */ }
  },

  // ---------- server picture helpers ----------
  pictureHtml() {
    const p = this.state.picture;
    return p ? `<img src="${esc(p.url || p.preview)}" alt="" draggable="false"/>` : icon('image');
  },

  updatePicture() {
    $$('.pfp-preview[data-pfp-open]', this.root).forEach((box) => {
      box.innerHTML = this.pictureHtml();
      box.classList.remove('pop'); void box.offsetWidth; box.classList.add('pop');   // little bounce
    });
  },

  // ---------- Step 3 ----------
  drawInstall(body) {
    const s = this.state;
    body.innerHTML = `
      <div class="card col" style="max-width:820px;margin:0 auto">
        <div class="row">
          ${s.installDone ? emoji('party', 40) : s.installError ? emoji('tools', 40) : emoji('rocket', 40, 'floaty')}
          <b style="font-size:15px">${s.installDone ? 'Your server is ready!' : s.installError ? 'Something went wrong' : `Installing ${esc(s.name)}...`}</b>
          <span class="spacer"></span><span class="muted small" data-pct></span>
        </div>
        <div class="progress ${s.installPercent < 0 && !s.installDone ? 'indeterminate' : ''}" data-bar><i style="width:${s.installDone ? 100 : Math.max(0, s.installPercent)}%"></i></div>
        <div class="install-log selectable" data-log>${s.installLines.map((l) => `<div>${esc(l)}</div>`).join('')}</div>
        ${s.installError ? `<div class="small" style="color:var(--bad)">${esc(s.installError)}</div>` : ''}
        <div class="row" style="justify-content:flex-end">
          ${s.installDone || s.installError ? `<button class="btn primary" data-open>${icon('dashboard')}Open server</button>` : '<span class="muted small">You can leave this page — it keeps installing in the background.</span>'}
        </div>
      </div>`;
    const log = $('[data-log]', body);
    log.scrollTop = log.scrollHeight;
    const open = $('[data-open]', body);
    if (open) open.onclick = () => App.selectServer(s.installId, 'dashboard');
  },

  onInstall(data) {
    const s = this.state;
    if (!s || data.id !== s.installId) return;
    if (data.line) s.installLines.push(data.line);
    if (typeof data.percent === 'number') s.installPercent = data.percent;
    if (data.done) s.installDone = true;
    if (data.error) s.installError = data.error;
    if (s.step !== 3) return;
    // Fast path: just update the bar + log without redrawing everything
    if (!data.done && !data.error) {
      const bar = $('[data-bar]', this.root);
      if (bar) { bar.classList.toggle('indeterminate', s.installPercent < 0); bar.firstElementChild.style.width = `${Math.max(0, s.installPercent)}%`; }
      const pct = $('[data-pct]', this.root);
      if (pct) pct.textContent = s.installPercent >= 0 ? `${s.installPercent}%` : '';
      const log = $('[data-log]', this.root);
      if (log && data.line) { log.appendChild(el(`<div>${esc(data.line)}</div>`)); log.scrollTop = log.scrollHeight; }
      return;
    }
    this.draw();
    if (data.done) {
      toast(`${s.name} is ready!`, 'ok');
      App.refreshServers().then(() => { App.currentId = s.installId; App.drawSwitcher(); App.drawNav(); });
    }
  }
};

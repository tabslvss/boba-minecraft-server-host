// content.js — installed mods/plugins + browse and install from Modrinth

Views.content = {
  needsServer: true,
  tab: 'installed',
  get title() {
    const s = App.current;
    return s && ['paper', 'purpur'].includes(s.type) ? 'Plugins' : 'Mods';
  },

  async render(root, server) {
    this.root = root;
    this.server = server;
    this.kind = ['paper', 'purpur'].includes(server.type) ? 'plugin' : 'mod';
    this.word = this.kind === 'plugin' ? 'plugin' : 'mod';
    this.query = '';
    this.sort = 'downloads';
    this.offset = 0;
    this.installing = new Set();

    if (server.type === 'vanilla' || server.type === 'custom') {
      root.innerHTML = `<div class="card empty max-w">${emoji('puzzle', 72)}<br/><h3>${server.type === 'vanilla' ? 'Vanilla servers can\'t use mods or plugins' : 'Unknown server type'}</h3>
        <div style="margin-bottom:16px">Make a <b>Paper</b> server for plugins, or a <b>Fabric / NeoForge</b> server for mods.<br/>Tip: you can copy your world folder over in the Files tab.</div>
        <button class="btn primary" data-new>${icon('plus')}Create a new server</button></div>`;
      $('[data-new]', root).onclick = () => App.go('create');
      return;
    }
    this.offProgress = App.on('content-progress', (d) => {
      const btn = $(`[data-install="${d.projectId}"]`, this.root);
      if (btn && d.percent >= 0 && d.percent < 100) btn.innerHTML = `<span class="spinner" style="width:14px;height:14px"></span>${d.percent}%`;
    });
    this.draw();
  },

  destroy() {
    if (this.offProgress) this.offProgress();
  },

  draw() {
    const s = this.server;
    const plural = this.word + 's';
    this.root.innerHTML = `
      <div class="col" style="gap:16px;max-width:1100px">
        <div class="row">
          <div class="segmented">
            <button data-tab="installed" class="${this.tab === 'installed' ? 'active' : ''}">${icon('check')}Installed</button>
            <button data-tab="browse" class="${this.tab === 'browse' ? 'active' : ''}"><span class="brand-row">${icon('brand-modrinth')}</span>Browse Modrinth</button>
          </div>
          <span class="spacer"></span>
          <span class="badge">${esc(typeInfo(s.type).name)} ${esc(s.mcVersion)}</span>
          <button class="btn sm" data-addfile data-tip="Add a .jar ${this.word} file you downloaded yourself (e.g. from CurseForge or SpigotMC)">${icon('upload')}Add .jar file</button>
        </div>
        <div data-body></div>
      </div>`;
    $$('[data-tab]', this.root).forEach((b) => (b.onclick = () => { this.tab = b.dataset.tab; this.draw(); }));
    $('[data-addfile]', this.root).onclick = async () => {
      const files = await call('dialog:openFiles');
      const jars = files.filter((f) => f.toLowerCase().endsWith('.jar'));
      if (!jars.length) return;
      await call('files:mkdir', s.id, `${plural}`);
      await call('files:import', s.id, plural, jars);
      toast(`Added ${jars.length} ${jars.length === 1 ? this.word : plural}. Restart to load.`, 'ok');
      this.tab = 'installed';
      this.draw();
    };
    if (this.tab === 'installed') this.drawInstalled();
    else this.drawBrowse();
  },

  async drawInstalled() {
    const body = $('[data-body]', this.root);
    body.innerHTML = '<div class="skeleton" style="height:200px"></div>';
    const { items } = await quietCall('content:list', this.server.id).catch(() => ({ items: [] }));
    if (!items.length) {
      body.innerHTML = `<div class="card empty">${emoji('puzzle', 72)}<br/><h3>No ${this.word}s yet</h3><div style="margin-bottom:14px">Find thousands of free ${this.word}s on Modrinth.</div><button class="btn primary" data-browse>${icon('search')}Browse ${this.word}s</button></div>`;
      $('[data-browse]', body).onclick = () => { this.tab = 'browse'; this.draw(); };
      return;
    }
    const enabled = items.filter((i) => i.enabled).length;
    body.innerHTML = `
      <div class="card">
        <div class="card-title">${icon('puzzle')}${items.length} ${this.word}${items.length === 1 ? '' : 's'} <span class="badge ok">${enabled} on</span>
          <div class="right">${this.server.status !== 'offline' ? `<span class="small muted">Restart the server to apply changes</span>` : ''}</div></div>
        <div class="player-list">${items.map((i) => `
          <div class="player-row">
            <div class="type-icon" style="width:34px;height:34px;color:${i.enabled ? 'var(--accent)' : 'var(--muted)'}">${icon('fileJar')}</div>
            <div style="min-width:0;flex:1"><div class="name" style="${i.enabled ? '' : 'opacity:.5;text-decoration:line-through'}">${esc(i.file.replace(/\.disabled$/, ''))}</div><div class="small muted">${formatBytes(i.size)}</div></div>
            <div class="actions">
              <label class="toggle" data-tip="${i.enabled ? 'Turn off without deleting' : 'Turn back on'}"><input type="checkbox" data-toggle="${esc(i.file)}" ${i.enabled ? 'checked' : ''}/><span></span></label>
              <button class="btn sm ghost icon" data-del="${esc(i.file)}" data-tip="Delete (moves to Recycle Bin)">${icon('trash')}</button>
            </div>
          </div>`).join('')}</div>
      </div>`;
    $$('[data-toggle]', body).forEach((t) => (t.onchange = async () => { await call('content:toggle', this.server.id, t.dataset.toggle); this.drawInstalled(); }));
    $$('[data-del]', body).forEach((b) => (b.onclick = async () => {
      if (!(await confirmBox(`Delete ${this.word}?`, `<b>${esc(b.dataset.del)}</b> goes to the Recycle Bin.`, { okText: 'Delete', danger: true }))) return;
      await call('content:delete', this.server.id, b.dataset.del);
      this.drawInstalled();
    }));
  },

  drawBrowse() {
    const body = $('[data-body]', this.root);
    body.innerHTML = `
      <div class="row" style="margin-bottom:14px">
        <div class="input-icon" style="flex:1">${icon('search')}<input class="input" data-q placeholder="Search ${this.word}s for ${esc(typeInfo(this.server.type).name)} ${esc(this.server.mcVersion)}..." value="${esc(this.query)}"/></div>
        <select class="select" data-sort style="width:170px" data-tip="How to order results">
          <option value="downloads" ${this.sort === 'downloads' ? 'selected' : ''}>Most downloaded</option>
          <option value="relevance" ${this.sort === 'relevance' ? 'selected' : ''}>Best match</option>
          <option value="follows" ${this.sort === 'follows' ? 'selected' : ''}>Most followed</option>
          <option value="updated" ${this.sort === 'updated' ? 'selected' : ''}>Recently updated</option>
          <option value="newest" ${this.sort === 'newest' ? 'selected' : ''}>Newest</option>
        </select>
      </div>
      <div class="grid cols-2" data-results></div>
      <div class="row" style="justify-content:center;margin-top:16px" data-pager></div>`;
    let timer;
    $('[data-q]', body).oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { this.query = e.target.value; this.offset = 0; this.search(); }, 350); };
    $('[data-sort]', body).onchange = (e) => { this.sort = e.target.value; this.offset = 0; this.search(); };
    this.search();
  },

  async search() {
    const box = $('[data-results]', this.root);
    if (!box) return;
    box.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton" style="height:84px"></div>').join('');
    let result;
    try {
      result = await call('modrinth:search', {
        query: this.query, kind: this.kind, loader: this.server.type, gameVersion: this.server.mcVersion, offset: this.offset, sort: this.sort
      });
    } catch (err) {
      box.innerHTML = `<div class="muted">Couldn't reach Modrinth. Check your internet.</div>`;
      return;
    }
    if (!result.hits.length) { box.innerHTML = `<div class="muted span-2">Nothing found for this version.</div>`; $('[data-pager]', this.root).innerHTML = ''; return; }
    box.innerHTML = result.hits.map((p) => `
      ${projectCard(p, {
        author: true,
        extraHtml: `<a href="https://modrinth.com/${esc(p.project_type)}/${esc(p.slug)}" target="_blank" class="small">Details ${icon('external')}</a>
          <span class="spacer"></span><button class="btn sm primary" data-install="${esc(p.project_id)}">${icon('download')}Install</button>`
      })}`).join('');
    $$('[data-install]', box).forEach((b) => (b.onclick = () => this.install(b, result.hits.find((h) => h.project_id === b.dataset.install))));

    // Pages
    const pages = Math.ceil(result.total_hits / 24);
    const page = Math.floor(this.offset / 24) + 1;
    const pager = $('[data-pager]', this.root);
    pager.innerHTML = pages > 1 ? `
      <button class="btn sm" data-prev ${page <= 1 ? 'disabled' : ''}>${icon('arrowLeft')}Prev</button>
      <span class="small muted">Page ${page} of ${pages}</span>
      <button class="btn sm" data-next ${page >= pages ? 'disabled' : ''}>Next ${icon('chevronRight')}</button>` : '';
    const prev = $('[data-prev]', pager);
    const next = $('[data-next]', pager);
    if (prev) prev.onclick = () => { this.offset -= 24; this.search(); this.root.scrollTop = 0; };
    if (next) next.onclick = () => { this.offset += 24; this.search(); this.root.scrollTop = 0; };
  },

  async install(button, project) {
    button.disabled = true;
    button.innerHTML = '<span class="spinner" style="width:14px;height:14px"></span>';
    try {
      const files = await call('content:install', this.server.id, project.project_id);
      button.innerHTML = `${icon('check')}Installed`;
      button.classList.remove('primary');
      button.classList.add('success');
      const extra = files.length > 1 ? ` (+${files.length - 1} required)` : '';
      toast(`${project.title} installed${extra}. Restart the server to load it.`, 'ok');
    } catch (err) {
      button.disabled = false;
      button.innerHTML = `${icon('download')}Install`;
    }
  }
};

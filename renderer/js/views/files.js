// files.js — built-in file explorer + text editor for the server folder

Views.files = {
  title: 'Files',
  needsServer: true,
  fullBleed: true,
  paths: new Map(),     // remembers which folder you were in, per server

  render(root, server) {
    this.root = root;
    this.server = server;
    this.path = this.paths.get(server.id) || '';
    this.selected = new Set();
    root.innerHTML = `
      <div class="files-wrap">
        <div class="row">
          <button class="btn icon" data-up data-tip="Go up one folder">${icon('arrowUp')}</button>
          <div class="crumbs" data-crumbs></div>
          <div class="input-icon" style="width:200px">${icon('search')}<input class="input" data-search placeholder="Filter..."/></div>
        </div>
        <div class="row">
          <button class="btn sm" data-newfolder>${icon('folder')}New folder</button>
          <button class="btn sm" data-newfile>${icon('file')}New file</button>
          <button class="btn sm" data-upload data-tip="Copy files from your PC into this folder. You can also drag & drop!">${icon('upload')}Upload</button>
          <span class="spacer"></span>
          <button class="btn sm danger hidden" data-delsel>${icon('trash')}Delete selected</button>
          <button class="btn sm ghost" data-refresh data-tip="Refresh">${icon('refresh')}</button>
          <button class="btn sm ghost" data-explorer data-tip="Open this folder in Windows Explorer">${icon('external')}Explorer</button>
        </div>
        <div class="file-table" data-table></div>
      </div>`;

    $('[data-up]', root).onclick = () => this.open(this.path.split('/').slice(0, -1).join('/'));
    $('[data-refresh]', root).onclick = () => this.load();
    $('[data-explorer]', root).onclick = () => call('files:openSystem', server.id, this.path);
    $('[data-search]', root).oninput = (e) => { this.filter = e.target.value.toLowerCase(); this.drawTable(); };
    $('[data-newfolder]', root).onclick = async () => {
      const name = await promptBox('New folder', { placeholder: 'folder name', okText: 'Create' });
      if (name) { await call('files:mkdir', server.id, this.join(name)); this.load(); }
    };
    $('[data-newfile]', root).onclick = async () => {
      const name = await promptBox('New file', { placeholder: 'notes.txt', okText: 'Create' });
      if (name) { await call('files:touch', server.id, this.join(name)); this.load(); }
    };
    $('[data-upload]', root).onclick = async () => {
      const sources = await call('dialog:openFiles');
      if (sources.length) this.importFiles(sources);
    };
    $('[data-delsel]', root).onclick = () => this.remove([...this.selected]);

    // Drag & drop files from Windows Explorer
    const table = $('[data-table]', root);
    table.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!$('.drop-overlay', table)) table.appendChild(el(`<div class="drop-overlay">${icon('upload')} Drop to copy into /${esc(this.path)}</div>`));
    });
    table.addEventListener('dragleave', (e) => { if (!table.contains(e.relatedTarget)) $('.drop-overlay', table)?.remove(); });
    table.addEventListener('drop', (e) => {
      e.preventDefault();
      $('.drop-overlay', table)?.remove();
      const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean);
      if (paths.length) this.importFiles(paths);
    });

    this.onKey = (e) => {
      if (e.key === 'Delete' && this.selected.size && !document.querySelector('.editor, .modal')) this.remove([...this.selected]);
    };
    document.addEventListener('keydown', this.onKey);
    this.load();
  },

  destroy() {
    document.removeEventListener('keydown', this.onKey);
  },

  join(name) {
    return this.path ? `${this.path}/${name}` : name;
  },

  open(path) {
    this.path = path;
    this.paths.set(this.server.id, path);
    this.selected.clear();
    this.load();
  },

  async load() {
    this.drawCrumbs();
    try {
      this.entries = await call('files:list', this.server.id, this.path);
    } catch (err) {
      this.entries = [];
      if (this.path) return this.open('');
    }
    this.drawTable();
  },

  drawCrumbs() {
    const box = $('[data-crumbs]', this.root);
    const parts = this.path ? this.path.split('/') : [];
    box.innerHTML = `<button data-p="">${icon('home').replace('<svg', '<svg style="width:15px;height:15px;vertical-align:-3px"')} ${esc(this.server.name)}</button>` +
      parts.map((part, i) => `<span class="sep">/</span><button data-p="${esc(parts.slice(0, i + 1).join('/'))}">${esc(part)}</button>`).join('');
    $$('[data-p]', box).forEach((b) => (b.onclick = () => this.open(b.dataset.p)));
  },

  fileIcon(entry) {
    if (entry.isDir) return icon('folder', 'folder');
    if (entry.ext === '.zip' || entry.ext === '.gz') return icon('fileZip');
    if (entry.ext === '.jar' || entry.name.endsWith('.jar.disabled')) return icon('fileJar');
    if (['.png', '.jpg', '.jpeg', '.gif'].includes(entry.ext)) return icon('image');
    if (entry.editable) return icon('fileText');
    return icon('file');
  },

  drawTable() {
    const table = $('[data-table]', this.root);
    const shown = (this.entries || []).filter((e) => !this.filter || e.name.toLowerCase().includes(this.filter));
    table.innerHTML = `
      <div class="file-row head"><span><input type="checkbox" class="check" data-all/></span><span>Name</span><span>Size</span><span>Modified</span><span></span></div>
      ${shown.map((e) => `
        <div class="file-row ${this.selected.has(this.join(e.name)) ? 'selected' : ''}" data-name="${esc(e.name)}">
          <span><input type="checkbox" class="check" data-check ${this.selected.has(this.join(e.name)) ? 'checked' : ''}/></span>
          <span class="file-name">${this.fileIcon(e)}<span>${esc(e.name)}</span></span>
          <span class="size">${e.isDir ? '—' : formatBytes(e.size)}</span>
          <span class="date">${e.modified ? formatDate(e.modified) : ''}</span>
          <span><button class="btn sm ghost icon" data-more>${icon('more')}</button></span>
        </div>`).join('')}
      ${shown.length ? '' : `<div class="empty">${emoji('openfolder', 72)}<br/><h3>Empty folder</h3><div>Drag files here to upload them.</div></div>`}`;

    $('[data-all]', table).onchange = (ev) => {
      this.selected = new Set(ev.target.checked ? shown.map((e) => this.join(e.name)) : []);
      this.drawTable();
    };
    $$('.file-row[data-name]', table).forEach((row) => {
      const entry = shown.find((e) => e.name === row.dataset.name);
      const rel = this.join(entry.name);
      row.ondblclick = () => this.activate(entry);
      row.onclick = (ev) => {
        if (ev.target.closest('[data-more]')) return;
        if (ev.target.matches('[data-check]') || ev.ctrlKey) {
          this.selected.has(rel) ? this.selected.delete(rel) : this.selected.add(rel);
        } else {
          this.selected = new Set([rel]);
        }
        this.drawTable();
      };
      const menu = (ev) => { ev.preventDefault(); ev.stopPropagation(); this.menu(ev.clientX, ev.clientY, entry); };
      row.oncontextmenu = menu;
      $('[data-more]', row).onclick = menu;
    });
    $('[data-delsel]', this.root).classList.toggle('hidden', this.selected.size < 1);
    $('[data-delsel]', this.root).innerHTML = `${icon('trash')}Delete ${this.selected.size} item${this.selected.size === 1 ? '' : 's'}`;
  },

  // Double-click: open folder or edit file
  activate(entry) {
    if (entry.isDir) return this.open(this.join(entry.name));
    if (entry.editable) return this.edit(this.join(entry.name));
    if (entry.ext === '.zip') return this.extract(entry);
    call('files:openSystem', this.server.id, this.join(entry.name));
  },

  menu(x, y, entry) {
    const rel = this.join(entry.name);
    const items = [];
    if (entry.isDir) items.push({ label: 'Open', icon: 'folderOpen', action: () => this.open(rel) });
    if (entry.editable) items.push({ label: 'Edit', icon: 'edit', action: () => this.edit(rel) });
    if (!entry.isDir && !entry.editable) items.push({ label: 'Open with Windows', icon: 'external', action: () => call('files:openSystem', this.server.id, rel) });
    items.push({ label: 'Rename', icon: 'tag', action: () => this.rename(entry) });
    if (entry.ext === '.zip') items.push({ label: 'Extract here', icon: 'fileZip', action: () => this.extract(entry) });
    else items.push({ label: 'Compress to .zip', icon: 'fileZip', action: () => this.compress(entry) });
    items.push({ label: 'Show in Explorer', icon: 'folder', action: () => call('files:reveal', this.server.id, rel) });
    items.push({ label: 'Copy path', icon: 'copy', action: () => copyText(`${this.server.dir}\\${rel.replace(/\//g, '\\')}`, 'Path copied') });
    items.push('sep');
    items.push({ label: 'Delete', icon: 'trash', danger: true, action: () => this.remove([rel]) });
    showContextMenu(x, y, items);
  },

  async rename(entry) {
    const name = await promptBox('Rename', { value: entry.name, okText: 'Rename' });
    if (name && name !== entry.name) {
      await call('files:rename', this.server.id, this.join(entry.name), this.join(name));
      this.load();
    }
  },

  async remove(rels) {
    if (this.server.status !== 'offline' && rels.some((r) => /^(world|mods|plugins|libraries)/.test(r))) {
      toast('Tip: stop the server before deleting world, mod or plugin files.', 'warn');
    }
    const ok = await confirmBox('Move to Recycle Bin?',
      `${rels.length === 1 ? `<b>${esc(rels[0])}</b>` : `<b>${rels.length} items</b>`} will be moved to the Recycle Bin. You can restore from there.`,
      { okText: 'Delete', danger: true });
    if (!ok) return;
    await call('files:delete', this.server.id, rels);
    this.selected.clear();
    toast('Moved to Recycle Bin', 'ok');
    this.load();
  },

  async extract(entry) {
    toast('Extracting...', 'info', 1500);
    await call('files:extract', this.server.id, this.join(entry.name));
    toast('Extracted!', 'ok');
    this.load();
  },

  async compress(entry) {
    toast('Compressing...', 'info', 1500);
    const name = await call('files:compress', this.server.id, this.join(entry.name));
    toast(`Created ${name}`, 'ok');
    this.load();
  },

  async importFiles(paths) {
    const copied = await call('files:import', this.server.id, this.path, paths);
    toast(`Copied ${copied.length} item${copied.length === 1 ? '' : 's'}`, 'ok');
    this.load();
  },

  // ---------- text editor ----------
  async edit(rel) {
    let text;
    try { text = (await call('files:read', this.server.id, rel)) ?? ''; } catch (err) { return; }
    const original = text;
    const editor = el(`
      <div class="editor">
        <div class="editor-bar">
          <button class="btn sm ghost" data-close>${icon('arrowLeft')}Back</button>
          ${icon('fileText').replace('<svg', '<svg style="width:18px;height:18px;color:var(--accent)"')}
          <b class="mono" style="font-size:13px">${esc(rel)}</b>
          <span class="badge warn hidden" data-dirty>Unsaved</span>
          <span class="spacer"></span>
          <span class="small muted">Ctrl+S to save</span>
          <button class="btn sm primary" data-save>${icon('save')}Save</button>
        </div>
        <div class="editor-body">
          <div class="gutter" data-gutter></div>
          <textarea spellcheck="false" data-text></textarea>
        </div>
      </div>`);
    this.root.appendChild(editor);
    const area = $('[data-text]', editor);
    const gutter = $('[data-gutter]', editor);
    area.value = text;
    // Line numbers on the left
    const updateGutter = () => {
      const count = area.value.split('\n').length;
      gutter.textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
      $('[data-dirty]', editor).classList.toggle('hidden', area.value === original);
    };
    updateGutter();
    area.addEventListener('input', updateGutter);
    area.addEventListener('scroll', () => { gutter.scrollTop = area.scrollTop; });
    // Tab key inserts 2 spaces instead of leaving the box
    area.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); }
      if (e.key === 's' && e.ctrlKey) { e.preventDefault(); save(); }
    });
    const save = async () => {
      await call('files:write', this.server.id, rel, area.value);
      text = area.value;
      toast('Saved!', 'ok', 1600);
      $('[data-dirty]', editor).classList.add('hidden');
      if (rel === 'server.properties' && this.server.status !== 'offline') toast('Restart the server to apply server.properties changes.', 'info');
    };
    $('[data-save]', editor).onclick = save;
    $('[data-close]', editor).onclick = async () => {
      if (area.value !== text && !(await confirmBox('Close without saving?', 'Your changes will be lost.', { okText: 'Discard', danger: true }))) return;
      editor.remove();
      this.load();
    };
    area.focus();
  }
};

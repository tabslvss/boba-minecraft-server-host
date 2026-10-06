// backups.js — world folders, manual + automatic backups, restore

Views.backups = {
  title: 'Worlds & Backups',
  needsServer: true,

  async render(root, server) {
    this.root = root;
    this.server = server;
    this.busy = false;
    await this.load();
    this.offs = [
      App.on('backup', (d) => { if (d.id === server.id) { this.busy = d.state === 'running'; this.load(); } }),
      App.on('status', (id) => id === server.id && this.draw())
    ];
  },

  destroy() {
    (this.offs || []).forEach((off) => off());
  },

  async load() {
    [this.backups, this.worlds] = await Promise.all([
      quietCall('backups:list', this.server.id).catch(() => []),
      quietCall('servers:worlds', this.server.id).catch(() => [])
    ]);
    this.server = App.current || this.server;
    this.draw();
  },

  draw() {
    const s = this.server;
    const b = s.backup;
    const total = this.backups.reduce((sum, x) => sum + x.size, 0);
    this.root.innerHTML = `
      <div class="grid max-w" style="max-width:1100px">
        <div class="grid cols-3">
          <div class="card stat"><div class="label">${icon('world')}Worlds</div><div class="value">${this.worlds.length}</div></div>
          <div class="card stat"><div class="label">${icon('archive')}Backups</div><div class="value">${this.backups.length}<small>${formatBytes(total)}</small></div></div>
          <div class="card stat"><div class="label">${icon('clock')}Last backup</div><div class="value" style="font-size:20px">${this.backups[0] ? timeAgo(this.backups[0].time) : 'Never'}</div></div>
        </div>

        <div class="grid cols-2">
          <div class="card">
            <div class="card-title">${emoji('floppy', 24)}Make a backup</div>
            <p class="muted small" style="margin:0 0 14px;line-height:1.5">Safe to do while the server runs — Boba tells it to save first.</p>
            <div class="row">
              <button class="btn primary" data-backup="worlds" ${this.busy ? 'disabled' : ''} data-tip="Just the worlds + player lists. Small and quick." data-ex="Use this before trying risky stuff">${this.busy ? '<span class="spinner" style="width:14px;height:14px"></span>Backing up...' : `${icon('world')}Back up worlds`}</button>
              <button class="btn" data-backup="full" ${this.busy ? 'disabled' : ''} data-tip="Everything: worlds, mods/plugins, configs. Bigger." data-ex="Use before updating mods">${icon('box')}Full backup</button>
              <span class="spacer"></span>
              <button class="btn ghost sm" data-openfolder>${icon('folderOpen')}Open folder</button>
            </div>
          </div>

          <div class="card" style="padding:6px 18px">
            ${settingRow({ key: 'enabled', label: 'Automatic backups', type: 'toggle', tip: 'Backs up the worlds on a timer while the server is online.', ex: 'Every 6 hours' }, b.enabled)}
            ${settingRow({ key: 'everyHours', label: 'Every', type: 'select', options: [[1, '1 hour'], [2, '2 hours'], [3, '3 hours'], [6, '6 hours'], [12, '12 hours'], [24, '24 hours']], tip: 'How often to make an automatic backup.', ex: '6 hours' }, b.everyHours)}
            ${settingRow({ key: 'keep', label: 'Keep newest', type: 'number', min: 1, max: 200, unit: 'backups', tip: 'Older backups are deleted to save space.', ex: '10' }, b.keep)}
          </div>
        </div>

        <div class="card">
          <div class="card-title">${icon('world')}Worlds in this server</div>
          ${this.worlds.length ? `<div class="player-chips">${this.worlds.map((w) => `<div class="player-chip" style="padding:6px 12px">${icon('world').replace('<svg', '<svg style="width:16px;height:16px;color:var(--accent)"')}${esc(w)}</div>`).join('')}</div>
            <div class="small muted" style="margin-top:12px">Want a fresh world? Change <b>World folder</b> in Server Settings — your old world stays safe.</div>`
          : '<div class="muted small">No world yet. Start the server once and it will create one.</div>'}
        </div>

        <div class="card">
          <div class="card-title">${icon('list')}Backups</div>
          ${this.backups.length ? `<div class="player-list">${this.backups.map((x) => `
            <div class="player-row">
              <div class="type-icon" style="width:36px;height:36px;color:var(--accent)">${icon(x.name.startsWith('full') ? 'box' : 'world')}</div>
              <div style="flex:1;min-width:0"><div class="name">${formatDate(x.time)} <span class="badge">${x.name.startsWith('full') ? 'Full' : 'Worlds'}</span></div><div class="small muted mono">${esc(x.name)} · ${formatBytes(x.size)}</div></div>
              <div class="actions">
                <button class="btn sm" data-restore="${esc(x.name)}" data-tip="Replace the current world with this backup. The server must be stopped.">${icon('restart')}Restore</button>
                <button class="btn sm ghost icon" data-delete="${esc(x.name)}" data-tip="Delete this backup">${icon('trash')}</button>
              </div>
            </div>`).join('')}</div>` : `<div class="titled-emoji">${emoji('floppy', 40)}<div class="muted small">No backups yet. Click "Back up worlds" to make your first one.</div></div>`}
        </div>
      </div>`;

    $$('[data-backup]', this.root).forEach((btn) => (btn.onclick = async () => {
      this.busy = true;
      this.draw();
      try {
        await call('backups:create', s.id, btn.dataset.backup);
        toast('Backup done!', 'ok');
      } catch (err) { /* toast shown */ }
      this.busy = false;
      this.load();
    }));
    $('[data-openfolder]', this.root).onclick = () => call('backups:open', s.id);

    // Auto-backup settings save instantly
    $$('[data-key]', this.root).forEach((input) => (input.onchange = async () => {
      const backup = { ...App.current.backup, [input.dataset.key]: readInput(input) };
      backup.everyHours = Number(backup.everyHours);
      await call('servers:saveMeta', s.id, { backup });
      await App.refreshServers();
      this.server = App.current;
      toast('Backup schedule saved', 'ok', 1500);
    }));

    $$('[data-restore]', this.root).forEach((btn) => (btn.onclick = async () => {
      if (App.current.status !== 'offline') return toast('Stop the server first, then restore.', 'warn');
      const ok = await confirmBox('Restore this backup?',
        `Your current world will be <b>replaced</b> with the one from <b>${esc(btn.dataset.restore)}</b>.<br/>Tip: make a backup of the current world first if you might want it.`,
        { okText: 'Restore', danger: true });
      if (!ok) return;
      await call('backups:restore', s.id, btn.dataset.restore);
      toast('Backup restored!', 'ok');
      this.load();
    }));
    $$('[data-delete]', this.root).forEach((btn) => (btn.onclick = async () => {
      if (!(await confirmBox('Delete backup?', `<b>${esc(btn.dataset.delete)}</b> will be deleted forever.`, { okText: 'Delete', danger: true }))) return;
      await call('backups:delete', s.id, btn.dataset.delete);
      this.load();
    }));
  }
};

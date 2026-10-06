// players.js — online players, operators, whitelist and bans

Views.players = {
  title: 'Players',
  needsServer: true,
  tab: 'online',

  async render(root, server) {
    this.root = root;
    this.server = server;
    this.lists = await quietCall('servers:players', server.id).catch(() => ({ online: [], ops: [], whitelist: [], banned: [], bannedIps: [], known: [] }));
    this.draw();
    this.offs = [
      App.on('players', (id) => id === server.id && this.refresh()),
      App.on('status', (id) => id === server.id && this.draw()),
      // Lists change after commands like "op" — reload a moment later
      App.on('log', (id, entry) => {
        if (id === server.id && /Made .* a server operator|Made .* no longer|Added .* to the whitelist|Removed .* from the whitelist|Banned|Unbanned/i.test(entry.line)) {
          setTimeout(() => this.refresh(), 400);
        }
      })
    ];
  },

  destroy() {
    (this.offs || []).forEach((off) => off());
  },

  async refresh() {
    this.lists = await quietCall('servers:players', this.server.id).catch(() => this.lists);
    this.draw();
  },

  get online() {
    return (App.current || this.server).status === 'online';
  },

  draw() {
    const l = this.lists;
    const tabs = [
      ['online', 'Online', 'users', l.online.length],
      ['ops', 'Operators', 'crown', l.ops.length],
      ['whitelist', 'Whitelist', 'shield', l.whitelist.length],
      ['banned', 'Banned', 'ban', l.banned.length + l.bannedIps.length]
    ];
    this.root.innerHTML = `
      <div class="max-w col" style="gap:16px">
        <div class="row">
          <div class="segmented">${tabs.map(([id, label, ic, n]) => `<button data-tab="${id}" class="${this.tab === id ? 'active' : ''}">${icon(ic)}${label} <span class="badge">${n}</span></button>`).join('')}</div>
          <span class="spacer"></span>
          ${this.online ? '' : `<span class="badge warn">${icon('info')} Start the server to change players</span>`}
        </div>
        <div class="card" data-body></div>
      </div>`;
    $$('[data-tab]', this.root).forEach((b) => (b.onclick = () => { this.tab = b.dataset.tab; this.draw(); }));
    this.drawBody($('[data-body]', this.root));
  },

  // Run a Minecraft command (only works while the server is running)
  run(command) {
    if (!this.online) return toast('The server must be running to do that.', 'warn');
    call('servers:send', this.server.id, command).then(() => setTimeout(() => this.refresh(), 600));
  },

  addBox(placeholder, buttonText, onAdd, tip) {
    return {
      html: `<div class="row" style="margin-bottom:12px">
        <div class="input-icon" style="flex:1">${icon('user')}<input class="input" data-add placeholder="${esc(placeholder)}" ${this.online ? '' : 'disabled'}/></div>
        <button class="btn primary" data-addbtn ${this.online ? '' : 'disabled'} ${tip ? `data-tip="${esc(tip)}"` : ''}>${icon('plus')}${esc(buttonText)}</button>
      </div>`,
      wire: (box) => {
        const input = $('[data-add]', box);
        const go = () => { const name = input.value.trim(); if (name) { onAdd(name); input.value = ''; } };
        $('[data-addbtn]', box).onclick = go;
        input.onkeydown = (e) => { if (e.key === 'Enter') go(); };
      }
    };
  },

  playerRow(name, actions, sub = '') {
    return `<div class="player-row">
      <img src="${headUrl(name, 34)}" alt="" loading="lazy"/>
      <div><div class="name">${esc(name)}</div>${sub ? `<div class="small muted">${esc(sub)}</div>` : ''}</div>
      <div class="actions">${actions}</div>
    </div>`;
  },

  drawBody(box) {
    const l = this.lists;
    const dis = this.online ? '' : 'disabled';

    if (this.tab === 'online') {
      box.innerHTML = l.online.length
        ? `<div class="player-list">${l.online.map((p) => this.playerRow(p, `
            <select class="select" data-gm="${esc(p)}" style="width:130px;height:28px" data-tip="Change this player's game mode" ${dis}>
              <option value="">Game mode…</option><option>survival</option><option>creative</option><option>adventure</option><option>spectator</option>
            </select>
            <button class="btn sm" data-cmd="${l.ops.includes(p) ? 'deop' : 'op'} ${esc(p)}" data-tip="${l.ops.includes(p) ? 'Remove admin powers' : 'Give admin powers (can use commands)'}" ${dis}>${icon('crown')}${l.ops.includes(p) ? 'De-op' : 'Op'}</button>
            <button class="btn sm" data-cmd="kick ${esc(p)}" data-tip="Disconnect them (they can rejoin)" ${dis}>${icon('door')}Kick</button>
            <button class="btn sm danger" data-ban="${esc(p)}" data-tip="Block them from joining" ${dis}>${icon('ban')}Ban</button>`,
            l.ops.includes(p) ? 'Operator' : 'Player')).join('')}</div>`
        : `<div class="empty">${emoji(this.online ? 'people' : 'sleeping', 72)}<br/><h3>Nobody's online</h3><div>${this.online ? 'Share your server address with friends!' : 'The server is offline.'}</div></div>`;
    }

    if (this.tab === 'ops') {
      const add = this.addBox('Player name, e.g. Notch', 'Make operator', (n) => this.run(`op ${n}`), 'Operators can use commands like /gamemode and /tp');
      box.innerHTML = add.html + (l.ops.length
        ? `<div class="player-list">${l.ops.map((p) => this.playerRow(p, `<button class="btn sm danger" data-cmd="deop ${esc(p)}" ${dis}>${icon('x')}Remove</button>`, 'Operator')).join('')}</div>`
        : `<div class="muted small">No operators yet. Make yourself one so you can use commands in-game!</div>`);
      add.wire(box);
    }

    if (this.tab === 'whitelist') {
      const add = this.addBox('Player name', 'Add to whitelist', (n) => this.run(`whitelist add ${n}`));
      box.innerHTML = `
        <div class="row" style="margin-bottom:14px;padding:10px 12px;border-radius:10px;background:var(--panel-2)">
          ${icon('info').replace('<svg', '<svg style="width:16px;height:16px;color:var(--accent)"')}
          <span class="small">The whitelist only blocks people when it's turned <b>on</b>.</span>
          <span class="spacer"></span>
          <button class="btn sm" data-cmd="whitelist on" ${dis}>Turn on</button>
          <button class="btn sm ghost" data-cmd="whitelist off" ${dis}>Turn off</button>
        </div>` + add.html + (l.whitelist.length
        ? `<div class="player-list">${l.whitelist.map((p) => this.playerRow(p, `<button class="btn sm danger" data-cmd="whitelist remove ${esc(p)}" ${dis}>${icon('x')}Remove</button>`)).join('')}</div>`
        : `<div class="muted small">Whitelist is empty.</div>`);
      add.wire(box);
    }

    if (this.tab === 'banned') {
      const add = this.addBox('Player name to ban', 'Ban', (n) => this.run(`ban ${n}`));
      box.innerHTML = add.html + (l.banned.length || l.bannedIps.length
        ? `<div class="player-list">
            ${l.banned.map((b) => this.playerRow(b.name, `<button class="btn sm" data-cmd="pardon ${esc(b.name)}" ${dis}>${icon('check')}Unban</button>`, b.reason || 'Banned')).join('')}
            ${l.bannedIps.map((b) => `<div class="player-row"><div class="server-avatar" style="--c:#555">IP</div><div><div class="name mono">${esc(b.ip)}</div><div class="small muted">${esc(b.reason || 'IP ban')}</div></div><div class="actions"><button class="btn sm" data-cmd="pardon-ip ${esc(b.ip)}" ${dis}>Unban</button></div></div>`).join('')}
           </div>`
        : `<div class="muted small">Nobody is banned. Nice server!</div>`);
      add.wire(box);
    }

    // Wire up buttons
    $$('[data-cmd]', box).forEach((b) => (b.onclick = () => this.run(b.dataset.cmd)));
    $$('[data-gm]', box).forEach((sel) => (sel.onchange = () => { if (sel.value) this.run(`gamemode ${sel.value} ${sel.dataset.gm}`); }));
    $$('[data-ban]', box).forEach((b) => (b.onclick = async () => {
      const reason = await promptBox(`Ban ${b.dataset.ban}?`, { label: 'Reason (optional)', placeholder: 'Griefing', okText: 'Ban' });
      if (reason !== null) this.run(`ban ${b.dataset.ban} ${reason}`.trim());
    }));
  }
};

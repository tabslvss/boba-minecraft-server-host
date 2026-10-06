// dashboard.js — overview: status, address, live stats, chart, recent console

// Keep the last 90 stat samples per server (about 3 minutes) so the chart has history
const STATS_HISTORY = new Map();
document.addEventListener('DOMContentLoaded', () => {
  App.on('stats', (id, stats) => {
    if (!STATS_HISTORY.has(id)) STATS_HISTORY.set(id, []);
    const list = STATS_HISTORY.get(id);
    list.push(stats);
    if (list.length > 90) list.shift();
  });
  App.on('status', (id, status) => { if (status === 'offline') STATS_HISTORY.delete(id); });
});

Views.dashboard = {
  title: 'Dashboard',
  needsServer: true,

  async render(root, server) {
    this.root = root;
    this.server = server;
    this.tunnel = await quietCall('tunnel:info').catch(() => null);
    this.draw();
    this.offs = [
      App.on('status', (id) => id === this.server.id && this.draw()),
      App.on('stats', (id, stats) => id === this.server.id && this.updateStats(stats)),
      App.on('players', (id) => id === this.server.id && this.drawPlayers()),
      App.on('log', (id, entry) => id === this.server.id && this.addLogLine(entry)),
      App.on('tunnel', (info) => { this.tunnel = info; this.drawAddress(); }),
      App.on('servers', () => { this.server = App.current || this.server; })
    ];
    // Redraw uptime every second
    this.timer = setInterval(() => this.updateUptime(), 1000);
    window.addEventListener('resize', this.onResize = () => this.drawChart());
  },

  destroy() {
    (this.offs || []).forEach((off) => off());
    clearInterval(this.timer);
    window.removeEventListener('resize', this.onResize);
  },

  draw() {
    const s = App.current || this.server;
    this.server = s;
    const info = typeInfo(s.type);
    const running = s.status !== 'offline';
    this.root.innerHTML = `
      <div class="grid" style="max-width:1280px">
        <div class="hero ${s.modpack && s.modpack.banner ? 'has-banner' : ''}" ${s.modpack && s.modpack.banner ? `style="background-image:url('${esc(s.modpack.banner)}')"` : ''}>
          ${serverAvatar(s, 'lg')}
          <div style="min-width:0">
            <h2>${esc(s.name)}</h2>
            <div class="meta">
              <span class="badge" style="color:${info.color}">${icon(info.icon)} ${info.name}</span>
              <span class="badge">MC ${esc(s.mcVersion || '?')}</span>
              ${s.modpack ? `<span class="badge accent">${icon('package')} ${esc(s.modpack.name)}</span>` : ''}
              <span class="badge">${icon('memory')} ${formatMB(s.memoryMax)}</span>
              <span class="badge">Port ${s.port}</span>
            </div>
          </div>
          <div class="actions">
            <button class="btn" data-folder data-tip="Open the server folder in Windows Explorer">${icon('folderOpen')}</button>
            ${running
              ? `<button class="btn danger lg" data-power="stop" ${s.status === 'stopping' ? 'disabled' : ''}>${icon('stop')}${s.status === 'stopping' ? 'Stopping...' : 'Stop'}</button>`
              : `<button class="btn primary lg" data-power="start" ${s.status === 'installing' ? 'disabled' : ''}>${icon('play')}${s.status === 'installing' ? 'Installing...' : 'Start server'}</button>`}
          </div>
        </div>

        <div class="card" data-address></div>

        <div class="grid cols-4">
          <div class="card stat"><div class="label">${icon('users')}Players</div><div class="value" data-players-count>${s.players.length}<small>/ ${s.maxPlayers}</small></div></div>
          <div class="card stat"><div class="label">${icon('memory')}Server RAM ${helpIcon('RAM used by the Java process. Java grabs memory up front, so this often looks high — that\'s normal.')}</div><div class="value" data-ram>—</div><div class="progress bar"><i data-ram-bar style="width:0"></i></div></div>
          <div class="card stat"><div class="label">${icon('cpu')}PC CPU ${helpIcon('How busy your whole PC\'s processor is right now.')}</div><div class="value" data-cpu>—</div><div class="progress bar"><i data-cpu-bar style="width:0"></i></div></div>
          <div class="card stat"><div class="label">${icon('clock')}Uptime</div><div class="value" data-uptime>—</div></div>
        </div>

        <div class="grid cols-2">
          <div class="card">
            <div class="card-title">${icon('zap')}Performance <div class="right legend"><span><i style="background:var(--accent)"></i>RAM</span><span><i style="background:var(--accent-2)"></i>CPU</span></div></div>
            <canvas class="chart" data-chart></canvas>
          </div>
          <div class="card">
            <div class="card-title">${icon('terminal')}Console <div class="right"><button class="btn sm ghost" data-open-console>Open full console ${icon('chevronRight')}</button></div></div>
            <div class="mini-console selectable" data-mini></div>
            <div class="row" style="margin-top:10px">
              <input class="input mono" data-quick placeholder="${running ? 'Type a command, e.g. say Hello!' : 'Start the server to send commands'}" ${running ? '' : 'disabled'}/>
              <button class="btn icon" data-quick-send ${running ? '' : 'disabled'}>${icon('send')}</button>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">${icon('users')}Online now <div class="right"><button class="btn sm ghost" data-open-players>Manage players ${icon('chevronRight')}</button></div></div>
          <div data-players></div>
        </div>
      </div>`;

    $('[data-folder]', this.root).onclick = () => call('servers:openFolder', s.id);
    const power = $('[data-power]', this.root);
    power.onclick = () => App.power(power.dataset.power);
    $('[data-open-console]', this.root).onclick = () => App.go('console');
    $('[data-open-players]', this.root).onclick = () => App.go('players');
    const quick = $('[data-quick]', this.root);
    const sendQuick = () => { if (quick.value.trim()) { call('servers:send', s.id, quick.value.trim().replace(/^\//, '')); quick.value = ''; } };
    quick.onkeydown = (e) => { if (e.key === 'Enter') sendQuick(); };
    $('[data-quick-send]', this.root).onclick = sendQuick;

    this.drawAddress();
    this.drawPlayers();
    this.loadLog();
    const history = STATS_HISTORY.get(s.id) || [];
    if (s.stats) this.updateStats(s.stats, true); else this.drawChart();
    if (!history.length) this.drawChart();
  },

  drawAddress() {
    const box = $('[data-address]', this.root);
    if (!box) return;
    const s = this.server;
    const t = this.tunnel || {};
    const lan = (App.info.localIps[0] || 'localhost') + (s.port === 25565 ? '' : `:${s.port}`);
    const address = t.address;
    const tunnelOk = t.state === 'running';
    box.innerHTML = `
      <div class="card-title">${icon('globe')}Server address
        <div class="right">
          <span class="badge ${tunnelOk ? 'ok' : t.state === 'error' ? 'bad' : 'warn'}">${tunnelOk ? 'Tunnel online' : t.state === 'stopped' || !t.state ? 'Tunnel off' : esc(t.state)}</span>
          <button class="btn sm ghost" data-go-net>Setup ${icon('chevronRight')}</button>
        </div>
      </div>
      <div class="grid cols-2">
        <div>
          <div class="small muted" style="margin-bottom:6px">Friends anywhere ${helpIcon('Give this to friends. It stays the same every time you start your PC.', 'boba-tea.joinmc.link')}</div>
          <div class="address-card">
            <div class="address">${address ? esc(address) : '<span class="muted" style="font-family:var(--font);font-weight:500;font-size:14px">Not set up yet — click Setup (2 minutes, free)</span>'}</div>
            ${address ? `<button class="btn icon" data-copy="${esc(address)}" data-tip="Copy address">${icon('copy')}</button>` : `<button class="btn primary" data-go-net2>${icon('rocket')}Go public</button>`}
          </div>
        </div>
        <div>
          <div class="small muted" style="margin-bottom:6px">Same Wi-Fi / this PC ${helpIcon('People on your home network can use this. On this PC you can also use localhost.', 'localhost')}</div>
          <div class="address-card">
            <div class="address" style="border-style:solid;border-color:var(--border)">${esc(lan)}</div>
            <button class="btn icon" data-copy="${esc(lan)}" data-tip="Copy LAN address">${icon('copy')}</button>
          </div>
        </div>
      </div>`;
    $$('[data-copy]', box).forEach((b) => (b.onclick = () => copyText(b.dataset.copy, 'Address copied! Send it to your friends.')));
    $('[data-go-net]', box).onclick = () => App.go('network');
    const go2 = $('[data-go-net2]', box);
    if (go2) go2.onclick = () => App.go('network');
  },

  drawPlayers() {
    const box = $('[data-players]', this.root);
    if (!box) return;
    const s = App.current || this.server;
    const count = $('[data-players-count]', this.root);
    if (count) count.innerHTML = `${s.players.length}<small>/ ${s.maxPlayers}</small>`;
    box.innerHTML = s.players.length
      ? `<div class="player-chips">${s.players.map((p) => `<div class="player-chip"><img src="${headUrl(p, 24)}" alt=""/>${esc(p)}</div>`).join('')}</div>`
      : `<div class="titled-emoji">${emoji(s.status === 'online' ? 'people' : 'sleeping', 40)}<div class="muted small">${s.status === 'online' ? 'Nobody online yet. Share your address!' : 'Server is offline. Press Start to wake it up.'}</div></div>`;
  },

  async loadLog() {
    const lines = await quietCall('servers:log', this.server.id).catch(() => []);
    const box = $('[data-mini]', this.root);
    if (!box) return;
    box.innerHTML = '';
    lines.slice(-12).forEach((entry) => this.addLogLine(entry));
  },

  addLogLine(entry) {
    const box = $('[data-mini]', this.root);
    if (!box) return;
    box.appendChild(el(`<div class="ln ${Views.console.lineClass(entry)}">${esc(stripCodes(entry.line))}</div>`));
    while (box.children.length > 12) box.firstChild.remove();
  },

  updateStats(stats, skipChart) {
    const s = this.server;
    const ramPct = Math.min(100, Math.round((stats.memory / s.memoryMax) * 100));
    const ram = $('[data-ram]', this.root);
    if (!ram) return;
    ram.innerHTML = `${formatMB(stats.memory)}<small>/ ${formatMB(s.memoryMax)}</small>`;
    $('[data-ram-bar]', this.root).style.width = `${ramPct}%`;
    $('[data-cpu]', this.root).innerHTML = `${stats.cpu}<small>%</small>`;
    $('[data-cpu-bar]', this.root).style.width = `${stats.cpu}%`;
    this.updateUptime();
    this.drawChart();
  },

  updateUptime() {
    const node = $('[data-uptime]', this.root);
    const s = App.current;
    if (!node || !s) return;
    node.textContent = s.startedAt ? formatDuration(Date.now() - s.startedAt) : '—';
  },

  // Draw the RAM + CPU lines on the canvas
  drawChart() {
    const canvas = $('[data-chart]', this.root);
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    const style = getComputedStyle(document.documentElement);
    const accent = style.getPropertyValue('--accent').trim();
    const accent2 = style.getPropertyValue('--accent-2').trim();
    const grid = style.getPropertyValue('--border').trim();
    const muted = style.getPropertyValue('--muted').trim();

    // Grid lines at 0/25/50/75/100%
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = muted;
    ctx.font = '10px Segoe UI, sans-serif';
    for (let i = 0; i <= 4; i++) {
      const y = 8 + ((height - 16) * i) / 4;
      ctx.beginPath(); ctx.moveTo(28, y); ctx.lineTo(width, y); ctx.stroke();
      ctx.fillText(`${100 - i * 25}%`, 0, y + 3);
    }

    const history = STATS_HISTORY.get(this.server.id) || [];
    if (history.length < 2) {
      ctx.fillStyle = muted;
      ctx.font = '12px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.server.status === 'offline' ? 'Start the server to see live stats' : 'Collecting data...', width / 2, height / 2);
      return;
    }
    const max = 90;
    const xFor = (i) => 28 + ((width - 28) * (max - history.length + i)) / (max - 1);
    const yFor = (pct) => 8 + (height - 16) * (1 - pct / 100);
    const line = (values, color) => {
      // Soft filled area under the line
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, color + '55');
      gradient.addColorStop(1, color + '00');
      ctx.beginPath();
      values.forEach((v, i) => (i ? ctx.lineTo(xFor(i), yFor(v)) : ctx.moveTo(xFor(i), yFor(v))));
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.lineTo(xFor(values.length - 1), height - 8); ctx.lineTo(xFor(0), height - 8); ctx.closePath();
      ctx.fillStyle = gradient; ctx.fill();
    };
    line(history.map((h) => Math.min(100, (h.memory / this.server.memoryMax) * 100)), accent);
    line(history.map((h) => h.cpu), accent2);
  }
};

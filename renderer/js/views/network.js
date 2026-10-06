// network.js — "Go Public": set up the free playit.gg tunnel (no port forwarding)

Views.network = {
  title: 'Go Public',
  needsServer: true,

  async render(root, server) {
    this.root = root;
    this.server = server;
    this.info = await quietCall('tunnel:info').catch(() => ({ state: 'stopped', log: [] }));
    this.downloadPct = -1;
    this.draw();
    this.offs = [
      App.on('tunnel', (info) => {
        // Only redraw the page if something important changed; otherwise just update the log
        const key = (i) => [i.state, i.claimUrl, i.address, i.linked].join('|');
        const changed = key(info) !== key(this.info);
        this.info = info;
        if (changed) return this.draw();
        const log = $('[data-log]', this.root);
        if (log) { log.innerHTML = info.log.map((l) => `<div>${esc(l)}</div>`).join(''); log.scrollTop = log.scrollHeight; }
      }),
      App.on('tunnel-download', (p) => { this.downloadPct = p; const n = $('[data-dl]', this.root); if (n) n.textContent = `${p}%`; })
    ];
  },

  destroy() {
    (this.offs || []).forEach((off) => off());
  },

  draw() {
    const t = this.info;
    const s = App.current || this.server;
    const running = ['running', 'starting', 'needs-claim', 'downloading'].includes(t.state);
    // Which step are we on?
    const step = !running && !t.linked ? 1 : !t.linked ? 2 : !t.address ? 3 : 5;
    const stepClass = (n) => (step > n ? 'done' : step === n ? 'current' : '');
    const portWarn = s.port !== 25565;

    this.root.innerHTML = `
      <div class="grid" style="max-width:1000px">
        ${t.address ? `
        <div class="big-address">
          ${emoji('globe', 64)}
          <div class="muted" style="margin-top:6px">Your permanent server address</div>
          <div class="addr gradient-text">${esc(t.address)}</div>
          <div class="row" style="justify-content:center">
            <button class="btn primary" data-copy>${icon('copy')}Copy address</button>
            <span class="badge ${t.state === 'running' ? 'ok' : 'warn'}">${t.state === 'running' ? 'Tunnel online' : 'Tunnel ' + esc(t.state)}</span>
          </div>
          <div class="small muted" style="margin-top:12px">Friends: Multiplayer → Add Server → paste this. It stays the same every time you boot.</div>
        </div>` : ''}

        <div class="card">
          <div class="card-title">${emoji('rocket', 26)}Setup (one time, free, about 2 minutes)
            <div class="right">${helpIcon('playit.gg is a free service that forwards players to your PC through a secure tunnel, so you never touch your router.', 'Friend → boba.joinmc.link → playit → your PC')}</div>
          </div>
          <div class="net-steps">
            <div class="net-step ${stepClass(1)}">
              <div class="num">${step > 1 ? '✓' : 1}</div>
              <div style="flex:1">
                <b>Start the tunnel</b>
                <p>Boba downloads the small playit.gg program (once) and runs it in the background.</p>
                ${running
                  ? `<span class="badge ${t.state === 'running' ? 'ok' : 'warn'}">${t.state === 'downloading' ? `Downloading <span data-dl>${this.downloadPct >= 0 ? this.downloadPct + '%' : ''}</span>` : esc(t.state)}</span>`
                  : `<button class="btn primary" data-start>${icon('play')}Start tunnel</button>`}
              </div>
            </div>
            <div class="net-step ${stepClass(2)}">
              <div class="num">${step > 2 ? '✓' : 2}</div>
              <div style="flex:1">
                <b>Link this PC to playit</b>
                <p>Open the link, sign in (or continue as guest) and approve. Boba saves the link so you never do this again.</p>
                ${t.claimUrl && !t.linked
                  ? `<div class="row"><button class="btn primary" data-claim>${icon('link')}Open link to approve</button><span class="small muted mono" style="overflow:hidden;text-overflow:ellipsis">${esc(t.claimUrl)}</span></div>`
                  : t.linked ? '<span class="badge ok">Linked</span>' : step === 2 ? '<span class="row small muted"><span class="spinner" style="width:14px;height:14px"></span>Waiting for the link...</span>' : ''}
              </div>
            </div>
            <div class="net-step ${stepClass(3)}">
              <div class="num">${step > 3 ? '✓' : 3}</div>
              <div style="flex:1">
                <b>Create a Minecraft tunnel</b>
                <p>On playit.gg: <b>Tunnels → Add Tunnel → "Minecraft Java"</b> → Add. Keep the local port <b class="mono">${s.port}</b>. playit gives you a random address like <span class="mono">word-word.joinmc.link</span>.</p>
                ${portWarn ? `<p style="color:var(--warn)">${icon('alert').replace('<svg', '<svg style="width:14px;height:14px;vertical-align:-2px"')} This server uses port ${s.port}. Set the tunnel's local port to ${s.port}.</p>` : ''}
                <button class="btn" data-dashboard ${step < 3 ? 'disabled' : ''}>${icon('external')}Open playit.gg tunnels</button>
              </div>
            </div>
            <div class="net-step ${step === 3 ? 'current' : stepClass(4)}">
              <div class="num">${step > 4 || t.address ? '✓' : 4}</div>
              <div style="flex:1">
                <b>Paste your address</b>
                <p>Boba tries to find it automatically. If not, copy it from playit.gg and paste it here.</p>
                <div class="row">
                  <input class="input mono" data-addr placeholder="example-name.joinmc.link" value="${esc(t.address || '')}"/>
                  <button class="btn primary" data-saveaddr>${icon('save')}Save</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="grid cols-2">
          <div class="card" style="padding:6px 18px">
            ${settingRow({ key: 'autoStart', label: 'Start tunnel with Boba', type: 'toggle', tip: 'Turns the tunnel on every time the app opens, so your address always works.', ex: 'Keep On' }, App.config.tunnel.autoStart)}
            <div class="setting">
              <div><div class="setting-label">Tunnel ${helpIcon('Turn the tunnel on or off. Off = only LAN players can join.')}</div></div>
              <div class="setting-control">${running ? `<button class="btn danger sm" data-stop>${icon('stop')}Stop</button>` : `<button class="btn sm" data-start2>${icon('play')}Start</button>`}</div>
            </div>
            <div class="setting">
              <div><div class="setting-label">Reset link ${helpIcon('Unlinks this PC from playit. Use if you want a different account. Your address may change!')}</div></div>
              <div class="setting-control"><button class="btn sm ghost" data-reset>${icon('restart')}Reset</button></div>
            </div>
          </div>
          <div class="card">
            <div class="card-title">${icon('wifi')}Other ways to join</div>
            <div class="col small" style="gap:8px">
              <div><b>This PC:</b> <span class="mono">localhost${s.port === 25565 ? '' : ':' + s.port}</span></div>
              ${App.info.localIps.map((ip) => `<div><b>Same Wi-Fi:</b> <span class="mono">${esc(ip)}${s.port === 25565 ? '' : ':' + s.port}</span> <button class="btn sm ghost icon" data-copyip="${esc(ip)}${s.port === 25565 ? '' : ':' + s.port}">${icon('copy')}</button></div>`).join('')}
              <div class="muted">Prefer port forwarding? Forward TCP ${s.port} on your router to ${esc(App.info.localIps[0] || 'this PC')}.</div>
            </div>
          </div>
        </div>

        <details class="card">
          <summary style="cursor:pointer;font-weight:600">Tunnel log (for troubleshooting)</summary>
          <div class="tunnel-log selectable" style="margin-top:12px" data-log>${(t.log || []).map((l) => `<div>${esc(l)}</div>`).join('') || '<div>Nothing yet.</div>'}</div>
        </details>
      </div>`;

    const on = (sel, fn) => { const n = $(sel, this.root); if (n) n.onclick = fn; };
    on('[data-start]', () => call('tunnel:start'));
    on('[data-start2]', () => call('tunnel:start'));
    on('[data-stop]', () => call('tunnel:stop'));
    on('[data-claim]', () => call('shell:openExternal', t.claimUrl));
    on('[data-dashboard]', () => call('shell:openExternal', 'https://playit.gg/account/tunnels'));
    on('[data-copy]', () => copyText(t.address, 'Address copied! Send it to your friends.'));
    on('[data-saveaddr]', async () => {
      const value = $('[data-addr]', this.root).value.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
      if (!value) return toast('Paste the address first.', 'warn');
      await call('tunnel:setAddress', value);
      App.config = await call('app:getConfig');
      toast('Address saved! It now shows on your dashboard.', 'ok');
    });
    on('[data-reset]', async () => {
      if (!(await confirmBox('Reset playit link?', 'You will need to link again, and your address might change.', { okText: 'Reset', danger: true }))) return;
      await call('tunnel:reset');
    });
    $$('[data-copyip]', this.root).forEach((b) => (b.onclick = () => copyText(b.dataset.copyip)));
    const auto = $('[data-key="autoStart"]', this.root);
    auto.onchange = () => App.saveConfig({ tunnel: { autoStart: auto.checked } }).then(() => toast('Saved', 'ok', 1200));
    const log = $('[data-log]', this.root);
    log.scrollTop = log.scrollHeight;
  }
};

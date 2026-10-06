// console.js — the built-in terminal: live server console + a system command prompt

// Common commands for the suggestion popup: [command, what it does]
const COMMAND_HINTS = [
  ['say <message>', 'Message everyone'],
  ['list', 'Who is online'],
  ['op <player>', 'Make someone an admin'],
  ['deop <player>', 'Remove admin'],
  ['kick <player> [reason]', 'Kick a player'],
  ['ban <player> [reason]', 'Ban a player'],
  ['pardon <player>', 'Unban a player'],
  ['whitelist add <player>', 'Allow a player'],
  ['whitelist remove <player>', 'Remove from whitelist'],
  ['whitelist on', 'Turn whitelist on'],
  ['gamemode creative <player>', 'Change game mode'],
  ['gamemode survival <player>', 'Change game mode'],
  ['difficulty <peaceful|easy|normal|hard>', 'Change difficulty'],
  ['time set day', 'Make it day'],
  ['time set night', 'Make it night'],
  ['weather clear', 'Stop rain'],
  ['tp <player> <target>', 'Teleport'],
  ['give <player> <item> [amount]', 'Give items'],
  ['gamerule keepInventory true', 'Keep items on death'],
  ['gamerule doDaylightCycle false', 'Freeze time'],
  ['setworldspawn', 'Set spawn to your spot'],
  ['save-all', 'Save the world now'],
  ['stop', 'Save and stop the server'],
  ['seed', 'Show world seed'],
  ['tps', 'Server speed (Paper/Purpur)'],
  ['plugins', 'List plugins (Paper/Purpur)']
];

Views.console = {
  title: 'Console',
  needsServer: true,
  fullBleed: true,
  mode: 'server',            // 'server' or 'system'
  history: [],               // commands you typed (Up/Down arrow)
  systemBuffers: new Map(),  // id -> text from the system terminal

  // Decide the color of a console line
  lineClass(entry) {
    const text = entry.line;
    if (entry.kind === 'cmd') return 'cmd';
    if (entry.kind === 'info') return 'info';
    if (entry.kind === 'warn' || /\/WARN\]|\bWARN(ING)?\b/.test(text)) return 'warn';
    if (entry.kind === 'err' && /Exception|ERROR|SEVERE|Error:|FATAL/.test(text)) return 'err';
    if (/\/ERROR\]|\bSEVERE\b|\bFATAL\b|Exception/.test(text)) return 'err';
    if (/joined the game|left the game|Done \(/.test(text)) return 'join';
    return '';
  },

  render(root, server) {
    this.root = root;
    this.server = server;
    this.autoscroll = true;
    this.filter = '';
    this.historyIndex = -1;
    this.showTime = this.showTime ?? false;
    root.innerHTML = `
      <div class="console-wrap">
        <div class="console-toolbar">
          <div class="segmented" data-mode>
            <button data-v="server" class="${this.mode === 'server' ? 'active' : ''}" data-tip="The Minecraft server's live output. Type Minecraft commands here.">${icon('terminal')}Server console</button>
            <button data-v="system" class="${this.mode === 'system' ? 'active' : ''}" data-tip="A Windows Command Prompt opened in this server's folder." data-ex="dir   or   java -version">${icon('cpu')}System terminal</button>
          </div>
          <div class="input-icon" style="width:240px">${icon('search')}<input class="input" data-filter placeholder="Filter lines..." /></div>
          <span class="spacer"></span>
          <label class="row small muted" style="gap:6px;cursor:pointer" data-tip="Show the time each line arrived"><input type="checkbox" class="check" data-time ${this.showTime ? 'checked' : ''}/>Times</label>
          <label class="row small muted" style="gap:6px;cursor:pointer" data-tip="Keep scrolling to the newest line"><input type="checkbox" class="check" data-auto checked/>Auto-scroll</label>
          <button class="btn sm" data-copy data-tip="Copy everything shown">${icon('copy')}Copy</button>
          <button class="btn sm" data-clear data-tip="Clear the screen (doesn't touch log files)">${icon('trash')}Clear</button>
        </div>
        <div class="quick-cmds" data-quick></div>
        <div class="console">
          <div class="console-lines" data-lines></div>
          <div class="console-input">
            <span class="prompt">${this.mode === 'server' ? '&gt;' : '$'}</span>
            <input data-input spellcheck="false" autocomplete="off" />
            <button class="btn sm primary" data-send>${icon('send')}Send</button>
          </div>
        </div>
      </div>`;

    // Toolbar wiring
    $$('[data-mode] button', root).forEach((b) => (b.onclick = () => { this.mode = b.dataset.v; App.go('console'); }));
    $('[data-filter]', root).oninput = (e) => { this.filter = e.target.value.toLowerCase(); this.redraw(); };
    $('[data-auto]', root).onchange = (e) => { this.autoscroll = e.target.checked; };
    $('[data-time]', root).onchange = (e) => { this.showTime = e.target.checked; this.redraw(); };
    $('[data-copy]', root).onclick = () => copyText($('[data-lines]', root).innerText, 'Console copied');
    $('[data-clear]', root).onclick = async () => {
      if (this.mode === 'server') { await call('servers:clearLog', server.id); this.lines = []; }
      else this.systemBuffers.set(server.id, '');
      this.redraw();
    };

    const lines = $('[data-lines]', root);
    // Stop auto-scroll if you scroll up to read
    lines.addEventListener('scroll', () => {
      const atBottom = lines.scrollHeight - lines.scrollTop - lines.clientHeight < 30;
      this.autoscroll = atBottom;
      $('[data-auto]', root).checked = atBottom;
    });

    this.wireInput();
    this.drawQuick();

    if (this.mode === 'server') {
      this.lines = [];
      quietCall('servers:log', server.id).then((log) => { this.lines = log; this.redraw(); });
      this.offs = [
        App.on('log', (id, entry) => { if (id === server.id) { this.lines.push(entry); if (this.lines.length > 3000) this.lines.shift(); this.appendLine(entry); } }),
        App.on('status', (id) => { if (id === server.id) this.drawQuick(); })
      ];
    } else {
      call('terminal:start', server.id).catch(() => {});
      this.offs = [App.on('terminal', (id, text) => {
        if (id !== server.id) return;
        this.systemBuffers.set(id, ((this.systemBuffers.get(id) || '') + text).slice(-200000));
        this.redraw();
      })];
      this.redraw();
    }
    setTimeout(() => $('[data-input]', root).focus(), 50);
  },

  destroy() {
    (this.offs || []).forEach((off) => off());
  },

  drawQuick() {
    const box = $('[data-quick]', this.root);
    if (!box) return;
    if (this.mode !== 'server') { box.innerHTML = ''; return; }
    const quick = [['list', 'Who\'s online'], ['time set day', 'Day'], ['weather clear', 'Clear weather'], ['save-all', 'Save world'], ['gamerule keepInventory true', 'Keep inventory']];
    box.innerHTML = quick.map(([cmd, label]) => `<button class="btn sm" data-q="${esc(cmd)}" data-tip="Runs: ${esc(cmd)}">${esc(label)}</button>`).join('');
    $$('[data-q]', box).forEach((b) => (b.onclick = () => this.sendCommand(b.dataset.q)));
  },

  // Turn a log entry into a line element
  lineHtml(entry) {
    const time = this.showTime ? `<span class="ts">${new Date(entry.t).toLocaleTimeString()}</span>` : '';
    return `<div class="ln ${this.lineClass(entry)}">${time}${esc(stripCodes(entry.line))}</div>`;
  },

  appendLine(entry) {
    if (this.filter && !entry.line.toLowerCase().includes(this.filter)) return;
    const box = $('[data-lines]', this.root);
    if (!box) return;
    box.insertAdjacentHTML('beforeend', this.lineHtml(entry));
    while (box.children.length > 3000) box.firstChild.remove();
    if (this.autoscroll) box.scrollTop = box.scrollHeight;
  },

  redraw() {
    const box = $('[data-lines]', this.root);
    if (!box) return;
    if (this.mode === 'server') {
      const shown = this.filter ? this.lines.filter((e) => e.line.toLowerCase().includes(this.filter)) : this.lines;
      box.innerHTML = shown.length
        ? shown.map((e) => this.lineHtml(e)).join('')
        : `<div class="ln dim">${this.server.status === 'offline' ? 'Server is offline. Press Start (top right) to see its output here.' : 'Waiting for output...'}</div>`;
    } else {
      const text = stripCodes(this.systemBuffers.get(this.server.id) || '');
      const lines = text.split(/\r?\n/).filter((l) => !this.filter || l.toLowerCase().includes(this.filter));
      box.innerHTML = lines.map((l) => `<div class="ln">${esc(l)}</div>`).join('');
    }
    if (this.autoscroll) box.scrollTop = box.scrollHeight;
  },

  sendCommand(text) {
    const command = text.trim().replace(/^\//, '');   // people often type "/op" — remove the slash
    if (!command) return;
    this.history.unshift(command);
    this.history = this.history.slice(0, 100);
    this.historyIndex = -1;
    if (this.mode === 'server') call('servers:send', this.server.id, command).catch(() => {});
    else call('terminal:write', this.server.id, command).catch(() => {});
  },

  wireInput() {
    const input = $('[data-input]', this.root);
    const wrap = input.parentElement;
    input.placeholder = this.mode === 'server'
      ? 'Type a command (no / needed) — Tab to complete, ↑ for history'
      : 'Type a Windows command, e.g. dir';
    let suggestIndex = 0;
    let matches = [];

    const closeSuggest = () => { const s = $('.suggest', wrap); if (s) s.remove(); matches = []; };
    const showSuggest = () => {
      closeSuggest();
      const text = input.value.trim().toLowerCase();
      if (this.mode !== 'server' || !text) return;
      matches = COMMAND_HINTS.filter(([cmd]) => cmd.startsWith(text) && cmd !== text).slice(0, 7);
      if (!matches.length) return;
      suggestIndex = 0;
      const box = el(`<div class="suggest">${matches.map(([cmd, desc], i) => `<div class="${i === 0 ? 'active' : ''}" data-i="${i}">${esc(cmd)}<span>${esc(desc)}</span></div>`).join('')}</div>`);
      wrap.appendChild(box);
      $$('[data-i]', box).forEach((row) => (row.onmousedown = (e) => { e.preventDefault(); pick(Number(row.dataset.i)); }));
    };
    // Put the suggestion into the box (without the <placeholders>)
    const pick = (i) => {
      input.value = matches[i][0].split(' <')[0].split(' [')[0] + ' ';
      closeSuggest();
      input.focus();
    };

    input.oninput = showSuggest;
    input.onblur = () => setTimeout(closeSuggest, 100);
    input.onkeydown = (e) => {
      // Tab = use the highlighted suggestion
      if (matches.length && e.key === 'Tab') {
        e.preventDefault();
        return pick(suggestIndex);
      }
      if (matches.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && $('.suggest', wrap)) {
        e.preventDefault();
        suggestIndex = (suggestIndex + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
        $$('.suggest div', wrap).forEach((d, i) => d.classList.toggle('active', i === suggestIndex));
        return;
      }
      if (e.key === 'Enter') { closeSuggest(); this.sendCommand(input.value); input.value = ''; return; }
      if (e.key === 'Escape') return closeSuggest();
      // History with arrow keys
      if (e.key === 'ArrowUp' && this.history.length) {
        e.preventDefault();
        this.historyIndex = Math.min(this.historyIndex + 1, this.history.length - 1);
        input.value = this.history[this.historyIndex];
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.historyIndex = Math.max(this.historyIndex - 1, -1);
        input.value = this.historyIndex >= 0 ? this.history[this.historyIndex] : '';
      }
    };
    $('[data-send]', this.root).onclick = () => { this.sendCommand(input.value); input.value = ''; input.focus(); };
  }
};

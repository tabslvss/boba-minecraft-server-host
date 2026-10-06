// ui.js

// Every page file adds itself to this object, e.g. Views.dashboard = {...}
window.Views = window.Views || {};
// Shared helpers used by every page: building HTML, toasts, popups, tooltips, setting rows.

// ---------- tiny DOM helpers ----------

// Find one element:  $('#id')  or  $('.class', insideThisElement)
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// Make an element from an HTML string:  el('<div class="card">Hi</div>')
function el(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

// Make text safe to put inside HTML (stops names like "<script>" from breaking the page)
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Call the backend. Shows a red toast if it fails, then re-throws.
async function call(channel, ...args) {
  try {
    return await window.api.invoke(channel, ...args);
  } catch (err) {
    if (!call.quiet) toast(cleanError(err), 'bad');
    throw err;
  }
}
// Same as call() but doesn't show a toast on error
async function quietCall(channel, ...args) {
  return window.api.invoke(channel, ...args);
}
function cleanError(err) {
  return String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

// ---------- formatting ----------

// 1536 -> "1.5 KB"
function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}
// 4096 (MB) -> "4 GB"
function formatMB(mb) {
  return mb >= 1024 ? `${+(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}
// 3725000 ms -> "1h 2m"
function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
// Timestamp -> "Oct 6, 9:41 PM"
function formatDate(ms) {
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
// 1234567 -> "1.2M"
function formatCount(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}
function timeAgo(ms) {
  const diff = Date.now() - ms;
  if (diff < 60000) return 'just now';
  return `${formatDuration(diff)} ago`;
}

// ---------- toasts (little popups in the corner) ----------
function toast(message, type = 'info', time = 3800) {
  const icons = { ok: 'checkCircle', bad: 'xCircle', info: 'info', warn: 'alert' };
  const node = el(`<div class="toast ${type}">${icon(icons[type])}<div>${esc(message)}</div></div>`);
  $('#toasts').appendChild(node);
  setTimeout(() => { node.classList.add('out'); setTimeout(() => node.remove(), 260); }, time);
}

// Copy text to the clipboard and say so
async function copyText(text, label = 'Copied!') {
  await navigator.clipboard.writeText(text);
  toast(label, 'ok', 2000);
}

// ---------- modals (popup windows) ----------

// Open a modal. contentHtml is the inside. Returns { node, close }.
function openModal(contentHtml, { wide = false, onClose } = {}) {
  const backdrop = el(`<div class="modal-backdrop"><div class="modal ${wide ? 'wide' : ''}">${contentHtml}</div></div>`);
  const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  $('#modal-root').appendChild(backdrop);
  return { node: backdrop.firstElementChild, close };
}

// Yes/No question. Resolves true if they click the main button.
function confirmBox(title, message, { okText = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const modal = openModal(`
      <h3>${esc(title)}</h3><p>${message}</p>
      <div class="modal-actions">
        <button class="btn ghost" data-no>Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(okText)}</button>
      </div>`, { onClose: () => !answered && resolve(false) });
    $('[data-yes]', modal.node).onclick = () => { answered = true; modal.close(); resolve(true); };
    $('[data-no]', modal.node).onclick = () => modal.close();
    $('[data-yes]', modal.node).focus();
  });
}

// Ask for some text. Resolves the text, or null if cancelled.
function promptBox(title, { label = '', value = '', placeholder = '', okText = 'OK', hint = '' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const modal = openModal(`
      <h3>${esc(title)}</h3>
      ${label ? `<p>${esc(label)}</p>` : ''}
      <input class="input" data-input value="${esc(value)}" placeholder="${esc(placeholder)}" />
      ${hint ? `<div class="small muted" style="margin-top:8px">${hint}</div>` : ''}
      <div class="modal-actions">
        <button class="btn ghost" data-no>Cancel</button>
        <button class="btn primary" data-yes>${esc(okText)}</button>
      </div>`, { onClose: () => !answered && resolve(null) });
    const input = $('[data-input]', modal.node);
    const submit = () => { answered = true; modal.close(); resolve(input.value.trim()); };
    $('[data-yes]', modal.node).onclick = submit;
    $('[data-no]', modal.node).onclick = () => modal.close();
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    input.focus();
    // Select the name part (not the extension) like Windows does
    const dot = value.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : value.length);
  });
}

// ---------- right-click menu ----------
// items: [{ label, icon, action, danger }, 'sep', ...]
function showContextMenu(x, y, items) {
  const menu = $('#context-menu');
  menu.innerHTML = '';
  for (const item of items) {
    if (item === 'sep') { menu.appendChild(el('<div class="cm-sep"></div>')); continue; }
    const row = el(`<div class="cm-item ${item.danger ? 'danger' : ''}">${icon(item.icon || 'chevronRight')}<span>${esc(item.label)}</span></div>`);
    row.onclick = () => { hideContextMenu(); item.action(); };
    menu.appendChild(row);
  }
  menu.classList.add('show');
  // Keep the menu on screen
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
}
function hideContextMenu() { $('#context-menu').classList.remove('show'); }
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#context-menu')) hideContextMenu(); });

// ---------- tooltips ----------
// Any element with data-tip="text" (and optional data-ex="example", data-tt="title") gets a nice tooltip.
(function setupTooltips() {
  let current = null;
  let timer = null;
  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest('[data-tip]');
    if (target === current) return;
    current = target;
    const tip = $('#tooltip');
    clearTimeout(timer);
    tip.classList.remove('show');
    if (!target) return;
    timer = setTimeout(() => {
      const title = target.dataset.tt ? `<div class="tt-title">${esc(target.dataset.tt)}</div>` : '';
      const example = target.dataset.ex ? `<div class="tt-ex">${esc(target.dataset.ex)}</div>` : '';
      tip.innerHTML = `${title}<div>${esc(target.dataset.tip)}</div>${example}`;
      const rect = target.getBoundingClientRect();
      const tipRect = tip.getBoundingClientRect();
      let left = rect.left + rect.width / 2 - tipRect.width / 2;
      let top = rect.bottom + 8;
      if (top + tipRect.height > window.innerHeight - 8) top = rect.top - tipRect.height - 8;
      left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
      tip.classList.add('show');
    }, 280);
  });
})();

// The little "?" bubble that shows a tooltip
function helpIcon(tip, example, title) {
  return `<span class="help" data-tip="${esc(tip)}"${example ? ` data-ex="${esc(example)}"` : ''}${title ? ` data-tt="${esc(title)}"` : ''}>?</span>`;
}

// ---------- setting rows ----------
// Builds one setting row. def = { key, label, desc, tip, ex, type, options, min, max, step, unit, placeholder }
function settingRow(def, value) {
  const id = `set-${def.key.replace(/[^a-z0-9]/gi, '-')}`;
  let control = '';
  switch (def.type) {
    case 'toggle':
      control = `<label class="toggle"><input type="checkbox" id="${id}" data-key="${esc(def.key)}" ${isTrue(value) ? 'checked' : ''}/><span></span></label>`;
      break;
    case 'select':
      control = `<select class="select" id="${id}" data-key="${esc(def.key)}">${def.options.map((o) => {
        const [val, text] = Array.isArray(o) ? o : [o, o];
        return `<option value="${esc(val)}" ${String(val) === String(value) ? 'selected' : ''}>${esc(text)}</option>`;
      }).join('')}</select>`;
      break;
    case 'number':
      control = `<input class="input" type="number" id="${id}" data-key="${esc(def.key)}" value="${esc(value)}" ${def.min != null ? `min="${def.min}"` : ''} ${def.max != null ? `max="${def.max}"` : ''} step="${def.step || 1}" placeholder="${esc(def.placeholder || '')}" style="max-width:140px"/>${def.unit ? `<span class="muted small">${esc(def.unit)}</span>` : ''}`;
      break;
    case 'range':
      control = `<input class="slider" type="range" id="${id}" data-key="${esc(def.key)}" value="${esc(value)}" min="${def.min}" max="${def.max}" step="${def.step || 1}" style="max-width:180px"/><b class="range-value mono" style="min-width:64px;text-align:right">${esc(def.format ? def.format(value) : value)}</b>`;
      break;
    case 'time':
      control = `<input class="input" type="time" id="${id}" data-key="${esc(def.key)}" value="${esc(value)}" style="max-width:140px"/>`;
      break;
    case 'password':
      control = `<input class="input" type="password" id="${id}" data-key="${esc(def.key)}" value="${esc(value)}" placeholder="${esc(def.placeholder || '')}"/>`;
      break;
    default:
      control = `<input class="input" type="text" id="${id}" data-key="${esc(def.key)}" value="${esc(value)}" placeholder="${esc(def.placeholder || '')}" spellcheck="false"/>`;
  }
  return `
    <div class="setting ${def.wide ? 'wide' : ''}" data-row="${esc(def.key)}">
      <div>
        <div class="setting-label">${esc(def.label)} ${helpIcon(def.tip, def.ex, def.label)}</div>
        ${def.desc ? `<div class="setting-desc">${esc(def.desc)}</div>` : ''}
        ${def.showKey ? `<div class="setting-key">${esc(def.key)}</div>` : ''}
      </div>
      <div class="setting-control">${control}</div>
      ${def.extra || ''}
    </div>`;
}

// "true" / true / "on" -> true
function isTrue(v) {
  return v === true || v === 'true' || v === 'on' || v === 1;
}

// Read the value of a setting input (checkbox -> true/false, number -> Number)
function readInput(input) {
  if (input.type === 'checkbox') return input.checked;
  if (input.type === 'number' || input.type === 'range') return input.value === '' ? '' : Number(input.value);
  return input.value;
}

// ---------- Minecraft text colors (for the MOTD preview) ----------
const MC_COLORS = {
  0: '#000000', 1: '#0000AA', 2: '#00AA00', 3: '#00AAAA', 4: '#AA0000', 5: '#AA00AA', 6: '#FFAA00', 7: '#AAAAAA',
  8: '#555555', 9: '#5555FF', a: '#55FF55', b: '#55FFFF', c: '#FF5555', d: '#FF55FF', e: '#FFFF55', f: '#FFFFFF'
};
// "§aHello §lWorld" -> colored HTML
function mcFormat(text) {
  let html = '';
  let style = { color: '#AAAAAA', bold: false, italic: false, underline: false, strike: false };
  const parts = String(text).replace(/\\n/g, '\n').split(/([§&][0-9a-fk-or])/i);
  for (const part of parts) {
    const code = part.match(/^[§&]([0-9a-fk-or])$/i);
    if (code) {
      const c = code[1].toLowerCase();
      if (MC_COLORS[c]) style = { color: MC_COLORS[c], bold: false, italic: false, underline: false, strike: false };
      else if (c === 'l') style.bold = true;
      else if (c === 'o') style.italic = true;
      else if (c === 'n') style.underline = true;
      else if (c === 'm') style.strike = true;
      else if (c === 'r') style = { color: '#AAAAAA', bold: false, italic: false, underline: false, strike: false };
      continue;
    }
    if (!part) continue;
    const deco = [style.underline && 'underline', style.strike && 'line-through'].filter(Boolean).join(' ');
    html += `<span style="color:${style.color};${style.bold ? 'font-weight:700;' : ''}${style.italic ? 'font-style:italic;' : ''}${deco ? `text-decoration:${deco};` : ''}">${esc(part).replace(/\n/g, '<br>')}</span>`;
  }
  return html;
}

// Remove terminal color codes + Minecraft § codes from a console line
function stripCodes(line) {
  return line.replace(/\x1b\[[0-9;]*m/g, '').replace(/§[0-9a-fk-or]/gi, '');
}

// Player head picture from mc-heads.net (falls back to Steve if offline)
function headUrl(name, size = 32) {
  return `https://mc-heads.net/avatar/${encodeURIComponent(name)}/${size}`;
}

// First letter avatar for a server (or its server-icon.png)
function serverAvatar(server, size = '') {
  // Use the server-icon.png if there is one, otherwise the server type's logo
  const img = server._icon ? `<img src="${server._icon}" alt=""/>` : icon(typeInfo(server.type).icon, 'avatar-ico');
  return `<div class="server-avatar ${size}" style="--c:${esc(server.color || '#a78bfa')}">${img}</div>`;
}

// Pretty name + icon for each server type
const TYPE_INFO = {
  vanilla:  { name: 'Vanilla',  icon: 'pickaxe',         color: '#6fd39a' },
  paper:    { name: 'Paper',    icon: 'loader-paper',    color: '#7c9cff' },
  purpur:   { name: 'Purpur',   icon: 'loader-purpur',   color: '#c18cff' },
  fabric:   { name: 'Fabric',   icon: 'loader-fabric',   color: '#e0c08a' },
  quilt:    { name: 'Quilt',    icon: 'loader-quilt',    color: '#c78bff' },
  forge:    { name: 'Forge',    icon: 'loader-forge',    color: '#ff9f6b' },
  neoforge: { name: 'NeoForge', icon: 'loader-neoforge', color: '#ff7a59' },
  modpack:  { name: 'Modpack',  icon: 'package',  color: '#ff8fc7' },
  custom:   { name: 'Custom',   icon: 'fileJar',  color: '#9aa0b4' }
};
function typeInfo(type) { return TYPE_INFO[type] || TYPE_INFO.custom; }

// If a web picture (player head, mod icon) fails to load (offline), show a soft placeholder instead
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName !== 'IMG' || img.dataset.fallback) return;
  img.dataset.fallback = '1';
  img.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#8a6a4f"/><rect y="0" width="8" height="2" fill="#3b2a1a"/><rect x="1" y="3" width="2" height="1" fill="#fff"/><rect x="5" y="3" width="2" height="1" fill="#fff"/><rect x="2" y="3" width="1" height="1" fill="#4a3bb0"/><rect x="5" y="3" width="1" height="1" fill="#4a3bb0"/><rect x="3" y="5" width="2" height="1" fill="#5a3a2a"/></svg>');
}, true);

// A Modrinth project card with its banner picture (from Modrinth's gallery) on top.
// p = a Modrinth search result. extraHtml = buttons etc. under the text.
function projectCard(p, { selected = false, clickable = false, extraHtml = '', author = false } = {}) {
  const banner = p.featured_gallery || (p.gallery && p.gallery[0]) || '';
  // No banner? Use the project's own color as a soft gradient instead
  const color = p.color ? '#' + p.color.toString(16).padStart(6, '0') : 'var(--accent)';
  const cover = banner
    ? `background-image:url('${esc(banner)}')`
    : `background:linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 30%, var(--panel)))`;
  return `
    <div class="proj banner ${clickable ? 'clickable' : ''} ${selected ? 'selected' : ''}" data-pid="${esc(p.project_id)}">
      <div class="cover" style="${cover}"></div>
      <div class="proj-inner">
        ${p.icon_url ? `<img class="pic" src="${esc(p.icon_url)}" alt="" loading="lazy"/>` : '<div class="ph"></div>'}
        <div class="proj-body" style="padding-top:26px">
          <div class="proj-title">${esc(p.title)}${author ? ` <span class="small muted" style="font-weight:400">by ${esc(p.author)}</span>` : ''}</div>
          <div class="proj-desc">${esc(p.description)}</div>
          <div class="proj-meta">
            <span>${icon('download')} ${formatCount(p.downloads)}</span>
            <span>${icon('heart')} ${formatCount(p.follows || 0)}</span>
            ${extraHtml}
          </div>
        </div>
      </div>
    </div>`;
}

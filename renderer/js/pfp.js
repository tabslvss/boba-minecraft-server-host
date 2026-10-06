// pfp.js
// Random server pictures ("PFPs") from free picture APIs on the internet:
//  - Minecraft mob & block heads from mc-heads.net (Mojang's official "MHF_" heads)
//  - Random avatars from DiceBear (api.dicebear.com) in lots of styles
// The chosen picture becomes the server's server-icon.png (shown in the multiplayer list).

// Official Minecraft "MHF_" heads: [name used by the API, nice label]
const MC_HEADS = [
  ['MHF_Steve', 'Steve'], ['MHF_Alex', 'Alex'], ['MHF_Creeper', 'Creeper'], ['MHF_Zombie', 'Zombie'],
  ['MHF_Skeleton', 'Skeleton'], ['MHF_WSkeleton', 'Wither Skeleton'], ['MHF_Spider', 'Spider'],
  ['MHF_CaveSpider', 'Cave Spider'], ['MHF_Enderman', 'Enderman'], ['MHF_Blaze', 'Blaze'], ['MHF_Ghast', 'Ghast'],
  ['MHF_Slime', 'Slime'], ['MHF_LavaSlime', 'Magma Cube'], ['MHF_Pig', 'Pig'], ['MHF_PigZombie', 'Zombie Piglin'],
  ['MHF_Cow', 'Cow'], ['MHF_MushroomCow', 'Mooshroom'], ['MHF_Sheep', 'Sheep'], ['MHF_Chicken', 'Chicken'],
  ['MHF_Squid', 'Squid'], ['MHF_Villager', 'Villager'], ['MHF_Golem', 'Iron Golem'], ['MHF_Ocelot', 'Ocelot'],
  ['MHF_Herobrine', 'Herobrine'], ['MHF_Cake', 'Cake'], ['MHF_Chest', 'Chest'], ['MHF_Melon', 'Melon'],
  ['MHF_TNT', 'TNT'], ['MHF_Pumpkin', 'Pumpkin'], ['MHF_Cactus', 'Cactus'], ['MHF_OakLog', 'Oak Log'],
  ['MHF_Present1', 'Present'], ['MHF_Present2', 'Gift'], ['MHF_Question', 'Question Block']
];

// Soft background colors for DiceBear pictures (looks nice in the server list)
const PFP_BACKGROUNDS = 'b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf,c1f4c5,fde68a';

// Picture "styles" the user can pick from. make(seed) returns a picture URL.
const PFP_SOURCES = {
  minecraft:  { label: 'Minecraft', icon: 'pickaxe', make: () => {
    const [id, name] = MC_HEADS[Math.floor(Math.random() * MC_HEADS.length)];
    return { url: `https://mc-heads.net/head/${id}/128`, label: name };
  } },
  pixel:      { label: 'Pixel art', icon: 'gamepad', make: (seed) => dicebear('pixel-art', seed) },
  robots:     { label: 'Robots', icon: 'cpu', make: (seed) => dicebear('bottts', seed) },
  emoji:      { label: 'Faces', icon: 'sparkles', make: (seed) => dicebear('fun-emoji', seed) },
  adventurer: { label: 'Characters', icon: 'user', make: (seed) => dicebear('adventurer', seed) },
  shapes:     { label: 'Shapes', icon: 'layers', make: (seed) => dicebear('shapes', seed) },
  glass:      { label: 'Glass', icon: 'eye', make: (seed) => dicebear('glass', seed) }
};

// Build a DiceBear avatar URL. The same seed always gives the same picture.
function dicebear(style, seed) {
  const url = `https://api.dicebear.com/9.x/${style}/png?seed=${encodeURIComponent(seed)}&size=128&backgroundColor=${PFP_BACKGROUNDS}&radius=18`;
  return { url, label: style };
}

// A random seed like "k3f9a2"
function randomSeed() {
  return Math.random().toString(36).slice(2, 8);
}

// One random picture from a style. For Minecraft we avoid repeating the current one.
function randomPicture(source = 'minecraft', avoidUrl = '') {
  for (let tries = 0; tries < 8; tries++) {
    const pic = PFP_SOURCES[source].make(randomSeed());
    if (pic.url !== avoidUrl) return { ...pic, source };
  }
  return { ...PFP_SOURCES[source].make(randomSeed()), source };
}

// Several DIFFERENT random pictures (for the picker grid)
function randomPictures(source, count) {
  if (source === 'minecraft') {
    // Shuffle the heads list and take the first few, so there are no duplicates
    const shuffled = MC_HEADS.slice().sort(() => Math.random() - 0.5).slice(0, count);
    return shuffled.map(([id, name]) => ({ url: `https://mc-heads.net/head/${id}/128`, label: name, source }));
  }
  return Array.from({ length: count }, () => ({ ...PFP_SOURCES[source].make(randomSeed()), source }));
}

// The big "Choose a picture" popup.
// current = the picture shown now. Resolves to {url} / {file} / null (cancelled).
function openPicturePicker(current, startSource = 'minecraft') {
  return new Promise((resolve) => {
    let source = (current && current.source && PFP_SOURCES[current.source]) ? current.source : startSource;
    let selected = current || null;
    let done = false;

    const modal = openModal(`
      <div class="row" style="margin-bottom:4px">
        <h3 style="margin:0">Choose a server picture</h3>
        <span class="spacer"></span>
        <button class="btn sm ghost icon" data-close>${icon('x')}</button>
      </div>
      <p class="small">Shown next to your server in the Minecraft multiplayer list. Keep pressing <b>Shuffle</b> until you love one!</p>
      <div class="pfp-sources" data-sources>${Object.entries(PFP_SOURCES).map(([id, s]) => `
        <button class="chip ${id === source ? 'active' : ''}" data-src="${id}">${icon(s.icon)}${s.label}</button>`).join('')}
      </div>
      <div class="pfp-grid" data-grid></div>
      <div class="modal-actions" style="justify-content:space-between">
        <div class="row">
          <button class="btn" data-shuffle>${icon('refresh')}Shuffle</button>
          <button class="btn ghost" data-upload>${icon('upload')}Upload my own</button>
        </div>
        <div class="row">
          <div class="pfp-preview sm" data-preview></div>
          <button class="btn primary" data-use>${icon('check')}Use this picture</button>
        </div>
      </div>`, { wide: true, onClose: () => !done && resolve(null) });

    const node = modal.node;
    const finish = (value) => { done = true; modal.close(); resolve(value); };

    // Draw the grid of 12 random pictures
    const drawGrid = () => {
      const pics = randomPictures(source, 12);
      $('[data-grid]', node).innerHTML = pics.map((p, i) => `
        <button class="pfp-cell ${selected && selected.url === p.url ? 'active' : ''}" data-i="${i}" title="${esc(p.label)}">
          <img src="${esc(p.url)}" alt="" loading="lazy" draggable="false"/>
        </button>`).join('');
      $$('[data-i]', node).forEach((cell) => {
        cell.onclick = () => { selected = pics[Number(cell.dataset.i)]; drawSelection(); };
        cell.ondblclick = () => { selected = pics[Number(cell.dataset.i)]; finish(selected); };
      });
    };
    // Highlight the chosen picture + show it in the small preview
    const drawSelection = () => {
      $$('.pfp-cell', node).forEach((c) => c.classList.toggle('active', !!selected && $('img', c).getAttribute('src') === selected.url));
      $('[data-preview]', node).innerHTML = selected ? `<img src="${esc(selected.url || selected.preview)}" alt=""/>` : '';
      $('[data-use]', node).disabled = !selected;
    };

    $$('[data-src]', node).forEach((b) => (b.onclick = () => {
      source = b.dataset.src;
      $$('[data-src]', node).forEach((x) => x.classList.toggle('active', x === b));
      drawGrid();
    }));
    $('[data-shuffle]', node).onclick = () => {
      // Spin the button icon for fun, then load new pictures
      const svg = $('[data-shuffle] svg', node);
      svg.classList.remove('spin-once'); void svg.offsetWidth; svg.classList.add('spin-once');
      drawGrid();
      drawSelection();
    };
    $('[data-upload]', node).onclick = async () => {
      const file = await call('dialog:openFile', [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]);
      if (file) finish({ file, preview: `file:///${file.replace(/\\/g, '/')}` });
    };
    $('[data-use]', node).onclick = () => selected && finish(selected);
    $('[data-close]', node).onclick = () => modal.close();

    drawGrid();
    drawSelection();
  });
}

// Turn any picture URL into a 64×64 PNG (what Minecraft wants) and save it as the server icon.
// The main process downloads it (so any website works), then we resize it on a canvas here.
async function saveServerPicture(serverId, picture) {
  if (!picture) return;
  if (picture.file) {
    await call('servers:setIcon', serverId, picture.file);
  } else if (picture.url) {
    const dataUrl = await call('net:imageData', picture.url);
    const png = await resizeToPng(dataUrl, 64);
    await call('servers:setIconData', serverId, png);
  }
  await App.reloadIcon(serverId);
}

// Draw an image onto a small canvas and export it as PNG
function resizeToPng(src, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      // "Cover" fit: fill the square without stretching
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('That picture could not be loaded.'));
    img.src = src;
  });
}

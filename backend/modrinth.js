// modrinth.js
// Search and install modpacks, mods and plugins from Modrinth (modrinth.com). Free, no account needed.

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { getJson, download } = require('./net');

const API = 'https://api.modrinth.com/v2';

// Search Modrinth.
// kind: 'modpack' | 'mod' | 'plugin'
// Example: search({ query: 'create', kind: 'mod', loader: 'forge', gameVersion: '1.20.1' })
async function search({ query = '', kind = 'modpack', loader, gameVersion, offset = 0, sort = 'relevance' }) {
  // "facets" are Modrinth's filters. Each inner list = OR, the outer list = AND.
  const facets = [[`project_type:${kind}`]];
  if (loader) facets.push(loaderCategories(loader, kind).map((c) => `categories:${c}`));
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  // Only show things that can run on a server
  if (kind !== 'plugin') facets.push(['server_side:required', 'server_side:optional']);

  const params = new URLSearchParams({
    query, limit: '24', offset: String(offset), index: sort, facets: JSON.stringify(facets)
  });
  return getJson(`${API}/search?${params}`);
}

// Which Modrinth "categories" match our server type
function loaderCategories(loader, kind) {
  if (kind === 'plugin') {
    // Paper and Purpur can run plugins made for Bukkit and Spigot too
    if (loader === 'purpur') return ['purpur', 'paper', 'spigot', 'bukkit'];
    return ['paper', 'spigot', 'bukkit'];
  }
  if (loader === 'quilt') return ['quilt', 'fabric'];  // Quilt can load most Fabric mods
  return [loader];
}

async function project(idOrSlug) {
  return getJson(`${API}/project/${idOrSlug}`);
}

// All versions of a project, optionally filtered
async function versions(idOrSlug, { loader, gameVersion, kind } = {}) {
  const params = new URLSearchParams();
  if (loader) params.set('loaders', JSON.stringify(loaderCategories(loader, kind || 'mod')));
  if (gameVersion) params.set('game_versions', JSON.stringify([gameVersion]));
  return getJson(`${API}/project/${idOrSlug}/version?${params}`);
}

// Install one mod/plugin into the right folder (mods/ or plugins/)
async function installContent(serverDir, folder, idOrSlug, { loader, gameVersion, kind, versionId }, onProgress) {
  let version;
  if (versionId) {
    version = await getJson(`${API}/version/${versionId}`);
  } else {
    const list = await versions(idOrSlug, { loader, gameVersion, kind });
    if (!list.length) throw new Error(`No version made for ${loader} ${gameVersion}.`);
    version = list.find((v) => v.version_type === 'release') || list[0];
  }
  const file = version.files.find((f) => f.primary) || version.files[0];
  const target = path.join(serverDir, folder, safeName(file.filename));
  await download(file.url, target, onProgress);

  // Also grab required dependencies (e.g. Fabric API) if they're missing
  const installed = [file.filename];
  for (const dep of version.dependencies || []) {
    if (dep.dependency_type !== 'required' || !dep.project_id) continue;
    try {
      const depList = await versions(dep.project_id, { loader, gameVersion, kind });
      const depVersion = depList.find((v) => v.version_type === 'release') || depList[0];
      if (!depVersion) continue;
      const depFile = depVersion.files.find((f) => f.primary) || depVersion.files[0];
      const depTarget = path.join(serverDir, folder, safeName(depFile.filename));
      if (!fs.existsSync(depTarget)) {
        await download(depFile.url, depTarget);
        installed.push(depFile.filename);
      }
    } catch (err) { /* optional extra: ignore if a dependency fails */ }
  }
  return installed;
}

// Remove anything sneaky from a file name like "../../evil.jar"
function safeName(name) {
  return path.basename(name).replace(/[<>:"|?*]/g, '_');
}

// Make sure a path from a modpack stays inside the server folder
function safeJoin(base, relative) {
  const full = path.resolve(base, relative);
  if (!full.startsWith(path.resolve(base) + path.sep)) throw new Error(`Unsafe path in modpack: ${relative}`);
  return full;
}

// Read a .mrpack file and tell us what Minecraft + loader it needs
function readPackInfo(mrpackFile) {
  const zip = new AdmZip(mrpackFile);
  const indexEntry = zip.getEntry('modrinth.index.json');
  if (!indexEntry) throw new Error('This is not a Modrinth modpack (.mrpack) file.');
  const index = JSON.parse(indexEntry.getData().toString('utf8'));
  const deps = index.dependencies || {};
  let type = 'vanilla';
  let loaderVersion = '';
  if (deps.neoforge)        { type = 'neoforge'; loaderVersion = deps.neoforge; }
  else if (deps.forge)      { type = 'forge'; loaderVersion = deps.forge; }
  else if (deps['quilt-loader'])  { type = 'quilt'; loaderVersion = deps['quilt-loader']; }
  else if (deps['fabric-loader']) { type = 'fabric'; loaderVersion = deps['fabric-loader']; }
  return { zip, index, mcVersion: deps.minecraft, type, loaderVersion, name: index.name };
}

// Install the files of a .mrpack into a server folder (the loader is installed separately)
async function installPackFiles(serverDir, pack, log, percent) {
  // 1) Download every file that the server needs
  const serverFiles = pack.index.files.filter((f) => !f.env || f.env.server !== 'unsupported');
  log(`Downloading ${serverFiles.length} mod files...`);
  let done = 0;
  // Download 6 at a time so it's fast but not overwhelming
  const queue = serverFiles.slice();
  const worker = async () => {
    while (queue.length) {
      const file = queue.shift();
      const target = safeJoin(serverDir, file.path);
      let ok = false;
      for (const url of file.downloads) {
        try { await download(url, target); ok = true; break; } catch (err) { /* try next mirror */ }
      }
      if (!ok) log(`Warning: could not download ${file.path}`);
      done++;
      percent(Math.round((done / serverFiles.length) * 100));
      if (done % 10 === 0 || done === serverFiles.length) log(`Downloaded ${done}/${serverFiles.length}`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  // 2) Copy the "overrides" (configs etc.), then "server-overrides" on top
  log('Copying modpack configs...');
  for (const prefix of ['overrides/', 'server-overrides/']) {
    for (const entry of pack.zip.getEntries()) {
      if (!entry.entryName.startsWith(prefix) || entry.isDirectory) continue;
      const relative = entry.entryName.slice(prefix.length);
      const target = safeJoin(serverDir, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.getData());
    }
  }
}

// Download a modpack version's .mrpack file
async function downloadPack(versionId, tempDir) {
  const version = await getJson(`${API}/version/${versionId}`);
  const file = version.files.find((f) => f.primary) || version.files[0];
  const target = path.join(tempDir, safeName(file.filename));
  await download(file.url, target);
  return target;
}

module.exports = { search, project, versions, installContent, readPackInfo, installPackFiles, downloadPack };

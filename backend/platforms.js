// platforms.js
// Knows how to list versions and install each server type:
// Vanilla, Paper, Purpur, Fabric, Quilt, Forge, NeoForge.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getJson, download } = require('./net');

// Info shown in the "Create server" screen
const PLATFORMS = {
  vanilla:  { name: 'Vanilla',  folder: null,      blurb: 'Pure Minecraft from Mojang. No mods or plugins.' },
  paper:    { name: 'Paper',    folder: 'plugins', blurb: 'Fast + supports Bukkit/Spigot plugins. Best for most servers.' },
  purpur:   { name: 'Purpur',   folder: 'plugins', blurb: 'Paper with extra fun settings. Also runs Bukkit plugins.' },
  fabric:   { name: 'Fabric',   folder: 'mods',    blurb: 'Lightweight mod loader. Great for performance mods.' },
  quilt:    { name: 'Quilt',    folder: 'mods',    blurb: 'Fabric-compatible mod loader.' },
  forge:    { name: 'Forge',    folder: 'mods',    blurb: 'The classic mod loader for big mods and modpacks.' },
  neoforge: { name: 'NeoForge', folder: 'mods',    blurb: 'Modern Forge fork used by most new modpacks.' }
};

// Remember API answers for a few minutes so the UI feels fast
const cache = new Map();
async function cachedJson(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.time < 10 * 60 * 1000) return hit.data;
  const data = await getJson(url);
  cache.set(url, { time: Date.now(), data });
  return data;
}

// ---------- Vanilla (Mojang) ----------
const MOJANG_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

async function vanillaManifest() {
  return cachedJson(MOJANG_MANIFEST);
}

// Returns [{ id: '1.21.4', type: 'release' }, ...] newest first
async function vanillaVersions(includeSnapshots) {
  const manifest = await vanillaManifest();
  return manifest.versions
    .filter((v) => v.type === 'release' || (includeSnapshots && v.type === 'snapshot'))
    .map((v) => ({ id: v.id, type: v.type }));
}

// Gets Mojang's detailed info for one version (download link + needed Java)
async function vanillaVersionInfo(mcVersion) {
  const manifest = await vanillaManifest();
  const entry = manifest.versions.find((v) => v.id === mcVersion);
  if (!entry) throw new Error(`Minecraft ${mcVersion} was not found`);
  return cachedJson(entry.url);
}

// Which Java does this Minecraft version need? (8, 17, 21, 25...)
async function requiredJava(mcVersion) {
  try {
    const info = await vanillaVersionInfo(mcVersion);
    if (info.javaVersion && info.javaVersion.majorVersion) return info.javaVersion.majorVersion;
  } catch (err) { /* offline -> use the guess below */ }
  return guessJava(mcVersion);
}

// Offline guess based on the version number
function guessJava(mcVersion) {
  const parts = String(mcVersion).split('.').map((n) => parseInt(n, 10) || 0);
  if (parts[0] >= 25) return 25;                  // new year-based versions (26.1, ...)
  const minor = parts[1] || 0;                    // the "20" in 1.20.4
  const patch = parts[2] || 0;                    // the "4"  in 1.20.4
  if (minor > 20 || (minor === 20 && patch >= 5)) return 21;
  if (minor >= 18) return 17;
  if (minor === 17) return 16;
  return 8;
}

// ---------- Paper (PaperMC "Fill" API v3, with the old v2 API as backup) ----------
async function paperVersions(project = 'paper') {
  try {
    const data = await cachedJson(`https://fill.papermc.io/v3/projects/${project}`);
    // data.versions looks like { "1.21": ["1.21.4", "1.21.3"], "1.20": [...] }
    const list = Object.values(data.versions).flat();
    return sortVersionsDesc(list).map((id) => ({ id, type: 'release' }));
  } catch (err) {
    const data = await cachedJson(`https://api.papermc.io/v2/projects/${project}`);
    return data.versions.slice().reverse().map((id) => ({ id, type: 'release' }));
  }
}

async function paperDownloadUrl(mcVersion, project = 'paper') {
  try {
    const builds = await getJson(`https://fill.papermc.io/v3/projects/${project}/versions/${mcVersion}/builds`);
    // Prefer a STABLE build, otherwise take the newest one
    const list = (Array.isArray(builds) ? builds : builds.builds || []).slice().sort((a, b) => b.id - a.id); // newest first
    const best = list.find((b) => b.channel === 'STABLE') || list[0];
    const file = best.downloads['server:default'] || Object.values(best.downloads)[0];
    return file.url;
  } catch (err) {
    const data = await getJson(`https://api.papermc.io/v2/projects/${project}/versions/${mcVersion}/builds`);
    const build = data.builds[data.builds.length - 1];
    const name = build.downloads.application.name;
    return `https://api.papermc.io/v2/projects/${project}/versions/${mcVersion}/builds/${build.build}/downloads/${name}`;
  }
}

// ---------- Purpur ----------
async function purpurVersions() {
  const data = await cachedJson('https://api.purpurmc.org/v2/purpur');
  return data.versions.slice().reverse().map((id) => ({ id, type: 'release' }));
}

// ---------- Fabric ----------
async function fabricVersions(includeSnapshots) {
  const games = await cachedJson('https://meta.fabricmc.net/v2/versions/game');
  return games
    .filter((g) => g.stable || includeSnapshots)
    .map((g) => ({ id: g.version, type: g.stable ? 'release' : 'snapshot' }));
}

async function fabricLatest(kind) {
  // kind = 'loader' or 'installer'; we pick the newest stable one
  const list = await cachedJson(`https://meta.fabricmc.net/v2/versions/${kind}`);
  return (list.find((x) => x.stable) || list[0]).version;
}

// ---------- Quilt ----------
async function quiltVersions(includeSnapshots) {
  const games = await cachedJson('https://meta.quiltmc.org/v3/versions/game');
  return games
    .filter((g) => g.stable || includeSnapshots)
    .map((g) => ({ id: g.version, type: g.stable ? 'release' : 'snapshot' }));
}

// ---------- Forge ----------
async function forgePromos() {
  return cachedJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
}

async function forgeVersions() {
  const data = await forgePromos();
  // keys look like "1.20.1-recommended" / "1.20.1-latest"
  const mcVersions = new Set(Object.keys(data.promos).map((key) => key.split('-')[0]));
  return sortVersionsDesc([...mcVersions]).map((id) => ({ id, type: 'release' }));
}

async function forgeBuildFor(mcVersion, wanted) {
  if (wanted) return wanted;
  const data = await forgePromos();
  return data.promos[`${mcVersion}-recommended`] || data.promos[`${mcVersion}-latest`];
}

// ---------- NeoForge ----------
async function neoforgeAll() {
  const data = await cachedJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
  return data.versions || [];
}

// NeoForge "21.1.77" -> Minecraft "1.21.1",  "20.4.200" -> "1.20.4",  "21.0.5" -> "1.21"
// Newer year-based ones like "26.1.0.3" -> "26.1"
function neoforgeToMinecraft(neo) {
  const parts = neo.split(/[.-]/);
  const major = parseInt(parts[0], 10);
  if (major >= 25) {
    return parts[2] && parts[2] !== '0' ? `${parts[0]}.${parts[1]}.${parts[2]}` : `${parts[0]}.${parts[1]}`;
  }
  return parts[1] === '0' ? `1.${parts[0]}` : `1.${parts[0]}.${parts[1]}`;
}

async function neoforgeVersions(includeSnapshots) {
  const all = await neoforgeAll();
  const mc = new Set();
  for (const v of all) {
    if (!includeSnapshots && /beta|alpha/i.test(v)) continue;
    mc.add(neoforgeToMinecraft(v));
  }
  return sortVersionsDesc([...mc]).map((id) => ({ id, type: 'release' }));
}

async function neoforgeBuildFor(mcVersion, wanted) {
  if (wanted) return wanted;
  const all = await neoforgeAll();
  const matches = all.filter((v) => neoforgeToMinecraft(v) === mcVersion);
  const stable = matches.filter((v) => !/beta|alpha/i.test(v));
  const pick = (stable.length ? stable : matches);
  if (!pick.length) throw new Error(`No NeoForge build found for Minecraft ${mcVersion}`);
  return pick[pick.length - 1]; // the maven list is oldest -> newest
}

// ---------- helpers ----------

// Sort version strings newest first: ["1.9", "1.20.1"] -> ["1.20.1", "1.9"]
function sortVersionsDesc(list) {
  const toNums = (v) => v.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  return list.slice().sort((a, b) => {
    const x = toNums(a);
    const y = toNums(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const diff = (y[i] || 0) - (x[i] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  });
}

// List versions for any platform (what the version dropdown shows)
async function listVersions(type, includeSnapshots) {
  let list;
  switch (type) {
    case 'vanilla':  list = await vanillaVersions(includeSnapshots); break;
    case 'paper':    list = await paperVersions('paper'); break;
    case 'purpur':   list = await purpurVersions(); break;
    case 'fabric':   list = await fabricVersions(includeSnapshots); break;
    case 'quilt':    list = await quiltVersions(includeSnapshots); break;
    case 'forge':    list = await forgeVersions(); break;
    case 'neoforge': list = await neoforgeVersions(includeSnapshots); break;
    default: throw new Error(`Unknown server type: ${type}`);
  }
  // Mark test builds like "1.21.5-rc1", "26.3-pre-2" or "25w14a" as snapshots
  const testBuild = /-(pre|rc|beta|alpha|snapshot)|\d+w\d+[a-z]/i;
  list = list.map((v) => (testBuild.test(v.id) ? { ...v, type: 'snapshot' } : v));
  // Hide them unless the user ticked "Show snapshots"
  return includeSnapshots ? list : list.filter((v) => v.type === 'release');
}

// Run a Java program (used for the Forge / NeoForge / Quilt installers)
function runJava(javaPath, args, cwd, log) {
  return new Promise((resolve, reject) => {
    const child = spawn(javaPath, args, { cwd, windowsHide: true });
    // Send each line of installer output to the progress log
    const onData = (chunk) => chunk.toString().split(/\r?\n/).forEach((line) => line.trim() && log(line));
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Installer exited with code ${code}`))));
  });
}

// Install a server of the given type into serverDir.
// opts: { type, mcVersion, loaderVersion?, javaPath, log(text), progress(percent) }
async function installServer(serverDir, opts) {
  const { type, mcVersion, javaPath, log, progress } = opts;
  fs.mkdirSync(serverDir, { recursive: true });
  const jarPath = path.join(serverDir, 'server.jar');
  const onProgress = (percent) => progress && progress(percent);

  if (type === 'vanilla') {
    log(`Getting Minecraft ${mcVersion} from Mojang...`);
    const info = await vanillaVersionInfo(mcVersion);
    if (!info.downloads || !info.downloads.server) throw new Error('This version has no official server download.');
    await download(info.downloads.server.url, jarPath, onProgress);
    return { launch: { kind: 'jar', jar: 'server.jar' } };
  }

  if (type === 'paper') {
    log(`Finding the newest Paper build for ${mcVersion}...`);
    const url = await paperDownloadUrl(mcVersion, 'paper');
    await download(url, jarPath, onProgress);
    return { launch: { kind: 'jar', jar: 'server.jar' } };
  }

  if (type === 'purpur') {
    log(`Downloading Purpur ${mcVersion}...`);
    await download(`https://api.purpurmc.org/v2/purpur/${mcVersion}/latest/download`, jarPath, onProgress);
    return { launch: { kind: 'jar', jar: 'server.jar' } };
  }

  if (type === 'fabric') {
    const loader = opts.loaderVersion || (await fabricLatest('loader'));
    const installer = await fabricLatest('installer');
    log(`Downloading Fabric loader ${loader} for ${mcVersion}...`);
    const url = `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${loader}/${installer}/server/jar`;
    await download(url, jarPath, onProgress);
    return { launch: { kind: 'jar', jar: 'server.jar' }, loaderVersion: loader };
  }

  if (type === 'quilt') {
    const installers = await cachedJson('https://meta.quiltmc.org/v3/versions/installer');
    const installerVersion = installers[0].version;
    const installerJar = path.join(serverDir, 'quilt-installer.jar');
    log(`Downloading Quilt installer ${installerVersion}...`);
    await download(
      `https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/${installerVersion}/quilt-installer-${installerVersion}.jar`,
      installerJar, onProgress
    );
    log('Running the Quilt installer (this can take a minute)...');
    const args = ['-jar', installerJar, 'install', 'server', mcVersion];
    if (opts.loaderVersion) args.push(opts.loaderVersion);
    args.push('--download-server', `--install-dir=${serverDir}`);
    await runJava(javaPath, args, serverDir, log);
    safeDelete(installerJar);
    return { launch: { kind: 'jar', jar: 'quilt-server-launch.jar' } };
  }

  if (type === 'forge') {
    const build = await forgeBuildFor(mcVersion, opts.loaderVersion);
    if (!build) throw new Error(`No Forge build found for Minecraft ${mcVersion}`);
    const full = `${mcVersion}-${build}`;
    const installerJar = path.join(serverDir, 'forge-installer.jar');
    log(`Downloading Forge ${full} installer...`);
    await download(
      `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`,
      installerJar, onProgress
    );
    log('Running the Forge installer (this downloads libraries, 1-3 minutes)...');
    await runJava(javaPath, ['-jar', installerJar, '--installServer'], serverDir, log);
    safeDelete(installerJar);
    safeDelete(installerJar + '.log');
    return { launch: { kind: 'auto' }, loaderVersion: build };
  }

  if (type === 'neoforge') {
    const build = await neoforgeBuildFor(mcVersion, opts.loaderVersion);
    const installerJar = path.join(serverDir, 'neoforge-installer.jar');
    log(`Downloading NeoForge ${build} installer...`);
    await download(
      `https://maven.neoforged.net/releases/net/neoforged/neoforge/${build}/neoforge-${build}-installer.jar`,
      installerJar, onProgress
    );
    log('Running the NeoForge installer (this downloads libraries, 1-3 minutes)...');
    await runJava(javaPath, ['-jar', installerJar, '--installServer'], serverDir, log);
    safeDelete(installerJar);
    safeDelete(installerJar + '.log');
    return { launch: { kind: 'auto' }, loaderVersion: build };
  }

  throw new Error(`Unknown server type: ${type}`);
}

function safeDelete(file) {
  try { fs.unlinkSync(file); } catch (err) { /* already gone */ }
}

// Work out HOW to start the server (which jar, or which Forge args file).
// Returns an array of Java arguments that go after the memory flags.
function findLaunchArgs(serverDir, meta) {
  const isWindows = process.platform === 'win32';
  const argsName = isWindows ? 'win_args.txt' : 'unix_args.txt';

  // 1) A jar the user picked by hand always wins
  if (meta.launch && meta.launch.kind === 'jar' && fs.existsSync(path.join(serverDir, meta.launch.jar))) {
    return ['-jar', meta.launch.jar];
  }

  // 2) Modern Forge / NeoForge: libraries/net/<group>/<name>/<version>/win_args.txt
  const groups = [['neoforged', 'neoforge'], ['neoforged', 'forge'], ['minecraftforge', 'forge']];
  for (const [group, name] of groups) {
    const base = path.join(serverDir, 'libraries', 'net', group, name);
    if (!fs.existsSync(base)) continue;
    for (const version of fs.readdirSync(base)) {
      const argsFile = path.join(base, version, argsName);
      if (fs.existsSync(argsFile)) {
        // Java reads extra arguments from a file when you write @path
        const relative = path.relative(serverDir, argsFile).split(path.sep).join('/');
        return [`@${relative}`];
      }
    }
  }

  // 3) Look for a likely server jar in the folder
  const jars = fs.readdirSync(serverDir).filter((f) => f.endsWith('.jar') && !/installer/i.test(f));
  const preferred =
    jars.find((f) => /shim/i.test(f)) ||
    jars.find((f) => /^(forge|neoforge).*\.jar$/i.test(f)) ||
    jars.find((f) => /quilt-server-launch/i.test(f)) ||
    jars.find((f) => /fabric-server-launch/i.test(f)) ||
    jars.find((f) => f === 'server.jar') ||
    jars[0];
  if (preferred) return ['-jar', preferred];

  throw new Error('No server jar found. Open Settings > Advanced and pick a jar, or reinstall the server.');
}

module.exports = {
  PLATFORMS, listVersions, installServer, findLaunchArgs,
  requiredJava, guessJava, sortVersionsDesc, neoforgeToMinecraft
};

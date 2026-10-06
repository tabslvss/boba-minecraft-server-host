// java.js
// Finds or downloads the right Java for each Minecraft version.
// You never have to install Java yourself: we grab a free copy from Adoptium (Eclipse Temurin).

const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const AdmZip = require('adm-zip');
const { RUNTIME_DIR, ensureDir } = require('./store');
const { download } = require('./net');

const isWindows = process.platform === 'win32';
const javaExe = isWindows ? 'java.exe' : 'java';

// Adoptium names for this computer's OS + CPU
function adoptiumOs() {
  if (isWindows) return 'windows';
  if (process.platform === 'darwin') return 'mac';
  return 'linux';
}
function adoptiumArch() {
  return process.arch === 'arm64' ? 'aarch64' : 'x64';
}

// Java 16 isn't offered as a small JRE anymore; 17 runs those versions fine
function normalizeMajor(major) {
  return major === 16 ? 17 : major;
}

// Search a folder (a few levels deep) for bin/java(.exe)
function findJavaBinary(folder, depth = 0) {
  const direct = path.join(folder, 'bin', javaExe);
  if (fs.existsSync(direct)) return direct;
  if (depth > 3 || !fs.existsSync(folder)) return null;
  for (const name of fs.readdirSync(folder)) {
    const child = path.join(folder, name);
    if (fs.statSync(child).isDirectory()) {
      const found = findJavaBinary(child, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

// Java versions we already downloaded: [{ major: 21, path: '...java.exe' }]
function listManaged() {
  ensureDir(RUNTIME_DIR);
  const result = [];
  for (const name of fs.readdirSync(RUNTIME_DIR)) {
    const match = name.match(/^java-(\d+)$/);
    if (!match) continue;
    const binary = findJavaBinary(path.join(RUNTIME_DIR, name));
    if (binary) result.push({ major: Number(match[1]), path: binary, source: 'Boba (auto)' });
  }
  return result.sort((a, b) => b.major - a.major);
}

// Ask a java binary what version it is. Returns e.g. 21, or null if it doesn't work.
function probeJava(binary) {
  return new Promise((resolve) => {
    execFile(binary, ['-version'], { windowsHide: true, timeout: 8000 }, (err, stdout, stderr) => {
      if (err) return resolve(null);
      // Output looks like: openjdk version "21.0.3" ...   or   java version "1.8.0_401"
      const match = String(stderr || stdout).match(/version "(\d+)(?:\.(\d+))?/);
      if (!match) return resolve(null);
      const first = Number(match[1]);
      resolve(first === 1 ? Number(match[2]) : first); // "1.8" means Java 8
    });
  });
}

// Everything we can use: our downloaded Javas + the one on your PATH (if any)
async function listAll() {
  const list = listManaged();
  const systemMajor = await probeJava('java');
  if (systemMajor) list.push({ major: systemMajor, path: 'java', source: 'System' });
  return list;
}

// Make sure we have Java <major>. Downloads it if missing. Returns the path to java(.exe).
async function ensureJava(major, log = () => {}, progress = () => {}) {
  major = normalizeMajor(major);
  const existing = listManaged().find((j) => j.major === major);
  if (existing) return existing.path;

  const target = ensureDir(path.join(RUNTIME_DIR, `java-${major}`));
  const ext = isWindows ? 'zip' : 'tar.gz';
  const archive = path.join(RUNTIME_DIR, `java-${major}.${ext}`);

  // Try the small "JRE" first, fall back to the full "JDK" if Adoptium doesn't have one
  let downloaded = false;
  for (const imageType of ['jre', 'jdk']) {
    const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/${adoptiumOs()}/${adoptiumArch()}/${imageType}/hotspot/normal/eclipse`;
    try {
      log(`Downloading Java ${major} (${imageType.toUpperCase()}) from Adoptium...`);
      await download(url, archive, progress);
      downloaded = true;
      break;
    } catch (err) {
      log(`Java ${major} ${imageType} not available, trying another option...`);
    }
  }
  if (!downloaded) throw new Error(`Could not download Java ${major}. Check your internet connection.`);

  log(`Unpacking Java ${major}...`);
  if (isWindows) {
    new AdmZip(archive).extractAllTo(target, true);
  } else {
    await new Promise((resolve, reject) => {
      const tar = spawn('tar', ['-xzf', archive, '-C', target]);
      tar.on('close', (code) => (code === 0 ? resolve() : reject(new Error('tar failed'))));
    });
  }
  fs.unlinkSync(archive);

  const binary = findJavaBinary(target);
  if (!binary) throw new Error(`Java ${major} unpacked but java was not found inside.`);
  if (!isWindows) fs.chmodSync(binary, 0o755);
  log(`Java ${major} is ready.`);
  return binary;
}

module.exports = { listManaged, listAll, ensureJava, probeJava, normalizeMajor };

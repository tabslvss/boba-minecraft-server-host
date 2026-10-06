// files.js
// The built-in file explorer. Every path is checked so you can only touch files
// INSIDE the server's folder (nothing else on your PC).

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const TEXT_EXTENSIONS = new Set([
  '.txt', '.properties', '.json', '.json5', '.yml', '.yaml', '.toml', '.cfg', '.conf', '.ini',
  '.log', '.md', '.sh', '.bat', '.cmd', '.mcmeta', '.mcfunction', '.js', '.csv', '.xml', '.snbt', '.secret'
]);
const MAX_EDIT_SIZE = 3 * 1024 * 1024; // 3 MB: bigger files are not opened in the editor

// Join root + relative path, and refuse anything that tries to escape (like "..\..\Windows")
function resolveInside(root, relative = '') {
  const rootFull = path.resolve(root);
  const full = path.resolve(rootFull, relative);
  if (full !== rootFull && !full.startsWith(rootFull + path.sep)) {
    throw new Error('That path is outside the server folder.');
  }
  return full;
}

// List a folder: folders first, then files, A-Z
function list(root, relative) {
  const dir = resolveInside(root, relative);
  const entries = fs.readdirSync(dir, { withFileTypes: true }).map((entry) => {
    const full = path.join(dir, entry.name);
    let stat = null;
    try { stat = fs.statSync(full); } catch (err) { /* locked file */ }
    const ext = path.extname(entry.name).toLowerCase();
    return {
      name: entry.name,
      isDir: entry.isDirectory(),
      size: stat ? stat.size : 0,
      modified: stat ? stat.mtimeMs : 0,
      ext,
      editable: !entry.isDirectory() && (TEXT_EXTENSIONS.has(ext) || entry.name.startsWith('.')) && stat && stat.size <= MAX_EDIT_SIZE
    };
  });
  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  return entries;
}

function readText(root, relative) {
  const file = resolveInside(root, relative);
  if (fs.statSync(file).size > MAX_EDIT_SIZE) throw new Error('File is too big to edit here (max 3 MB).');
  return fs.readFileSync(file, 'utf8');
}

function writeText(root, relative, content) {
  fs.writeFileSync(resolveInside(root, relative), content, 'utf8');
}

function createFolder(root, relative) {
  fs.mkdirSync(resolveInside(root, relative), { recursive: true });
}

function createFile(root, relative) {
  const file = resolveInside(root, relative);
  if (fs.existsSync(file)) throw new Error('A file with that name already exists.');
  fs.writeFileSync(file, '');
}

function rename(root, fromRelative, toRelative) {
  const from = resolveInside(root, fromRelative);
  const to = resolveInside(root, toRelative);
  if (fs.existsSync(to)) throw new Error('Something with that name already exists.');
  fs.renameSync(from, to);
}

// Copy files from anywhere on the PC (drag & drop / upload button) INTO a server folder
function importFiles(root, relativeDir, sourcePaths) {
  const dir = resolveInside(root, relativeDir);
  const copied = [];
  for (const source of sourcePaths) {
    const target = path.join(dir, path.basename(source));
    fs.cpSync(source, target, { recursive: true });
    copied.push(path.basename(source));
  }
  return copied;
}

// Unzip a .zip that's inside the server folder (into a folder with the same name)
function extract(root, relative) {
  const file = resolveInside(root, relative);
  const target = file.replace(/\.zip$/i, '');
  const zip = new AdmZip(file);
  // Check every entry stays inside the target folder
  for (const entry of zip.getEntries()) resolveInside(target, entry.entryName);
  zip.extractAllTo(target, true);
  return path.relative(path.resolve(root), target);
}

// Zip a file or folder that's inside the server folder
function compress(root, relative) {
  const full = resolveInside(root, relative);
  const zip = new AdmZip();
  if (fs.statSync(full).isDirectory()) zip.addLocalFolder(full, path.basename(full));
  else zip.addLocalFile(full);
  let target = full + '.zip';
  let n = 2;
  while (fs.existsSync(target)) target = `${full} (${n++}).zip`;
  zip.writeZip(target);
  return path.basename(target);
}

module.exports = { resolveInside, list, readText, writeText, createFolder, createFile, rename, importFiles, extract, compress };

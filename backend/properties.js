// properties.js
// Reads and writes Minecraft's server.properties file (lines like "max-players=20").

const fs = require('fs');

// Turn the file text into an object: { 'max-players': '20', motd: 'Hello' }
function parseProperties(text) {
  const result = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue; // skip comments/blank lines
    const equalsAt = line.indexOf('=');
    if (equalsAt === -1) continue;
    const key = line.slice(0, equalsAt).trim();
    const value = line.slice(equalsAt + 1).trim();
    result[key] = unescapeValue(value);
  }
  return result;
}

// Minecraft escapes some characters, e.g. "§" for color codes and "\:" for colons
function unescapeValue(value) {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\(.)/g, '$1');
}

function escapeValue(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/[^\x20-\x7E]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

// Read server.properties (empty object if it doesn't exist yet)
function readProperties(file) {
  if (!fs.existsSync(file)) return {};
  return parseProperties(fs.readFileSync(file, 'utf8'));
}

// Update some keys but keep every other line (and comments) exactly as they were
function writeProperties(file, changes) {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : ['#Minecraft server properties'];
  const remaining = { ...changes };

  const updated = lines.map((line) => {
    const equalsAt = line.indexOf('=');
    if (line.trim().startsWith('#') || equalsAt === -1) return line;
    const key = line.slice(0, equalsAt).trim();
    if (key in remaining) {
      const newLine = `${key}=${escapeValue(remaining[key])}`;
      delete remaining[key];          // mark as handled
      return newLine;
    }
    return line;
  });

  // Remove empty lines at the end, then add any keys that weren't in the file yet
  while (updated.length && updated[updated.length - 1] === '') updated.pop();
  for (const [key, value] of Object.entries(remaining)) {
    updated.push(`${key}=${escapeValue(value)}`);
  }
  // End the file with exactly one newline
  fs.writeFileSync(file, updated.join('\n') + '\n');
}

module.exports = { parseProperties, readProperties, writeProperties };

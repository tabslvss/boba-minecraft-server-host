// store.js
// Keeps track of WHERE things live on disk and saves/loads the app's settings.
// Everything is stored next to the app (so it all stays inside your D:\MinecraftServerMaker folder).

const fs = require('fs');                 // Node's file system tools
const path = require('path');             // Helps build file paths safely (\ vs /)

// The folder this app lives in (one level up from /backend)
const APP_ROOT = path.join(__dirname, '..');

// Sub folders we use
const DATA_DIR = path.join(APP_ROOT, 'data');        // app settings + tunnel secret
const RUNTIME_DIR = path.join(APP_ROOT, 'runtime');  // auto-downloaded Java versions
const TOOLS_DIR = path.join(APP_ROOT, 'tools');      // playit.gg tunnel program
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// Default app settings (used the first time the app runs)
const DEFAULT_CONFIG = {
  serversDir: path.join(APP_ROOT, 'servers'),  // where each server's folder is created
  theme: 'dark',                                // 'dark' or 'light'
  accent: 'taro',                               // color theme name
  startWithWindows: false,                      // open the app when the PC boots
  startMinimized: false,                        // open hidden in the tray
  closeToTray: true,                            // X button hides instead of quitting
  autoStartServerId: null,                      // server to start automatically on launch
  tunnel: {
    autoStart: true,          // start the playit tunnel when the app opens
    address: '',              // the permanent public address (e.g. cool-name.joinmc.link)
    claimed: false            // true after you linked playit once
  },
  lastServerId: null          // which server was open last time
};

// Make sure a folder exists (creates it and any parents)
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Read the app config, filling in any missing keys with defaults
function loadConfig() {
  ensureDir(DATA_DIR);
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (err) {
    saved = {}; // first run or broken file -> just use defaults
  }
  // Merge defaults + saved (tunnel is nested, so merge it separately)
  const config = { ...DEFAULT_CONFIG, ...saved };
  config.tunnel = { ...DEFAULT_CONFIG.tunnel, ...(saved.tunnel || {}) };
  ensureDir(config.serversDir);
  return config;
}

// Save the app config to disk
function saveConfig(config) {
  ensureDir(DATA_DIR);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Read a JSON file, or return a fallback value if it is missing / broken
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return fallback;
  }
}

// Write a JSON file nicely formatted
function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

module.exports = {
  APP_ROOT, DATA_DIR, RUNTIME_DIR, TOOLS_DIR,
  ensureDir, loadConfig, saveConfig, readJson, writeJson
};

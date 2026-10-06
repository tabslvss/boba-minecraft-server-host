// tunnel.js
// "No port forwarding" magic: runs the free playit.gg tunnel program.
// Friends connect to an address like  cool-name.joinmc.link  and playit sends them to your PC.
// The address is picked randomly by playit ONCE, then it stays the same every time you boot.

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const { TOOLS_DIR, DATA_DIR, ensureDir } = require('./store');
const { download } = require('./net');

const isWindows = process.platform === 'win32';
const AGENT_FILE = path.join(TOOLS_DIR, isWindows ? 'playit.exe' : 'playit');
const SECRET_FILE = path.join(DATA_DIR, 'playit-secret.toml');   // your private link to playit (keep it secret!)

// Where to download the agent for this computer
function agentUrl() {
  const base = 'https://github.com/playit-cloud/playit-agent/releases/latest/download/';
  if (isWindows) return base + 'playit-windows-x86_64-signed.exe';
  if (process.arch === 'arm64') return base + 'playit-linux-aarch64';
  return base + 'playit-linux-amd64';
}

// Finds addresses like "abc-def.gl.joinmc.link" or "something.ply.gg:12345" in text
const ADDRESS_PATTERN = /([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:joinmc\.link|ply\.gg))(:\d{2,5})?/i;
const CLAIM_PATTERN = /https:\/\/playit\.gg\/(?:claim|mc)\/[A-Za-z0-9_-]+/i;

class Tunnel extends EventEmitter {
  constructor(getConfig, saveConfig) {
    super();
    this.getConfig = getConfig;
    this.saveConfig = saveConfig;
    this.child = null;
    this.state = 'stopped';      // stopped | downloading | needs-claim | starting | running | error
    this.claimUrl = '';
    this.log = [];
    this.wantRunning = false;
  }

  info() {
    const config = this.getConfig();
    return {
      state: this.state,
      claimUrl: this.claimUrl,
      address: config.tunnel.address,
      installed: fs.existsSync(AGENT_FILE),
      // Linked = we have the secret file, or the tunnel is running with an address
      linked: fs.existsSync(SECRET_FILE) || (this.state === 'running' && !!config.tunnel.address),
      log: this.log.slice(-200)
    };
  }

  setState(state, extra = {}) {
    this.state = state;
    Object.assign(this, extra);
    this.emit('update', this.info());
  }

  addLog(line) {
    const clean = line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim();   // strip terminal colors
    if (!clean) return;
    this.log.push(clean);
    if (this.log.length > 500) this.log.shift();
    this.scan(clean);
    this.emit('update', this.info());
  }

  // Look in the agent output for the claim link or your public address
  scan(text) {
    const claim = text.match(CLAIM_PATTERN);
    if (claim && !fs.existsSync(SECRET_FILE)) {
      this.setState('needs-claim', { claimUrl: claim[0] });
    }
    const address = text.match(ADDRESS_PATTERN);
    if (address && !/^(www|api)\./i.test(address[0])) {
      this.setAddress(address[0]);
    }
    if (/tunnel running|agent registered|connected to tunnel server|established/i.test(text) && this.state !== 'running') {
      this.setState('running');
    }
  }

  // Save the public address (it's shown on the dashboard with a copy button)
  setAddress(address) {
    const config = this.getConfig();
    if (config.tunnel.address === address) return;
    config.tunnel.address = address.trim();
    this.saveConfig(config);
    this.emit('update', this.info());
  }

  async ensureAgent() {
    if (fs.existsSync(AGENT_FILE)) return;
    ensureDir(TOOLS_DIR);
    this.setState('downloading');
    this.addLog('Downloading the playit.gg tunnel program (one time only)...');
    await download(agentUrl(), AGENT_FILE, (p) => this.emit('download', p));
    if (!isWindows) fs.chmodSync(AGENT_FILE, 0o755);
  }

  // Run a quick playit command and return what it printed
  run(args, timeout = 20000) {
    return new Promise((resolve, reject) => {
      execFile(AGENT_FILE, args, { windowsHide: true, timeout }, (err, stdout, stderr) => {
        if (err) return reject(new Error(String(stderr || err.message)));
        resolve(String(stdout).trim());
      });
    });
  }

  // Ask playit which options it supports (the names changed between versions,
  // e.g. old "--secret_path" became "--secret-path"). We read "playit --help" once.
  async detectFlags() {
    if (this.flags) return this.flags;
    let help = '';
    try {
      help = await this.run(['--help'], 15000);
    } catch (err) {
      help = String(err.message || '');   // some versions print help to stderr
    }
    this.flags = {
      secret: help.includes('--secret_path') && !help.includes('--secret-path') ? '--secret_path' : '--secret-path',
      stdout: help.includes('--stdout') ? '--stdout' : null,   // plain text logs (no fancy screen)
      hasStart: /^\s+start\b/m.test(help),                  // does it have a "start" command?
      hasClaim: /^\s+claim\b/m.test(help)                   // does it have a "claim" command?
    };
    return this.flags;
  }

  // First-time setup: get a link the user opens once to connect this PC to a free playit account
  async claim() {
    const flags = await this.detectFlags();
    if (!flags.hasClaim) return false;   // newer agents print the link themselves when started
    try {
      const code = (await this.run(['claim', 'generate'])).split(/\s+/).pop();
      const url = (await this.run(['claim', 'url', code])).match(/https?:\/\/\S+/);
      this.setState('needs-claim', { claimUrl: url ? url[0] : `https://playit.gg/claim/${code}` });
      // Wait (up to 10 minutes) until the user finishes on the website, then save the secret
      const secret = await this.run(['claim', 'exchange', code, '--wait'], 10 * 60 * 1000);
      // The secret is a long hex code; find it in the output
      const key = (secret.match(/[a-f0-9]{40,}/i) || [])[0];
      if (!key) throw new Error('No secret returned');
      fs.writeFileSync(SECRET_FILE, `secret_key = "${key}"\n`);
      this.addLog('This PC is now linked to playit.gg.');
      return true;
    } catch (err) {
      this.addLog('Using the agent\'s built-in setup link...');
      return false;
    }
  }

  // The command line for the agent. "variant" lets us try simpler versions if one fails.
  buildArgs(variant) {
    const f = this.flags;
    const args = [f.secret, SECRET_FILE];
    if (variant === 0 && f.stdout) args.push(f.stdout);
    if (variant <= 1 && f.hasStart) args.push('start');
    return args;
  }

  async start() {
    if (this.child) return;
    this.wantRunning = true;
    this.variant = this.variant || 0;
    this.quickFails = this.quickFails || 0;
    try {
      await this.ensureAgent();
      await this.detectFlags();
      if (!fs.existsSync(SECRET_FILE)) await this.claim();
    } catch (err) {
      this.setState('error');
      this.addLog(`Error: ${err.message}`);
      return;
    }
    if (!this.wantRunning) return;

    this.setState(fs.existsSync(SECRET_FILE) ? 'starting' : this.state);
    const args = this.buildArgs(this.variant);
    this.addLog(`Starting tunnel... (playit ${args.map((a) => (a === SECRET_FILE ? '<secret file>' : a)).join(' ')})`);
    const child = spawn(AGENT_FILE, args, { windowsHide: true, cwd: DATA_DIR });
    const startedAt = Date.now();
    this.child = child;

    const onData = (chunk) => chunk.toString().split(/\r?\n/).forEach((line) => this.addLog(line));
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    // If it keeps running for 8 seconds with a secret, we call it "running"
    setTimeout(() => {
      if (this.child === child && fs.existsSync(SECRET_FILE) && this.state === 'starting') this.setState('running');
    }, 8000);

    child.on('error', (err) => this.addLog(`Error: ${err.message}`));
    child.on('close', (code) => {
      this.child = null;
      const ranFor = Date.now() - startedAt;
      const recent = this.log.slice(-12).join(' ');

      // Wrong options? Try the next simpler command line (max 3 variants)
      if (ranFor < 8000 && /unexpected argument|unrecognized|Usage:/i.test(recent) && this.variant < 2) {
        this.variant++;
        this.addLog('Trying again with simpler options...');
        setTimeout(() => this.start(), 500);
        return;
      }

      this.addLog(`Tunnel stopped (code ${code}).`);
      // Count crashes that happen right after starting. A long healthy run resets the count.
      this.quickFails = ranFor < 30000 ? this.quickFails + 1 : 0;
      if (this.quickFails >= 3) {
        // Stop the endless loop and tell the user instead
        this.wantRunning = false;
        this.quickFails = 0;
        this.setState('error');
        this.addLog('The tunnel keeps stopping, so Boba paused it. Check the log above, then press Start to try again.');
        return;
      }
      this.setState(this.wantRunning ? 'error' : 'stopped');
      // Come back to life automatically if it died by itself
      if (this.wantRunning) setTimeout(() => this.wantRunning && this.start(), 10000);
    });
  }

  stop() {
    this.wantRunning = false;
    if (this.child) this.child.kill();
    this.setState('stopped');
  }

  // Forget the playit link (you'll get asked to link again, and may get a new address)
  reset() {
    this.stop();
    try { fs.unlinkSync(SECRET_FILE); } catch (err) { /* not linked */ }
    const config = this.getConfig();
    config.tunnel.address = '';
    this.saveConfig(config);
    this.claimUrl = '';
    this.variant = 0;
    this.emit('update', this.info());
  }
}

module.exports = { Tunnel };

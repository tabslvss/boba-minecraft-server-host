// terminal.js
// A simple system terminal (Command Prompt on Windows) that opens inside a server's folder.
// Useful for things like "dir", "java -version" or running scripts.

const { spawn } = require('child_process');
const { EventEmitter } = require('events');

class Terminals extends EventEmitter {
  constructor() {
    super();
    this.shells = new Map();   // id -> child process
  }

  start(id, cwd) {
    if (this.shells.has(id)) return;
    const isWindows = process.platform === 'win32';
    // /Q = don't echo commands twice, /K = keep running
    const child = isWindows
      ? spawn('cmd.exe', ['/Q', '/K', 'prompt $P$G$_'], { cwd, windowsHide: true })
      : spawn('bash', ['-i'], { cwd, env: { ...process.env, PS1: '$PWD> ' } });
    this.shells.set(id, child);

    const send = (chunk) => this.emit('data', id, chunk.toString());
    child.stdout.on('data', send);
    child.stderr.on('data', send);
    child.on('close', () => {
      this.shells.delete(id);
      this.emit('data', id, '\r\n[terminal closed]\r\n');
      this.emit('closed', id);
    });
    child.on('error', (err) => this.emit('data', id, `Could not open terminal: ${err.message}\r\n`));
  }

  write(id, text) {
    const child = this.shells.get(id);
    if (!child) throw new Error('Terminal is not open.');
    this.emit('data', id, text + '\r\n');      // show what you typed
    child.stdin.write(text + '\n');
  }

  kill(id) {
    const child = this.shells.get(id);
    if (child) child.kill();
  }

  killAll() {
    for (const child of this.shells.values()) child.kill();
  }
}

module.exports = { Terminals };

// net.js
// Small helpers for talking to the internet: get JSON and download files with progress.

const fs = require('fs');
const path = require('path');

// Some APIs (like Modrinth and PaperMC) ask apps to send a name so they know who is calling
const USER_AGENT = 'BobaMinecraftServerHostTool/1.0 (desktop app)';

// Get a URL and turn the reply into a JS object
// Example: await getJson('https://api.modrinth.com/v2/project/sodium')
async function getJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

// Download a file to disk.
// onProgress(percent, downloadedBytes, totalBytes) is called while it downloads.
async function download(url, destination, onProgress) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }

  // Total size (may be 0 if the server doesn't tell us)
  const totalBytes = Number(response.headers.get('content-length')) || 0;
  let downloadedBytes = 0;

  // We write to a ".part" file first, then rename when finished,
  // so a half-downloaded file is never mistaken for a good one.
  const tempFile = destination + '.part';
  const fileStream = fs.createWriteStream(tempFile);

  // Read the download in chunks
  const reader = response.body.getReader();
  let lastReport = 0;
  while (true) {
    const { done, value } = await reader.read();  // value = next chunk of bytes
    if (done) break;
    downloadedBytes += value.length;
    // write() returns false when the disk buffer is full -> wait for it to drain
    if (!fileStream.write(Buffer.from(value))) {
      await new Promise((resolve) => fileStream.once('drain', resolve));
    }
    // Only report progress every 150ms so we don't spam the UI
    const now = Date.now();
    if (onProgress && now - lastReport > 150) {
      lastReport = now;
      const percent = totalBytes ? Math.round((downloadedBytes / totalBytes) * 100) : -1;
      onProgress(percent, downloadedBytes, totalBytes);
    }
  }

  // Wait until everything is flushed to disk
  await new Promise((resolve, reject) => {
    fileStream.end(resolve);
    fileStream.on('error', reject);
  });

  fs.renameSync(tempFile, destination);
  if (onProgress) onProgress(100, downloadedBytes, totalBytes);
  return destination;
}

module.exports = { getJson, download, USER_AGENT };

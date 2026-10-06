// preload.js
// A safe "bridge" between the UI and the main process.
// The UI can only use the functions listed here (window.api.*).

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Ask the main process to do something; throws an Error if it failed
  invoke: async (channel, ...args) => {
    const result = await ipcRenderer.invoke(channel, ...args);
    if (!result.ok) throw new Error(result.error);
    return result.data;
  },
  // Listen for events from the main process. Returns a function that stops listening.
  on: (channel, callback) => {
    const listener = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  // Title bar buttons
  window: {
    minimize: () => ipcRenderer.send('win:minimize'),
    maximize: () => ipcRenderer.send('win:maximize'),
    close: () => ipcRenderer.send('win:close')
  },
  // Real file path of a file dragged into the window
  pathForFile: (file) => webUtils.getPathForFile(file)
});

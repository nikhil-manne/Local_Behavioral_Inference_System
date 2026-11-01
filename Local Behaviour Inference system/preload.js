// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send('set-ignore-mouse-events', ignore),
  terminate: () => ipcRenderer.send('terminate-app'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  setWorkflowActive: (active) => ipcRenderer.send('set-workflow-active', active)
});

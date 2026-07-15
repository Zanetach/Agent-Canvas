const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inuxDesktop', Object.freeze({
  getAppInfo: () => ipcRenderer.invoke('desktop:get-app-info'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
  openReleasePage: releaseUrl => ipcRenderer.invoke('desktop:open-release-page', releaseUrl),
}));

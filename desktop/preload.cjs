const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('backupDesktop', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (input) => ipcRenderer.invoke('settings:save', input),
  setSchedule: (input) => ipcRenderer.invoke('settings:schedule', input),
  testConnection: (profileId) => ipcRenderer.invoke('connection:test', profileId),
  getStatus: (profileId) => ipcRenderer.invoke('backup:status', profileId),
  runBackup: (profileId) => ipcRenderer.invoke('backup:run', profileId),
  getLogs: (profileId) => ipcRenderer.invoke('backup:logs', profileId),
  openBackupFolder: (profileId) => ipcRenderer.invoke('backup:open-folder', profileId),
  pickDirectory: () => ipcRenderer.invoke('dialog:directory'),
  pickPgDump: () => ipcRenderer.invoke('dialog:pgdump'),
  onLog: (callback) => {
    const listener = (_event, entry) => callback(entry)
    ipcRenderer.on('backup:log', listener)
    return () => ipcRenderer.removeListener('backup:log', listener)
  },
})

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopBridge", {
  getSettings: () => ipcRenderer.invoke("desktop:get-settings"),
  updateSettings: (changes) => ipcRenderer.invoke("desktop:update-settings", changes),
  chooseDownloadDirectory: () => ipcRenderer.invoke("desktop:choose-download-directory"),
  openDownloadDirectory: () => ipcRenderer.invoke("desktop:open-download-directory"),
  openLogsDirectory: () => ipcRenderer.invoke("desktop:open-logs-directory"),
  openTaskFile: (payload) => ipcRenderer.invoke("desktop:open-task-file", payload),
  getRuntimeStatus: () => ipcRenderer.invoke("desktop:get-runtime-status"),
  listRecentTasks: (limit) => ipcRenderer.invoke("desktop:list-recent-tasks", limit),
  getDiagnostics: () => ipcRenderer.invoke("desktop:get-diagnostics"),
  restartBackend: () => ipcRenderer.invoke("desktop:restart-backend"),
  exportLogs: () => ipcRenderer.invoke("desktop:export-logs"),
});

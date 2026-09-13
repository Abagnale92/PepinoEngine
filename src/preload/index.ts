import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("pepino", {
  openProject: () => ipcRenderer.invoke("project:open"),
  openSample: () => ipcRenderer.invoke("project:sample"),
  saveProject: (data: unknown) => ipcRenderer.invoke("project:save", data),
  exportWeb: (data: unknown) => ipcRenderer.invoke("project:export", data),
  importAssets: () => ipcRenderer.invoke("assets:import"),
  reveal: (path: string) => ipcRenderer.invoke("shell:reveal", path),
});

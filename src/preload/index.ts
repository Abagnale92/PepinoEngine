import { contextBridge, ipcRenderer, webFrame } from "electron";

// Ingrandimento dell'interfaccia (Impostazioni): come lo zoom del browser, anche il mouse resta allineato.
contextBridge.exposeInMainWorld("pepinoZoom", (factor: number) => webFrame.setZoomFactor(Math.min(2, Math.max(0.5, Number(factor) || 1))));

contextBridge.exposeInMainWorld("pepino", {
  openProject: () => ipcRenderer.invoke("project:open"),
  openSample: () => ipcRenderer.invoke("project:sample"),
  newProject: (template: string) => ipcRenderer.invoke("project:new", template),
  saveProject: (data: unknown) => ipcRenderer.invoke("project:save", data),
  exportWeb: (data: unknown) => ipcRenderer.invoke("project:export", data),
  importAssets: () => ipcRenderer.invoke("assets:import"),
  writeAsset: (path: string, base64: string) => ipcRenderer.invoke("assets:write", path, base64),
  reveal: (path: string) => ipcRenderer.invoke("shell:reveal", path),
  setLanguage: (lang: string) => ipcRenderer.send("app:lang", lang),
});

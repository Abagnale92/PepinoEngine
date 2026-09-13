import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";
import { existsSync } from "fs";
import { copyFile, mkdir, readFile, writeFile } from "fs/promises";
import { basename, dirname, extname, join, resolve } from "path";
import { exportProject, isInside } from "./exporter";

// Gli asset del progetto aperto si leggono da pepino://<qualsiasi>/percorso/relativo.
protocol.registerSchemesAsPrivileged([
  { scheme: "pepino", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let win: BrowserWindow | null = null;
let projectPath = "";
let projectDir = "";
let lastExport = "";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".json": "application/json",
};

async function openAt(path: string) {
  const data = JSON.parse(await readFile(path, "utf8"));
  if (data?.format !== "pepino") throw new Error("Il file scelto non è un progetto Pepino.");
  projectPath = path;
  projectDir = dirname(path);
  win?.setTitle(`${data.name} · Pepino`);
  // L'host cambia a ogni apertura: così il browser non riusa immagini di un altro progetto.
  return { path, baseUrl: `pepino://p${Date.now()}/`, data };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: "#121712",
    title: "Pepino",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
    },
  });
  win.webContents.on("will-prevent-unload", (e) => {
    const choice = dialog.showMessageBoxSync(win!, {
      type: "question",
      buttons: ["Esci senza salvare", "Annulla"],
      defaultId: 1,
      cancelId: 1,
      message: "Ci sono modifiche non salvate.",
      detail: "Se chiudi adesso andranno perse.",
    });
    if (choice === 0) e.preventDefault();
  });
  // Link esterni: mai dentro la finestra dell'editor.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(() => {
  protocol.handle("pepino", async (req) => {
    if (!projectDir) return new Response("Nessun progetto aperto", { status: 404 });
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, "");
    const file = resolve(projectDir, rel);
    if (!isInside(projectDir, file)) return new Response("Percorso non valido", { status: 403 });
    try {
      const data = await readFile(file);
      return new Response(new Uint8Array(data), {
        headers: {
          "Content-Type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        },
      });
    } catch {
      return new Response("File non trovato", { status: 404 });
    }
  });

  ipcMain.handle("project:open", async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: "Apri un progetto Pepino",
      filters: [{ name: "Progetto Pepino", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return openAt(r.filePaths[0]);
  });

  ipcMain.handle("project:sample", () => openAt(join(app.getAppPath(), "samples", "demo", "project.json")));

  ipcMain.handle("project:save", async (_e, data: { name: string }) => {
    if (!projectPath) return { ok: false, message: "Nessun progetto aperto." };
    await writeFile(projectPath, JSON.stringify(data, null, 2), "utf8");
    win?.setTitle(`${data.name} · Pepino`);
    return { ok: true };
  });

  ipcMain.handle("project:export", async (_e, data: { name: string; assets: { src: string }[] }) => {
    if (!projectDir) return { error: "Apri o salva un progetto prima di esportare." };
    const r = await dialog.showOpenDialog(win!, {
      title: "Dove salvo la build WebGL?",
      properties: ["openDirectory", "createDirectory"],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    try {
      const res = await exportProject({ data, projectDir, playerDir: join(app.getAppPath(), "dist", "player"), parentDir: r.filePaths[0] });
      lastExport = res.dir;
      return res;
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  ipcMain.handle("assets:import", async () => {
    if (!projectDir) return null;
    const r = await dialog.showOpenDialog(win!, {
      title: "Importa immagini e suoni",
      filters: [{ name: "Immagini e audio", extensions: ["png", "jpg", "jpeg", "gif", "webp", "wav", "mp3", "ogg"] }],
      properties: ["openFile", "multiSelections"],
    });
    if (r.canceled) return null;
    const dir = join(projectDir, "assets");
    await mkdir(dir, { recursive: true });
    const out: { id: string; type: "image" | "audio"; src: string }[] = [];
    for (const src of r.filePaths) {
      const ext = extname(src).toLowerCase();
      let name = basename(src);
      let dst = join(dir, name);
      for (let n = 2; existsSync(dst) && resolve(dst) !== resolve(src); n++) {
        name = `${basename(src, ext)}_${n}${ext}`;
        dst = join(dir, name);
      }
      if (resolve(dst) !== resolve(src)) await copyFile(src, dst);
      out.push({
        id: basename(name, ext).toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        type: [".wav", ".mp3", ".ogg"].includes(ext) ? "audio" : "image",
        src: `assets/${name}`,
      });
    }
    return out;
  });

  // Apre solo cartelle che l'editor conosce: l'ultima build o il progetto aperto.
  ipcMain.handle("shell:reveal", (_e, p: string) => {
    const target = resolve(String(p));
    const allowed =
      (lastExport && target === resolve(lastExport)) || (projectDir && (target === resolve(projectDir) || isInside(projectDir, target)));
    return allowed ? shell.openPath(target) : "Percorso non consentito";
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

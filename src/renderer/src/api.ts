import type { ProjectData } from "@runtime";

export interface OpenedProject {
  path: string;
  /** Indirizzo da cui si leggono gli asset del progetto. */
  baseUrl: string;
  data: ProjectData;
}

export interface ImportedAsset {
  id: string;
  type: "image" | "audio";
  src: string;
}

export interface Bridge {
  desktop: boolean;
  openProject(): Promise<OpenedProject | null>;
  openSample(): Promise<OpenedProject | null>;
  saveProject(data: ProjectData): Promise<{ ok: boolean; message?: string }>;
  exportWeb(data: ProjectData): Promise<{ dir?: string; error?: string; copied?: number; skipped?: string[] } | null>;
  importAssets(): Promise<ImportedAsset[] | null>;
  reveal(path: string): Promise<unknown>;
}

declare global {
  interface Window {
    pepino?: Omit<Bridge, "desktop">;
  }
}

/** Versione per il browser (npm run dev:web): legge la demo dal server di sviluppo. */
const web: Bridge = {
  desktop: false,
  async openProject() {
    return web.openSample();
  },
  async openSample() {
    const url = new URL("/demo/project.json", location.href);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Progetto demo non trovato (${res.status}). Esegui "npm run samples".`);
    return { path: url.pathname, baseUrl: url.href, data: await res.json() };
  },
  async saveProject() {
    return { ok: false, message: "Nel browser non si salva su file: apri l'app desktop con \"npm run dev\"." };
  },
  async exportWeb() {
    return { error: "L'esportazione WebGL è disponibile nell'app desktop." };
  },
  async importAssets() {
    return null;
  },
  async reveal() {},
};

export const api: Bridge = window.pepino ? { desktop: true, ...window.pepino } : web;

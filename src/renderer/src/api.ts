import type { ProjectData } from "@runtime";
import { N, T } from "./i18n";

export interface OpenedProject {
  path: string;
  /** Indirizzo da cui si leggono gli asset del progetto. */
  baseUrl: string;
  data: ProjectData;
}

export interface ImportedAsset {
  id: string;
  type: "image" | "audio" | "font";
  src: string;
}

export interface Bridge {
  desktop: boolean;
  openProject(): Promise<OpenedProject | null>;
  openSample(): Promise<OpenedProject | null>;
  /** Nuovo progetto da un modello di genere (platform, topdown, beatemup). */
  newProject(template: string): Promise<OpenedProject | null>;
  saveProject(data: ProjectData): Promise<{ ok: boolean; message?: string }>;
  exportWeb(data: ProjectData): Promise<{ dir?: string; error?: string; copied?: number; skipped?: string[] } | null>;
  importAssets(): Promise<ImportedAsset[] | null>;
  /** Scrive un file dentro assets/ (immagini del Disegno); `base64` = contenuto. Solo nell'app desktop. */
  writeAsset?(path: string, base64: string): Promise<boolean>;
  reveal(path: string): Promise<unknown>;
  /** L'app desktop traduce anche le sue finestre (apri, salva…). */
  setLanguage?(lang: string): void;
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
    if (!res.ok) throw new Error(T("Progetto demo non trovato ({0}). Esegui «npm run samples».", res.status));
    return { path: url.pathname, baseUrl: url.href, data: await res.json() };
  },
  async newProject(template) {
    // Nel browser il modello si apre in memoria; gli asset sono quelli della demo.
    const res = await fetch(new URL(`/templates/${template}.json`, location.href));
    if (!res.ok) throw new Error(T("Modello «{0}» non trovato ({1}). Esegui «npm run samples».", template, res.status));
    return { path: "", baseUrl: new URL("/demo/project.json", location.href).href, data: await res.json() };
  },
  async saveProject() {
    return { ok: false, message: N("Nel browser non si salva su file: apri l'app desktop con «npm run dev».") };
  },
  async exportWeb() {
    return { error: N("L'esportazione WebGL è disponibile nell'app desktop.") };
  },
  async importAssets() {
    return null;
  },
  async reveal() {},
};

export const api: Bridge = window.pepino ? { desktop: true, ...window.pepino } : web;

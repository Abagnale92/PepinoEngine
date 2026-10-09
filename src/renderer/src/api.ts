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

/** Testo in italiano e in inglese. */
export interface Bilingual {
  it: string;
  en?: string;
}

/** Un gioco di esempio in samples/<id>/project.json, elencato in samples/esempi.json (lo scrive «npm run samples» se ci sono esempi). */
export interface SampleInfo {
  id: string;
  name: Bilingual;
  description?: Bilingual;
}

const SAMPLE_ID = /^[a-z0-9_-]+$/;

/** Tiene solo le voci valide dell'indice degli esempi. */
export function parseSamples(list: unknown): SampleInfo[] {
  if (!Array.isArray(list)) return [];
  return list.filter((s): s is SampleInfo => typeof s?.id === "string" && SAMPLE_ID.test(s.id) && typeof s?.name?.it === "string");
}

export interface Bridge {
  desktop: boolean;
  openProject(): Promise<OpenedProject | null>;
  /** Gli esempi disponibili (nessuno se samples/esempi.json manca). */
  listSamples(): Promise<SampleInfo[]>;
  /** Apre un gioco di esempio per id. */
  openSample(id: string): Promise<OpenedProject | null>;
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

/** Legge un JSON dal server di sviluppo; `null` se manca (il server può rispondere con la pagina dell'editor). */
async function fetchJson(url: URL): Promise<unknown> {
  try {
    const res = await fetch(url);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** Versione per il browser (npm run dev:web): modelli ed esempi arrivano dal server di sviluppo (cartella samples). */
const web: Bridge = {
  desktop: false,
  async openProject() {
    // Nel browser non si sceglie un file: si apre il primo esempio, se c'è.
    const [first] = await web.listSamples();
    if (!first) throw new Error(T("Nel browser si aprono solo i modelli (menu Nuovo): per i tuoi progetti usa l'app desktop («npm run dev»)."));
    return web.openSample(first.id);
  },
  async listSamples() {
    return parseSamples(await fetchJson(new URL("/esempi.json", location.href)));
  },
  async openSample(id) {
    const url = new URL(`/${SAMPLE_ID.test(id) ? id : "_"}/project.json`, location.href);
    const data = await fetchJson(url);
    if (!data) throw new Error(T("Esempio «{0}» non trovato. Esegui «npm run samples».", id));
    return { path: url.pathname, baseUrl: url.href, data: data as ProjectData };
  },
  async newProject(template) {
    // Nel browser il modello si apre in memoria; i suoi asset sono in samples/templates/assets.
    const url = new URL(`/templates/${template}.json`, location.href);
    const data = await fetchJson(url);
    if (!data) throw new Error(T("Modello «{0}» non trovato. Esegui «npm run samples».", template));
    return { path: "", baseUrl: url.href, data: data as ProjectData };
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

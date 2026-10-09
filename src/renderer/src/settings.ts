import { useSyncExternalStore } from "react";
import { setEditorLang, type EditorLang } from "./i18n";

/** Preferenze dell'editor: valgono per tutti i progetti e restano tra una sessione e l'altra. */
export interface EditorSettings {
  language: EditorLang;
  theme: "dark" | "light";
  /** Ingrandimento dell'interfaccia (app desktop). */
  uiScale: number;
  /** Salvataggio automatico ogni N minuti; 0 = mai. */
  autosave: number;
  gridColor: string;
  gridOpacity: number;
  /** Aggancio degli oggetti: mezzo tile o tile intero. */
  snapStep: "half" | "full";
  /** Controlla il progetto prima di ogni «Prova». */
  checkBeforePlay: boolean;
  /** L'anteprima parte con le collisioni visibili. */
  previewCollisions: boolean;
  previewSpeed: number;
  codeFontSize: number;
  /** Dimensioni (px) dei riquadri cambiate trascinando i divisori, per id (vedi PANELS in Splitter.tsx); chi manca ha la dimensione iniziale. */
  panels: Record<string, number>;
}

const KEY = "pepino:editor:settings";

const browserLang = (): EditorLang =>
  typeof navigator !== "undefined" && !(navigator.language || "it").toLowerCase().startsWith("it") ? "en" : "it";

export const DEFAULT_SETTINGS: EditorSettings = {
  language: browserLang(),
  theme: "dark",
  uiScale: 1,
  autosave: 0,
  gridColor: "#ffffff",
  gridOpacity: 0.12,
  snapStep: "half",
  checkBeforePlay: true,
  previewCollisions: false,
  previewSpeed: 1,
  codeFontSize: 12.5,
  panels: {},
};

function load(): EditorSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // memoria non disponibile o dati rovinati: si riparte dalle impostazioni predefinite
  }
  return { ...DEFAULT_SETTINGS };
}

let settings = load();
const listeners = new Set<() => void>();

declare global {
  interface Window {
    pepinoZoom?: (factor: number) => void;
  }
}

/** Applica le impostazioni che toccano la pagina: lingua, tema, ingrandimento. */
function apply(s: EditorSettings): void {
  setEditorLang(s.language);
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = s.theme;
  window.pepinoZoom?.(s.uiScale);
  window.pepino?.setLanguage?.(s.language);
}

apply(settings);

export const getSettings = () => settings;

export function updateSettings(patch: Partial<EditorSettings>): void {
  settings = { ...settings, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // senza memoria le impostazioni valgono solo fino alla chiusura
  }
  apply(settings);
  for (const l of listeners) l();
}

/** Cambia la dimensione di un riquadro (`undefined` = quella iniziale). Mentre si trascina (`save` falso) non scrive in memoria e non riapplica lingua e zoom. */
export function updatePanel(id: string, size: number | undefined, save = true): void {
  const panels = { ...(settings.panels ?? {}) };
  if (size === undefined) delete panels[id];
  else panels[id] = size;
  settings = { ...settings, panels };
  if (save) {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      // senza memoria le dimensioni valgono solo fino alla chiusura
    }
  }
  for (const l of listeners) l();
}

export function resetSettings(): void {
  updateSettings({ ...DEFAULT_SETTINGS });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Il selettore deve restituire valori stabili (campi delle impostazioni, non oggetti nuovi). */
export function useSettings<V>(selector: (s: EditorSettings) => V): V {
  return useSyncExternalStore(subscribe, () => selector(settings));
}

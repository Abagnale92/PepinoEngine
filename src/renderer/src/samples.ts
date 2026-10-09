import { useSyncExternalStore } from "react";
import { api, type Bilingual, type SampleInfo } from "./api";
import { getEditorLang } from "./i18n";

/** I giochi di esempio disponibili: si leggono una volta all'avvio (menu Esempi e schermata iniziale). */
let samples: SampleInfo[] = [];
const listeners = new Set<() => void>();

export async function loadSamples(): Promise<SampleInfo[]> {
  try {
    samples = await api.listSamples();
  } catch {
    samples = [];
  }
  for (const l of listeners) l();
  return samples;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const useSamples = (): SampleInfo[] => useSyncExternalStore(subscribe, () => samples);

/** Il testo nella lingua dell'editor (l'italiano se manca l'inglese). */
export const bilingual = (t?: Bilingual): string => (t ? (getEditorLang() === "en" && t.en ? t.en : t.it) : "");

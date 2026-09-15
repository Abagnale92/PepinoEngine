/** Effetti a tutto schermo: la posizione nell'elenco è il numero usato dallo shader. */
export const SCREEN_EFFECTS = [
  { value: "none", label: "Nessuno" },
  { value: "vignette", label: "Vignetta (bordi scuri)" },
  { value: "crt", label: "Vecchio televisore (CRT)" },
  { value: "gameboy", label: "Game Boy (4 verdi)" },
  { value: "grayscale", label: "Bianco e nero" },
  { value: "sepia", label: "Seppia" },
];

export interface ScreenEffect {
  id: string;
  /** 0..1 */
  strength: number;
}

export const screenEffectIndex = (id: string | undefined) => Math.max(0, SCREEN_EFFECTS.findIndex((e) => e.value === id));

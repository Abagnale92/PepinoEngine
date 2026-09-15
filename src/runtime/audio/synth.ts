/**
 * Sintetizzatore 8/16 bit: effetti sonori (come sfxr) e brani a più canali, calcolati campione per campione.
 * Non usa Web Audio: il risultato è un Float32Array che l'AudioSystem trasforma in un suono come gli altri,
 * così brani ed effetti si usano ovunque ci sia un campo audio (musica della scena, suono salto…).
 */

export type Wave = "square" | "pulse25" | "pulse12" | "triangle" | "saw" | "sine" | "noise";

export const WAVES: { id: Wave; label: string }[] = [
  { id: "square", label: "Quadra" },
  { id: "pulse25", label: "Impulso 25%" },
  { id: "pulse12", label: "Impulso 12%" },
  { id: "triangle", label: "Triangolo" },
  { id: "saw", label: "Dente di sega" },
  { id: "sine", label: "Sinusoide" },
  { id: "noise", label: "Rumore" },
];

export const SAMPLE_RATE = 44100;

/** Numeri casuali ripetibili (stesso seme = stesso suono). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Valore dell'onda con fase 0..1 (il rumore si calcola a parte). */
function osc(wave: Exclude<Wave, "noise">, phase: number): number {
  switch (wave) {
    case "square":
      return phase < 0.5 ? 1 : -1;
    case "pulse25":
      return phase < 0.25 ? 1 : -1;
    case "pulse12":
      return phase < 0.125 ? 1 : -1;
    case "triangle":
      // A scalini, come il triangolo delle vecchie console.
      return Math.round((1 - 4 * Math.abs(phase - 0.5)) * 7.5) / 7.5;
    case "saw":
      return 2 * phase - 1;
    case "sine":
      return Math.sin(phase * 2 * Math.PI);
  }
}

/** Un'onda che scorre: fase e, per il rumore, il valore che cambia a ogni giro. */
class Voice {
  phase = 0;
  private nv = 0;
  constructor(
    private wave: Wave,
    private noise: () => number,
  ) {
    this.nv = noise() * 2 - 1;
  }
  /** Avanza di `step` giri (frequenza / campioni al secondo) e restituisce il valore. */
  next(step: number): number {
    this.phase += step;
    if (this.phase >= 1) {
      this.phase -= Math.floor(this.phase);
      this.nv = this.noise() * 2 - 1;
    }
    return this.wave === "noise" ? this.nv : osc(this.wave, this.phase);
  }
}

// ------------------------------------------------------------------ effetti sonori

export interface SfxData {
  wave: Wave;
  /** Frequenza all'inizio e alla fine, in Hz: se sono diverse il suono "scivola". */
  freq: number;
  freqEnd: number;
  /** Secondi: salita, tenuta e sfumatura del volume. */
  attack: number;
  sustain: number;
  decay: number;
  volume: number;
  /** Tremolio della nota: profondità 0..1 e velocità in Hz. */
  vibrato: number;
  vibratoSpeed: number;
  /** Salto di frequenza (× questo numero) dopo `jumpAt` secondi, come nella moneta. 1 = nessun salto. */
  jump: number;
  jumpAt: number;
  /** Suono "sporco" a pochi livelli: 0 = pulito, 1 = molto sporco. */
  crush: number;
}

export const DEFAULT_SFX: SfxData = {
  wave: "square",
  freq: 440,
  freqEnd: 440,
  attack: 0,
  sustain: 0.08,
  decay: 0.15,
  volume: 0.6,
  vibrato: 0,
  vibratoSpeed: 10,
  jump: 1,
  jumpAt: 0.05,
  crush: 0,
};

export const sfxSeconds = (s: SfxData): number => Math.max(0.01, s.attack + s.sustain + s.decay);

export function renderSfx(s: SfxData, sr = SAMPLE_RATE, seed = 1): Float32Array {
  const n = Math.max(1, Math.round(sfxSeconds(s) * sr));
  const out = new Float32Array(n);
  const voice = new Voice(s.wave, rng(seed));
  const dur = n / sr;
  const ratio = Math.max(1, s.freqEnd) / Math.max(1, s.freq);
  const levels = s.crush > 0 ? Math.max(2, Math.round(16 * (1 - s.crush))) : 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env =
      s.attack > 0 && t < s.attack
        ? t / s.attack
        : t < s.attack + s.sustain
          ? 1
          : Math.max(0, 1 - (t - s.attack - s.sustain) / Math.max(1e-4, s.decay));
    // Scivolo esponenziale: a orecchio è una salita (o discesa) regolare.
    let f = Math.max(1, s.freq) * Math.pow(ratio, t / dur);
    if (s.jump !== 1 && t >= s.jumpAt) f *= s.jump;
    if (s.vibrato > 0) f *= 1 + s.vibrato * 0.5 * Math.sin(2 * Math.PI * s.vibratoSpeed * t);
    let v = voice.next(f / sr);
    if (levels) v = Math.round(v * levels) / levels;
    out[i] = v * env * s.volume;
  }
  return out;
}

export type SfxPreset = "coin" | "jump" | "hit" | "explosion" | "powerup" | "laser" | "blip" | "fall";

export const SFX_PRESETS: { id: SfxPreset; label: string }[] = [
  { id: "coin", label: "Moneta" },
  { id: "jump", label: "Salto" },
  { id: "hit", label: "Colpo" },
  { id: "explosion", label: "Esplosione" },
  { id: "powerup", label: "Potenziamento" },
  { id: "laser", label: "Laser" },
  { id: "blip", label: "Blip (menù)" },
  { id: "fall", label: "Caduta" },
];

/** Un effetto del tipo scelto, ogni volta un po' diverso (come il pulsante "Genera" di sfxr). */
export function makeSfx(preset: SfxPreset, rand: () => number = Math.random): SfxData {
  const r = (a: number, b: number) => a + (b - a) * rand();
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length) % list.length];
  const s: SfxData = { ...DEFAULT_SFX };
  switch (preset) {
    case "coin": {
      const f = r(700, 1100);
      return { ...s, wave: pick(["square", "pulse25"] as Wave[]), freq: f, freqEnd: f, sustain: r(0.04, 0.08), decay: r(0.15, 0.3), jump: r(1.3, 1.6), jumpAt: r(0.04, 0.08) };
    }
    case "jump":
      return { ...s, wave: pick(["square", "pulse25"] as Wave[]), freq: r(250, 400), freqEnd: r(600, 900), sustain: r(0.05, 0.1), decay: r(0.1, 0.2) };
    case "hit":
      return { ...s, wave: pick(["noise", "square"] as Wave[]), freq: r(200, 500), freqEnd: r(60, 120), sustain: r(0.02, 0.05), decay: r(0.1, 0.2), crush: 0.3 };
    case "explosion":
      return { ...s, wave: "noise", freq: r(600, 1500), freqEnd: r(40, 120), sustain: r(0.05, 0.12), decay: r(0.4, 0.8), volume: 0.8 };
    case "powerup":
      return {
        ...s,
        wave: pick(["square", "triangle"] as Wave[]),
        freq: r(300, 500),
        freqEnd: r(900, 1400),
        sustain: r(0.2, 0.3),
        decay: 0.2,
        vibrato: r(0.1, 0.3),
        vibratoSpeed: r(10, 20),
      };
    case "laser":
      return { ...s, wave: pick(["saw", "square"] as Wave[]), freq: r(900, 1500), freqEnd: r(150, 300), sustain: r(0.05, 0.1), decay: r(0.1, 0.2) };
    case "blip": {
      const f = r(600, 1200);
      return { ...s, wave: pick(["pulse12", "square"] as Wave[]), freq: f, freqEnd: f, sustain: r(0.02, 0.05), decay: r(0.03, 0.08), volume: 0.5 };
    }
    case "fall":
      return { ...s, wave: pick(["triangle", "square"] as Wave[]), freq: r(600, 900), freqEnd: r(80, 150), sustain: r(0.3, 0.5), decay: 0.2, vibrato: 0.2, vibratoSpeed: 8 };
  }
}

// ------------------------------------------------------------------ brani

export interface SongNote {
  /** Passo in cui comincia (un passo = un sedicesimo). */
  step: number;
  /** Durata in passi. */
  len: number;
  /** Nota MIDI (60 = Do centrale); nella batteria indica lo strumento (vedi DRUMS). */
  pitch: number;
}

export interface SongChannel {
  name: string;
  /** "drums" = batteria fatta di rumore e toni brevi. */
  wave: Wave | "drums";
  volume: number;
  /** Secondi: salita del volume a inizio nota e sfumatura quando finisce. */
  attack: number;
  release: number;
  notes: SongNote[];
}

export interface SongData {
  /** Battiti al minuto (un battito = 4 passi). */
  bpm: number;
  /** Lunghezza in passi (16 passi = una battuta). */
  length: number;
  /** Ricomincia da capo quando finisce (musica di sottofondo). */
  loop: boolean;
  /** Eco: 0 = asciutto, 1 = molto. Dà il suono più pieno dei giochi a 16 bit. */
  echo: number;
  channels: SongChannel[];
}

export const DRUMS: { pitch: number; label: string }[] = [
  { pitch: 49, label: "Piatto" },
  { pitch: 46, label: "Charleston aperto" },
  { pitch: 42, label: "Charleston" },
  { pitch: 38, label: "Rullante" },
  { pitch: 36, label: "Cassa" },
];

export const midiToFreq = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const stepSeconds = (song: SongData): number => 60 / Math.max(20, song.bpm) / 4;
export const songSeconds = (song: SongData): number => song.length * stepSeconds(song);

/** Brano vuoto con i quattro canali classici; `names` = nomi dei canali nella lingua dell'editor. */
export function createSong(names = ["Melodia", "Armonia", "Basso", "Batteria"]): SongData {
  return {
    bpm: 120,
    length: 64,
    loop: true,
    echo: 0.2,
    channels: [
      { name: names[0], wave: "pulse25", volume: 0.5, attack: 0.005, release: 0.08, notes: [] },
      { name: names[1], wave: "square", volume: 0.35, attack: 0.005, release: 0.1, notes: [] },
      { name: names[2], wave: "triangle", volume: 0.7, attack: 0.002, release: 0.05, notes: [] },
      { name: names[3], wave: "drums", volume: 0.6, attack: 0, release: 0, notes: [] },
    ],
  };
}

/** Un colpo di batteria aggiunto a `out` dal campione `start`. */
function renderDrum(out: Float32Array, start: number, pitch: number, vol: number, sr: number, noise: () => number): void {
  const kind = pitch <= 36 ? "kick" : pitch <= 40 ? "snare" : pitch <= 44 ? "hat" : pitch <= 47 ? "open" : "crash";
  const dur = { kick: 0.2, snare: 0.16, hat: 0.05, open: 0.25, crash: 0.7 }[kind];
  const n = Math.min(out.length - start, Math.round(dur * sr));
  let phase = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.pow(1 - i / n, 2);
    let v: number;
    if (kind === "kick") {
      // Tono che scende velocemente: il "tum" della cassa.
      phase += (45 + 120 * Math.exp(-t * 30)) / sr;
      v = Math.sin(phase * 2 * Math.PI) * 1.2;
    } else {
      const w = noise() * 2 - 1;
      // Piatti e charleston: solo le frequenze alte del rumore (differenza tra due campioni).
      const high = w - prev;
      prev = w;
      if (kind === "snare") {
        phase += 180 / sr;
        v = w * 0.7 + Math.sin(phase * 2 * Math.PI) * 0.4 * Math.exp(-t * 25);
      } else v = high * (kind === "crash" ? 0.45 : 0.5);
    }
    out[start + i] += v * env * vol * 0.6;
  }
}

/** Calcola tutto il brano: un canale mono, lungo esattamente `length` passi. */
export function renderSong(song: SongData, sr = SAMPLE_RATE, seed = 7): Float32Array {
  const stepN = stepSeconds(song) * sr;
  const n = Math.max(1, Math.round(song.length * stepN));
  const out = new Float32Array(n);
  const noise = rng(seed);
  for (const ch of song.channels) {
    for (const note of ch.notes) {
      if (note.step < 0 || note.step >= song.length) continue;
      const start = Math.round(note.step * stepN);
      if (ch.wave === "drums") {
        renderDrum(out, start, note.pitch, ch.volume, sr, noise);
        continue;
      }
      const held = Math.max(1, note.len) * stepN;
      const att = Math.max(0.0005, ch.attack) * sr;
      const rel = Math.max(0.001, ch.release) * sr;
      const end = Math.min(n, Math.round(start + held + rel));
      const step = midiToFreq(note.pitch) / sr;
      const voice = new Voice(ch.wave, noise);
      for (let i = start; i < end; i++) {
        const j = i - start;
        const env = j < att ? j / att : j < held ? 1 : Math.max(0, 1 - (j - held) / rel);
        out[i] += voice.next(step) * env * ch.volume * 0.3;
      }
    }
  }
  if (song.echo > 0) {
    // Eco a tre passi di distanza: ogni ripetizione più piano della precedente.
    const d = Math.max(1, Math.round(stepN * 3));
    const fb = Math.min(0.7, song.echo * 0.5);
    for (let i = d; i < n; i++) out[i] += out[i - d] * fb;
  }
  for (let i = 0; i < n; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
  return out;
}

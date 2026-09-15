import { useSyncExternalStore } from "react";
import { SAMPLE_RATE, renderSfx, renderSong, type AudioAsset, type SongChannel } from "@runtime";
import { setState } from "../store";

/**
 * Ascolto nella scheda Musica: un brano alla volta (con la posizione per la barra che scorre)
 * e suoni brevi di prova che non lo interrompono.
 */

let ctx: AudioContext | null = null;
let current: { src: AudioBufferSourceNode; start: number; dur: number; loop: boolean } | null = null;
let selected = "";
const listeners = new Set<() => void>();

const notify = () => {
  for (const l of listeners) l();
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

function source(samples: Float32Array, sr: number, loop: boolean): AudioBufferSourceNode {
  ctx ??= new AudioContext();
  void ctx.resume();
  const buf = ctx.createBuffer(1, Math.max(1, samples.length), sr);
  buf.getChannelData(0).set(samples);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = loop;
  const gain = ctx.createGain();
  gain.gain.value = 0.8;
  src.connect(gain).connect(ctx.destination);
  src.start();
  return src;
}

export function playSamples(samples: Float32Array, sr = SAMPLE_RATE, loop = false): void {
  stopSamples();
  const src = source(samples, sr, loop);
  const cur = { src, start: ctx!.currentTime, dur: samples.length / sr, loop };
  src.onended = () => {
    if (current !== cur) return;
    current = null;
    notify();
  };
  current = cur;
  notify();
}

export function stopSamples(): void {
  if (!current) return;
  const cur = current;
  current = null;
  cur.src.stop();
  notify();
}

/** Suono breve di prova (una nota, un effetto): non ferma il brano in ascolto. */
export function playOnce(samples: Float32Array, sr = SAMPLE_RATE): void {
  source(samples, sr, false);
}

/** Secondi dall'inizio del brano in ascolto, o null se non suona niente. */
export function playbackTime(): number | null {
  if (!current || !ctx) return null;
  const t = ctx.currentTime - current.start;
  return current.loop ? t % current.dur : t <= current.dur ? t : null;
}

export const usePlaying = (): boolean => useSyncExternalStore(subscribe, () => current !== null);

/** Suona una nota con lo strumento del canale. */
export function previewNote(ch: SongChannel, pitch: number): void {
  const song = { bpm: 120, length: 2, loop: false, echo: 0, channels: [{ ...ch, notes: [{ step: 0, len: 1, pitch }] }] };
  playOnce(renderSong(song));
}

/** Ascolta un brano o un effetto creato nella scheda Musica. */
export function previewAsset(a: AudioAsset): void {
  if (a.song) playSamples(renderSong(a.song));
  else if (a.sfx) playOnce(renderSfx(a.sfx));
}

export const useSelectedSound = (): string => useSyncExternalStore(subscribe, () => selected);

export function selectSound(id: string): void {
  selected = id;
  notify();
}

/** Apre un suono nella scheda Musica. */
export function openInMusic(id: string): void {
  selectSound(id);
  setState({ centerTab: "music" });
}

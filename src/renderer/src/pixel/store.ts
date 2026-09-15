import { useSyncExternalStore } from "react";
import type { ImageAsset } from "@runtime";
import { api } from "../api";
import { T } from "../i18n";
import { assetUrl, uniqueId } from "../projectOps";
import { editProject, getState as getEditor, log, setState as setEditor } from "../store";
import * as px from "./doc";

/**
 * Stato del Disegno (scheda pixel art). Resta in memoria anche cambiando scheda;
 * ha il suo Annulla/Ripeti, separato da quello del progetto.
 */

export type PixelTool = "pencil" | "eraser" | "fill" | "line" | "rect" | "ellipse" | "picker" | "move";

export interface PixelState {
  doc: px.PixelDoc | null;
  /** Asset che si sta modificando; "" = disegno nuovo, non ancora salvato. */
  assetId: string;
  /** Nome con cui il disegno diventa un asset. */
  name: string;
  tool: PixelTool;
  primary: string;
  secondary: string;
  size: number;
  mirrorX: boolean;
  mirrorY: boolean;
  /** Rettangoli ed ellissi pieni. */
  filled: boolean;
  frame: number;
  layer: number;
  zoom: number;
  grid: boolean;
  onion: boolean;
  playing: boolean;
  paletteId: string;
  dirty: boolean;
  saving: boolean;
  /** Cresce a ogni modifica dei pixel: le viste si ridisegnano. */
  version: number;
  canUndo: boolean;
  canRedo: boolean;
}

let state: PixelState = {
  doc: null,
  assetId: "",
  name: "disegno",
  tool: "pencil",
  primary: "#1d2b53",
  secondary: "#ffffff",
  size: 1,
  mirrorX: false,
  mirrorY: false,
  filled: false,
  frame: 0,
  layer: 0,
  zoom: 16,
  grid: true,
  onion: false,
  playing: false,
  paletteId: "pico8",
  dirty: false,
  saving: false,
  version: 0,
  canUndo: false,
  canRedo: false,
};

const listeners = new Set<() => void>();

export const getPixelState = () => state;

export function setPixelState(patch: Partial<PixelState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function usePixel<V>(selector: (s: PixelState) => V): V {
  return useSyncExternalStore(subscribe, () => selector(state));
}

const layerName = (n: number) => T("Livello {0}", n);
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

// ------------------------------------------------------------------ Annulla / Ripeti

interface Snapshot {
  w: number;
  h: number;
  layers: px.PixelLayer[];
  cels: Uint32Array[][];
  frame: number;
  layer: number;
}

const past: Snapshot[] = [];
const future: Snapshot[] = [];

const snap = (d: px.PixelDoc): Snapshot => ({
  w: d.w,
  h: d.h,
  layers: d.layers.map((l) => ({ ...l })),
  cels: px.cloneCels(d),
  frame: state.frame,
  layer: state.layer,
});

/** Da chiamare prima di ogni modifica: la mette nella storia. */
function record(): void {
  if (!state.doc) return;
  past.push(snap(state.doc));
  if (past.length > 100) past.shift();
  future.length = 0;
}

function changed(patch: Partial<PixelState> = {}): void {
  setPixelState({ ...patch, version: state.version + 1, dirty: true, canUndo: past.length > 0, canRedo: future.length > 0 });
}

function restore(sn: Snapshot): void {
  const d = state.doc!;
  d.w = sn.w;
  d.h = sn.h;
  d.layers = sn.layers;
  d.cels = sn.cels;
  changed({ frame: Math.min(sn.frame, d.cels.length - 1), layer: Math.min(sn.layer, d.layers.length - 1) });
}

export function pixelUndo(): void {
  const d = state.doc;
  const sn = past.pop();
  if (!d || !sn) return;
  future.push(snap(d));
  restore(sn);
}

export function pixelRedo(): void {
  const d = state.doc;
  const sn = future.pop();
  if (!d || !sn) return;
  past.push(snap(d));
  restore(sn);
}

// ------------------------------------------------------------------ tratti sulla tela

interface Stroke {
  tool: PixelTool;
  color: number;
  x0: number;
  y0: number;
  lx: number;
  ly: number;
  /** Il livello com'era all'inizio (linee, forme e spostamento si ridisegnano da qui). */
  base: Uint32Array;
}

let stroke: Stroke | null = null;

const currentCel = () => state.doc!.cels[state.frame][state.layer];
const brush = (): px.Brush => ({ size: state.size, mirrorX: state.mirrorX, mirrorY: state.mirrorY });

function pick(x: number, y: number, secondary: boolean): void {
  const d = state.doc!;
  if (x < 0 || y < 0 || x >= d.w || y >= d.h) return;
  const c = px.composite(d, state.frame)[y * d.w + x];
  if (c >>> 24 === 0) return;
  const hex = px.colorToHex((c | 0xff000000) >>> 0);
  setPixelState(secondary ? { secondary: hex } : { primary: hex });
}

function applyStroke(x: number, y: number): void {
  const d = state.doc!;
  const s = stroke!;
  const cel = currentCel();
  switch (s.tool) {
    case "pencil":
    case "eraser":
      px.drawPoints(d, cel, px.linePoints(s.lx, s.ly, x, y), s.color, brush());
      break;
    case "line":
      cel.set(s.base);
      px.drawPoints(d, cel, px.linePoints(s.x0, s.y0, x, y), s.color, brush());
      break;
    case "rect":
      cel.set(s.base);
      px.drawPoints(d, cel, px.rectPoints(s.x0, s.y0, x, y, state.filled), s.color, brush());
      break;
    case "ellipse":
      cel.set(s.base);
      px.drawPoints(d, cel, px.ellipsePoints(s.x0, s.y0, x, y, state.filled), s.color, brush());
      break;
    case "move":
      cel.set(px.shiftCel(d, s.base, x - s.x0, y - s.y0));
      break;
  }
  s.lx = x;
  s.ly = y;
}

/** Inizio di un tratto: tasto sinistro = colore principale, destro = secondario, Alt = contagocce. */
export function strokeStart(x: number, y: number, button: number, alt: boolean): void {
  if (!state.doc) return;
  const tool = alt ? "picker" : state.tool;
  if (tool === "picker") return pick(x, y, button === 2);
  record();
  const color = tool === "eraser" ? 0 : px.hexToColor(button === 2 ? state.secondary : state.primary);
  const cel = currentCel();
  if (tool === "fill") {
    px.floodFill(state.doc, cel, x, y, color);
    return changed();
  }
  stroke = { tool, color, x0: x, y0: y, lx: x, ly: y, base: cel.slice() };
  applyStroke(x, y);
  changed();
}

export function strokeMove(x: number, y: number, alt: boolean, button: number): void {
  if (!state.doc) return;
  if (!stroke) {
    if (alt || state.tool === "picker") pick(x, y, button === 2);
    return;
  }
  if (x === stroke.lx && y === stroke.ly) return;
  applyStroke(x, y);
  changed();
}

export function strokeEnd(): void {
  stroke = null;
}

// ------------------------------------------------------------------ comandi

function edit(fn: (d: px.PixelDoc) => Partial<PixelState> | void): void {
  const d = state.doc;
  if (!d) return;
  record();
  changed(fn(d) ?? {});
}

export const addLayer = () => edit((d) => ({ layer: px.addLayer(d, state.layer, layerName(d.layers.length + 1)) }));
export const removeLayer = () => edit((d) => ({ layer: px.removeLayer(d, state.layer) }));
export const moveLayer = (dir: number) => edit((d) => ({ layer: px.moveLayer(d, state.layer, dir) }));
export const mergeDown = () => edit((d) => ({ layer: px.mergeDown(d, state.layer) }));
export const toggleLayer = (i: number) => edit((d) => void (d.layers[i].visible = !d.layers[i].visible));
export const renameLayer = (i: number, name: string) => edit((d) => void (d.layers[i].name = name.trim() || d.layers[i].name));
export const selectLayer = (i: number) => setPixelState({ layer: i });

export const addFrame = () => edit((d) => ({ frame: px.addFrame(d, state.frame) }));
export const duplicateFrame = () => edit((d) => ({ frame: px.duplicateFrame(d, state.frame) }));
export const removeFrame = () => edit((d) => ({ frame: px.removeFrame(d, state.frame) }));
export const moveFrame = (dir: number) => edit((d) => ({ frame: px.moveFrame(d, state.frame, dir) }));

export function selectFrame(i: number): void {
  const n = state.doc?.cels.length ?? 1;
  setPixelState({ frame: ((i % n) + n) % n });
}

export const clearCel = () => edit(() => void currentCel().fill(0));
export const flipCel = (horizontal: boolean) => edit((d) => px.flipCel(d, currentCel(), horizontal));
export const resizeDoc = (w: number, h: number) => edit((d) => px.resizeDoc(d, w, h));

export function setFps(fps: number): void {
  if (!state.doc) return;
  state.doc.fps = Math.max(1, Math.min(60, Math.round(fps) || 1));
  changed();
  if (state.playing) {
    stopPlay();
    startPlay();
  }
}

export const swapColors = () => setPixelState({ primary: state.secondary, secondary: state.primary });

export function addPaletteColor(): void {
  const d = state.doc;
  if (!d || d.palette.includes(state.primary)) return;
  d.palette.push(state.primary);
  changed();
}

export function removePaletteColor(hex: string): void {
  const d = state.doc;
  if (!d) return;
  d.palette = d.palette.filter((c) => c !== hex);
  changed();
}

const ZOOMS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48];

export function zoomBy(dir: number): void {
  const i = ZOOMS.findIndex((z) => z >= state.zoom);
  const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? ZOOMS.length - 1 : i) + dir))];
  setPixelState({ zoom: next });
}

const fitZoom = (d: px.PixelDoc) => Math.max(1, Math.min(32, Math.floor(384 / Math.max(d.w, d.h))));

let timer = 0;

function stopPlay(): void {
  if (timer) clearInterval(timer);
  timer = 0;
}

function startPlay(): void {
  const d = state.doc;
  if (!d) return;
  timer = window.setInterval(() => selectFrame(state.frame + 1), 1000 / d.fps);
}

export function togglePixelPlay(): void {
  if (state.playing) {
    stopPlay();
    return setPixelState({ playing: false });
  }
  if ((state.doc?.cels.length ?? 0) < 2) return;
  startPlay();
  setPixelState({ playing: true });
}

// ------------------------------------------------------------------ nuovo, apri, salva

function loadDoc(doc: px.PixelDoc, assetId: string, name: string): void {
  stopPlay();
  past.length = 0;
  future.length = 0;
  stroke = null;
  setPixelState({
    doc,
    assetId,
    name,
    frame: 0,
    layer: doc.layers.length - 1,
    zoom: fitZoom(doc),
    dirty: false,
    playing: false,
    canUndo: false,
    canRedo: false,
    version: state.version + 1,
  });
}

export function newDoc(name: string, w: number, h: number): void {
  loadDoc(px.createDoc(w, h, layerName(1)), "", slug(name) || "disegno");
}

/** Torna alla schermata iniziale del Disegno (nuovo o apri). */
export function closeDoc(): void {
  stopPlay();
  setPixelState({ doc: null, playing: false });
}

/** Scheda Disegno aperta sulla schermata "nuovo disegno". */
export function startNewDrawing(): void {
  closeDoc();
  setEditor({ centerTab: "paint" });
}

/** Nel browser le immagini non si scrivono su disco: il disegno modificabile resta qui finché la pagina è aperta. */
const webSidecars = new Map<string, string>();
let warnedWeb = false;

async function docFromImage(url: string, a: ImageAsset): Promise<px.PixelDoc> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // Da blob: l'immagine è "nostra" e se ne possono leggere i pixel anche se arriva da pepino://.
  const bmp = await createImageBitmap(await res.blob());
  const fw = a.frameWidth || bmp.width;
  const fh = a.frameHeight || bmp.height;
  if (fw > px.MAX_SIZE || fh > px.MAX_SIZE) throw new Error(T("L'immagine è troppo grande per il Disegno (massimo {0} pixel).", px.MAX_SIZE));
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const g = c.getContext("2d")!;
  g.drawImage(bmp, 0, 0);
  const data = new Uint32Array(g.getImageData(0, 0, c.width, c.height).data.buffer);
  const frames = px.framesFromPixels(data, bmp.width, bmp.height, fw, fh);
  const doc = px.createDoc(fw, fh, layerName(1), frames.length);
  frames.forEach((f, i) => (doc.cels[i][0] = f));
  doc.fps = Object.values(a.animations ?? {})[0]?.fps ?? 8;
  return doc;
}

/** Apre un'immagine del progetto nel Disegno: con i suoi livelli se è stata disegnata qui, altrimenti come un livello solo. */
export async function openImageAsset(id: string): Promise<void> {
  const ed = getEditor();
  const a = ed.project?.assets.find((x): x is ImageAsset => x.id === id && x.type === "image");
  if (!a) return;
  try {
    let doc: px.PixelDoc | null = null;
    const memo = webSidecars.get(id);
    if (memo) doc = px.deserializeDoc(JSON.parse(memo));
    else if (a.pixel) {
      const res = await fetch(assetUrl(ed.baseUrl, a.pixel, a.rev));
      if (res.ok) doc = px.deserializeDoc(await res.json());
    }
    doc ??= await docFromImage(assetUrl(ed.baseUrl, a.src, a.rev), a);
    loadDoc(doc, id, id);
    setEditor({ centerTab: "paint" });
  } catch (e) {
    log("error", T("Immagine non aperta: {0}", errorText(e)));
  }
}

/**
 * Salva il disegno come immagine del progetto: uno sprite sheet PNG (fotogrammi in fila) più il file
 * con livelli e fotogrammi, per riaprirlo. Se l'asset non c'è ancora, lo crea.
 */
export async function saveDoc(): Promise<void> {
  const d = state.doc;
  const p = getEditor().project;
  if (!d || !p || state.saving) return;
  setPixelState({ saving: true });
  try {
    const existing = p.assets.find((x): x is ImageAsset => x.id === state.assetId && x.type === "image");
    const id = existing?.id ?? uniqueId(slug(state.name) || "disegno", new Set(p.assets.map((x) => x.id)));
    const sheet = px.sheetPixels(d);
    const canvas = document.createElement("canvas");
    canvas.width = sheet.width;
    canvas.height = sheet.height;
    canvas.getContext("2d")!.putImageData(px.toImageData(sheet.data, sheet.width, sheet.height), 0, 0);
    const dataUrl = canvas.toDataURL("image/png");
    const file = JSON.stringify(px.serializeDoc(d));
    let src: string;
    let pixel: string | undefined;
    if (api.writeAsset) {
      src = existing && /^assets\/.+\.png$/i.test(existing.src) ? existing.src : `assets/${id}.png`;
      pixel = existing?.pixel ?? `assets/${id}.pixel.json`;
      await api.writeAsset(src, dataUrl.slice(dataUrl.indexOf(",") + 1));
      await api.writeAsset(pixel, px.bytesToBase64(new TextEncoder().encode(file)));
    } else {
      src = dataUrl;
      webSidecars.set(id, file);
      if (!warnedWeb) {
        warnedWeb = true;
        log("warn", T("Nel browser l'immagine resta solo in memoria: per salvarla su file usa l'app desktop."));
      }
    }
    const frames = d.cels.length;
    editProject((proj) => {
      let a = proj.assets.find((x): x is ImageAsset => x.id === id && x.type === "image");
      if (!a) {
        a = { id, type: "image", src };
        proj.assets.push(a);
      }
      a.src = src;
      a.pixel = pixel;
      a.rev = (a.rev ?? 0) + 1;
      if (frames > 1 || a.frameWidth) {
        a.frameWidth = d.w;
        a.frameHeight = d.h;
      }
      if (frames > 1 && !a.animations) a.animations = { animazione: { frames: d.cels.map((_, i) => i), fps: d.fps, loop: true } };
    });
    setPixelState({ assetId: id, name: id, dirty: false, saving: false });
    log("info", T("Immagine salvata: {0}", id));
  } catch (e) {
    setPixelState({ saving: false });
    log("error", T("Immagine non salvata: {0}", errorText(e)));
  }
}

// ------------------------------------------------------------------ tastiera

const TOOL_KEYS: Record<string, PixelTool> = { b: "pencil", e: "eraser", g: "fill", l: "line", r: "rect", o: "ellipse", i: "picker", m: "move" };

/** Scorciatoie della scheda Disegno; true = tasto usato. */
export function pixelKey(e: KeyboardEvent): boolean {
  if (!state.doc) return false;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === "z") {
    if (e.shiftKey) pixelRedo();
    else pixelUndo();
    return true;
  }
  if (mod && k === "y") {
    pixelRedo();
    return true;
  }
  if (mod || e.altKey) return false;
  if (Object.hasOwn(TOOL_KEYS, k)) {
    setPixelState({ tool: TOOL_KEYS[k] });
    return true;
  }
  if (k === "x") swapColors();
  else if (k === "[") setPixelState({ size: Math.max(1, state.size - 1) });
  else if (k === "]") setPixelState({ size: Math.min(8, state.size + 1) });
  else if (k === ",") selectFrame(state.frame - 1);
  else if (k === ".") selectFrame(state.frame + 1);
  else if (e.key === "Delete") clearCel();
  else return false;
  return true;
}

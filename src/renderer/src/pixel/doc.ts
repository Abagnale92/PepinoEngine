/**
 * Disegno in pixel art dell'editor: livelli e fotogrammi, come in Aseprite.
 * I colori sono interi 0xAABBGGRR, lo stesso ordine dei byte di ImageData (R, G, B, A): 0 = trasparente.
 */

export interface PixelLayer {
  name: string;
  visible: boolean;
}

export interface PixelDoc {
  w: number;
  h: number;
  /** Dal basso verso l'alto: l'ultimo livello copre gli altri. */
  layers: PixelLayer[];
  /** cels[fotogramma][livello]: i pixel di un livello in un fotogramma, riga per riga. */
  cels: Uint32Array[][];
  fps: number;
  /** Colori messi da parte per questo disegno. */
  palette: string[];
}

export const MAX_SIZE = 512;

export const clampSize = (n: number): number => Math.max(1, Math.min(MAX_SIZE, Math.round(Number(n) || 1)));

export function hexToColor(hex: string): number {
  let h = hex.replace("#", "").trim();
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255;
  if ([r, g, b, a].some(Number.isNaN)) return 0;
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

const hex2 = (n: number) => n.toString(16).padStart(2, "0");

/** "#rrggbb", con l'alfa in fondo solo se il colore non è pieno. */
export function colorToHex(c: number): string {
  const a = c >>> 24;
  return `#${hex2(c & 255)}${hex2((c >>> 8) & 255)}${hex2((c >>> 16) & 255)}${a === 255 ? "" : hex2(a)}`;
}

export function createDoc(w: number, h: number, layerName: string, frames = 1): PixelDoc {
  const W = clampSize(w);
  const H = clampSize(h);
  return {
    w: W,
    h: H,
    layers: [{ name: layerName, visible: true }],
    cels: Array.from({ length: Math.max(1, frames) }, () => [new Uint32Array(W * H)]),
    fps: 8,
    palette: [],
  };
}

export const cloneCels = (doc: PixelDoc): Uint32Array[][] => doc.cels.map((f) => f.map((c) => c.slice()));

export function getPixel(doc: PixelDoc, cel: Uint32Array, x: number, y: number): number {
  return x >= 0 && y >= 0 && x < doc.w && y < doc.h ? cel[y * doc.w + x] : 0;
}

export function setPixel(doc: PixelDoc, cel: Uint32Array, x: number, y: number, c: number): void {
  if (x >= 0 && y >= 0 && x < doc.w && y < doc.h) cel[y * doc.w + x] = c;
}

export interface Brush {
  size: number;
  /** Ripete il tratto a specchio: sinistra-destra e/o sopra-sotto. */
  mirrorX?: boolean;
  mirrorY?: boolean;
}

/** Un colpo di pennello quadrato centrato in (x, y). */
export function stamp(doc: PixelDoc, cel: Uint32Array, x: number, y: number, c: number, b: Brush): void {
  const n = Math.max(1, Math.round(b.size));
  const from = -Math.floor((n - 1) / 2);
  for (let dy = from; dy < from + n; dy++) {
    for (let dx = from; dx < from + n; dx++) {
      const px = x + dx;
      const py = y + dy;
      setPixel(doc, cel, px, py, c);
      if (b.mirrorX) setPixel(doc, cel, doc.w - 1 - px, py, c);
      if (b.mirrorY) setPixel(doc, cel, px, doc.h - 1 - py, c);
      if (b.mirrorX && b.mirrorY) setPixel(doc, cel, doc.w - 1 - px, doc.h - 1 - py, c);
    }
  }
}

export function drawPoints(doc: PixelDoc, cel: Uint32Array, pts: [number, number][], c: number, b: Brush): void {
  for (const [x, y] of pts) stamp(doc, cel, x, y, c, b);
}

/** Punti di una linea (Bresenham): senza buchi e senza doppioni. */
export function linePoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const pts: [number, number][] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    pts.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return pts;
}

const box = (x0: number, y0: number, x1: number, y1: number) => [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];

export function rectPoints(x0: number, y0: number, x1: number, y1: number, filled: boolean): [number, number][] {
  const [ax, ay, bx, by] = box(x0, y0, x1, y1);
  const pts: [number, number][] = [];
  for (let y = ay; y <= by; y++) {
    for (let x = ax; x <= bx; x++) if (filled || x === ax || x === bx || y === ay || y === by) pts.push([x, y]);
  }
  return pts;
}

/** Ellisse dentro il rettangolo (x0, y0)–(x1, y1): il bordo sono i punti dentro con un vicino fuori. */
export function ellipsePoints(x0: number, y0: number, x1: number, y1: number, filled: boolean): [number, number][] {
  const [ax, ay, bx, by] = box(x0, y0, x1, y1);
  const rx = (bx - ax + 1) / 2;
  const ry = (by - ay + 1) / 2;
  const cx = ax + rx;
  const cy = ay + ry;
  const inside = (x: number, y: number) => {
    const u = (x + 0.5 - cx) / rx;
    const v = (y + 0.5 - cy) / ry;
    return u * u + v * v <= 1.0001;
  };
  const pts: [number, number][] = [];
  for (let y = ay; y <= by; y++) {
    for (let x = ax; x <= bx; x++) {
      if (!inside(x, y)) continue;
      if (filled || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) pts.push([x, y]);
    }
  }
  return pts;
}

/** Secchiello: colora l'area dello stesso colore toccata da (x, y). Restituisce quanti pixel ha cambiato. */
export function floodFill(doc: PixelDoc, cel: Uint32Array, x: number, y: number, c: number): number {
  if (x < 0 || y < 0 || x >= doc.w || y >= doc.h) return 0;
  const target = cel[y * doc.w + x];
  if (target === c) return 0;
  const stack = [y * doc.w + x];
  let n = 0;
  while (stack.length) {
    const i = stack.pop()!;
    if (cel[i] !== target) continue;
    cel[i] = c;
    n++;
    const px = i % doc.w;
    if (px > 0) stack.push(i - 1);
    if (px < doc.w - 1) stack.push(i + 1);
    if (i >= doc.w) stack.push(i - doc.w);
    if (i < doc.w * (doc.h - 1)) stack.push(i + doc.w);
  }
  return n;
}

/** Copia del livello spostata di (dx, dy): quello che esce dal bordo sparisce. */
export function shiftCel(doc: PixelDoc, src: Uint32Array, dx: number, dy: number): Uint32Array {
  const out = new Uint32Array(src.length);
  for (let y = 0; y < doc.h; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= doc.h) continue;
    for (let x = 0; x < doc.w; x++) {
      const sx = x - dx;
      if (sx >= 0 && sx < doc.w) out[y * doc.w + x] = src[sy * doc.w + sx];
    }
  }
  return out;
}

export function flipCel(doc: PixelDoc, cel: Uint32Array, horizontal: boolean): void {
  const src = cel.slice();
  for (let y = 0; y < doc.h; y++) {
    for (let x = 0; x < doc.w; x++) {
      cel[y * doc.w + x] = horizontal ? src[y * doc.w + (doc.w - 1 - x)] : src[(doc.h - 1 - y) * doc.w + x];
    }
  }
}

/** Colore `src` appoggiato sopra `dst`, tenendo conto della trasparenza. */
export function blendOver(dst: number, src: number): number {
  const sa = src >>> 24;
  if (sa === 255) return src;
  if (sa === 0) return dst;
  const da = dst >>> 24;
  const outA = sa + (da * (255 - sa)) / 255;
  const ch = (shift: number) => {
    const s = (src >>> shift) & 255;
    const d = (dst >>> shift) & 255;
    return Math.round((s * sa + (d * da * (255 - sa)) / 255) / outA);
  };
  return ((Math.round(outA) << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0;
}

/** Immagine di un fotogramma con i livelli visibili uno sopra l'altro. */
export function composite(doc: PixelDoc, frame: number): Uint32Array {
  const out = new Uint32Array(doc.w * doc.h);
  const cels = doc.cels[frame] ?? [];
  doc.layers.forEach((l, li) => {
    const cel = cels[li];
    if (!l.visible || !cel) return;
    for (let i = 0; i < out.length; i++) if (cel[i]) out[i] = blendOver(out[i], cel[i]);
  });
  return out;
}

/** Sprite sheet: i fotogrammi uno accanto all'altro, nell'ordine (il fotogramma 0 è il primo a sinistra). */
export function sheetPixels(doc: PixelDoc): { width: number; height: number; data: Uint32Array } {
  const width = doc.w * doc.cels.length;
  const data = new Uint32Array(width * doc.h);
  doc.cels.forEach((_, f) => {
    const img = composite(doc, f);
    for (let y = 0; y < doc.h; y++) data.set(img.subarray(y * doc.w, (y + 1) * doc.w), y * width + f * doc.w);
  });
  return { width, height: doc.h, data };
}

/** Pixel pronti da mettere su un canvas 2D (stessa memoria, nessuna copia). */
export function toImageData(data: Uint32Array, w: number, h: number): ImageData {
  return new ImageData(new Uint8ClampedArray(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength), w, h);
}

/** Divide un'immagine a griglia in fotogrammi, riga per riga (come lo sprite sheet del gioco). */
export function framesFromPixels(data: Uint32Array, width: number, height: number, fw: number, fh: number): Uint32Array[] {
  const cols = Math.max(1, Math.floor(width / fw));
  const rows = Math.max(1, Math.floor(height / fh));
  const frames: Uint32Array[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const f = new Uint32Array(fw * fh);
      for (let y = 0; y < fh; y++) {
        const sy = r * fh + y;
        if (sy < height) f.set(data.subarray(sy * width + c * fw, sy * width + Math.min(width, c * fw + fw)), y * fw);
      }
      frames.push(f);
    }
  }
  return frames;
}

/** Cambia la dimensione del disegno tenendo fermo l'angolo in alto a sinistra. */
export function resizeDoc(doc: PixelDoc, w: number, h: number): void {
  const W = clampSize(w);
  const H = clampSize(h);
  doc.cels = doc.cels.map((f) =>
    f.map((cel) => {
      const out = new Uint32Array(W * H);
      for (let y = 0; y < Math.min(H, doc.h); y++) out.set(cel.subarray(y * doc.w, y * doc.w + Math.min(W, doc.w)), y * W);
      return out;
    }),
  );
  doc.w = W;
  doc.h = H;
}

// ------------------------------------------------------------------ livelli e fotogrammi (restituiscono il nuovo indice)

export function addLayer(doc: PixelDoc, above: number, name: string): number {
  const i = Math.min(doc.layers.length, above + 1);
  doc.layers.splice(i, 0, { name, visible: true });
  for (const f of doc.cels) f.splice(i, 0, new Uint32Array(doc.w * doc.h));
  return i;
}

export function removeLayer(doc: PixelDoc, i: number): number {
  if (doc.layers.length <= 1) return i;
  doc.layers.splice(i, 1);
  for (const f of doc.cels) f.splice(i, 1);
  return Math.max(0, i - 1);
}

export function moveLayer(doc: PixelDoc, i: number, dir: number): number {
  const j = i + dir;
  if (j < 0 || j >= doc.layers.length) return i;
  [doc.layers[i], doc.layers[j]] = [doc.layers[j], doc.layers[i]];
  for (const f of doc.cels) [f[i], f[j]] = [f[j], f[i]];
  return j;
}

/** Unisce il livello a quello sotto, in tutti i fotogrammi. */
export function mergeDown(doc: PixelDoc, i: number): number {
  if (i <= 0) return i;
  for (const f of doc.cels) {
    const below = f[i - 1];
    const above = f[i];
    for (let p = 0; p < below.length; p++) if (above[p]) below[p] = blendOver(below[p], above[p]);
  }
  doc.layers.splice(i, 1);
  for (const f of doc.cels) f.splice(i, 1);
  return i - 1;
}

export function addFrame(doc: PixelDoc, after: number): number {
  const i = Math.min(doc.cels.length, after + 1);
  doc.cels.splice(i, 0, doc.layers.map(() => new Uint32Array(doc.w * doc.h)));
  return i;
}

export function duplicateFrame(doc: PixelDoc, f: number): number {
  doc.cels.splice(f + 1, 0, doc.cels[f].map((c) => c.slice()));
  return f + 1;
}

export function removeFrame(doc: PixelDoc, f: number): number {
  if (doc.cels.length <= 1) return f;
  doc.cels.splice(f, 1);
  return Math.min(f, doc.cels.length - 1);
}

export function moveFrame(doc: PixelDoc, f: number, dir: number): number {
  const j = f + dir;
  if (j < 0 || j >= doc.cels.length) return f;
  [doc.cels[f], doc.cels[j]] = [doc.cels[j], doc.cels[f]];
  return j;
}

// ------------------------------------------------------------------ file del disegno

export interface PixelFile {
  format: "pepino-pixel";
  version: 1;
  w: number;
  h: number;
  fps: number;
  palette: string[];
  layers: PixelLayer[];
  /** frames[fotogramma][livello]: pixel RGBA in base64. */
  frames: string[][];
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const encodeCel = (cel: Uint32Array): string => bytesToBase64(new Uint8Array(cel.buffer, cel.byteOffset, cel.byteLength));

export function decodeCel(b64: string, n: number): Uint32Array {
  const out = new Uint32Array(n);
  const bytes = base64ToBytes(b64);
  new Uint8Array(out.buffer).set(bytes.subarray(0, n * 4));
  return out;
}

export function serializeDoc(doc: PixelDoc): PixelFile {
  return {
    format: "pepino-pixel",
    version: 1,
    w: doc.w,
    h: doc.h,
    fps: doc.fps,
    palette: [...doc.palette],
    layers: doc.layers.map((l) => ({ ...l })),
    frames: doc.cels.map((f) => f.map(encodeCel)),
  };
}

export function deserializeDoc(f: PixelFile): PixelDoc {
  if (f?.format !== "pepino-pixel") throw new Error("Il file non è un disegno di Pepino.");
  const w = clampSize(f.w);
  const h = clampSize(f.h);
  const layers = f.layers?.length ? f.layers.map((l) => ({ name: String(l.name), visible: l.visible !== false })) : [{ name: "1", visible: true }];
  const frames = f.frames?.length ? f.frames : [[]];
  return {
    w,
    h,
    layers,
    cels: frames.map((fr) => layers.map((_, i) => (fr[i] ? decodeCel(fr[i], w * h) : new Uint32Array(w * h)))),
    fps: Math.max(1, Number(f.fps) || 8),
    palette: Array.isArray(f.palette) ? f.palette.filter((c) => typeof c === "string") : [],
  };
}

// ------------------------------------------------------------------ tavolozze

export interface Palette {
  id: string;
  label: string;
  colors: string[];
}

export const PALETTES: Palette[] = [
  {
    id: "pico8",
    label: "PICO-8",
    colors: [
      "#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8",
      "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa",
    ],
  },
  {
    id: "pepino",
    label: "Pepino",
    colors: [
      "#0d180e", "#1d3b1f", "#2c4a2c", "#4f7d3a", "#6aa75e", "#8cc480", "#c8f7a8", "#f4f4e8",
      "#8fd3ff", "#4a8fd6", "#6b4a2b", "#9b6b3c", "#d8a468", "#e5695f", "#b452e0", "#f0b43c",
    ],
  },
  {
    id: "sweetie16",
    label: "Sweetie 16",
    colors: [
      "#1a1c2c", "#5d275d", "#b13e53", "#ef7d57", "#ffcd75", "#a7f070", "#38b764", "#257179",
      "#29366f", "#3b5dc9", "#41a6f6", "#73eff7", "#f4f4f4", "#94b0c2", "#566c86", "#333c57",
    ],
  },
  { id: "gameboy", label: "Game Boy", colors: ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"] },
  { id: "grays", label: "Grigi", colors: ["#000000", "#242424", "#494949", "#6d6d6d", "#929292", "#b6b6b6", "#dbdbdb", "#ffffff"] },
];

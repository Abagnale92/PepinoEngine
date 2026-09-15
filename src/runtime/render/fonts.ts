/**
 * Caratteri dei testi del gioco.
 * I caratteri "Pixel" sono disegnati punto per punto (bitmap): restano nitidi come la pixel art a qualsiasi zoom.
 * Gli altri usano i caratteri del sistema; in più ci sono quelli importati nel progetto (.ttf, .otf, .woff).
 */

export interface FontInfo {
  id: string;
  label: string;
  /** Famiglia CSS dei caratteri del sistema; assente per quelli a punti. */
  css?: string;
}

export const SANS_CSS = '"Segoe UI", system-ui, sans-serif';

export const BUILTIN_FONTS: FontInfo[] = [
  { id: "pixel", label: "Pixel" },
  { id: "pixel-bold", label: "Pixel grassetto" },
  { id: "pixel-tiny", label: "Pixel piccolo" },
  { id: "sans", label: "Moderno", css: SANS_CSS },
  { id: "serif", label: "Classico", css: 'Georgia, "Times New Roman", serif' },
  { id: "mono", label: "Macchina da scrivere", css: 'Consolas, "Courier New", monospace' },
];

export const DEFAULT_FONT_ID = "sans";

export const isBuiltinFont = (id: string): boolean => BUILTIN_FONTS.some((f) => f.id === id);

export const fontCss = (id: string): string | undefined => BUILTIN_FONTS.find((f) => f.id === id)?.css;

/** Nome con cui un carattere importato viene registrato nel browser. */
export const fontFamilyName = (assetId: string): string => `pepino-font-${assetId}`;

// ------------------------------------------------------------------ caratteri a punti

export interface Glyph {
  w: number;
  /** Coppie x, y dei punti accesi; y = 0 è la cima delle maiuscole (gli accenti delle maiuscole stanno sopra). */
  pixels: number[];
}

export interface BitmapFont {
  id: string;
  /** Altezza delle maiuscole in punti. */
  cap: number;
  /** Punti che corrispondono alla dimensione del testo: con size = em un punto è grande un pixel. */
  em: number;
  bold: boolean;
  glyphs: Map<string, Glyph>;
  /** Le minuscole usano le maiuscole (carattere piccolo). */
  lowerToUpper: boolean;
}

/**
 * Lettere del carattere Pixel (maiuscole alte 7 punti, minuscole 5, code sotto la riga fino a 2).
 * Righe separate da "/", "#" = punto acceso. "@2:" = la prima riga è la numero 2.
 */
export const PIXEL_GLYPHS: Record<string, string> = {
  " ": "...",
  A: ".###./#...#/#...#/#####/#...#/#...#/#...#",
  B: "####./#...#/#...#/####./#...#/#...#/####.",
  C: ".###./#...#/#..../#..../#..../#...#/.###.",
  D: "####./#...#/#...#/#...#/#...#/#...#/####.",
  E: "#####/#..../#..../####./#..../#..../#####",
  F: "#####/#..../#..../####./#..../#..../#....",
  G: ".###./#...#/#..../#.###/#...#/#...#/.####",
  H: "#...#/#...#/#...#/#####/#...#/#...#/#...#",
  I: "###/.#./.#./.#./.#./.#./###",
  J: "..###/...#./...#./...#./#..#./#..#./.##..",
  K: "#...#/#..#./#.#../##.../#.#../#..#./#...#",
  L: "#..../#..../#..../#..../#..../#..../#####",
  M: "#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#",
  N: "#...#/#...#/##..#/#.#.#/#..##/#...#/#...#",
  O: ".###./#...#/#...#/#...#/#...#/#...#/.###.",
  P: "####./#...#/#...#/####./#..../#..../#....",
  Q: ".###./#...#/#...#/#...#/#.#.#/#..#./.##.#",
  R: "####./#...#/#...#/####./#.#../#..#./#...#",
  S: ".###./#...#/#..../.###./....#/#...#/.###.",
  T: "#####/..#../..#../..#../..#../..#../..#..",
  U: "#...#/#...#/#...#/#...#/#...#/#...#/.###.",
  V: "#...#/#...#/#...#/#...#/#...#/.#.#./..#..",
  W: "#...#/#...#/#...#/#.#.#/#.#.#/#.#.#/.#.#.",
  X: "#...#/#...#/.#.#./..#../.#.#./#...#/#...#",
  Y: "#...#/#...#/.#.#./..#../..#../..#../..#..",
  Z: "#####/....#/...#./..#../.#.../#..../#####",
  a: "@2:.##./...#/.###/#..#/.###",
  b: "#.../#.../###./#..#/#..#/#..#/###.",
  c: "@2:.###/#.../#.../#.../.###",
  d: "...#/...#/.###/#..#/#..#/#..#/.###",
  e: "@2:.##./#..#/####/#.../.###",
  f: ".##/#../###/#../#../#../#..",
  g: "@2:.###/#..#/#..#/#..#/.###/...#/.##.",
  h: "#.../#.../###./#..#/#..#/#..#/#..#",
  i: "#/./#/#/#/#/#",
  j: "..#/.../..#/..#/..#/..#/..#/#.#/.#.",
  k: "#.../#.../#..#/#.#./##../#.#./#..#",
  l: "#./#./#./#./#./#./.#",
  m: "@2:##.#./#.#.#/#.#.#/#.#.#/#.#.#",
  n: "@2:###./#..#/#..#/#..#/#..#",
  o: "@2:.##./#..#/#..#/#..#/.##.",
  p: "@2:###./#..#/#..#/#..#/###./#.../#...",
  q: "@2:.###/#..#/#..#/#..#/.###/...#/...#",
  r: "@2:#.##/##../#.../#.../#...",
  s: "@2:.###/#.../.##./...#/###.",
  t: ".#./.#./###/.#./.#./.#./..#",
  u: "@2:#..#/#..#/#..#/#..#/.###",
  v: "@2:#...#/#...#/.#.#./.#.#./..#..",
  w: "@2:#...#/#...#/#.#.#/#.#.#/.#.#.",
  x: "@2:#...#/.#.#./..#../.#.#./#...#",
  y: "@2:#..#/#..#/#..#/#..#/.###/...#/.##.",
  z: "@2:####/...#/..#./.#../####",
  ì: "#./.#/.#/.#/.#/.#/.#",
  í: ".#/#./#./#./#./#./#.",
  î: ".#./#.#/.#./.#./.#./.#./.#.",
  ï: "#.#/.../.#./.#./.#./.#./.#.",
  ç: "@2:.###/#.../#.../#.../.###/..#./.#..",
  Ç: ".###./#...#/#..../#..../#..../#...#/.###./..#../.#...",
  "0": ".###./#...#/#..##/#.#.#/##..#/#...#/.###.",
  "1": ".#./##./.#./.#./.#./.#./###",
  "2": ".###./#...#/....#/...#./..#../.#.../#####",
  "3": "#####/...#./..#../...#./....#/#...#/.###.",
  "4": "...#./..##./.#.#./#..#./#####/...#./...#.",
  "5": "#####/#..../####./....#/....#/#...#/.###.",
  "6": "..##./.#.../#..../####./#...#/#...#/.###.",
  "7": "#####/....#/...#./..#../.#.../.#.../.#...",
  "8": ".###./#...#/#...#/.###./#...#/#...#/.###.",
  "9": ".###./#...#/#...#/.####/....#/...#./.##..",
  "!": "#/#/#/#/#/./#",
  '"': "#.#/#.#",
  "#": ".#.#./.#.#./#####/.#.#./#####/.#.#./.#.#.",
  $: "..#../.####/#.#../.###./..#.#/####./..#..",
  "%": "##..#/##..#/...#./..#../.#.../#..##/#..##",
  "&": ".##../#..#./#.#../.#.../#.#.#/#..#./.##.#",
  "'": "#/#",
  "(": "..#/.#./#../#../#../.#./..#",
  ")": "#../.#./..#/..#/..#/.#./#..",
  "*": "@1:..#../#.#.#/.###./#.#.#/..#..",
  "+": "@1:..#../..#../#####/..#../..#..",
  ",": "@5:.#/.#/#.",
  "-": "@3:####",
  ".": "@6:#",
  "/": "....#/...#./...#./..#../.#.../.#.../#....",
  ":": "@2:#/./././#",
  ";": "@2:.#/../../../.#/.#/#.",
  "<": "...#/..#./.#../#.../.#../..#./...#",
  "=": "@2:####/..../####",
  ">": "#.../.#../..#./...#/..#./.#../#...",
  "?": ".###./#...#/....#/...#./..#../...../..#..",
  "@": ".###./#...#/#.###/#.#.#/#.###/#..../.####",
  "[": "##/#./#./#./#./#./##",
  "\\": "#..../.#.../.#.../..#../...#./...#./....#",
  "]": "##/.#/.#/.#/.#/.#/##",
  "^": "..#../.#.#./#...#",
  _: "@7:#####",
  "`": "#./.#",
  "{": "..#/.#./.#./#../.#./.#./..#",
  "|": "#/#/#/#/#/#/#",
  "}": "#../.#./.#./..#/.#./.#./#..",
  "~": "@2:.##.#/#.##.",
  "·": "@3:#",
  "…": "@6:#.#.#",
  "«": "@2:..#.#/.#.#./#.#../.#.#./..#.#",
  "»": "@2:#.#../.#.#./..#.#/.#.#./#.#..",
  "▶": "@1:#../##./###/##./#..",
  "◀": "@1:..#/.##/###/.##/..#",
  "▼": "@2:#####/.###./..#..",
  "▲": "@2:..#../.###./#####",
  "←": "@1:..#../.#.../#####/.#.../..#..",
  "→": "@1:..#../...#./#####/...#./..#..",
  "↑": "..#../.###./#.#.#/..#../..#../..#../..#..",
  "↓": "..#../..#../..#../..#../#.#.#/.###./..#..",
  "♥": "@1:.#.#./#####/#####/.###./..#..",
  "★": "..#../..#../#####/.###./.#.#./#...#",
  "°": ".#./#.#/.#.",
  "×": "@2:#...#/.#.#./..#../.#.#./#...#",
  "€": "..###/.#.../####./.#.../####./.#.../..###",
  "¿": "..#../...../..#../.#.../#..../#...#/.###.",
  "¡": "#/./#/#/#/#/#",
};

/** Lettere del carattere Pixel piccolo: maiuscole alte 5 punti, le minuscole sono uguali alle maiuscole. */
export const TINY_GLYPHS: Record<string, string> = {
  " ": "..",
  A: ".#./#.#/###/#.#/#.#",
  B: "##./#.#/##./#.#/##.",
  C: ".##/#../#../#../.##",
  D: "##./#.#/#.#/#.#/##.",
  E: "###/#../##./#../###",
  F: "###/#../##./#../#..",
  G: ".##/#../#.#/#.#/.##",
  H: "#.#/#.#/###/#.#/#.#",
  I: "###/.#./.#./.#./###",
  J: "..#/..#/..#/#.#/.#.",
  K: "#.#/#.#/##./#.#/#.#",
  L: "#../#../#../#../###",
  M: "#...#/##.##/#.#.#/#...#/#...#",
  N: "#..#/##.#/#.##/#..#/#..#",
  O: ".#./#.#/#.#/#.#/.#.",
  P: "##./#.#/##./#../#..",
  Q: ".#./#.#/#.#/##./.##",
  R: "##./#.#/##./#.#/#.#",
  S: ".##/#../.#./..#/##.",
  T: "###/.#./.#./.#./.#.",
  U: "#.#/#.#/#.#/#.#/###",
  V: "#.#/#.#/#.#/#.#/.#.",
  W: "#...#/#...#/#.#.#/#.#.#/.#.#.",
  X: "#.#/#.#/.#./#.#/#.#",
  Y: "#.#/#.#/.#./.#./.#.",
  Z: "###/..#/.#./#../###",
  Ç: ".##/#../#../#../.##/.#./#..",
  "0": "###/#.#/#.#/#.#/###",
  "1": ".#./##./.#./.#./###",
  "2": "##./..#/.#./#../###",
  "3": "##./..#/.#./..#/##.",
  "4": "#.#/#.#/###/..#/..#",
  "5": "###/#../##./..#/##.",
  "6": ".##/#../###/#.#/###",
  "7": "###/..#/.#./.#./.#.",
  "8": "###/#.#/###/#.#/###",
  "9": "###/#.#/###/..#/##.",
  "!": "#/#/#/./#",
  '"': "#.#/#.#",
  "#": "#.#/###/#.#/###/#.#",
  $: ".##/##./.#./.##/##.",
  "%": "#.#/..#/.#./#../#.#",
  "&": ".#./#.#/.#./#.#/.##",
  "'": "#/#",
  "(": ".#/#./#./#./.#",
  ")": "#./.#/.#/.#/#.",
  "*": "@1:#.#/.#./#.#",
  "+": "@1:.#./###/.#.",
  ",": "@4:.#/#.",
  "-": "@2:###",
  ".": "@4:#",
  "/": "..#/..#/.#./#../#..",
  ":": "@1:#/./#",
  ";": "@1:.#/../.#/#.",
  "<": "..#/.#./#../.#./..#",
  "=": "@1:###/.../###",
  ">": "#../.#./..#/.#./#..",
  "?": "##./..#/.#./.../.#.",
  "@": ".#./#.#/#.#/#../.##",
  "[": "##/#./#./#./##",
  "\\": "#../#../.#./..#/..#",
  "]": "##/.#/.#/.#/##",
  "^": ".#./#.#",
  _: "@5:###",
  "`": "#./.#",
  "{": ".##/.#./#../.#./.##",
  "|": "#/#/#/#/#",
  "}": "##./.#./..#/.#./##.",
  "~": "@1:.#.#/#.#.",
  "·": "@2:#",
  "…": "@4:#.#.#",
  "«": "@1:.#.#/#.#./.#.#",
  "»": "@1:#.#./.#.#/#.#.",
  "▶": "#../##./###/##./#..",
  "◀": "..#/.##/###/.##/..#",
  "▼": "@1:#####/.###./..#..",
  "▲": "@1:..#../.###./#####",
  "←": "..#../.#.../#####/.#.../..#..",
  "→": "..#../...#./#####/...#./..#..",
  "↑": "..#../.###./#.#.#/..#../..#..",
  "↓": "..#../..#../#.#.#/.###./..#..",
  "♥": ".#.#./#####/#####/.###./..#..",
  "★": "..#../#####/.###./.#.#./#...#",
  "°": "##/##",
  "×": "@1:#.#/.#./#.#",
  "€": ".##/#../##./#../.##",
  "¿": ".#./.../.#./#../.##",
  "¡": "#/./#/#/#",
};

type Accent = "grave" | "acute" | "circ" | "uml" | "tilde";

const ACCENTS: Record<Accent, string> = { grave: "#./.#", acute: ".#/#.", circ: ".#./#.#", uml: "#.#", tilde: ".#.#/#.#." };

/** Lettere accentate costruite da lettera + accento (le maiuscole si ricavano da sole). */
const ACCENTED: [string, string, Accent][] = [
  ["à", "a", "grave"], ["á", "a", "acute"], ["â", "a", "circ"], ["ä", "a", "uml"], ["ã", "a", "tilde"],
  ["è", "e", "grave"], ["é", "e", "acute"], ["ê", "e", "circ"], ["ë", "e", "uml"],
  ["ì", "i", "grave"], ["í", "i", "acute"], ["î", "i", "circ"], ["ï", "i", "uml"],
  ["ò", "o", "grave"], ["ó", "o", "acute"], ["ô", "o", "circ"], ["ö", "o", "uml"], ["õ", "o", "tilde"],
  ["ù", "u", "grave"], ["ú", "u", "acute"], ["û", "u", "circ"], ["ü", "u", "uml"],
  ["ñ", "n", "tilde"],
];

/** Caratteri tipografici che si disegnano come quelli semplici. */
const NORMALIZE = new Map([
  ["’", "'"],
  ["‘", "'"],
  ["“", '"'],
  ["”", '"'],
  ["–", "-"],
  ["—", "-"],
  [" ", " "],
]);

/** Righe di una lettera, senza il prefisso "@n:". */
export const glyphRows = (spec: string): string[] => spec.replace(/^@\d+:/, "").split("/");

function parseGlyph(spec: string): Glyph {
  const top = Number(/^@(\d+):/.exec(spec)?.[1] ?? 0);
  const rows = glyphRows(spec);
  const pixels: number[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "#") pixels.push(x, y + top);
  });
  return { w: Math.max(...rows.map((r) => r.length)), pixels };
}

function buildFont(
  id: string,
  specs: Record<string, string>,
  o: { cap: number; em: number; lowerToUpper: boolean; upperGap: number },
): BitmapFont {
  const glyphs = new Map<string, Glyph>();
  for (const [ch, spec] of Object.entries(specs)) glyphs.set(ch, parseGlyph(spec));
  for (const [lower, base, mark] of ACCENTED) {
    const variants: [string, string, boolean][] = [
      [lower, base, false],
      [lower.toUpperCase(), base.toUpperCase(), true],
    ];
    for (const [ch, b, upper] of variants) {
      if (glyphs.has(ch) || (!upper && o.lowerToUpper)) continue;
      const g = glyphs.get(b);
      if (!g) continue;
      const acc = parseGlyph(ACCENTS[mark]);
      // Minuscole: l'accento occupa le due righe libere sopra la lettera. Maiuscole: sta sopra la cima.
      const top = upper ? -glyphRows(ACCENTS[mark]).length - o.upperGap : 0;
      const ax = Math.floor((g.w - acc.w) / 2);
      const pixels = [...g.pixels];
      for (let i = 0; i < acc.pixels.length; i += 2) pixels.push(acc.pixels[i] + ax, acc.pixels[i + 1] + top);
      glyphs.set(ch, { w: Math.max(g.w, acc.w), pixels });
    }
  }
  return { id, cap: o.cap, em: o.em, bold: false, glyphs, lowerToUpper: o.lowerToUpper };
}

const PIXEL = buildFont("pixel", PIXEL_GLYPHS, { cap: 7, em: 10, lowerToUpper: false, upperGap: 0 });
const TINY = buildFont("pixel-tiny", TINY_GLYPHS, { cap: 5, em: 7, lowerToUpper: true, upperGap: 1 });

const BITMAP_FONTS = new Map<string, BitmapFont>([
  ["pixel", PIXEL],
  ["pixel-bold", { ...PIXEL, id: "pixel-bold", bold: true }],
  ["pixel-tiny", TINY],
]);

/** Carattere a punti con questo id, se è uno di quelli "Pixel". */
export const bitmapFont = (id: string): BitmapFont | undefined => BITMAP_FONTS.get(id);

function glyphOf(f: BitmapFont, ch: string): Glyph | undefined {
  const c = NORMALIZE.get(ch) ?? ch;
  return f.glyphs.get(c) ?? (f.lowerToUpper ? f.glyphs.get(c.toUpperCase()) : undefined);
}

/** Vero se il carattere ha tutte le lettere del testo (altrimenti si usa un carattere del sistema). */
export function canDrawBitmap(f: BitmapFont, str: string): boolean {
  for (const ch of str) if (!glyphOf(f, ch)) return false;
  return true;
}

/** Larghezza del testo in punti. */
export function measureBitmapText(f: BitmapFont, str: string, bold = f.bold): number {
  let w = 0;
  for (const ch of str) {
    const g = glyphOf(f, ch);
    if (g) w += g.w + 1 + (bold ? 1 : 0);
  }
  return Math.max(0, w - 1);
}

/** Grandezza di un punto in pixel dello schermo per un testo di dimensione `size`. */
export const bitmapUnit = (f: BitmapFont, size: number, scale: number): number => Math.max(1, Math.round((size * scale) / f.em));

/** Disegna il testo con il colore attuale di `ctx`; (x, y) = cima delle maiuscole della prima lettera. */
export function drawBitmapText(ctx: CanvasRenderingContext2D, f: BitmapFont, str: string, x: number, y: number, unit: number, bold = f.bold): void {
  let cx = x;
  for (const ch of str) {
    const g = glyphOf(f, ch);
    if (!g) continue;
    for (let i = 0; i < g.pixels.length; i += 2) ctx.fillRect(cx + g.pixels[i] * unit, y + g.pixels[i + 1] * unit, bold ? unit * 2 : unit, unit);
    cx += (g.w + 1 + (bold ? 1 : 0)) * unit;
  }
}

// Genera i modelli di «Nuovo progetto» (samples/templates) con i loro asset (samples/templates/assets)
// e poi gli eventuali giochi di esempio (scripts/<nome>/build.mjs, vedi in fondo).
// Tutto è creato da codice, così il repository non dipende da asset esterni.
import { deflateSync } from "node:zlib";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(ROOT, "samples", "templates", "assets");
mkdirSync(ASSETS, { recursive: true });

let seed = 7;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;

// ---------------------------------------------------------------- PNG

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(w, h, rgba) {
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * stride + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const hex = (c) => {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
};

class Pix {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4);
  }
  set(x, y, c) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const [r, g, b, a] = hex(c);
    const i = (y * this.w + x) * 4;
    this.data.set([r, g, b, a], i);
  }
  rect(x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  save(name) {
    writeFileSync(join(ASSETS, name), encodePng(this.w, this.h, this.data));
  }
}

/** Riempie una forma con il bordo scuro: `inside(x, y)` dice se il pixel è dentro. */
function shape(c, ox, oy, inside, fill, outline, [x0, y0, x1, y1]) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
      c.set(ox + x, oy + y, edge ? outline : fill);
    }
  }
}

const roundRect = (l, t, r, b) => (x, y) =>
  x >= l && x <= r && y >= t && y <= b && !((x === l || x === r) && (y === t || y === b));
const ellipse = (cx, cy, rx, ry) => (x, y) => ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;

function blob(c, ox, oy, cx, cy, rx, ry, color) {
  const inside = ellipse(cx, cy, rx, ry);
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) if (inside(x, y)) c.set(ox + x, oy + y, color);
}

const P = {
  grass: "#6cc24a", grassHi: "#9be26a", grassDk: "#3f8a36",
  dirt: "#8a5a3b", dirtDk: "#6b4229", dirtHi: "#a8744d",
  stone: "#8d8f9c", stoneDk: "#5f6170", stoneHi: "#b5b7c3",
  wood: "#b07a45", woodDk: "#7a5230", woodHi: "#d39a5e",
  spike: "#e3e7ee", spikeDk: "#7c8494",
  water: "#3f8fd9", waterHi: "#7cc0f2", waterDk: "#2c67a8",
  leaf: "#3f9a45", leafDk: "#2a6d33", leafHi: "#6cc25a", trunk: "#6b4229",
  path: "#d9b57c", pathDk: "#b8935d",
  flowerR: "#ff6b8b", flowerY: "#ffd84a", white: "#ffffff", cloudSh: "#dcefff",
  pickle: "#5fae4e", pickleDk: "#3c7d35", pickleHi: "#93d86c", pickleOut: "#1d3b1f",
  slime: "#d0525a", slimeDk: "#7d2733", slimeHi: "#f59aa0",
  coin: "#ffd23f", coinDk: "#b9831a", coinHi: "#fff3a6",
  door: "#8a5a3b", doorDk: "#5b3a24", frame: "#5f6170", ink: "#1b1b24",
};

// ---------------------------------------------------------------- Tileset (16×16, 8 colonne)

const TS = 16;
const COLS = 8;
const tiles = new Pix(COLS * TS, 3 * TS);
const T = (i) => [(i % COLS) * TS, Math.floor(i / COLS) * TS];

function speckle(x, y, base, dots, n) {
  tiles.rect(x, y, TS, TS, base);
  for (let k = 0; k < n; k++) tiles.set(x + rnd() * TS, y + rnd() * TS, dots[k % dots.length]);
}

function drawTiles() {
  let [x, y] = T(0); // erba sopra la terra
  speckle(x, y, P.dirt, [P.dirtDk, P.dirtHi], 12);
  tiles.rect(x, y, 16, 5, P.grass);
  tiles.rect(x, y, 16, 1, P.grassHi);
  for (let i = 0; i < 16; i++) if (rnd() > 0.35) tiles.set(x + i, y + 5, P.grassDk);
  for (let i = 1; i < 16; i += 4) tiles.set(x + i, y + 6, P.grassDk);

  [x, y] = T(1); // terra
  speckle(x, y, P.dirt, [P.dirtDk, P.dirtHi], 14);

  [x, y] = T(2); // mattoni
  tiles.rect(x, y, 16, 16, P.stone);
  for (let r = 0; r < 4; r++) {
    tiles.rect(x, y + r * 4, 16, 1, P.stoneHi);
    tiles.rect(x, y + r * 4 + 3, 16, 1, P.stoneDk);
    for (let c = r % 2 ? 0 : 4; c < 16; c += 8) tiles.rect(x + c, y + r * 4, 1, 3, P.stoneDk);
  }

  [x, y] = T(3); // piattaforma di legno (attraversabile)
  tiles.rect(x, y, 16, 5, P.wood);
  tiles.rect(x, y, 16, 1, P.woodHi);
  tiles.rect(x, y + 4, 16, 1, P.woodDk);
  tiles.set(x + 4, y + 2, P.woodDk);
  tiles.set(x + 11, y + 2, P.woodDk);
  tiles.rect(x + 2, y + 5, 2, 3, P.woodDk);
  tiles.rect(x + 12, y + 5, 2, 3, P.woodDk);

  [x, y] = T(4); // scala
  for (const sx of [3, 11]) {
    tiles.rect(x + sx, y, 2, 16, P.wood);
    tiles.rect(x + sx, y, 1, 16, P.woodHi);
  }
  for (let r = 2; r < 16; r += 5) {
    tiles.rect(x + 5, y + r, 6, 1, P.woodHi);
    tiles.rect(x + 5, y + r + 1, 6, 1, P.woodDk);
  }

  [x, y] = T(5); // punte
  for (let s = 0; s < 4; s++) {
    const bx = x + s * 4;
    [3, 8, 7, 3].forEach((h, i) => tiles.rect(bx + i, y + 14 - h, 1, h, i < 2 ? P.spike : P.spikeDk));
  }
  tiles.rect(x, y + 14, 16, 2, P.stoneDk);

  [x, y] = T(6); // cespuglio
  blob(tiles, x, y, 8, 11, 7.5, 5.5, P.leafDk);
  blob(tiles, x, y, 8, 10.5, 6.5, 4.5, P.leaf);
  blob(tiles, x, y, 6, 8.5, 2, 1.5, P.leafHi);

  [x, y] = T(7); // fiori
  for (const [fx, fy, col] of [[5, 8, P.flowerR], [11, 10, P.flowerY]]) {
    tiles.rect(x + fx, y + fy + 2, 1, 16 - fy - 2, P.grassDk);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) tiles.set(x + fx + dx, y + fy + dy, col);
    tiles.set(x + fx, y + fy, P.white);
  }

  [x, y] = T(8); // prato (top-down)
  speckle(x, y, P.grass, [P.grassDk, P.grassHi], 10);

  [x, y] = T(9); // prato con ciuffi
  speckle(x, y, P.grass, [P.grassDk, P.grassHi, P.grassDk], 18);
  for (const [tx, ty] of [[3, 5], [10, 11]]) {
    tiles.set(x + tx, y + ty, P.grassDk);
    tiles.set(x + tx + 1, y + ty - 1, P.grassDk);
    tiles.set(x + tx + 2, y + ty, P.grassDk);
  }

  [x, y] = T(10); // sentiero
  speckle(x, y, P.path, [P.pathDk], 12);

  [x, y] = T(11); // acqua
  tiles.rect(x, y, 16, 16, P.water);
  for (const [wx, wy, w] of [[2, 3, 5], [9, 7, 5], [3, 11, 6], [11, 13, 4]]) tiles.rect(x + wx, y + wy, w, 1, P.waterHi);
  tiles.rect(x, y + 15, 16, 1, P.waterDk);

  [x, y] = T(12); // albero (top-down)
  speckle(x, y, P.grass, [P.grassDk], 6);
  tiles.rect(x + 6, y + 10, 4, 6, P.trunk);
  blob(tiles, x, y, 8, 7, 7.5, 6.5, P.leafDk);
  blob(tiles, x, y, 7.5, 6.5, 6.5, 5.5, P.leaf);
  blob(tiles, x, y, 5.5, 4.5, 2, 1.5, P.leafHi);

  [x, y] = T(13); // muro di pietra (top-down)
  tiles.rect(x, y, 16, 16, P.stoneDk);
  for (let r = 0; r < 4; r++) {
    for (let c = r % 2 ? 0 : 4; c < 16; c += 8) tiles.rect(x + c + 1, y + r * 4 + 1, 6, 2, P.stone);
  }

  [x, y] = T(14); // erba alta
  for (const bx of [3, 6, 9, 12]) {
    const h = 4 + Math.floor(rnd() * 4);
    tiles.rect(x + bx, y + 15 - h, 1, h, P.grassDk);
    tiles.set(x + bx, y + 15 - h, P.grassHi);
  }

  [x, y] = T(15); // roccia
  speckle(x, y, P.grass, [P.grassDk], 6);
  blob(tiles, x, y, 8, 10, 6.5, 4.5, P.stoneDk);
  blob(tiles, x, y, 7.5, 9, 5.5, 3.5, P.stone);
  tiles.rect(x + 5, y + 7, 3, 1, P.stoneHi);

  [x, y] = T(16); // nuvola (su due tile: 16 e 17)
  blob(tiles, x, y, 9, 10, 8, 5, P.white);
  blob(tiles, x, y, 17, 8, 8, 6.5, P.white);
  blob(tiles, x, y, 25, 11, 6.5, 4, P.white);
  tiles.rect(x + 3, y + 14, 26, 1, P.cloudSh);

  [x, y] = T(18); // terra scura di sfondo
  speckle(x, y, P.dirtDk, [P.dirt], 10);

  [x, y] = T(19); // marciapiede (beat 'em up)
  tiles.rect(x, y, 16, 16, "#9a9ca8");
  tiles.rect(x, y, 16, 1, "#b8bac4");
  tiles.rect(x, y + 15, 16, 1, "#6d6f7c");
  tiles.rect(x + 15, y, 1, 16, "#7d7f8c");
  for (const [dx, dy] of [[3, 4], [9, 11], [12, 5], [5, 12]]) tiles.set(x + dx, y + dy, "#86889a");

  [x, y] = T(20); // asfalto
  tiles.rect(x, y, 16, 16, "#3b3d4a");
  for (const [dx, dy, c] of [[2, 3, "#474a58"], [11, 6, "#30323d"], [6, 12, "#474a58"], [13, 13, "#30323d"], [4, 8, "#30323d"]]) tiles.set(x + dx, y + dy, c);

  [x, y] = T(21); // finestra illuminata su muro di mattoni
  tiles.rect(x, y, 16, 16, P.stone);
  for (let r = 0; r < 4; r++) {
    tiles.rect(x, y + r * 4, 16, 1, P.stoneHi);
    tiles.rect(x, y + r * 4 + 3, 16, 1, P.stoneDk);
  }
  tiles.rect(x + 3, y + 3, 10, 10, "#3d444d");
  tiles.rect(x + 4, y + 4, 8, 8, "#ffd66b");
  tiles.rect(x + 4, y + 4, 3, 2, "#fff3c0");
  tiles.rect(x + 7, y + 4, 1, 8, "#3d444d");
  tiles.rect(x + 4, y + 7, 8, 1, "#3d444d");

  [x, y] = T(22); // asfalto con la striscia di mezzeria
  tiles.rect(x, y, 16, 16, "#3b3d4a");
  tiles.set(x + 3, y + 12, "#30323d");
  tiles.set(x + 12, y + 3, "#474a58");
  tiles.rect(x + 3, y + 7, 9, 2, "#e8e2c8");
}

drawTiles();
tiles.save("tiles.png");

// ---------------------------------------------------------------- Personaggi

/** Colori di un personaggio a forma di cetriolo: quelli di Pepino e quelli dei suoi rivali. */
const PICKLE_PAL = { fill: P.pickle, out: P.pickleOut, hi: P.pickleHi, dk: P.pickleDk };

/**
 * Pepino, il cetriolo. (l, t, r, b) = corpo; legs = [x, y del piede]; arms = braccia abbassate.
 * hArms = braccia tese [x, y, lunghezza] con il pugno; hLegs = gambe tese [x, y, lunghezza] (calci).
 * `pal` cambia i colori: lo stesso disegno serve anche per gli avversari.
 */
function pickle(
  c,
  ox,
  oy,
  { l = 3, t = 4, r = 12, b = 19, legs = [[5, 23], [9, 23]], view = "front", arms = [], lines = false, hArms = [], hLegs = [], pal = PICKLE_PAL } = {},
) {
  for (const [lx, foot] of legs) c.rect(ox + lx, oy + b + 1, 2, Math.max(0, foot - b), pal.out);
  for (const [lx, ly, len] of hLegs) {
    c.rect(ox + lx, oy + ly, len, 2, pal.out);
    c.rect(ox + lx + len - 1, oy + ly - 1, 1, 3, pal.out);
  }
  shape(c, ox, oy, roundRect(l, t, r, b), pal.fill, pal.out, [l, t, r, b]);
  c.rect(ox + l + 2, oy + t + 2, 1, Math.max(0, b - t - 5), pal.hi);
  for (const [bx, by] of [[l + 5, t + 9], [l + 3, t + 12], [r - 2, t + 7], [r - 3, b - 3]]) {
    if (by < b && bx < r && bx > l) c.set(ox + bx, oy + by, pal.dk);
  }
  const w = r - l + 1;
  const ey = t + (b - t > 12 ? 4 : 3);
  if (view === "back") {
    c.rect(ox + Math.floor((l + r) / 2), oy + t + 2, 1, b - t - 4, pal.dk);
  } else if (view === "down") {
    for (const ex of [l + 1, r - 2]) {
      c.rect(ox + ex, oy + ey, 2, 3, P.white);
      c.rect(ox + ex, oy + ey + 2, 2, 1, pal.out);
    }
    c.rect(ox + Math.floor((l + r) / 2), oy + ey + 5, 2, 1, pal.out);
  } else {
    const [e1, e2] = w >= 10 ? [3, 6] : [2, 5];
    for (const ex of [l + e1, l + e2]) {
      c.rect(ox + ex, oy + ey, 2, 3, P.white);
      c.rect(ox + ex + 1, oy + ey + 1, 1, 2, pal.out);
    }
    c.rect(ox + l + e2 - 1, oy + ey + 5, 2, 1, pal.out);
  }
  for (const [ax, ay] of arms) c.rect(ox + ax, oy + ay, 1, 3, pal.out);
  for (const [ax, ay, len] of hArms) {
    c.rect(ox + ax, oy + ay, len, 1, pal.out);
    c.rect(ox + ax + len - 1, oy + ay - 1, 2, 3, pal.out);
  }
  if (lines) for (const [lx, ly, lw] of [[0, 11, 3], [1, 14, 2], [0, 17, 3]]) c.rect(ox + lx, oy + ly, lw, 1, pal.hi);
}

// 0-10: fermo, corsa, salto, caduta, dash, scale. 11-19: mosse del beat 'em up e reazioni ai colpi.
const HERO_FRAMES = [
  {},
  { t: 5 },
  { legs: [[4, 23], [10, 22]] },
  { t: 3, b: 18, legs: [[5, 23], [9, 23]] },
  { legs: [[6, 22], [9, 23]] },
  { t: 3, b: 18, legs: [[5, 23], [9, 23]] },
  { t: 2, b: 17, legs: [[4, 20], [10, 20]], arms: [[2, 4], [13, 4]] },
  { t: 3, b: 18, legs: [[5, 22], [9, 22]], arms: [[2, 9], [13, 9]] },
  { l: 4, r: 15, t: 8, b: 19, legs: [[6, 21], [12, 21]], lines: true },
  { view: "back", legs: [[5, 23], [9, 21]], arms: [[2, 5], [13, 8]] },
  { view: "back", legs: [[5, 21], [9, 23]], arms: [[2, 8], [13, 5]] },
  { l: 2, r: 11, t: 5, legs: [[4, 23], [9, 23]], arms: [[1, 9]] }, // 11 carica il pugno
  { legs: [[4, 23], [9, 23]], hArms: [[12, 10, 3]] }, // 12 primo pugno
  { l: 4, r: 13, legs: [[5, 23], [10, 22]], arms: [[3, 10]], hArms: [[13, 9, 2]] }, // 13 secondo pugno
  { t: 4, b: 18, legs: [[5, 23]], arms: [[2, 8], [13, 8]], hLegs: [[9, 19, 3]] }, // 14 alza il ginocchio
  { l: 1, r: 10, t: 5, b: 18, legs: [[3, 23]], arms: [[0, 7]], hLegs: [[10, 16, 5]] }, // 15 calcio
  { l: 2, r: 11, t: 2, b: 15, legs: [[4, 19]], arms: [[1, 4], [12, 4]], hLegs: [[10, 13, 5]] }, // 16 calcio volante
  { l: 1, r: 10, t: 5, legs: [[3, 23], [8, 22]], arms: [[0, 3], [11, 3]] }, // 17 colpito
  { l: 0, r: 15, t: 16, b: 22, legs: [] }, // 18 a terra
  { t: 9, b: 21, legs: [[5, 23], [9, 23]], arms: [[2, 12], [13, 12]] }, // 19 si rialza
];
const hero = new Pix(8 * 16, 3 * 24);
HERO_FRAMES.forEach((f, i) => pickle(hero, (i % 8) * 16, Math.floor(i / 8) * 24, f));
hero.save("pepino.png");

/** Le animazioni del foglio di Pepino: le usano anche i personaggi disegnati con gli stessi fotogrammi. */
const HERO_ANIMS = {
  idle: { frames: [0, 1], fps: 2, loop: true },
  run: { frames: [2, 3, 4, 5], fps: 10, loop: true },
  walk: { frames: [2, 3, 4, 5], fps: 8, loop: true },
  attack1: { frames: [11, 12, 12], fps: 12, loop: false },
  attack2: { frames: [11, 13, 13], fps: 12, loop: false },
  attack3: { frames: [14, 15, 15, 15, 15], fps: 12, loop: false },
  airAttack: { frames: [16], fps: 1, loop: true },
  hurt: { frames: [17], fps: 1, loop: true },
  down: { frames: [18], fps: 1, loop: true },
  getup: { frames: [19], fps: 1, loop: true },
  jump: { frames: [6], fps: 1, loop: true },
  fall: { frames: [7], fps: 1, loop: true },
  dash: { frames: [8], fps: 1, loop: true },
  climb: { frames: [9, 10], fps: 6, loop: true },
};

// Il rivale del picchiaduro: stesso disegno, colori da peperone.
const PEPPER_PAL = { fill: "#d0525a", out: "#4a151c", hi: "#f59aa0", dk: "#8e2b35" };
{
  const rival = new Pix(8 * 16, 3 * 24);
  HERO_FRAMES.forEach((f, i) => pickle(rival, (i % 8) * 16, Math.floor(i / 8) * 24, { ...f, pal: PEPPER_PAL }));
  rival.save("peperone.png");
}

const heroTd = new Pix(6 * 16, 16);
const tdBody = { l: 4, r: 11, t: 1, b: 12 };
[
  { view: "down", legs: [[5, 15], [9, 14]] },
  { view: "down", legs: [[5, 14], [9, 15]] },
  { view: "back", legs: [[5, 15], [9, 14]] },
  { view: "back", legs: [[5, 14], [9, 15]] },
  { view: "front", legs: [[5, 15], [9, 14]] },
  { view: "front", legs: [[5, 14], [9, 15]] },
].forEach((f, i) => pickle(heroTd, i * 16, 0, { ...tdBody, ...f }));
heroTd.save("pepino_td.png");

const slime = new Pix(32, 16);
[
  [7, 5.5, 8, 10.5],
  [7.8, 4.5, 8, 11.5],
].forEach(([rx, ry, cx, cy], i) => {
  const ox = i * 16;
  shape(slime, ox, 0, ellipse(cx, cy, rx, ry), P.slime, P.slimeDk, [0, 0, 15, 15]);
  slime.rect(ox + cx - 4, cy - ry + 2, 2, 1, P.slimeHi);
  slime.set(ox + cx - 5, cy - ry + 3, P.slimeHi);
  for (const ex of [cx - 3, cx + 1]) {
    slime.rect(ox + ex, cy - 1, 2, 2, P.white);
    slime.set(ox + ex + 1, cy, P.ink);
  }
});
slime.save("slime.png");

const coin = new Pix(64, 16);
[4, 3, 1.2, 3].forEach((rx, i) => {
  shape(coin, i * 16, 0, ellipse(8, 8, rx, 4.6), P.coin, P.coinDk, [0, 0, 15, 15]);
  if (rx > 2) coin.rect(i * 16 + 7, 5, 1, 2, P.coinHi);
});
coin.save("coin.png");

const door = new Pix(16, 24);
shape(door, 0, 0, roundRect(0, 1, 15, 23), P.stone, P.frame, [0, 0, 15, 23]);
door.rect(3, 4, 10, 20, P.door);
for (const px of [6, 9]) door.rect(px, 4, 1, 20, P.doorDk);
door.rect(3, 4, 10, 1, P.doorDk);
door.rect(10, 14, 2, 2, P.coin);
door.save("door.png");

const sign = new Pix(16, 16);
sign.rect(7, 9, 2, 7, P.woodDk);
shape(sign, 0, 0, roundRect(1, 1, 14, 9), P.wood, P.doorDk, [0, 0, 15, 15]);
sign.rect(3, 4, 10, 1, P.woodDk);
sign.rect(3, 6, 7, 1, P.woodDk);
sign.save("sign.png");

// Nonno Cetriolo (top-down): cappello, barba, e un secondo fotogramma con gli occhi chiusi.
const nonno = new Pix(32, 16);
for (let f = 0; f < 2; f++) {
  const ox = f * 16;
  pickle(nonno, ox, 0, { l: 4, r: 11, t: 2, b: 12, view: "down", legs: [[5, 15], [9, 15]] });
  nonno.rect(ox + 3, 1, 10, 2, P.doorDk);
  nonno.rect(ox + 5, 0, 6, 1, P.doorDk);
  nonno.rect(ox + 5, 8, 6, 3, P.white);
  nonno.rect(ox + 6, 11, 4, 1, P.white);
  if (f === 1) {
    for (const ex of [5, 9]) {
      nonno.rect(ox + ex, 5, 2, 3, P.pickle);
      nonno.rect(ox + ex, 6, 2, 1, P.pickleOut);
    }
  }
}
nonno.save("nonno.png");

// Ritratti per i dialoghi: due volti 16×16 ingranditi ×2 su sfondo colorato.
function blitScaled(src, dst, dx, dy, k) {
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      if (src.data[i + 3] === 0) continue;
      const c = `#${[0, 1, 2].map((j) => src.data[i + j].toString(16).padStart(2, "0")).join("")}`;
      dst.rect(dx + x * k, dy + y * k, k, k, c);
    }
  }
}
const portraitFace = (old) => {
  const f = new Pix(16, 16);
  pickle(f, 0, 0, { l: 3, r: 12, t: old ? 3 : 2, b: 18, view: "front", legs: [] });
  if (old) {
    f.rect(2, 1, 12, 2, P.doorDk);
    f.rect(4, 0, 8, 1, P.doorDk);
    f.rect(5, 10, 7, 4, P.white);
    f.rect(6, 14, 5, 1, P.white);
    f.rect(6, 6, 2, 1, P.white);
    f.rect(9, 6, 2, 1, P.white);
  }
  return f;
};
const ritratti = new Pix(64, 32);
ritratti.rect(0, 0, 32, 32, "#cfe8c4");
ritratti.rect(32, 0, 32, 32, "#f0dcae");
blitScaled(portraitFace(false), ritratti, 0, 0, 2);
blitScaled(portraitFace(true), ritratti, 32, 0, 2);
ritratti.save("ritratti.png");

// Seme sputato dalla pianta.
const seme = new Pix(8, 8);
shape(seme, 0, 0, ellipse(4, 4, 3.2, 2.4), "#c8914f", "#6b4229", [0, 0, 7, 7]);
seme.set(3, 3, "#e8c48a");
seme.save("seme.png");

// Sputasemi: pianta in vaso che guarda a destra (2 fotogrammi).
const sputa = new Pix(32, 16);
for (let f = 0; f < 2; f++) {
  const ox = f * 16;
  for (let y = 10; y < 16; y++) {
    const inset = Math.floor((y - 10) / 2);
    sputa.rect(ox + 3 + inset, y, 10 - inset * 2, 1, y === 10 ? "#d98a5a" : "#b5653a");
  }
  sputa.rect(ox + 2, 9, 12, 2, "#7a3f22");
  shape(sputa, ox, 0, ellipse(8, 5.5, 5.5, f ? 5 : 4.5), "#4f9a3a", "#2a6d2a", [0, 0, 15, 15]);
  const mr = f ? 2 : 1.4;
  shape(sputa, ox, 0, ellipse(11.5, 6, mr, mr), P.ink, P.ink, [0, 0, 15, 15]);
  sputa.rect(ox + 6, 3, 2, 2, P.white);
  sputa.set(ox + 7, 4, P.ink);
}
sputa.save("sputasemi.png");

// Molla: piattaforma rossa su una spirale (il blocco è scritto in Python, vedi SCRIPT_MOLLA).
const molla = new Pix(16, 10);
molla.rect(1, 0, 14, 2, "#e5484d");
molla.rect(1, 2, 14, 1, "#9e2a2f");
for (let i = 0; i < 3; i++) {
  molla.rect(3, 3 + i * 2, 10, 1, "#c9d1d9");
  if (4 + i * 2 < 8) molla.rect(4, 4 + i * 2, 8, 1, "#7d8590");
}
molla.rect(2, 8, 12, 2, "#57606a");
molla.rect(2, 9, 12, 1, "#3d444d");
molla.save("molla.png");

// Lampione per la strada di notte: palo grigio e lanterna accesa (la luce la fa il blocco Luce).
const lamp = new Pix(16, 48);
lamp.rect(6, 0, 4, 2, "#5f6170");
lamp.rect(4, 2, 8, 6, "#3d444d");
lamp.rect(5, 3, 6, 4, "#ffe28a");
lamp.rect(6, 4, 2, 2, "#fff6cf");
lamp.rect(7, 8, 2, 37, "#5f6170");
lamp.rect(7, 8, 1, 37, "#8d8f9c");
lamp.rect(5, 45, 6, 3, "#3d444d");
lamp.save("lampione.png");

// Capo dei teppisti (boss del beat 'em up): un grosso slime viola con la corona. 8 fotogrammi 32×32.
const bossImg = new Pix(4 * 32, 2 * 32);
const BOSS = { body: "#8b5cf6", dark: "#4c1d95", hi: "#c4b5fd", crown: "#ffd23f", crownDk: "#b9831a", gem: "#e5484d" };
[
  { rx: 13, ry: 10, cy: 21 }, // 0 fermo
  { rx: 13.5, ry: 9.5, cy: 21.5 }, // 1 fermo (respiro)
  { rx: 12.5, ry: 10.5, cy: 20.5 }, // 2 cammina
  { rx: 13.5, ry: 9.5, cy: 21.5 }, // 3 cammina
  { rx: 15, ry: 8, cy: 23 }, // 4 si prepara (schiacciato)
  { rx: 11, ry: 12.5, cy: 18.5 }, // 5 attacca / salta (allungato)
  { rx: 14, ry: 9.5, cy: 21.5, lean: 2 }, // 6 carica
  { rx: 14, ry: 9, cy: 22, tired: true }, // 7 stanco
].forEach(({ rx, ry, cy, lean = 0, tired = false }, i) => {
  const ox = (i % 4) * 32;
  const oy = Math.floor(i / 4) * 32;
  const cx = 16 + lean;
  shape(bossImg, ox, oy, ellipse(cx, cy, rx, ry), BOSS.body, BOSS.dark, [0, 0, 31, 31]);
  bossImg.rect(ox + cx - Math.round(rx * 0.55), oy + Math.round(cy - ry) + 3, 4, 1, BOSS.hi);
  bossImg.set(ox + cx - Math.round(rx * 0.55) - 1, oy + Math.round(cy - ry) + 4, BOSS.hi);
  // Corona
  const top = Math.round(cy - ry) - 5;
  bossImg.rect(ox + cx - 5, oy + top + 3, 10, 3, BOSS.crown);
  for (const sx of [-5, -1, 3]) bossImg.rect(ox + cx + sx, oy + top, 2, 3, BOSS.crown);
  bossImg.rect(ox + cx - 5, oy + top + 5, 10, 1, BOSS.crownDk);
  bossImg.set(ox + cx, oy + top + 4, BOSS.gem);
  // Occhi arrabbiati (o stanchi) e bocca
  const ey = Math.round(cy - 2);
  for (const ex of [cx - 5, cx + 2]) {
    bossImg.rect(ox + ex, oy + ey, 3, 3, P.white);
    bossImg.rect(ox + ex + 1, oy + ey + 1, 2, 2, P.ink);
    if (tired) bossImg.rect(ox + ex, oy + ey, 3, 2, BOSS.dark);
  }
  if (!tired) {
    bossImg.set(ox + cx - 6, oy + ey - 2, BOSS.dark);
    bossImg.rect(ox + cx - 5, oy + ey - 1, 3, 1, BOSS.dark);
    bossImg.set(ox + cx + 5, oy + ey - 2, BOSS.dark);
    bossImg.rect(ox + cx + 2, oy + ey - 1, 3, 1, BOSS.dark);
  }
  bossImg.rect(ox + cx - 3, oy + ey + 5, 6, tired ? 2 : 1, P.ink);
  if (!tired) for (const tx of [-2, 1]) bossImg.set(ox + cx + tx, oy + ey + 5, P.white);
});
bossImg.save("boss.png");

// ---------------------------------------------------------------- Audio (WAV 16 bit mono)

const RATE = 22050;

function encodeWav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return buf;
}

const osc = (wave, p, duty = 0.5) =>
  wave === "square" ? (p < duty ? 1 : -1) : wave === "tri" ? 1 - 4 * Math.abs(p - 0.5) : wave === "noise" ? rnd() * 2 - 1 : Math.sin(p * Math.PI * 2);

/** fn(t, k) → { f, v, wave, duty } con k = avanzamento 0..1. */
function sfx(name, duration, fn) {
  const n = Math.floor(duration * RATE);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const { f, v, wave = "square", duty = 0.5 } = fn(t, t / duration);
    phase = (phase + f / RATE) % 1;
    out[i] = osc(wave, phase, duty) * v;
  }
  writeFileSync(join(ASSETS, name), encodeWav(out));
}

sfx("jump.wav", 0.16, (t, k) => ({ f: 280 + 520 * k, v: 0.22 * (1 - k), duty: 0.25 }));
sfx("coin.wav", 0.28, (t, k) => ({ f: k < 0.3 ? 988 : 1319, v: 0.2 * (1 - k), duty: 0.5 }));
sfx("hurt.wav", 0.32, (t, k) => ({ f: 420 - 320 * k, v: 0.28 * (1 - k), duty: 0.4 }));
sfx("stomp.wav", 0.2, (t, k) => ({ f: 190 - 130 * k, v: 0.35 * (1 - k), duty: 0.5 }));
sfx("dash.wav", 0.18, (t, k) => ({ f: 1, v: 0.18 * (1 - k), wave: "noise" }));

// Musica: 4 battute a 120 bpm (Do - La- - Fa - Sol), in loop.
{
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const melody = [76, 79, 81, 79, 76, 74, 72, 74, 76, 79, 81, 84, 81, 79, 76, 79, 77, 81, 84, 81, 77, 76, 74, 76, 72, 74, 76, 79, 76, 74, 72, -1];
  const bass = [48, 55, 48, 55, 45, 52, 45, 52, 41, 48, 41, 48, 43, 50, 43, 50];
  const eighth = 0.25;
  const total = melody.length * eighth;
  const n = Math.floor(total * RATE);
  const out = new Float32Array(n);
  let pm = 0;
  let pb = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const mi = Math.floor(t / eighth);
    const mt = t - mi * eighth;
    const bi = Math.floor(t / (eighth * 2));
    const bt = t - bi * eighth * 2;
    let s = 0;
    if (melody[mi] > 0) {
      pm = (pm + midi(melody[mi]) / RATE) % 1;
      s += osc("square", pm, 0.25) * 0.09 * Math.exp(-mt * 6);
    }
    pb = (pb + midi(bass[bi]) / RATE) % 1;
    s += osc("tri", pb) * 0.2 * Math.max(0.3, Math.exp(-bt * 3));
    if (mi % 2 === 1) s += (rnd() * 2 - 1) * 0.025 * Math.exp(-mt * 40);
    out[i] = s;
  }
  writeFileSync(join(ASSETS, "music.wav"), encodeWav(out));
}

// ---------------------------------------------------------------- Livelli

const cx = (col) => col * TS + TS / 2; // centro del tile
const feet = (row) => (row + 1) * TS; // piedi appoggiati sul fondo del tile
const mid = (row) => row * TS + TS / 2;

function makeLayer(id, name, w, h, data, z, collides, extra = {}) {
  return { id, name, tileset: "tiles", width: w, height: h, data, z, collides, visible: true, locked: false, parallax: 1, ...extra };
}

let uid = 0;
const inst = (prefab, name, x, y, blocks = []) => ({ id: `${prefab}_${++uid}`, name, x, y, prefab, blocks });

const hud = () => [
  { id: "hud_vita_testo", name: "HUD · Vita", x: 8, y: 4, z: 100, tags: ["interfaccia"], blocks: [{ type: "Text", props: { text: "Vita", size: 7 } }] },
  {
    id: "hud_vita",
    name: "HUD · Barra vita",
    x: 30,
    y: 7,
    z: 100,
    tags: ["interfaccia"],
    blocks: [{ type: "Bar", props: { variable: "vita", max: 3, width: 40, height: 5 } }],
  },
  {
    id: "hud_monete",
    name: "HUD · Monete",
    x: 82,
    y: 4,
    z: 100,
    tags: ["interfaccia"],
    blocks: [{ type: "Text", props: { text: "Monete {monete}", size: 7 } }],
  },
];

/** Una regola "Quando → Allora". */
const rule = (id, comment, when, conditions, actions, extra = {}) => ({ id, comment, when, conditions, actions, ...extra });
const say = (text, duration = 3, pause = false) => ({ type: "message.show", params: { text, duration, pause } });

// ---- Livello 1: platform
function levelPlatform() {
  const W = 72;
  const H = 17;
  const solid = new Array(W * H).fill(false);
  const ter = new Array(W * H).fill(-1);
  const dec = new Array(W * H).fill(-1);
  const sky = new Array(W * H).fill(-1);
  const set = (arr, x, y, v) => x >= 0 && y >= 0 && x < W && y < H && (arr[y * W + x] = v);
  const ground = (x0, x1, top) => {
    for (let x = x0; x <= x1; x++) for (let y = top; y < H; y++) solid[y * W + x] = true;
  };
  ground(0, 13, 14);
  ground(14, 16, 16);
  ground(17, 30, 14);
  ground(24, 30, 12);
  ground(31, 36, 14);
  ground(37, 40, 16);
  ground(41, 71, 14);
  // Autotile semplice: erba se sopra è vuoto, terra altrimenti.
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (solid[y * W + x]) ter[y * W + x] = y > 0 && solid[(y - 1) * W + x] ? 1 : 0;
  for (const x of [14, 15, 16, 37, 38, 39, 40]) set(ter, x, 15, 5);
  for (let x = 19; x <= 22; x++) set(ter, x, 10, 3);
  for (let x = 37; x <= 40; x++) set(ter, x, 11, 3);
  for (let x = 44; x <= 50; x++) set(ter, x, 7, 3);
  for (let y = 8; y <= 13; y++) set(ter, 46, y, 4);
  for (let y = 10; y <= 13; y++) for (const x of [54, 55]) set(ter, x, y, 2);
  for (let x = 60; x <= 62; x++) set(ter, x, 9, 2);
  for (const [x, y] of [[5, 13], [28, 11], [43, 13], [66, 13]]) set(dec, x, y, 6);
  for (const [x, y] of [[8, 13], [20, 13], [33, 13], [50, 13], [63, 13]]) set(dec, x, y, 7);
  for (const [x, y] of [[3, 2], [15, 4], [28, 1], [40, 3], [55, 2], [66, 4]]) {
    set(sky, x, y, 16);
    set(sky, x + 1, y, 17);
  }

  const coins = [
    ...[19, 20, 21, 22].map((x) => [x, 9]),
    ...[44, 46, 48, 50].map((x) => [x, 6]),
    ...[60, 61, 62].map((x) => [x, 8]),
    [26, 10], [28, 10], [38, 9], [39, 9],
  ];

  return {
    id: "livello1",
    name: "Livello 1 · Colline",
    width: W,
    height: H,
    background: "#8fd3ff",
    ySort: false,
    openBottom: false,
    music: "musica",
    layers: [
      makeLayer("cielo", "Cielo", W, H, sky, -20, false, { parallax: 0.4 }),
      makeLayer("decori", "Decori", W, H, dec, -10, false),
      makeLayer("terreno", "Terreno", W, H, ter, 0, true),
      makeLayer("primo_piano", "Primo piano", W, H, new Array(W * H).fill(-1), 10, false),
    ],
    entities: [
      {
        id: "giocatore",
        name: "Pepino",
        x: cx(3),
        y: feet(13),
        tags: ["giocatore"],
        blocks: [
          { type: "Sprite", props: { image: "pepino" } },
          { type: "Body", props: { width: 10, height: 18, group: "giocatore", collidesWith: ["nemici", "raccoglibili", "trigger"] } },
          { type: "PlatformController", props: { jumpSound: "salto", dashSound: "dash" } },
          { type: "Animator", props: {} },
          { type: "CameraFollow", props: { mode: "platform" } },
          { type: "Health", props: { max: 3, variable: "vita", onDeath: "restart", hurtSound: "colpo" } },
          { type: "PowerUps", props: {} },
        ],
      },
      pickupAt("stella_colline", "Stella", "stella", cx(21), feet(9)),
      pickupAt("calamita_colline", "Calamita", "calamita", cx(8), feet(13)),
      inst("slime", "Slime", cx(20), feet(13)),
      inst("slime", "Slime", cx(33), feet(13)),
      inst("slime", "Slime", cx(64), feet(13)),
      inst("sputasemi", "Sputasemi", cx(49), feet(6)),
      inst("sputasemi", "Sputasemi", cx(63), feet(13)),
      {
        id: "molla",
        name: "Molla",
        x: cx(52),
        y: feet(13),
        blocks: [
          { type: "Sprite", props: { image: "molla", flipWithFacing: false } },
          { type: "Body", props: { width: 14, height: 6, group: "trigger", collidesWith: ["giocatore"], world: false } },
          { type: "Molla", props: { force: 22, target: "giocatore", sound: "salto" } },
        ],
      },
      ...coins.map(([x, y]) => inst("moneta", "Moneta", cx(x), mid(y))),
      inst("porta", "Porta del villaggio", cx(69), feet(13), [{ type: "SceneExit", props: { scene: "villaggio" } }]),
      {
        id: "aiuto1",
        name: "Suggerimento comandi",
        x: cx(1),
        y: 150,
        blocks: [{ type: "Text", props: { text: "← →  muoviti     Z  salta (anche in aria)", size: 7, screen: false } }],
      },
      {
        id: "aiuto2",
        name: "Suggerimento comandi 2",
        x: cx(1),
        y: 162,
        blocks: [{ type: "Text", props: { text: "X  dash     ↑ ↓  scale     F1  debug", size: 7, screen: false } }],
      },
      ...hud(),
    ],
    rules: [
      rule(
        "boing",
        "La prima volta che la molla (blocco in Python) lancia il giocatore",
        { type: "event", params: { target: "@molla", event: "launched" } },
        [],
        [say("Boing! Questa molla è un blocco scritto in Python: guardalo nella scheda Codice.", 3)],
        { once: true },
      ),
      rule("benvenuto", "Messaggio di inizio livello", { type: "scene.start", params: {} }, [], [
        say("Raccogli le monete e raggiungi la porta in fondo al livello!", 3.5),
      ]),
      rule("colpito", "Lo schermo trema quando Pepino si fa male", { type: "event", params: { target: "#giocatore", event: "hurt" } }, [], [
        { type: "camera.shake", params: { intensity: 3, duration: 0.25 } },
      ]),
      rule("schiacciato", "Piccola scossa quando schiacci un nemico", { type: "event", params: { target: "#nemico", event: "stomped" } }, [], [
        { type: "camera.shake", params: { intensity: 2, duration: 0.12 } },
      ]),
      rule(
        "dieci_monete",
        "Complimenti alla decima moneta",
        { type: "always", params: {} },
        [{ type: "var.compare", params: { variable: "monete", op: ">=", value: "10" } }],
        [say("Dieci monete! Continua così.", 2.5)],
        { once: true },
      ),
    ],
  };
}

// ---- Villaggio: top-down
function levelVillage() {
  const W = 30;
  const H = 20;
  const floor = new Array(W * H).fill(8);
  const obst = new Array(W * H).fill(-1);
  const dec = new Array(W * H).fill(-1);
  const at = (x, y) => y * W + x;
  for (let i = 0; i < floor.length; i++) if (rnd() < 0.18) floor[i] = 9;
  const isPath = (x, y) => (y === 10 && x >= 1 && x <= 28) || (x === 15 && y >= 2 && y <= 17);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isPath(x, y)) floor[at(x, y)] = 10;
  for (let x = 0; x < W; x++) obst[at(x, 0)] = obst[at(x, H - 1)] = 12;
  for (let y = 0; y < H; y++) obst[at(0, y)] = obst[at(W - 1, y)] = 12;
  for (let y = 3; y <= 6; y++) for (let x = 19; x <= 25; x++) obst[at(x, y)] = 11;
  for (const [x, y] of [[6, 4], [7, 15], [12, 3], [25, 16], [4, 16], [12, 15], [22, 14], [5, 6]]) obst[at(x, y)] = 12;
  for (const [x, y] of [[17, 14], [8, 8], [26, 8]]) obst[at(x, y)] = 15;
  for (let x = 9; x <= 12; x++) obst[at(x, 6)] = 13;
  for (let k = 0; k < 40; k++) {
    const x = 1 + Math.floor(rnd() * (W - 2));
    const y = 1 + Math.floor(rnd() * (H - 2));
    if (!isPath(x, y) && obst[at(x, y)] < 0 && !(y === 10 && x < 5)) dec[at(x, y)] = rnd() < 0.7 ? 14 : 7;
  }

  const coins = [[6, 10], [11, 10], [19, 10], [24, 10], [15, 4], [15, 14], [3, 3], [27, 17]];

  return {
    id: "villaggio",
    name: "Villaggio · Pepinopoli",
    width: W,
    height: H,
    background: "#3f8a36",
    ySort: true,
    openBottom: false,
    music: "musica",
    layers: [
      makeLayer("pavimento", "Pavimento", W, H, floor, -20, false),
      makeLayer("decori", "Decori", W, H, dec, -10, false),
      makeLayer("ostacoli", "Ostacoli", W, H, obst, -5, true),
    ],
    entities: [
      {
        id: "giocatore_td",
        name: "Pepino",
        x: cx(3),
        y: feet(10),
        tags: ["giocatore"],
        blocks: [
          { type: "Sprite", props: { image: "pepino_td" } },
          { type: "Body", props: { width: 10, height: 7, group: "giocatore", collidesWith: ["nemici", "raccoglibili", "trigger"] } },
          { type: "TopDownController", props: { directions: "8" } },
          { type: "Animator", props: {} },
          { type: "CameraFollow", props: { mode: "topdown", deadzoneW: 1, deadzoneH: 1, offsetY: -0.5, lookahead: 0 } },
          { type: "Health", props: { max: 3, variable: "vita", onDeath: "restart", hurtSound: "colpo" } },
          { type: "Attack", enabled: false, props: { target: "nemico", damage: 1 } },
          { type: "PowerUps", props: {} },
        ],
      },
      {
        id: "zia_zucca",
        name: "Zia Zucca",
        x: cx(10),
        y: feet(12),
        tags: ["npc"],
        blocks: [
          { type: "Sprite", props: { image: "nonno", tint: "#ffc0dd" } },
          { type: "Animator", props: {} },
          {
            type: "Shop",
            props: {
              title: "Bottega di Zia Zucca",
              prompt: "C  Bottega",
              items: [
                { item: "pozione", price: 0 },
                { item: "stivali", price: 0 },
                { item: "scudo", price: 0 },
                { item: "stella", price: 0 },
              ],
              buySound: "moneta",
              failSound: "colpo",
            },
          },
        ],
      },
      pickupAt("pozione_prato", "Pozione", "pozione", cx(5), feet(12)),
      {
        id: "hud_inventario",
        name: "HUD · Inventario",
        x: 4,
        y: 156,
        z: 100,
        tags: ["interfaccia"],
        blocks: [{ type: "Inventory", props: { slots: 4, size: 20, sound: "moneta" } }],
      },
      inst("slime_td", "Slime vagante", cx(9), feet(13)),
      inst("slime_td", "Slime vagante", cx(21), feet(12)),
      inst("slime_td", "Slime vagante", cx(24), feet(15)),
      {
        id: "nonno",
        name: "Nonno Cetriolo",
        x: cx(7),
        y: feet(9),
        tags: ["npc"],
        blocks: [
          { type: "Sprite", props: { image: "nonno" } },
          { type: "Animator", props: {} },
          { type: "Talker", props: { dialogue: "nonno", range: 1.6 } },
        ],
      },
      ...coins.map(([x, y]) => inst("moneta", "Moneta", cx(x), mid(y))),
      inst("porta", "Porta delle colline", cx(27), feet(10), [{ type: "SceneExit", props: { scene: "livello1" } }]),
      inst("porta", "Porta della città", cx(15), feet(17), [{ type: "SceneExit", props: { scene: "strada" } }]),
      {
        id: "nome_villaggio",
        name: "Nome del villaggio",
        x: cx(15),
        y: 20,
        blocks: [{ type: "Text", props: { text: "Pepinopoli", size: 9, align: "center", screen: false } }],
      },
      {
        id: "cartello",
        name: "Cartello",
        x: cx(4),
        y: feet(9),
        tags: ["cartello"],
        blocks: [
          { type: "Sprite", props: { image: "cartello", flipWithFacing: false } },
          { type: "Body", props: { width: 16, height: 16, group: "trigger", collidesWith: ["giocatore"], world: false } },
        ],
      },
      {
        id: "cartello_aiuto",
        name: "Suggerimento cartello",
        x: cx(4),
        y: feet(9) - 28,
        blocks: [{ type: "Text", props: { text: "C", size: 7, align: "center", screen: false } }],
      },
      ...hud(),
    ],
    rules: [
      rule("salva", "Salvataggio all'arrivo nel villaggio", { type: "scene.start", params: {} }, [], [
        { type: "game.save", params: {} },
        say("Benvenuto a Pepinopoli! La partita è stata salvata.", 3),
      ]),
      rule(
        "leggi_cartello",
        "Leggere il cartello con Azione",
        { type: "input.pressed", params: { action: "action" } },
        [{ type: "object.touching", params: { target: "#giocatore", other: "@cartello" } }],
        [say("«Le porte collegano i mondi. Vicino a un cartello premi C per leggerlo.»", 0, true)],
      ),
      rule(
        "missione",
        "Accettata la missione: Pepino riceve il mestolo",
        { type: "dialogue.end", params: { dialogue: "nonno" } },
        [{ type: "var.compare", params: { variable: "missione", op: "==", value: "1" } }],
        [
          { type: "block.enable", params: { enabled: "on", block: "Attack", target: "#giocatore" } },
          say("Hai il mestolo! Premi V per colpire gli slime.", 3),
        ],
        { once: true },
      ),
      rule(
        "mestolo",
        "Dopo un riavvio Pepino ha ancora il mestolo",
        { type: "scene.start", params: {} },
        [{ type: "var.compare", params: { variable: "missione", op: "==", value: "1" } }],
        [{ type: "block.enable", params: { enabled: "on", block: "Attack", target: "#giocatore" } }],
      ),
      rule("slime_sconfitto", "Uno slime sconfitto lascia una moneta", { type: "event", params: { target: "#nemico", event: "died" } }, [], [
        { type: "object.spawn", params: { prefab: "moneta", target: "self", offsetX: 0, offsetY: -0.5 } },
      ]),
      rule(
        "villaggio_salvo",
        "Tutti gli slime sconfitti",
        { type: "always", params: {} },
        [
          { type: "var.compare", params: { variable: "missione", op: "==", value: "1" } },
          { type: "count", params: { target: "#nemico", op: "==", value: "0" } },
        ],
        [say("Pepinopoli è salva! Il nonno ti regala 10 monete.", 3.5), { type: "var.add", params: { amount: 10, variable: "monete" } }],
        { once: true },
      ),
    ],
  };
}

// ---- Strada: beat 'em up di notte, con lampioni (blocco Luce) e scintille (blocco Particelle)
function levelStreet(exitScene = "villaggio") {
  const W = 84;
  const H = 12;
  const back = new Array(W * H).fill(-1);
  const floor = new Array(W * H).fill(-1);
  const at = (x, y) => y * W + x;
  for (let x = 0; x < W; x++) {
    for (let y = 0; y <= 5; y++) back[at(x, y)] = 2;
    for (const y of [6, 7]) floor[at(x, y)] = 19;
    for (const y of [8, 10]) floor[at(x, y)] = 20;
    floor[at(x, 9)] = x % 2 ? 22 : 20;
    back[at(x, 11)] = 13;
  }
  // Finestre accese sui palazzi.
  for (let x = 2; x < W - 1; x += 5) {
    back[at(x, 1)] = back[at(x + 1, 1)] = 21;
    if (x % 3 !== 0) back[at(x, 3)] = 21;
    if (x % 2 === 0) back[at(x + 2, 3)] = 21;
  }

  const lamps = [6, 18, 30, 42, 54, 66, 78].map((x, i) => ({
    id: `lampione_${i + 1}`,
    name: `Lampione ${i + 1}`,
    x: cx(x),
    y: feet(6) - 2,
    blocks: [
      { type: "Sprite", props: { image: "lampione", flipWithFacing: false } },
      { type: "Light", props: { radius: 4.5, color: "#ffd98a", intensity: 1.1, flicker: 0.08, offsetY: -43 } },
    ],
  }));
  const thug = (x, y, group) => ({ ...inst("teppista", "Teppista", cx(x), feet(y)), tags: [group] });
  const arena = (id, x) => ({
    id,
    name: `Inizio ${id}`,
    x: cx(x),
    y: feet(10),
    blocks: [{ type: "Body", props: { width: 16, height: 80, group: "trigger", collidesWith: ["giocatore"], world: false } }],
  });
  const lockCamera = (arenaId, group) =>
    rule(
      `blocca_${arenaId}`,
      `Entrando in ${arenaId} la camera si ferma finché ci sono nemici`,
      { type: "contact", params: { target: "#giocatore", other: `@${arenaId}` } },
      [{ type: "count", params: { target: `#${group}`, op: ">", value: "0" } }],
      [{ type: "block.action", params: { target: "#giocatore", action: "CameraFollow.lock" } }],
      { once: true },
    );
  const unlockCamera = (group, text) =>
    rule(
      `libera_${group}`,
      `Sconfitto il ${group}: la camera riparte`,
      { type: "always", params: {} },
      [{ type: "count", params: { target: `#${group}`, op: "==", value: "0" } }],
      [{ type: "block.action", params: { target: "#giocatore", action: "CameraFollow.unlock" } }, say(text, 2.5)],
      { once: true },
    );

  return {
    id: "strada",
    name: "Strada dei teppisti · beat 'em up",
    width: W,
    height: H,
    background: "#1b1d33",
    ySort: true,
    openBottom: false,
    music: "musica",
    ambient: "#565b86",
    effect: "vignette",
    effectStrength: 0.7,
    layers: [makeLayer("strada", "Strada", W, H, floor, -20, false), makeLayer("palazzi", "Palazzi", W, H, back, -5, true)],
    entities: [
      {
        id: "giocatore_strada",
        name: "Pepino",
        x: cx(3),
        y: feet(8),
        tags: ["giocatore"],
        blocks: [
          { type: "Sprite", props: { image: "pepino", shadow: true } },
          { type: "Body", props: { width: 10, height: 8, group: "giocatore", collidesWith: ["nemici", "raccoglibili", "trigger"] } },
          { type: "BeatEmUpController", props: { jumpSound: "salto" } },
          { type: "Animator", props: {} },
          { type: "CameraFollow", props: { mode: "beatemup", noBacktrack: true, keepInView: true, deadzoneW: 1, offsetY: 0, lookahead: 0 } },
          { type: "Health", props: { max: 3, variable: "vita", onDeath: "restart", hurtSound: "colpo", knockback: 6 } },
          { type: "Combo", props: { target: "nemico", sound: "dash", hitSound: "schiaccia" } },
          { type: "SpriteFX", props: { onHurt: "hit", onAttack: "lunge", onDeath: "none" } },
          {
            type: "Particles",
            props: { burstOn: "landed", burstCount: 6, speed: 1.5, spread: 160, lifetime: 0.3, sizeStart: 2, colorStart: "#c9c2b8", colorEnd: "#c9c2b800", offsetY: -1 },
          },
        ],
      },
      ...lamps,
      arena("arena1", 12),
      thug(17, 8, "gruppo1"),
      thug(20, 10, "gruppo1"),
      thug(21, 7, "gruppo1"),
      arena("arena2", 33),
      thug(37, 8, "gruppo2"),
      thug(39, 10, "gruppo2"),
      thug(41, 7, "gruppo2"),
      thug(43, 9, "gruppo2"),
      arena("arena3", 64),
      inst("capo", "Capo dei teppisti", cx(74), feet(9)),
      inst("porta", "Porta del villaggio", cx(81), feet(7), [{ type: "SceneExit", props: { scene: exitScene } }]),
      {
        id: "nome_strada",
        name: "Nome della strada",
        x: cx(5),
        y: 52,
        blocks: [{ type: "Text", props: { text: "Strada dei teppisti", size: 9, align: "center", screen: false } }],
      },
      ...hud(),
    ],
    rules: [
      rule("strada_inizio", "Istruzioni all'ingresso", { type: "scene.start", params: {} }, [], [
        say("Strada dei teppisti! ↑ ↓ cammini in profondità, Z salta, V colpisce.", 3.5),
      ]),
      lockCamera("arena1", "gruppo1"),
      unlockCamera("gruppo1", "Avanti!"),
      lockCamera("arena2", "gruppo2"),
      unlockCamera("gruppo2", "Avanti, il capo ti aspetta in fondo alla strada!"),
      lockCamera("arena3", "boss"),
      unlockCamera("boss", "Hai sconfitto il Capo dei teppisti! La porta in fondo riporta al villaggio."),
      rule("teppista_moneta", "Un teppista sconfitto lascia una moneta", { type: "event", params: { target: "#nemico", event: "died" } }, [], [
        { type: "object.spawn", params: { prefab: "moneta", target: "self", offsetX: 0, offsetY: -0.5 } },
      ]),
      rule("colpito_strada", "Lo schermo trema quando Pepino si fa male", { type: "event", params: { target: "#giocatore", event: "hurt" } }, [], [
        { type: "camera.shake", params: { intensity: 3, duration: 0.2 } },
      ]),
    ],
  };
}

// ---- Nello spazio: shoot'em up a scorrimento verticale (modello di progetto)

const SP = {
  hull: "#5fae4e", hullHi: "#93d86c", hullDk: "#1d3b1f", glass: "#8fd3ff", glassDk: "#2c67a8",
  flame: "#ffb14a", flameHi: "#fff3a6", ufo: "#b452e0", ufoDk: "#4a1d5e",
  caccia: "#d0525a", cacciaDk: "#5e1b24", light: "#ffd84a", madre: "#6f5aa8", madreDk: "#26194a",
};

/** Navicella-cetriolo vista dall'alto; `tilt` = -1/1 per l'inclinazione quando va di lato. */
function drawShip(c, ox, tilt) {
  const body = (x, y) => y >= 1 && y <= 12 && Math.abs(x - 7.5) <= 0.5 + (y - 1) * 0.25;
  const wing = (side, reach) => (x, y) => {
    const d = side * (x - 7.5);
    return d >= 2 && d <= reach && y <= 12 && y >= 8 + (d - 2) * 0.5;
  };
  const inside = (x, y) => body(x, y) || wing(-1, tilt < 0 ? 5 : 7)(x, y) || wing(1, tilt > 0 ? 5 : 7)(x, y);
  shape(c, ox, 0, inside, SP.hull, SP.hullDk, [0, 0, 15, 15]);
  blob(c, ox, 0, 8, 6, 1.2, 1.8, SP.glass);
  c.set(ox + 7, 3, SP.hullHi);
  c.rect(ox + 6, 13, 4, 1, SP.flameHi);
  c.rect(ox + 7, 14, 2, 1, SP.flame);
}

function drawUfo(c, ox, frame) {
  shape(c, ox, 0, ellipse(8, 10, 7.5, 3.2), SP.ufo, SP.ufoDk, [0, 5, 15, 14]);
  shape(c, ox, 0, (x, y) => ellipse(8, 8, 3.8, 3.5)(x, y) && y <= 8, SP.glass, SP.glassDk, [3, 3, 12, 9]);
  for (let i = 0; i < 4; i++) c.set(ox + 3 + i * 3, 10, (i + frame) % 2 ? SP.light : SP.flameHi);
}

/** Caccia nemico che punta verso il basso. */
function drawCaccia(c, ox, frame) {
  shape(c, ox, 0, (x, y) => y >= 1 && y <= 14 && Math.abs(x - 7.5) <= (14 - y) * 0.45 + 0.5, SP.caccia, SP.cacciaDk, [0, 0, 15, 15]);
  for (let y = 2; y <= 6; y++) {
    for (let x = 0; x < 16; x++) {
      const d = Math.abs(x - 7.5);
      if (d >= 2.5 && d <= 7 - (y - 2) * 0.8) c.set(ox + x, y, SP.cacciaDk);
    }
  }
  blob(c, ox, 0, 8, 8, 1, 1.5, SP.glass);
  c.rect(ox + 6, 0, 4, 1, frame ? SP.flameHi : SP.flame);
}

function drawMadre(c, ox, frame) {
  shape(c, ox, 0, ellipse(24, 19, 23.5, 8), SP.madre, SP.madreDk, [0, 10, 47, 28]);
  shape(c, ox, 0, (x, y) => ellipse(24, 14, 11, 9)(x, y) && y <= 15, SP.glass, SP.glassDk, [12, 4, 36, 16]);
  for (let i = 0; i < 8; i++) c.set(ox + 5 + i * 5, 20, (i + frame) % 2 ? SP.light : SP.flameHi);
  c.rect(ox + 18, 26, 12, 2, SP.madreDk);
}

{
  const nav = new Pix(48, 16);
  drawShip(nav, 0, 0);
  drawShip(nav, 16, -1);
  drawShip(nav, 32, 1);
  nav.save("navicella.png");
  const ufo = new Pix(32, 16);
  drawUfo(ufo, 0, 0);
  drawUfo(ufo, 16, 1);
  ufo.save("ufo.png");
  const caccia = new Pix(32, 16);
  drawCaccia(caccia, 0, 0);
  drawCaccia(caccia, 16, 1);
  caccia.save("caccia.png");
  const madre = new Pix(96, 32);
  drawMadre(madre, 0, 0);
  drawMadre(madre, 48, 1);
  madre.save("madre.png");
  const laser = new Pix(3, 8);
  laser.rect(0, 1, 3, 6, "#9ff3ff");
  laser.rect(1, 0, 1, 8, "#ffffff");
  laser.save("laser.png");
  const plasma = new Pix(6, 6);
  blob(plasma, 0, 0, 3, 3, 3, 3, "#ff77a8");
  blob(plasma, 0, 0, 3, 3, 1.5, 1.5, "#ffe0ee");
  plasma.save("plasma.png");
}

/** Brano chiptune del livello, scritto come nella scheda Musica: il gioco lo calcola all'avvio. */
function spaceSong() {
  const ch = (name, wave, volume, attack, release, notes) => ({ name, wave, volume, attack, release, notes });
  const bassLine = [36, 36, 43, 43, 41, 41, 43, 46];
  const bass = bassLine.flatMap((p, i) => [
    { step: i * 4, len: 2, pitch: p },
    { step: i * 4 + 2, len: 1, pitch: p + 12 },
  ]);
  const arp = [60, 64, 67, 72, 60, 64, 67, 72, 65, 69, 72, 77, 67, 71, 74, 79];
  const lead = arp.map((p, i) => ({ step: i * 2, len: 1, pitch: p + 12 }));
  const drums = [];
  for (let s = 0; s < 32; s += 2) drums.push({ step: s, len: 1, pitch: 42 });
  for (let s = 0; s < 32; s += 8) drums.push({ step: s, len: 1, pitch: 36 }, { step: s + 4, len: 1, pitch: 38 });
  return {
    bpm: 150,
    length: 32,
    loop: true,
    echo: 0.25,
    channels: [
      ch("Melodia", "pulse25", 0.35, 0.005, 0.06, lead),
      ch("Armonia", "square", 0.3, 0.005, 0.1, []),
      ch("Basso", "triangle", 0.7, 0.002, 0.05, bass),
      ch("Batteria", "drums", 0.5, 0, 0, drums),
    ],
  };
}

const sfxData = (o) => ({ wave: "square", freq: 440, freqEnd: 440, attack: 0, sustain: 0.05, decay: 0.1, volume: 0.5, vibrato: 0, vibratoSpeed: 10, jump: 1, jumpAt: 0.05, crush: 0, ...o });

const SPACE_ASSETS = [
  {
    id: "navicella",
    type: "image",
    src: "assets/navicella.png",
    frameWidth: 16,
    frameHeight: 16,
    animations: {
      idle: { frames: [0], fps: 1, loop: true },
      left: { frames: [1], fps: 1, loop: true },
      right: { frames: [2], fps: 1, loop: true },
    },
  },
  { id: "ufo", type: "image", src: "assets/ufo.png", frameWidth: 16, frameHeight: 16, animations: { idle: { frames: [0, 1], fps: 4, loop: true } } },
  { id: "caccia", type: "image", src: "assets/caccia.png", frameWidth: 16, frameHeight: 16, animations: { idle: { frames: [0, 1], fps: 8, loop: true } } },
  { id: "madre", type: "image", src: "assets/madre.png", frameWidth: 48, frameHeight: 32, animations: { idle: { frames: [0, 1], fps: 3, loop: true } } },
  { id: "laser", type: "image", src: "assets/laser.png" },
  { id: "plasma", type: "image", src: "assets/plasma.png" },
  { id: "sparo", type: "audio", src: "", sfx: sfxData({ freq: 1200, freqEnd: 500, sustain: 0.03, decay: 0.08, volume: 0.3 }) },
  { id: "esplosione", type: "audio", src: "", sfx: sfxData({ wave: "noise", freq: 900, freqEnd: 60, sustain: 0.05, decay: 0.5, volume: 0.7 }) },
  { id: "brano_spazio", type: "audio", src: "", song: spaceSong() },
];

const boom = (count = 16) => ({
  type: "Particles",
  props: { mode: "burst", burstOn: "died", burstCount: count, speed: 3, spread: 360, lifetime: 0.5, sizeStart: 3, sizeEnd: 0, colorStart: "#fff3a6", colorEnd: "#ff6b3b00", additive: true },
});

const enemyBlocks = (image, w, h, hp, pattern) => [
  { type: "Sprite", props: { image, flipWithFacing: false } },
  { type: "Body", props: { width: w, height: h, group: "nemici", collidesWith: ["giocatore"], world: false } },
  { type: "MovePattern", props: pattern },
  { type: "Health", props: { max: hp, invulnerability: 0, knockback: 0, hurtSound: "esplosione" } },
  { type: "ContactDamage", props: { target: "giocatore", stompable: false } },
  { type: "SpriteFX", props: { onHurt: "hit" } },
  boom(),
  { type: "Animator", props: {} },
];

const SPACE_PREFABS = [
  {
    id: "laser",
    name: "Laser",
    tags: ["proiettile"],
    blocks: [
      { type: "Sprite", props: { image: "laser", flipWithFacing: false } },
      { type: "Body", props: { width: 3, height: 8, group: "proiettili", collidesWith: [], world: false } },
      { type: "Projectile", props: { target: "nemico", damage: 1, lifetime: 1.2, destroyOnWall: false, offscreen: true } },
    ],
  },
  {
    id: "plasma",
    name: "Plasma",
    tags: ["proiettile"],
    blocks: [
      { type: "Sprite", props: { image: "plasma", flipWithFacing: false } },
      { type: "Body", props: { width: 6, height: 6, group: "proiettili", collidesWith: [], world: false } },
      { type: "Projectile", props: { target: "giocatore", damage: 1, lifetime: 4, destroyOnWall: false } },
    ],
  },
  { id: "ufo", name: "Ufo", tags: ["nemico"], blocks: enemyBlocks("ufo", 12, 8, 2, { pattern: "wave", direction: 90, speed: 1.6, amplitude: 1.5, frequency: 0.4 }) },
  { id: "caccia", name: "Caccia", tags: ["nemico"], blocks: enemyBlocks("caccia", 10, 12, 1, { pattern: "dive", speed: 5, target: "giocatore" }) },
  {
    id: "ufo_sparo",
    name: "Ufo che spara",
    tags: ["nemico"],
    blocks: [
      ...enemyBlocks("ufo", 12, 8, 3, { pattern: "circle", direction: 90, speed: 0.8, amplitude: 1.5, frequency: 0.3 }),
      { type: "Shooter", props: { projectile: "plasma", mode: "auto", aim: "target", target: "giocatore", range: 12, lineOfSight: false, interval: 1.6, speed: 4, offsetX: 0, offsetY: 0 } },
    ],
  },
];

function levelSpace() {
  const W = 20;
  const H = 80;
  const bottom = H * TS;
  const entities = [
    {
      id: "scorrimento",
      name: "Scorrimento",
      x: 160,
      y: bottom - 90,
      blocks: [
        { type: "AutoScroll", props: { direction: "up", speed: 1.25, startDelay: 1.5 } },
        {
          type: "Particles",
          props: {
            mode: "continuous", rate: 10, area: 170, offsetX: 0, offsetY: -95, speed: 1.5, direction: 90, spread: 0, gravity: 0,
            lifetime: 7, sizeStart: 1, sizeEnd: 1, colorStart: "#ffffff", colorEnd: "#c8d8ff66", max: 150,
          },
        },
      ],
    },
    {
      id: "navicella",
      name: "Pepino in navicella",
      x: 160,
      y: bottom - 24,
      tags: ["giocatore"],
      blocks: [
        { type: "Sprite", props: { image: "navicella", flipWithFacing: false } },
        { type: "Body", props: { width: 8, height: 10, group: "giocatore", collidesWith: ["nemici"], world: false } },
        { type: "ShipController", props: { speed: 6, focus: "dash", focusSpeed: 2.5 } },
        {
          type: "Shooter",
          props: { projectile: "laser", mode: "player", command: "jump", hold: true, aim: "fixed", angle: -90, interval: 0.14, speed: 14, offsetX: 0, offsetY: -12, sound: "sparo" },
        },
        { type: "Health", props: { max: 3, variable: "vita", invulnerability: 1.2, knockback: 0, hurtSound: "colpo", onDeath: "restart" } },
        { type: "SpriteFX", props: { onHurt: "hit" } },
        { type: "Animator", props: {} },
      ],
    },
    { id: "hud_punti_sp", name: "HUD · Punti", x: 8, y: 4, z: 100, tags: ["interfaccia"], blocks: [{ type: "Text", props: { text: "Punti {punti}", size: 8 } }] },
    { id: "hud_vita_sp_testo", name: "HUD · Vita", x: 244, y: 4, z: 100, tags: ["interfaccia"], blocks: [{ type: "Text", props: { text: "Vita", size: 8 } }] },
    { id: "hud_vita_sp", name: "HUD · Barra vita", x: 272, y: 6, z: 100, tags: ["interfaccia"], blocks: [{ type: "Bar", props: { variable: "vita", max: 3, width: 40, height: 5 } }] },
    {
      id: "madre",
      name: "Astronave madre",
      x: 160,
      y: 120,
      tags: ["nemico"],
      blocks: [
        ...enemyBlocks("madre", 40, 16, 20, { pattern: "wave", direction: 90, speed: 0, amplitude: 5, frequency: 0.15, leaveScreen: false }),
        { type: "Shooter", props: { projectile: "plasma", mode: "auto", aim: "target", target: "giocatore", range: 20, lineOfSight: false, count: 5, spread: 60, interval: 1.8, speed: 3.5, offsetX: 0, offsetY: -8 } },
      ].map((b) => (b.type === "Particles" ? boom(40) : b)),
    },
  ];
  // Ondate dal basso verso l'alto: partono quando entrano nello schermo.
  for (let i = 0; i < 9; i++) {
    const y = bottom - 280 - i * 95;
    if (i % 3 === 0) for (const x of [60, 120, 200, 260]) entities.push(inst("ufo", "Ufo", x, y));
    else if (i % 3 === 1) for (const x of [80, 160, 240]) entities.push(inst("caccia", "Caccia", x, y));
    else for (const x of [90, 230]) entities.push(inst("ufo_sparo", "Ufo che spara", x, y));
  }
  return {
    id: "spazio",
    name: "Nello spazio",
    width: W,
    height: H,
    background: "#0b1026",
    music: "brano_spazio",
    layers: [makeLayer("vuoto", "Vuoto", W, H, new Array(W * H).fill(-1), 0, false)],
    entities,
    rules: [
      rule("sp_inizio", "Comandi", { type: "scene.start", params: {} }, [], [say("Frecce: muoviti · Z: spara · X: rallenta", 4)]),
      rule("sp_punti", "Nemico abbattuto", { type: "event", params: { target: "#nemico", event: "died" } }, [], [
        { type: "var.add", params: { amount: 10, variable: "punti" } },
      ]),
      rule("sp_vittoria", "Astronave madre sconfitta", { type: "event", params: { target: "@madre", event: "died" } }, [], [
        { type: "var.add", params: { amount: 100, variable: "punti" } },
        { type: "wait", params: { seconds: 1.5 } },
        { type: "scene.goto", params: { scene: "fine", fade: 0.6 } },
      ]),
    ],
  };
}

// ---- Difesa del villaggio: tower defense (modello di progetto)

{
  const t = new Pix(16, 16);
  shape(t, 0, 0, roundRect(3, 6, 12, 15), P.stone, P.stoneDk, [0, 0, 15, 15]);
  for (const x of [3, 6, 9, 12]) {
    t.rect(x, 3, 2, 3, P.stone);
    t.set(x, 3, P.stoneHi);
  }
  t.rect(3, 6, 10, 1, P.stoneDk);
  t.rect(7, 10, 2, 5, P.ink);
  blob(t, 0, 0, 8, 4.5, 2.2, 2.2, P.pickle);
  t.set(7, 4, P.pickleOut);
  t.set(9, 4, P.pickleOut);
  t.save("torretta.png");
}

const TD_ASSETS = [
  { id: "torretta", type: "image", src: "assets/torretta.png" },
  { id: "tiro", type: "audio", src: "", sfx: sfxData({ freq: 500, freqEnd: 250, sustain: 0.02, decay: 0.06, volume: 0.25 }) },
];

const goo = () => ({
  type: "Particles",
  props: { mode: "burst", burstOn: "died", burstCount: 12, speed: 2.5, spread: 360, lifetime: 0.45, sizeStart: 3, sizeEnd: 0, colorStart: "#9be26a", colorEnd: "#3f8a3600" },
});

const pathSlime = (id, name, speed, hp, color) => ({
  id,
  name,
  tags: ["nemico"],
  blocks: [
    { type: "Sprite", props: { image: "slime", tint: color } },
    { type: "Body", props: { width: 12, height: 9, group: "nemici", collidesWith: [], world: false } },
    { type: "PathFollower", props: { path: "strada", speed, atEnd: "destroy", startAtFirst: true } },
    { type: "Health", props: { max: hp, invulnerability: 0, knockback: 0 } },
    { type: "SpriteFX", props: { onHurt: "hit" } },
    goo(),
    { type: "Animator", props: {} },
  ],
});

const TD_PREFABS = [
  {
    id: "sasso",
    name: "Sasso",
    tags: ["proiettile"],
    blocks: [
      { type: "Sprite", props: { image: "seme", flipWithFacing: false } },
      { type: "Body", props: { width: 4, height: 4, group: "proiettili", collidesWith: [], world: false } },
      { type: "Projectile", props: { target: "nemico", damage: 1, lifetime: 1, destroyOnWall: false } },
    ],
  },
  {
    id: "torretta",
    name: "Torretta",
    tags: ["torretta"],
    blocks: [
      { type: "Sprite", props: { image: "torretta", flipWithFacing: false } },
      {
        type: "Shooter",
        props: { projectile: "sasso", mode: "auto", aim: "target", target: "nemico", range: 3.5, lineOfSight: false, interval: 0.7, speed: 9, offsetX: 0, offsetY: -12, sound: "tiro" },
      },
      { type: "SpriteFX", props: { onAppear: "pop", customEvent: "shot", customEffect: "squash" } },
    ],
  },
  pathSlime("slime_percorso", "Slime del sentiero", 1.2, 4, "#ffffff"),
  pathSlime("slime_veloce", "Slime veloce", 2.2, 2, "#9fc4ff"),
];

function levelDefense() {
  const W = 20;
  const H = 11;
  const floor = new Array(W * H).fill(8);
  const dec = new Array(W * H).fill(-1);
  const at = (c, r) => r * W + c;
  // Il sentiero: da sinistra a destra con due curve.
  const route = [[0, 2], [6, 2], [6, 7], [13, 7], [13, 3], [19, 3]];
  for (let i = 0; i < route.length - 1; i++) {
    const [c0, r0] = route[i];
    const [c1, r1] = route[i + 1];
    for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) floor[at(c, r)] = 10;
  }
  for (let k = 0; k < 26; k++) {
    const i = Math.floor(rnd() * W * H);
    if (floor[i] === 8) floor[i] = 9;
  }
  for (const [c, r, t] of [[1, 5, 12], [2, 9, 12], [17, 8, 12], [18, 0, 12], [9, 1, 15], [16, 9, 15], [3, 0, 14], [10, 10, 14]]) dec[at(c, r)] = t;

  const spots = [[4, 4], [8, 5], [10, 9], [11, 5], [15, 5], [16, 1]];
  const waypoints = [[-1, 2], ...route.slice(1, -1), [20, 3]];
  const entities = [
    ...waypoints.map(([c, r], i) => ({
      id: `punto_${i + 1}`,
      name: `Punto ${i + 1}`,
      x: cx(c),
      y: mid(r) + 5,
      blocks: [{ type: "Waypoint", props: { path: "strada", order: i + 1 } }],
    })),
    ...spots.map(([c, r], i) => ({
      id: `piazzola_${i + 1}`,
      name: `Piazzola ${i + 1}`,
      x: cx(c),
      y: feet(r),
      blocks: [{ type: "BuildSpot", props: { prefab: "torretta", cost: 20, variable: "monete", sound: "moneta" } }],
    })),
    {
      id: "ondate",
      name: "Ondate di slime",
      x: cx(0),
      y: feet(0),
      blocks: [
        {
          type: "Waves",
          props: { prefab: "slime_percorso", altPrefab: "slime_veloce", altEvery: 3, waves: 5, count: 4, increase: 2, interval: 1.1, pause: 5, startDelay: 4, variable: "ondata" },
        },
      ],
    },
    { id: "hud_monete_td", name: "HUD · Monete", x: 8, y: 4, z: 100, tags: ["interfaccia"], blocks: [{ type: "Text", props: { text: "Monete {monete}", size: 8 } }] },
    { id: "hud_ondata_td", name: "HUD · Ondata", x: 160, y: 4, z: 100, tags: ["interfaccia"], blocks: [{ type: "Text", props: { text: "Ondata {ondata}/5", size: 8, align: "center" } }] },
    { id: "hud_vita_td_testo", name: "HUD · Vita", x: 244, y: 4, z: 100, tags: ["interfaccia"], blocks: [{ type: "Text", props: { text: "Vita", size: 8 } }] },
    { id: "hud_vita_td", name: "HUD · Barra vita", x: 272, y: 6, z: 100, tags: ["interfaccia"], blocks: [{ type: "Bar", props: { variable: "vita", max: 10, width: 40, height: 5 } }] },
  ];
  return {
    id: "difesa",
    name: "Difesa del villaggio",
    width: W,
    height: H,
    background: "#6cc24a",
    music: "musica",
    layers: [
      makeLayer("prato", "Prato", W, H, floor, 0, false),
      makeLayer("decorazioni", "Decorazioni", W, H, dec, 1, false),
    ],
    entities,
    rules: [
      rule("td_inizio", "Come si gioca", { type: "scene.start", params: {} }, [], [say("Clicca una piazzola per costruire una torretta (20 monete)", 5)]),
      rule("td_monete", "Slime sconfitto", { type: "event", params: { target: "#nemico", event: "died" } }, [], [
        { type: "var.add", params: { amount: 5, variable: "monete" } },
      ]),
      rule("td_passato", "Uno slime è arrivato in fondo", { type: "event", params: { target: "#nemico", event: "reachedEnd" } }, [], [
        { type: "var.add", params: { amount: -1, variable: "vita" } },
      ]),
      rule(
        "td_perso",
        "Niente più vita",
        { type: "always", params: {} },
        [{ type: "var.compare", params: { variable: "vita", op: "<=", value: "0" } }],
        [say("Gli slime sono passati!", 2), { type: "wait", params: { seconds: 2 } }, { type: "scene.restart", params: {} }],
        { once: true },
      ),
      rule("td_vinto", "Tutte le ondate respinte", { type: "event", params: { target: "@ondate", event: "cleared" } }, [], [
        say("Hai difeso il villaggio!", 2),
        { type: "wait", params: { seconds: 2 } },
        { type: "scene.goto", params: { scene: "fine", fade: 0.6 } },
      ]),
    ],
  };
}

// ---- Oggetti dell'archivio: icone (16×16 in fila) e oggetti di base di tutti i progetti

{
  const o = new Pix(256, 16);
  const at = (i) => i * 16;
  // 0 pozione
  o.rect(at(0) + 7, 1, 2, 1, P.wood);
  o.rect(at(0) + 7, 2, 2, 3, "#cfe8ff");
  shape(o, at(0), 0, ellipse(8, 10.5, 5, 4.5), "#e5695f", "#7a2e2e", [2, 5, 14, 15]);
  o.set(at(0) + 6, 8, "#ffd0c8");
  // 1 stivali veloci
  shape(o, at(1), 0, (x, y) => (x >= 4 && x <= 8 && y >= 3 && y <= 13) || (x >= 4 && x <= 12 && y >= 10 && y <= 13), "#4a8fd6", "#1c3566", [0, 0, 15, 15]);
  o.rect(at(1) + 9, 4, 4, 1, "#ffffff");
  o.rect(at(1) + 10, 6, 3, 1, "#ffffff");
  // 2 stella
  shape(
    o,
    at(2),
    0,
    (x, y) => {
      const dx = x + 0.5 - 8;
      const dy = y + 0.5 - 8.5;
      const a = Math.atan2(dy, dx);
      return Math.hypot(dx, dy) <= 3.2 + 3.8 * Math.max(0, Math.cos(5 * (a + Math.PI / 2))) ** 1.5;
    },
    "#ffd84a",
    "#9a7420",
    [0, 0, 15, 15],
  );
  o.set(at(2) + 7, 8, "#1d2819");
  o.set(at(2) + 9, 8, "#1d2819");
  // 3 calamita
  shape(o, at(3), 0, (x, y) => (y >= 3 && y <= 9 && ((x >= 3 && x <= 5) || (x >= 10 && x <= 12))) || (y >= 9 && y <= 13 && Math.hypot(x - 7.5, y - 8.5) <= 5 && Math.hypot(x - 7.5, y - 8.5) >= 2), "#e5695f", "#7a2e2e", [0, 0, 15, 15]);
  o.rect(at(3) + 3, 2, 3, 2, "#cfd3dc");
  o.rect(at(3) + 10, 2, 3, 2, "#cfd3dc");
  // 4 scudo
  shape(o, at(4), 0, (x, y) => y >= 2 && y <= 14 && Math.abs(x - 7.5) <= (y < 9 ? 5.5 : 5.5 - (y - 9) * 1.1), "#8fd3ff", "#2c67a8", [0, 0, 15, 15]);
  o.rect(at(4) + 7, 4, 2, 8, "#ffffff");
  o.rect(at(4) + 5, 6, 6, 2, "#ffffff");
  // 5 fungo saltarello
  shape(o, at(5), 0, (x, y) => ellipse(8, 7, 6.5, 4.5)(x, y) && y <= 8, "#e5695f", "#7a2e2e", [0, 1, 15, 9]);
  o.rect(at(5) + 5, 4, 2, 2, "#ffffff");
  o.rect(at(5) + 10, 5, 2, 2, "#ffffff");
  shape(o, at(5), 0, roundRect(6, 9, 10, 14), "#f3e3c3", "#b8935d", [5, 8, 11, 15]);
  // 6 munizioni
  for (let x = 4; x <= 11; x += 2) {
    o.rect(at(6) + x, 3, 1, 4, "#f0c43c");
    o.set(at(6) + x, 2, "#b0772a");
  }
  shape(o, at(6), 0, roundRect(3, 7, 12, 13), "#6b8e4e", "#2f4a22", [2, 6, 13, 14]);
  // 7 medikit
  shape(o, at(7), 0, roundRect(2, 4, 13, 13), "#ffffff", "#8d8f9c", [1, 3, 14, 14]);
  o.rect(at(7) + 7, 6, 2, 6, "#e5695f");
  o.rect(at(7) + 5, 8, 6, 2, "#e5695f");
  o.rect(at(7) + 6, 3, 4, 1, "#8d8f9c");
  // 9 pila per la torcia
  shape(o, at(9), 0, roundRect(5, 3, 10, 13), "#2c2e38", "#12141a", [4, 2, 11, 14]);
  o.rect(at(9) + 6, 1, 4, 2, "#b5b7c3");
  o.rect(at(9) + 6, 5, 4, 3, "#ffd84a");
  o.rect(at(9) + 6, 9, 4, 1, "#8fd3ff");
  // 10 fusibile
  shape(o, at(10), 0, roundRect(3, 5, 12, 11), "#d9b57c", "#7a5230", [2, 4, 13, 12]);
  o.rect(at(10) + 1, 7, 3, 2, "#b5b7c3");
  o.rect(at(10) + 12, 7, 3, 2, "#b5b7c3");
  o.rect(at(10) + 6, 7, 4, 2, "#e5695f");
  // 8 lanciapeperoncini
  shape(o, at(8), 0, (x, y) => y >= 6 && y <= 11 && x >= 2 && x <= 11, "#b03b3b", "#5e1c1c", [1, 5, 12, 12]);
  shape(o, at(8), 0, (x, y) => y >= 4 && y <= 12 && x >= 10 && x <= 14, "#d0525a", "#7d2733", [9, 3, 15, 13]);
  o.rect(at(8) + 4, 12, 3, 3, "#3c7d35");
  o.save("oggetti.png");
}

const ITEM_ICONS = { id: "oggetti", type: "image", src: "assets/oggetti.png", frameWidth: 16, frameHeight: 16 };

/** Oggetti di esempio presenti in tutti i progetti (tranne quello vuoto). */
const BASE_ITEMS = [
  { id: "pozione", name: "Pozione", icon: "oggetti", frame: 0, kind: "consumable", price: 3, max: 5, description: "Recupera un cuore.", effect: { type: "heal", amount: 1 } },
  { id: "stivali", name: "Stivali veloci", icon: "oggetti", frame: 1, kind: "instant", price: 5, description: "Corri più veloce per 10 secondi.", effect: { type: "powerup", powerup: "speed", seconds: 10 } },
  { id: "stella", name: "Stella", icon: "oggetti", frame: 2, kind: "instant", price: 8, description: "Invincibile per 8 secondi.", effect: { type: "powerup", powerup: "invincible", seconds: 8 } },
  { id: "calamita", name: "Calamita", icon: "oggetti", frame: 3, kind: "instant", price: 4, description: "Attira le monete vicine per 12 secondi.", effect: { type: "powerup", powerup: "magnet", seconds: 12 } },
  { id: "scudo", name: "Scudo", icon: "oggetti", frame: 4, kind: "instant", price: 6, description: "Para il prossimo colpo.", effect: { type: "powerup", powerup: "shield", seconds: 0 } },
  { id: "fungo", name: "Fungo saltarello", icon: "oggetti", frame: 5, kind: "instant", price: 4, description: "Salti più in alto per 10 secondi.", effect: { type: "powerup", powerup: "jump", seconds: 10 } },
];

/** Oggetto dell'archivio messo nella scena: si vede la sua icona e si raccoglie toccandolo. */
const pickupAt = (id, name, item, x, y) => ({
  id,
  name,
  x,
  y,
  blocks: [
    { type: "Body", props: { width: 12, height: 12, group: "raccoglibili", collidesWith: [], world: false } },
    { type: "ItemPickup", props: { item, sound: "moneta" } },
  ],
});

// ---- Il labirinto degli slime: gioco in prima persona (modello di progetto)

/** L'arma vista in prima persona: una sparasemi tenuta da una mano-cetriolo; `firing` = con la vampata. */
function drawWeapon(c, ox, firing) {
  shape(c, ox, 0, ellipse(24, 37, 11, 7), P.pickle, P.pickleOut, [12, 29, 36, 39]);
  shape(c, ox, 0, (x, y) => y >= 9 && y <= 33 && Math.abs(x - 23.5) <= 3.5 + (y - 9) * 0.06, "#5f6170", "#2c2e38", [16, 8, 31, 34]);
  c.rect(ox + 20, 8, 8, 3, "#8d8f9c");
  c.rect(ox + 22, 14, 1, 16, "#b5b7c3");
  c.rect(ox + 18, 26, 12, 2, "#2c2e38");
  if (firing) {
    blob(c, ox, 0, 24, 5, 7, 5, "#ffd84a");
    blob(c, ox, 0, 24, 5, 3.5, 2.5, "#ffffff");
  }
}
{
  const a = new Pix(96, 40);
  drawWeapon(a, 0, false);
  drawWeapon(a, 48, true);
  a.save("arma_semi.png");
}

/** La seconda arma: un lanciapeperoncini tozzo e rosso, con la bocca larga. */
function drawPepperGun(c, ox, firing) {
  shape(c, ox, 0, ellipse(24, 37, 11, 7), P.pickle, P.pickleOut, [12, 29, 36, 39]);
  shape(c, ox, 0, (x, y) => y >= 12 && y <= 34 && Math.abs(x - 23.5) <= 6.5, "#b03b3b", "#5e1c1c", [16, 11, 31, 35]);
  shape(c, ox, 0, (x, y) => y >= 6 && y <= 13 && Math.abs(x - 23.5) <= 9.5 - (y - 6) * 0.35, "#d0525a", "#7d2733", [13, 5, 34, 14]);
  c.rect(ox + 18, 18, 12, 2, "#5e1c1c");
  c.rect(ox + 18, 24, 12, 2, "#5e1c1c");
  c.rect(ox + 22, 30, 4, 4, "#f59aa0");
  if (firing) {
    blob(c, ox, 0, 24, 4, 10, 6, "#ff8a3c");
    blob(c, ox, 0, 24, 4, 6, 3.5, "#ffd84a");
    blob(c, ox, 0, 24, 4, 3, 2, "#ffffff");
  }
}
{
  const a = new Pix(96, 40);
  drawPepperGun(a, 0, false);
  drawPepperGun(a, 48, true);
  a.save("arma_pepe.png");
}

const FP_ASSETS = [
  { id: "arma_semi", type: "image", src: "assets/arma_semi.png", frameWidth: 48, frameHeight: 40 },
  { id: "arma_pepe", type: "image", src: "assets/arma_pepe.png", frameWidth: 48, frameHeight: 40 },
  { id: "sparo", type: "audio", src: "", sfx: sfxData({ wave: "square", freq: 700, freqEnd: 160, sustain: 0.03, decay: 0.12, volume: 0.3, crush: 0.3 }) },
  { id: "sparo_pepe", type: "audio", src: "", sfx: sfxData({ wave: "saw", freq: 320, freqEnd: 60, sustain: 0.05, decay: 0.2, volume: 0.35, crush: 0.5 }) },
  { id: "cambio_arma", type: "audio", src: "", sfx: sfxData({ wave: "square", freq: 200, freqEnd: 520, sustain: 0.02, decay: 0.07, volume: 0.25 }) },
  { id: "vuoto", type: "audio", src: "", sfx: sfxData({ freq: 1400, freqEnd: 1300, sustain: 0.01, decay: 0.03, volume: 0.2 }) },
];

const FP_ITEMS = [
  { id: "munizioni", name: "Munizioni", icon: "oggetti", frame: 6, kind: "instant", price: 3, description: "Dieci semi per la sparasemi.", effect: { type: "variable", variable: "munizioni", amount: 10 } },
  { id: "medikit", name: "Medikit", icon: "oggetti", frame: 7, kind: "instant", price: 5, description: "Recupera due cuori.", effect: { type: "heal", amount: 2 } },
  {
    id: "lanciapeperoncini",
    name: "Lanciapeperoncini",
    icon: "oggetti",
    frame: 8,
    kind: "instant",
    price: 12,
    description: "La seconda arma: peperoncini che bruciano.",
    effect: { type: "variable", variable: "arma2", amount: 1 },
  },
];

const FP_PREFABS = [
  {
    id: "slime_fp",
    name: "Slime del labirinto",
    tags: ["nemico"],
    blocks: [
      { type: "Sprite", props: { image: "slime", tint: "#c8ffb0" } },
      { type: "Body", props: { width: 12, height: 10, group: "nemici", collidesWith: ["giocatore"] } },
      { type: "TopDownController", props: { input: "ai", speed: 1.7, directions: "8" } },
      { type: "Chaser", props: { target: "giocatore", seeRange: 7, loseRange: 11 } },
      { type: "Attack", props: { mode: "auto", target: "giocatore", damage: 1, cooldown: 1.1, reach: 9, width: 14, height: 14, slash: false } },
      { type: "Health", props: { max: 3, invulnerability: 0.1, knockback: 2 } },
      { type: "SpriteFX", props: { onHurt: "hit", onDeath: "vanish", onJump: "none", onLand: "none" } },
      { type: "Animator", props: {} },
    ],
  },
  {
    id: "sputasemi_fp",
    name: "Sputasemi del labirinto",
    tags: ["nemico"],
    blocks: [
      { type: "Sprite", props: { image: "sputasemi" } },
      { type: "Body", props: { width: 12, height: 13, group: "nemici", collidesWith: ["giocatore"], world: false } },
      { type: "Health", props: { max: 2, invulnerability: 0.1, knockback: 0 } },
      { type: "Shooter", props: { projectile: "seme", mode: "auto", aim: "target", target: "giocatore", range: 8, interval: 2.4, speed: 4, offsetX: 0, offsetY: -8 } },
      { type: "SpriteFX", props: { onHurt: "hit", onDeath: "vanish", onJump: "none", onLand: "none" } },
      { type: "Animator", props: {} },
    ],
  },
];

/** Legenda: # muro di pietra, o pilastro, P giocatore, s slime, t sputasemi, a munizioni, h medikit, k stella, w lanciapeperoncini, E uscita. */
const FP_MAP = [
  "####################",
  "#P....#............#",
  "#.....#....s.......#",
  "#..................#",
  "#.....#.....########",
  "###.###.....#......#",
  "#.......a...#..s...#",
  "#...........#......#",
  "#..o....s...#...h..#",
  "#......######......#",
  "#......#....s......#",
  "#..t...#........w..#",
  "#......#.......k...#",
  "#...s.......#......#",
  "#......#....#....E.#",
  "####################",
];

function levelMaze() {
  const H = FP_MAP.length;
  const W = FP_MAP[0].length;
  const floor = new Array(W * H).fill(-1);
  const walls = new Array(W * H).fill(-1);
  const entities = [];
  let n = 0;
  // I piedi un po' sotto il centro della cella: il corpo (alto 10 px) resta al centro.
  const at = (c, r) => ({ x: cx(c), y: mid(r) + 5 });
  FP_MAP.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      const i = r * W + c;
      if (ch === "#") walls[i] = 13;
      else if (ch === "o") walls[i] = 15;
      else floor[i] = 10;
      const p = at(c, r);
      const id = (base) => `${base}_${++n}`;
      if (ch === "P") {
        entities.push({
          id: "giocatore_fp",
          name: "Pepino",
          ...p,
          tags: ["giocatore"],
          blocks: [
            { type: "Body", props: { width: 10, height: 10, group: "giocatore", collidesWith: ["nemici", "raccoglibili", "trigger"] } },
            { type: "FirstPersonController", props: { speed: 3.5, turn: 150, startAngle: 0 } },
            { type: "FirstPersonView", props: {} },
            {
              type: "FirstPersonWeapon",
              props: {
                weapons: [
                  { name: "Sparasemi", image: "arma_semi", idleFrame: 0, fireFrame: 1, scale: 2, damage: 1, interval: 0.35, range: 12, ammo: "munizioni", unlock: "", sound: "sparo", emptySound: "vuoto" },
                  { name: "Lanciapeperoncini", image: "arma_pepe", idleFrame: 0, fireFrame: 1, scale: 2, damage: 3, interval: 0.7, range: 9, ammo: "peperoncini", unlock: "arma2", sound: "sparo_pepe", emptySound: "vuoto" },
                ],
              },
            },
            { type: "Health", props: { max: 5, variable: "vita", onDeath: "restart", hurtSound: "colpo", knockback: 3, invulnerability: 0.8 } },
            { type: "PowerUps", props: {} },
          ],
        });
      }
      if (ch === "s") entities.push(inst("slime_fp", "Slime", p.x, p.y));
      if (ch === "t") entities.push(inst("sputasemi_fp", "Sputasemi", p.x, p.y));
      if (ch === "a") entities.push(pickupAt(id("munizioni"), "Munizioni", "munizioni", p.x, p.y));
      if (ch === "h") entities.push(pickupAt(id("medikit"), "Medikit", "medikit", p.x, p.y));
      if (ch === "k") entities.push(pickupAt(id("stella"), "Stella", "stella", p.x, p.y));
      if (ch === "w") entities.push(pickupAt(id("lanciapeperoncini"), "Lanciapeperoncini", "lanciapeperoncini", p.x, p.y));
      if (ch === "E") entities.push({ ...inst("porta", "Uscita", p.x, p.y + 3, [{ type: "SceneExit", props: { scene: "fine" } }]), id: "uscita" });
    }),
  );
  entities.push(
    { id: "hud_vita_fp_testo", name: "HUD · Vita", x: 8, y: 6, z: 100, tags: ["interfaccia"], blocks: [{ type: "Text", props: { text: "Vita", size: 8, outline: true } }] },
    { id: "hud_vita_fp", name: "HUD · Barra vita", x: 32, y: 8, z: 100, tags: ["interfaccia"], blocks: [{ type: "Bar", props: { variable: "vita", max: 5, width: 40, height: 5 } }] },
    {
      id: "hud_munizioni_fp",
      name: "HUD · Munizioni",
      x: 8,
      y: 18,
      z: 100,
      tags: ["interfaccia"],
      blocks: [{ type: "Text", props: { text: "Semi {munizioni} · Peperoncini {peperoncini}", size: 8, outline: true } }],
    },
    { id: "hud_punti_fp", name: "HUD · Punti", x: 8, y: 30, z: 100, tags: ["interfaccia"], blocks: [{ type: "Text", props: { text: "Punti {punti}", size: 8, outline: true } }] },
  );
  return {
    id: "labirinto",
    name: "Il labirinto degli slime",
    width: W,
    height: H,
    background: "#1b1f14",
    ySort: false,
    openBottom: false,
    music: "musica",
    layers: [makeLayer("pavimento", "Pavimento", W, H, floor, -20, false), makeLayer("muri", "Muri", W, H, walls, 0, true)],
    entities,
    rules: [
      rule("fp_inizio", "Come si gioca", { type: "scene.start", params: {} }, [], [
        say("↑ ↓ cammina · ← → gira · X + ← → passo di lato · V spara · E cambia arma. Trova l'uscita!", 4),
      ]),
      rule("fp_punti", "Uno slime sconfitto vale 10 punti", { type: "event", params: { target: "#nemico", event: "died" } }, [], [
        { type: "var.add", params: { amount: 10, variable: "punti" } },
      ]),
      // La seconda arma: l'oggetto mette «arma2» a 1, la Regola dà i peperoncini e la fa prendere in mano.
      rule("fp_arma2", "Trovato il lanciapeperoncini", { type: "item.used", params: { item: "lanciapeperoncini" } }, [], [
        { type: "var.set", params: { variable: "peperoncini", value: "8" } },
        { type: "audio.play", params: { sound: "cambio_arma" } },
        { type: "block.action", params: { target: "@giocatore_fp", action: "FirstPersonWeapon.select", args: { weapon: 2 } } },
        say("Lanciapeperoncini! Premi E per cambiare arma.", 3),
      ]),
    ],
  };
}

/** Fine del labirinto: «Ricomincia» rimette vita, munizioni e punti come all'inizio. */
function mazeEnd() {
  const s = retext(retext(levelEnd("labirinto"), "titolo_fine", "Sei uscito dal labirinto!"), "monete_fine", "Punti: {punti}");
  s.rules[0].actions.push(
    { type: "var.set", params: { variable: "vita", value: "5" } },
    { type: "var.set", params: { variable: "munizioni", value: "20" } },
    { type: "var.set", params: { variable: "peperoncini", value: "0" } },
    { type: "var.set", params: { variable: "arma2", value: "0" } },
    { type: "var.set", params: { variable: "punti", value: "0" } },
  );
  return s;
}

// ---- Il concerto dell'orto: gioco a ritmo (modello di progetto)

/**
 * Le note della canzone: 8 gruppi da 8 ottavi (a 120 bpm sono 16 secondi, come due giri di musica.wav).
 * I primi otto posti sono vuoti: danno il tempo di prepararsi senza sfasare la musica.
 */
const RHYTHM_PATTERN = ["--------", "1-2-3-4-", "1-1-2-2-", "3-4-3-4-", "1-3-2-4-", "1-2-3-4-", "4-3-2-1-", "1-1-4-4-"].join("");

const RH_ASSETS = [
  { id: "nota_ok", type: "audio", src: "", sfx: sfxData({ wave: "square", freq: 880, freqEnd: 1320, sustain: 0.01, decay: 0.06, volume: 0.22 }) },
  { id: "nota_no", type: "audio", src: "", sfx: sfxData({ wave: "noise", freq: 200, freqEnd: 80, sustain: 0.02, decay: 0.1, volume: 0.2 }) },
];

/** Il palco: Pepino balla di lato mentre le note scendono al centro. */
function levelStage() {
  const W = 20;
  const H = 11;
  const fondo = new Array(W * H).fill(-1);
  const palco = new Array(W * H).fill(-1);
  for (let y = 0; y < 8; y++) for (let x = 0; x < W; x++) fondo[y * W + x] = 13;
  for (const [x, y] of [[1, 1], [4, 3], [8, 1], [12, 2], [16, 4], [18, 1]]) fondo[y * W + x] = 21;
  for (let y = 8; y < H; y++) for (let x = 0; x < W; x++) palco[y * W + x] = 2;
  return {
    id: "palco",
    name: "Il concerto dell'orto",
    width: W,
    height: H,
    background: "#150f24",
    ySort: false,
    openBottom: false,
    music: "musica",
    layers: [makeLayer("fondo", "Fondo", W, H, fondo, -10, false), makeLayer("palco", "Palco", W, H, palco, 0, true)],
    entities: [
      {
        id: "pepino_dj",
        name: "Pepino",
        x: cx(2),
        y: feet(7),
        blocks: [
          { type: "Sprite", props: { image: "pepino", shadow: true } },
          { type: "SpriteFX", props: { idle: "pulse", idleSpeed: 2, onJump: "none", onLand: "none", onHurt: "none", onDeath: "none" } },
        ],
      },
      {
        id: "nonno_dj",
        name: "Nonno Cetriolo",
        x: cx(17),
        y: feet(7),
        blocks: [
          { type: "Sprite", props: { image: "nonno", shadow: true } },
          { type: "SpriteFX", props: { idle: "breathe", onJump: "none", onLand: "none", onHurt: "none", onDeath: "none" } },
        ],
      },
      {
        id: "canzone",
        name: "Canzone",
        x: 0,
        y: 0,
        z: 100,
        blocks: [
          {
            type: "RhythmTrack",
            props: {
              lanes: 4,
              bpm: 120,
              perBeat: 2,
              pattern: RHYTHM_PATTERN,
              delay: 0,
              speed: 110,
              perfectWindow: 70,
              goodWindow: 150,
              scoreVar: "punti",
              comboVar: "combo",
              missVar: "mancate",
              hitSound: "nota_ok",
              missSound: "nota_no",
              lineY: 150,
            },
          },
        ],
      },
    ],
    rules: [
      rule("rh_inizio", "Come si gioca", { type: "scene.start", params: {} }, [], [
        say("← ↓ ↑ → quando la nota tocca la linea. Non perdere il ritmo!", 3),
      ]),
      rule("rh_fine", "Finita la canzone si vede il risultato", { type: "event", params: { target: "@canzone", event: "finished" } }, [], [
        { type: "wait", params: { seconds: 1.5 } },
        { type: "scene.goto", params: { scene: "fine", fade: 0.5 } },
      ]),
    ],
  };
}

/** Fine del concerto: «Ricomincia» azzera punti e combo. */
function stageEnd() {
  const s = retext(retext(levelEnd("palco"), "titolo_fine", "Concerto finito!"), "monete_fine", "Punti: {punti} · Note mancate: {mancate}");
  s.rules[0].actions.push(
    { type: "var.set", params: { variable: "punti", value: "0" } },
    { type: "var.set", params: { variable: "combo", value: "0" } },
    { type: "var.set", params: { variable: "mancate", value: "0" } },
  );
  return s;
}

// ---- La serra abbandonata: gioco della paura (modello di progetto)

/** L'Ombra: una sagoma scura con due occhi gialli, che ondeggia. */
{
  const c = new Pix(32, 24);
  for (const ox of [0, 16]) {
    const wob = ox ? 1 : 0;
    shape(
      c,
      ox,
      0,
      (x, y) => y >= 4 && y <= 22 && Math.abs(x - 8 + (y > 14 ? wob : -wob)) <= 2 + (y - 4) * 0.22,
      "#191a24",
      "#0a0b10",
      [1, 3, 14, 23],
    );
    shape(c, ox, 0, ellipse(8, 6, 4, 3.5), "#191a24", "#0a0b10", [3, 2, 13, 10]);
    c.rect(ox + 5, 6, 2, 2, "#ffd84a");
    c.rect(ox + 9, 6, 2, 2, "#ffd84a");
  }
  c.save("ombra.png");
}

const HR_ASSETS = [
  {
    id: "ombra",
    type: "image",
    src: "assets/ombra.png",
    frameWidth: 16,
    frameHeight: 24,
    animations: { idle: { frames: [0, 1], fps: 3, loop: true }, walk: { frames: [0, 1], fps: 6, loop: true } },
  },
  { id: "cigolio", type: "audio", src: "", sfx: sfxData({ wave: "saw", freq: 180, freqEnd: 90, sustain: 0.08, decay: 0.3, volume: 0.18, vibrato: 0.4, vibratoSpeed: 6 }) },
  { id: "spavento", type: "audio", src: "", sfx: sfxData({ wave: "noise", freq: 900, freqEnd: 100, sustain: 0.05, decay: 0.4, volume: 0.3 }) },
  { id: "interruttore", type: "audio", src: "", sfx: sfxData({ wave: "square", freq: 900, freqEnd: 1400, sustain: 0.01, decay: 0.05, volume: 0.2 }) },
];

const HR_PREFABS = [
  {
    id: "ombra_mostro",
    name: "Ombra",
    tags: ["mostro", "nemico"],
    blocks: [
      { type: "Sprite", props: { image: "ombra", shadow: false } },
      { type: "Body", props: { width: 10, height: 8, group: "nemici", collidesWith: ["giocatore"] } },
      { type: "TopDownController", props: { input: "ai", speed: 1.2, directions: "8" } },
      { type: "Stalker", props: { target: "giocatore", seeRange: 6, fov: 120, hearRange: 5, hearSpeed: 2, wanderSpeed: 1.1, chaseSpeed: 2.4, patience: 4 } },
      { type: "ContactDamage", props: { target: "giocatore", amount: 1, stompable: false } },
      { type: "Animator", props: {} },
      { type: "SpriteFX", props: { idle: "float", onJump: "none", onLand: "none", onHurt: "none", onDeath: "none" } },
    ],
  },
  {
    id: "fusibile",
    name: "Fusibile",
    tags: ["fusibile", "raccoglibile"],
    blocks: [
      { type: "Sprite", props: { image: "oggetti", frame: 10, origin: "center", flipWithFacing: false } },
      { type: "Body", props: { width: 10, height: 10, group: "raccoglibili", collidesWith: ["giocatore"], world: false } },
      { type: "Collectible", props: { variable: "fusibili", amount: 1, sound: "moneta" } },
      { type: "Light", props: { radius: 1.2, color: "#ffd84a", intensity: 0.7, flicker: 0.3, offsetY: 0 } },
    ],
  },
  {
    id: "pila",
    name: "Pila",
    tags: ["pila", "raccoglibile"],
    blocks: [
      { type: "Sprite", props: { image: "oggetti", frame: 9, origin: "center", flipWithFacing: false } },
      { type: "Body", props: { width: 10, height: 10, group: "raccoglibili", collidesWith: ["giocatore"], world: false } },
      { type: "Collectible", props: { variable: "", amount: 0, sound: "moneta" } },
      { type: "Light", props: { radius: 1, color: "#8fd3ff", intensity: 0.5, flicker: 0, offsetY: 0 } },
    ],
  },
  {
    id: "armadio",
    name: "Armadio",
    tags: ["nascondiglio"],
    blocks: [
      { type: "Sprite", props: { image: "door", flipWithFacing: false } },
      { type: "HidingSpot", props: { target: "giocatore", range: 1.2, command: "action", hideTag: "nascosto", sound: "cigolio" } },
    ],
  },
];

/** Legenda: # muro, P giocatore, m ombra, f fusibile, b pila, a armadio, U uscita. */
const HR_MAP = [
  "######################",
  "#P.....#......#......#",
  "#......#...b..#...f..#",
  "#..a...#......#......#",
  "#......#..#####...####",
  "#####..#..#......#...#",
  "#......#..#..a...#...#",
  "#...f..#..#......#.b.#",
  "#......+..+......#...#",
  "#......#..#####..#...#",
  "####...#......#..#...#",
  "#......#...m..#..+...#",
  "#..a...#......#......#",
  "#......####...#...f..#",
  "#.................U..#",
  "######################",
];

function levelHaunted() {
  const H = HR_MAP.length;
  const W = HR_MAP[0].length;
  const pavimento = new Array(W * H).fill(-1);
  const muri = new Array(W * H).fill(-1);
  const entities = [];
  let n = 0;
  const at = (c, r) => ({ x: cx(c), y: mid(r) + 4 });
  HR_MAP.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      const i = r * W + c;
      if (ch === "#") muri[i] = 13;
      else pavimento[i] = 19;
      const p = at(c, r);
      const id = (base) => `${base}_${++n}`;
      if (ch === "P") {
        entities.push({
          id: "giocatore_hr",
          name: "Pepino",
          ...p,
          tags: ["giocatore"],
          blocks: [
            { type: "Sprite", props: { image: "pepino_td" } },
            { type: "Body", props: { width: 10, height: 7, group: "giocatore", collidesWith: ["nemici", "raccoglibili", "trigger"] } },
            { type: "TopDownController", props: { directions: "8", speed: 3.2 } },
            { type: "Animator", props: {} },
            { type: "CameraFollow", props: { mode: "topdown", deadzoneW: 1, deadzoneH: 1, offsetY: -0.5, lookahead: 0 } },
            { type: "Flashlight", props: { range: 5.5, spread: 1.8, halo: 1.2, command: "item", battery: "batteria", drain: 1.5 } },
            { type: "Sanity", props: { variable: "coraggio", max: 100, darkLoss: 3, fearLoss: 10, fearRange: 4, monster: "mostro", recover: 2, low: 35 } },
            { type: "Health", props: { max: 3, variable: "vita", onDeath: "restart", hurtSound: "spavento", invulnerability: 1.5, knockback: 6 } },
            { type: "SpriteFX", props: { onHurt: "hit", onJump: "none", onLand: "none", onDeath: "vanish" } },
          ],
        });
      }
      if (ch === "m") entities.push(inst("ombra_mostro", "Ombra", p.x, p.y));
      if (ch === "f") entities.push(inst("fusibile", "Fusibile", p.x, p.y));
      if (ch === "b") entities.push(inst("pila", "Pila", p.x, p.y));
      if (ch === "a") entities.push({ ...inst("armadio", "Armadio", p.x, p.y + 4), id: id("armadio") });
      if (ch === "U") {
        entities.push({
          id: "cancello",
          name: "Cancello",
          ...p,
          tags: ["uscita"],
          blocks: [
            { type: "Sprite", props: { image: "door", flipWithFacing: false } },
            { type: "Body", props: { width: 12, height: 16, group: "trigger", collidesWith: ["giocatore"], world: false } },
          ],
        });
      }
    }),
  );
  entities.push(
    { id: "hud_vita_hr", name: "HUD · Vita", x: 8, y: 6, z: 100, tags: ["interfaccia"], blocks: [{ type: "Text", props: { text: "Vita", size: 7, outline: true } }] },
    { id: "hud_vita_bar_hr", name: "HUD · Barra vita", x: 30, y: 8, z: 100, tags: ["interfaccia"], blocks: [{ type: "Bar", props: { variable: "vita", max: 3, width: 36, height: 5 } }] },
    { id: "hud_coraggio_hr", name: "HUD · Coraggio", x: 8, y: 16, z: 100, tags: ["interfaccia"], blocks: [{ type: "Text", props: { text: "Coraggio", size: 7, outline: true } }] },
    {
      id: "hud_coraggio_bar_hr",
      name: "HUD · Barra coraggio",
      x: 46,
      y: 18,
      z: 100,
      tags: ["interfaccia"],
      blocks: [{ type: "Bar", props: { variable: "coraggio", max: 100, width: 36, height: 5, color: "#b452e0" } }],
    },
    {
      id: "hud_batteria_hr",
      name: "HUD · Batteria",
      x: 8,
      y: 26,
      z: 100,
      tags: ["interfaccia"],
      blocks: [{ type: "Text", props: { text: "Torcia {batteria}%", size: 7, outline: true } }],
    },
    {
      id: "hud_fusibili_hr",
      name: "HUD · Fusibili",
      x: 240,
      y: 6,
      z: 100,
      tags: ["interfaccia"],
      blocks: [{ type: "Text", props: { text: "Fusibili {fusibili}/3", size: 7, outline: true } }],
    },
  );
  return {
    id: "serra",
    name: "La serra abbandonata",
    width: W,
    height: H,
    background: "#05060a",
    ambient: "#191c26",
    ySort: true,
    openBottom: false,
    layers: [makeLayer("pavimento", "Pavimento", W, H, pavimento, -10, false), makeLayer("muri", "Muri", W, H, muri, 0, true)],
    entities,
    rules: [
      rule("hr_inizio", "Come si gioca", { type: "scene.start", params: {} }, [], [
        say("Q accende e spegne la torcia · C per nasconderti negli armadi. Trova 3 fusibili e scappa dal cancello!", 5),
      ]),
      rule("hr_pila", "Le pile ricaricano la torcia", { type: "event", params: { target: "#pila", event: "collected" } }, [], [
        { type: "block.action", params: { target: "@giocatore_hr", action: "Flashlight.charge", args: { amount: 40 } } },
        { type: "audio.play", params: { sound: "interruttore" } },
        say("Pila nuova!", 1.5),
      ]),
      rule("hr_fusibile", "Tutti i fusibili trovati", { type: "event", params: { target: "#fusibile", event: "collected" } }, [
        { type: "var.compare", params: { variable: "fusibili", op: ">=", value: "3" } },
      ], [say("Hai tutti i fusibili: il cancello si apre!", 3)]),
      rule("hr_uscita", "Il cancello si apre solo con tre fusibili", { type: "contact", params: { target: "@cancello", other: "#giocatore" } }, [
        { type: "var.compare", params: { variable: "fusibili", op: ">=", value: "3" } },
      ], [{ type: "scene.goto", params: { scene: "fine", fade: 0.6 } }]),
      rule("hr_chiuso", "Senza fusibili il cancello resta chiuso", { type: "contact", params: { target: "@cancello", other: "#giocatore" } }, [
        { type: "var.compare", params: { variable: "fusibili", op: "<", value: "3" } },
      ], [say("Il cancello è bloccato: mancano dei fusibili.", 2)]),
      rule("hr_paura", "Senza coraggio si scappa via", { type: "event", params: { target: "@giocatore_hr", event: "empty" } }, [], [
        { type: "audio.play", params: { sound: "spavento" } },
        say("Troppa paura!", 1.5, true),
        { type: "scene.restart", params: { fade: 0.6 } },
      ]),
    ],
  };
}

/** Fine della serra: «Ricomincia» rimette fusibili, batteria e coraggio. */
function hauntedEnd() {
  const s = retext(retext(levelEnd("serra"), "titolo_fine", "Sei uscito dalla serra!"), "monete_fine", "Il nonno non ci crederà mai.");
  s.rules[0].actions.push(
    { type: "var.set", params: { variable: "fusibili", value: "0" } },
    { type: "var.set", params: { variable: "batteria", value: "100" } },
    { type: "var.set", params: { variable: "coraggio", value: "100" } },
    { type: "var.set", params: { variable: "vita", value: "3" } },
  );
  return s;
}

// ---- Il torneo dell'orto: duelli a carte (modello di progetto)

/** Il mazzo di Pepino: le prime quattro carte sono già nel mazzo, il peperoncino si impara vincendo. */
const CARD_DECK = [
  { name: "Zappata", cost: 1, effect: "attack", value: 4, copies: 4, color: "#c2504a" },
  { name: "Foglia dura", cost: 1, effect: "shield", value: 4, copies: 3, color: "#4a8fd6" },
  { name: "Innaffiata", cost: 1, effect: "heal", value: 3, copies: 2, color: "#6cc24a" },
  { name: "Buona idea", cost: 0, effect: "draw", value: 2, copies: 1, color: "#b452e0" },
  { name: "Peperoncino", cost: 2, effect: "attack", value: 9, copies: 0, color: "#ff8a3c" },
];

const CARD_ASSETS = [
  { id: "carta_giocata", type: "audio", src: "", sfx: sfxData({ wave: "square", freq: 520, freqEnd: 780, sustain: 0.02, decay: 0.08, volume: 0.22 }) },
];

/** Un duello: l'avversario in mezzo al tavolo e il blocco che gestisce le carte. */
function cardDuel(id, name, sceneName, rival, rivalHp, rivalImage, tint, moves, rules) {
  const W = 20;
  const H = 11;
  const tavolo = new Array(W * H).fill(-1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) tavolo[y * W + x] = 2;
  return {
    id,
    name: sceneName,
    width: W,
    height: H,
    background: "#1b1420",
    ySort: false,
    openBottom: false,
    music: "musica",
    layers: [makeLayer("tavolo", "Tavolo", W, H, tavolo, -10, false)],
    entities: [
      {
        id: `${id}_rivale`,
        name: rival,
        x: 160,
        y: 78,
        scaleX: 2,
        scaleY: 2,
        blocks: [
          { type: "Sprite", props: { image: rivalImage, origin: "center", tint, flipWithFacing: false } },
          { type: "SpriteFX", props: { idle: "breathe", onJump: "none", onLand: "none", onHurt: "none", onDeath: "none" } },
        ],
      },
      {
        id: `${id}_tavolo`,
        name: "Duello",
        x: 0,
        y: 0,
        z: 100,
        blocks: [
          {
            type: "CardBattle",
            props: {
              hp: 24,
              enemyName: rival,
              enemyHp: rivalHp,
              energy: 3,
              handSize: 4,
              deck: CARD_DECK,
              enemyDeck: moves,
              deckVar: "carte",
              hpVar: "vita",
              enemyHpVar: "vita_nemico",
              wonVar: "vinto",
              playSound: "carta_giocata",
            },
          },
        ],
      },
    ],
    rules,
  };
}

function levelCards1() {
  return cardDuel(
    "duello1",
    "duello1",
    "Sfida al Cavolo Nero",
    "Cavolo Nero",
    20,
    "slime",
    "#7a5ba8",
    [
      { name: "Zampata", cost: 0, effect: "attack", value: 5, copies: 3, color: "#c2504a" },
      { name: "Corazza", cost: 0, effect: "shield", value: 4, copies: 1, color: "#4a8fd6" },
      { name: "Morso", cost: 0, effect: "attack", value: 8, copies: 1, color: "#8e2b35" },
    ],
    [
      rule("cd_inizio", "Come si gioca", { type: "scene.start", params: {} }, [], [
        say("← → scegli la carta · C la giochi · X chiude il turno. Puoi anche cliccare!", 4),
      ]),
      rule("cd_vinto", "Vinto: si impara una carta nuova", { type: "event", params: { target: "@duello1_tavolo", event: "won" } }, [], [
        { type: "wait", params: { seconds: 1.5 } },
        { type: "block.action", params: { target: "@duello1_tavolo", action: "CardBattle.addCard", args: { card: "Peperoncino" } } },
        say("Hai imparato il Peperoncino!", 2.5, true),
        { type: "scene.goto", params: { scene: "duello2", fade: 0.5 } },
      ]),
      rule("cd_perso", "Perso: si ricomincia", { type: "event", params: { target: "@duello1_tavolo", event: "lost" } }, [], [
        { type: "wait", params: { seconds: 1.5 } },
        { type: "scene.goto", params: { scene: "sconfitta", fade: 0.5 } },
      ]),
    ],
  );
}

function levelCards2() {
  return cardDuel(
    "duello2",
    "duello2",
    "Finale con la Barbabietola",
    "Barbabietola",
    28,
    "boss",
    "#d0525a",
    [
      { name: "Testata", cost: 0, effect: "attack", value: 7, copies: 3, color: "#c2504a" },
      { name: "Radici", cost: 0, effect: "shield", value: 6, copies: 1, color: "#4a8fd6" },
      { name: "Zuccherino", cost: 0, effect: "heal", value: 4, copies: 1, color: "#6cc24a" },
    ],
    [
      rule("cd2_inizio", "L'ultimo avversario", { type: "scene.start", params: {} }, [], [say("Ultimo duello: usa il Peperoncino al momento giusto!", 3)]),
      rule("cd2_vinto", "Torneo vinto", { type: "event", params: { target: "@duello2_tavolo", event: "won" } }, [], [
        { type: "wait", params: { seconds: 1.5 } },
        { type: "scene.goto", params: { scene: "fine", fade: 0.5 } },
      ]),
      rule("cd2_perso", "Perso: si ricomincia", { type: "event", params: { target: "@duello2_tavolo", event: "lost" } }, [], [
        { type: "wait", params: { seconds: 1.5 } },
        { type: "scene.goto", params: { scene: "sconfitta", fade: 0.5 } },
      ]),
    ],
  );
}

/** Schermata di sconfitta: si riparte dal primo duello, senza le carte imparate. */
function cardsLost() {
  const s = retext(retext(levelEnd("duello1"), "titolo_fine", "Ti hanno battuto!"), "monete_fine", "Riprova: le carte imparate si perdono.");
  s.id = "sconfitta";
  s.name = "Sconfitta";
  s.rules[0].actions.push({ type: "var.set", params: { variable: "carte", value: "" } });
  return s;
}

/** Fine del torneo. */
function cardsEnd() {
  const s = retext(retext(levelEnd("duello1"), "titolo_fine", "Torneo vinto!"), "monete_fine", "Il Peperoncino resta nel tuo mazzo.");
  s.rules[0].actions.push({ type: "var.set", params: { variable: "carte", value: "" } });
  return s;
}

// ---- Le cantine del nonno: sotterranei a caso (modello di progetto)

/** La scala che porta al piano di sotto e uno scrigno chiuso. */
{
  const c = new Pix(32, 16);
  // 0: scala nel pavimento
  shape(c, 0, 0, roundRect(2, 3, 13, 15), "#2a2f3a", "#12151c", [1, 2, 14, 15]);
  for (let i = 0; i < 4; i++) {
    c.rect(3, 5 + i * 3, 10, 2, i % 2 ? "#5f6170" : "#8d8f9c");
    c.rect(3, 7 + i * 3, 10, 1, "#1b1e26");
  }
  // 1: scrigno
  shape(c, 16, 0, roundRect(2, 6, 13, 14), P.wood, P.woodDk, [1, 5, 14, 15]);
  shape(c, 16, 0, (x, y) => y >= 3 && y <= 6 && x >= 2 && x <= 13, P.woodHi, P.woodDk, [1, 2, 14, 7]);
  c.rect(16 + 7, 8, 2, 3, P.coin);
  c.save("sotterraneo.png");
}

const RL_ASSETS = [
  { id: "sotterraneo", type: "image", src: "assets/sotterraneo.png", frameWidth: 16, frameHeight: 16 },
  { id: "scalino", type: "audio", src: "", sfx: sfxData({ wave: "square", freq: 330, freqEnd: 110, sustain: 0.03, decay: 0.16, volume: 0.28 }) },
];

const RL_PREFABS = [
  {
    id: "scala_giu",
    name: "Scala per il piano dopo",
    tags: ["scala"],
    blocks: [
      { type: "Sprite", props: { image: "sotterraneo", frame: 0, origin: "center", flipWithFacing: false } },
      { type: "Body", props: { width: 14, height: 14, group: "trigger", collidesWith: ["giocatore"], world: false } },
      { type: "FloorExit", props: { target: "giocatore", floorVar: "piano", fade: 0.4, sound: "scalino" } },
    ],
  },
  {
    id: "scrigno",
    name: "Scrigno",
    tags: ["raccoglibile"],
    blocks: [
      { type: "Sprite", props: { image: "sotterraneo", frame: 1, origin: "center", flipWithFacing: false } },
      { type: "Body", props: { width: 12, height: 12, group: "raccoglibili", collidesWith: ["giocatore"], world: false } },
      { type: "Collectible", props: { variable: "monete", amount: 5, sound: "moneta" } },
    ],
  },
  {
    id: "pozione_terra",
    name: "Pozione nel sotterraneo",
    tags: ["raccoglibile"],
    blocks: [
      { type: "Body", props: { width: 12, height: 12, group: "raccoglibili", collidesWith: ["giocatore"], world: false } },
      { type: "ItemPickup", props: { item: "pozione", sound: "moneta" } },
    ],
  },
  {
    id: "slime_cantina",
    name: "Slime di cantina",
    tags: ["nemico"],
    blocks: [
      { type: "Sprite", props: { image: "slime", tint: "#b0a2ff" } },
      { type: "Body", props: { width: 12, height: 8, group: "nemici", collidesWith: ["giocatore"] } },
      { type: "TopDownController", props: { input: "ai", speed: 1.6, directions: "8" } },
      { type: "Chaser", props: { target: "giocatore", seeRange: 5, loseRange: 9 } },
      { type: "Patrol", props: { axis: "horizontal", turnAtEdges: false } },
      { type: "Health", props: { max: 2, invulnerability: 0.3, knockback: 6 } },
      { type: "ContactDamage", props: { target: "giocatore", stompable: false } },
      { type: "SpriteFX", props: { onHurt: "hit", onDeath: "vanish", onJump: "none", onLand: "none" } },
      { type: "Animator", props: {} },
    ],
  },
];

/** Una cantina generata dal computer: il layer parte vuoto, ci pensa il blocco a scavarlo. */
function levelDungeon() {
  const W = 26;
  const H = 18;
  return {
    id: "sotterraneo",
    name: "Le cantine del nonno",
    width: W,
    height: H,
    background: "#0e1014",
    ySort: true,
    openBottom: false,
    music: "musica",
    layers: [makeLayer("cantina", "Cantina", W, H, new Array(W * H).fill(13), 0, true)],
    entities: [
      {
        id: "giocatore_rl",
        name: "Pepino",
        x: cx(2),
        y: mid(2),
        tags: ["giocatore"],
        blocks: [
          { type: "Sprite", props: { image: "pepino_td" } },
          { type: "Body", props: { width: 10, height: 7, group: "giocatore", collidesWith: ["nemici", "raccoglibili", "trigger"] } },
          { type: "TopDownController", props: { directions: "8", speed: 4 } },
          { type: "Animator", props: {} },
          { type: "CameraFollow", props: { mode: "topdown", deadzoneW: 1, deadzoneH: 1, offsetY: -0.5, lookahead: 0 } },
          { type: "Health", props: { max: 3, variable: "vita", onDeath: "restart", hurtSound: "colpo", invulnerability: 1 } },
          { type: "Attack", props: { target: "nemico", damage: 1, reach: 12, width: 16, height: 14, sound: "colpo" } },
          { type: "PowerUps", props: {} },
          { type: "MiniMap", props: { size: 48, corner: "topright", mark: "nemico" } },
          { type: "SpriteFX", props: { onHurt: "hit", onJump: "none", onLand: "none", onDeath: "vanish" } },
        ],
      },
      {
        id: "regia_cantina",
        name: "Generatore del sotterraneo",
        x: 0,
        y: 0,
        blocks: [
          {
            type: "DungeonGenerator",
            props: {
              rooms: 8,
              roomMin: 3,
              roomMax: 6,
              floorTile: 10,
              wallTile: 13,
              seed: 0,
              player: "giocatore",
              exit: "scala_giu",
              floorVar: "piano",
              spawns: [
                { prefab: "slime_cantina", count: 3, perFloor: 1 },
                { prefab: "scrigno", count: 2, perFloor: 0.5 },
                { prefab: "pozione_terra", count: 1, perFloor: 0 },
              ],
            },
          },
        ],
      },
      ...hud(),
      {
        id: "hud_piano",
        name: "HUD · Piano",
        x: 150,
        y: 4,
        z: 100,
        tags: ["interfaccia"],
        blocks: [{ type: "Text", props: { text: "Piano {piano}", size: 7, outline: true } }],
      },
    ],
    rules: [
      rule("rl_inizio", "Come si gioca", { type: "scene.start", params: {} }, [], [
        say("Frecce per muoverti · V colpisci · trova la scala e scendi. Ogni piano è diverso!", 4),
      ]),
      rule("rl_moneta", "Uno slime sconfitto lascia una moneta", { type: "event", params: { target: "#nemico", event: "died" } }, [], [
        { type: "var.add", params: { amount: 1, variable: "monete" } },
      ]),
      rule("rl_caduta", "Se la vita finisce si riparte dal primo piano", { type: "event", params: { target: "@giocatore_rl", event: "died" } }, [], [
        { type: "var.set", params: { variable: "piano", value: "1" } },
        { type: "var.set", params: { variable: "monete", value: "0" } },
      ]),
      rule("rl_scesi", "Ogni piano nuovo ridà un cuore", { type: "scene.start", params: {} }, [{ type: "var.compare", params: { variable: "piano", op: ">", value: "1" } }], [
        { type: "block.action", params: { target: "@giocatore_rl", action: "Health.heal", args: { amount: 1 } } },
        say("Piano {piano}!", 2),
      ]),
    ],
  };
}

// ---- Sfida sul tetto: picchiaduro uno contro uno (modello di progetto)

const VS_ASSETS = [
  { id: "peperone", type: "image", src: "assets/peperone.png", frameWidth: 16, frameHeight: 24, animations: HERO_ANIMS },
  { id: "parata", type: "audio", src: "", sfx: sfxData({ wave: "square", freq: 900, freqEnd: 300, sustain: 0.01, decay: 0.08, volume: 0.25, crush: 0.4 }) },
  { id: "pugno", type: "audio", src: "", sfx: sfxData({ wave: "noise", freq: 400, freqEnd: 120, sustain: 0.01, decay: 0.09, volume: 0.28 }) },
  { id: "colpito", type: "audio", src: "", sfx: sfxData({ wave: "square", freq: 240, freqEnd: 90, sustain: 0.02, decay: 0.14, volume: 0.3, crush: 0.5 }) },
];

/** Le animazioni del picchiaduro che non hanno un disegno tutto loro: si appoggiano a quelle che ci sono. */
const VS_STATES = { walkBack: "walk", guard: "idle", crouch: "getup", hurt: "hurt" };

/** Un lottatore: corpo, controller, combo di colpi, salute e animazioni. */
function fighterEntity(id, name, image, x, tags, opponent, ai) {
  return {
    id,
    name,
    x,
    y: feet(7),
    tags,
    blocks: [
      { type: "Sprite", props: { image, shadow: true } },
      { type: "Body", props: { width: 11, height: 20, group: ai ? "nemici" : "giocatore", collidesWith: ai ? ["giocatore"] : ["nemici"] } },
      { type: "FighterController", props: { input: ai ? "ai" : "player", opponent, speed: 4, backSpeed: 3, jumpHeight: 2.6, guardSound: "parata" } },
      {
        type: "Combo",
        props: {
          mode: ai ? "ai" : "player",
          target: ai ? "giocatore" : "avversario",
          moves: 3,
          m1Damage: 1,
          m2Damage: 1,
          m3Damage: 2,
          m3Push: 4,
          finisherKnockdown: false,
          airKnockdown: false,
          sound: "pugno",
          hitSound: "colpito",
        },
      },
      { type: "Health", props: { max: 10, invulnerability: 0.15, knockback: 3, onDeath: "none", hurtSound: "colpito" } },
      { type: "SpriteFX", props: { onHurt: "hit", onJump: "none", onLand: "squash", onDeath: "none" } },
      { type: "Animator", props: { map: VS_STATES } },
      ...(ai ? [{ type: "FighterAI", props: { target: "giocatore", reach: 20, aggression: 0.55, think: 0.3, jumpChance: 0.12 } }] : []),
    ],
  };
}

/** Il tetto al tramonto: due lottatori, la regia dell'incontro e il pubblico di finestre illuminate. */
function levelArena() {
  const W = 20;
  const H = 11;
  const sfondo = new Array(W * H).fill(-1);
  const suolo = new Array(W * H).fill(-1);
  for (let y = 0; y < 8; y++) for (let x = 0; x < W; x++) sfondo[y * W + x] = 13;
  for (const [x, y] of [[2, 2], [5, 4], [9, 2], [13, 5], [17, 3], [7, 6], [15, 1]]) sfondo[y * W + x] = 21;
  for (let y = 8; y < H; y++) for (let x = 0; x < W; x++) suolo[y * W + x] = 2;
  return {
    id: "arena",
    name: "Sfida sul tetto",
    width: W,
    height: H,
    background: "#241a2e",
    ySort: false,
    openBottom: false,
    music: "musica",
    layers: [makeLayer("sfondo", "Sfondo", W, H, sfondo, -10, false), makeLayer("tetto", "Tetto", W, H, suolo, 0, true)],
    entities: [
      fighterEntity("pepino_vs", "Pepino", "pepino", cx(4), ["giocatore"], "avversario", false),
      fighterEntity("peperone_vs", "Peperone", "peperone", cx(15), ["avversario", "nemico"], "giocatore", true),
      {
        id: "regia",
        name: "Regia dell'incontro",
        x: 0,
        y: 0,
        z: 100,
        blocks: [
          {
            type: "FightMatch",
            props: { fighter1: "giocatore", fighter2: "avversario", name1: "Pepino", name2: "Peperone", rounds: 2, time: 60, winner: "vincitore" },
          },
        ],
      },
    ],
    rules: [
      rule("vs_inizio", "Come si gioca", { type: "scene.start", params: {} }, [], [
        say("← → muoviti · tieni indietro per parare · ↓ abbassati · Z salta · V colpisci (tre colpi in fila)", 4),
      ]),
      rule("vs_fine", "Quando l'incontro finisce si va alla schermata finale", { type: "event", params: { target: "@regia", event: "matchEnd" } }, [], [
        { type: "wait", params: { seconds: 2 } },
        { type: "scene.goto", params: { scene: "fine", fade: 0.5 } },
      ]),
    ],
  };
}

/** Fine dell'incontro: «Ricomincia» rimette tutto com'era. */
function arenaEnd() {
  const s = retext(retext(levelEnd("arena"), "titolo_fine", "Incontro finito!"), "monete_fine", "Ci rivediamo sul tetto!");
  s.rules[0].actions.push({ type: "var.set", params: { variable: "vincitore", value: "0" } });
  return s;
}

// ---- Gran premio dei cetrioli: corse viste dall'alto (modello di progetto)

/** Auto vista dall'alto con il muso a destra: è la direzione della rotazione 0. */
function drawCar(file, body, dark, roof) {
  const c = new Pix(16, 16);
  for (const [x, y] of [[2, 1], [10, 1], [2, 12], [10, 12]]) c.rect(x, y, 4, 3, "#1d1d24");
  shape(c, 0, 0, roundRect(1, 3, 14, 12), body, dark, [0, 0, 15, 15]);
  c.rect(9, 5, 2, 6, SP.glass);
  c.rect(4, 5, 1, 6, SP.glassDk);
  c.rect(5, 5, 4, 6, roof);
  c.rect(12, 7, 2, 2, roof);
  c.set(14, 4, "#fff3a6");
  c.set(14, 11, "#fff3a6");
  c.save(file);
}
drawCar("auto_verde.png", SP.hull, SP.hullDk, SP.hullHi);
drawCar("auto_rossa.png", "#d0525a", "#5e1b24", "#f08a8a");
drawCar("auto_blu.png", "#3f7fd9", "#1c3566", "#8fc0ff");
drawCar("auto_gialla.png", "#f0c43c", "#7a5a14", "#fff0a0");
{
  const f = new Pix(8, 96);
  for (let y = 0; y < 96; y += 4) for (let x = 0; x < 8; x += 4) f.rect(x, y, 4, 4, ((x + y) / 4) % 2 ? "#1d1d24" : "#ffffff");
  f.save("linea_arrivo.png");
}

const RACE_ASSETS = [
  ...["verde", "rossa", "blu", "gialla"].map((c) => ({ id: `auto_${c}`, type: "image", src: `assets/auto_${c}.png` })),
  { id: "linea_arrivo", type: "image", src: "assets/linea_arrivo.png" },
  { id: "semaforo", type: "audio", src: "", sfx: sfxData({ freq: 520, freqEnd: 520, sustain: 0.12, decay: 0.06, volume: 0.3 }) },
  { id: "partenza", type: "audio", src: "", sfx: sfxData({ freq: 1040, freqEnd: 1040, sustain: 0.3, decay: 0.15, volume: 0.3 }) },
  { id: "giro_fatto", type: "audio", src: "", sfx: sfxData({ freq: 660, freqEnd: 990, sustain: 0.08, decay: 0.12, volume: 0.3 }) },
];

function levelRace() {
  const W = 40;
  const H = 24;
  const at = (c, r) => r * W + c;
  const floor = new Array(W * H).fill(8);
  const track = new Array(W * H).fill(-1);
  const walls = new Array(W * H).fill(-1);
  for (let i = 0; i < floor.length; i++) if (rnd() < 0.15) floor[i] = 9;
  // La pista è un anello: il rettangolo esterno meno il prato in mezzo, con gli angoli arrotondati.
  const rounded = (c0, r0, c1, r1, rad) => (c, r) => {
    if (c < c0 || c > c1 || r < r0 || r > r1) return false;
    const dx = Math.max(c0 + rad - c, 0, c - (c1 - rad));
    const dy = Math.max(r0 + rad - r, 0, r - (r1 - rad));
    return dx * dx + dy * dy <= rad * rad + 0.5;
  };
  const outer = rounded(2, 2, 37, 21, 4);
  const inner = rounded(8, 8, 31, 15, 2);
  const onTrack = (c, r) => outer(c, r) && !inner(c, r);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (onTrack(c, r)) track[at(c, r)] = 20;
  // Il cordolo: marciapiede tutto intorno all'asfalto (è già fuori pista).
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (onTrack(c, r)) continue;
      let near = false;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) near ||= onTrack(c + dc, r + dr);
      if (near) floor[at(c, r)] = 19;
    }
  }
  for (let c = 0; c < W; c++) walls[at(c, 0)] = walls[at(c, H - 1)] = 13;
  for (let r = 0; r < H; r++) walls[at(0, r)] = walls[at(W - 1, r)] = 13;
  for (const c of [12, 16, 20, 24, 28]) walls[at(c, 11)] = 12;
  for (const c of [14, 18, 22, 26]) walls[at(c, 12)] = 12;
  for (const [c, r] of [[10, 10], [29, 13]]) walls[at(c, r)] = 15;

  // Linea centrale della pista in senso orario, dall'angolo in alto a destra; ogni avversario ha la sua corsia.
  const LINE = [[500, 80], [560, 140], [560, 244], [500, 304], [140, 304], [80, 244], [80, 140], [140, 80]];
  const lane = (d) =>
    LINE.map(([x, y]) => [x + (Math.abs(x - 320) > 200 ? Math.sign(320 - x) * d : 0), y + (Math.abs(y - 192) > 80 ? Math.sign(192 - y) * d : 0)]);
  const rivals = [
    { id: "auto_rossa", name: "Auto rossa", lane: -20, x: 296, speed: 7.8 },
    { id: "auto_blu", name: "Auto blu", lane: 20, x: 276, speed: 7.5 },
    { id: "auto_gialla", name: "Auto gialla", lane: 0, x: 256, speed: 7 },
  ];
  const checkpoint = (id, name, order, x, y, w, h, extra = []) => ({
    id,
    name,
    x,
    y,
    z: -12,
    blocks: [...extra, { type: "Checkpoint", props: { order, width: w, height: h } }],
  });
  const hudText = (id, name, x, text, align = "left") => ({
    id,
    name,
    x,
    y: 4,
    z: 100,
    tags: ["interfaccia"],
    blocks: [{ type: "Text", props: { text, size: 8, align } }],
  });

  const entities = [
    checkpoint("arrivo", "Linea d'arrivo", 0, 328, 80, 1, 6, [{ type: "Sprite", props: { image: "linea_arrivo", origin: "center", flipWithFacing: false } }]),
    checkpoint("traguardo_1", "Traguardo 1", 1, 560, 192, 6, 1),
    checkpoint("traguardo_2", "Traguardo 2", 2, 320, 304, 1, 6),
    checkpoint("traguardo_3", "Traguardo 3", 3, 80, 192, 6, 1),
    ...rivals.flatMap((r) =>
      lane(r.lane).map(([x, y], i) => ({
        id: `${r.id}_punto_${i + 1}`,
        name: `${r.name} · punto ${i + 1}`,
        x,
        y,
        blocks: [{ type: "Waypoint", props: { path: `giro_${r.id}`, order: i + 1 } }],
      })),
    ),
    ...rivals.map((r) => ({
      id: r.id,
      name: r.name,
      x: r.x,
      y: 80 + r.lane,
      tags: ["rivale"],
      blocks: [
        { type: "Sprite", props: { image: r.id, origin: "center", flipWithFacing: false } },
        { type: "PathFollower", props: { path: `giro_${r.id}`, speed: r.speed, atEnd: "loop", autoStart: false, rotate: true } },
        { type: "LapCounter", props: { laps: 3 } },
      ],
    })),
    {
      id: "auto_giocatore",
      name: "Auto di Pepino",
      x: 236,
      y: 60,
      tags: ["giocatore"],
      blocks: [
        { type: "Sprite", props: { image: "auto_verde", origin: "center", flipWithFacing: false } },
        { type: "Body", props: { width: 11, height: 11, group: "giocatore", collidesWith: [] } },
        { type: "CarController", props: { trackLayer: "pista", maxSpeed: 9, startAngle: 0 } },
        { type: "LapCounter", props: { laps: 3, lapVariable: "giro", timeVariable: "tempo", bestVariable: "migliore", positionVariable: "posizione" } },
        { type: "CameraFollow", props: { mode: "topdown", deadzoneW: 0.5, deadzoneH: 0.5, offsetY: 0, lookahead: 0 } },
      ],
    },
    hudText("hud_giro", "HUD · Giro", 8, "Giro {giro}/3"),
    hudText("hud_posizione", "HUD · Posizione", 160, "Posizione {posizione}/4", "center"),
    hudText("hud_tempo", "HUD · Tempo", 250, "Tempo {tempo}"),
  ];

  const player = "@auto_giocatore";
  const sound = (id) => ({ type: "audio.play", params: { sound: id } });
  const wait = (seconds) => ({ type: "wait", params: { seconds } });
  return {
    id: "circuito",
    name: "Circuito dei cetrioli",
    width: W,
    height: H,
    background: "#6cc24a",
    ySort: false,
    openBottom: false,
    music: "musica",
    layers: [
      makeLayer("prato", "Prato", W, H, floor, -20, false),
      makeLayer("pista", "Pista", W, H, track, -15, false),
      makeLayer("muri", "Muretti e alberi", W, H, walls, -5, true),
    ],
    entities,
    rules: [
      rule("gara_via", "Conto alla rovescia, poi via!", { type: "scene.start", params: {} }, [], [
        { type: "controls.lock", params: { mode: "lock" } },
        say("↑ acceleri · ↓ freni · ← → sterzi. Resta sull'asfalto!", 2),
        wait(2),
        ...["3", "2", "1"].flatMap((n) => [sound("semaforo"), say(n, 0.8), wait(1)]),
        { type: "controls.lock", params: { mode: "unlock" } },
        sound("partenza"),
        { type: "block.action", params: { target: "#rivale", action: "PathFollower.go", args: {} } },
        say("Via!", 1),
      ]),
      rule("gara_giro", "Un giro in più", { type: "event", params: { target: player, event: "lap" } }, [], [sound("giro_fatto")]),
      rule(
        "gara_ultimo",
        "Comincia l'ultimo giro",
        { type: "event", params: { target: player, event: "lap" } },
        [
          { type: "var.compare", params: { variable: "giro", op: "==", value: "3" } },
          { type: "block.condition", params: { target: player, condition: "LapCounter.isFinished" }, not: true },
        ],
        [say("Ultimo giro!", 1.5)],
      ),
      rule("gara_avversario", "Un avversario arrivato si ferma", { type: "event", params: { target: "#rivale", event: "finished" } }, [], [
        { type: "block.action", params: { target: "self", action: "PathFollower.stop", args: {} } },
      ]),
      rule("gara_fine", "Arrivo", { type: "event", params: { target: player, event: "finished" } }, [], [
        { type: "controls.lock", params: { mode: "lock" } },
        say("Arrivo! Posizione {posizione} su 4", 2.5),
        wait(2.5),
        { type: "controls.lock", params: { mode: "unlock" } },
        { type: "scene.goto", params: { scene: "fine", fade: 0.6 } },
      ]),
    ],
  };
}

// ---- La casa del nonno: avventura punta e clicca (modello di progetto)

const HOUSE = {
  wall: "#d8b48a", wallDk: "#c9a27a", skirt: "#7a5230", floor: "#b07a45", floorDk: "#8a5a3b", sky: "#8fd3ff",
  gold: "#e0b040", goldDk: "#9a7420", pot: "#c8643c", potDk: "#8a3f22", rug: "#a84848", rugDk: "#7a2e2e", hat: "#5a4636",
};

{
  const s = new Pix(320, 180);
  // Parete a righe, battiscopa e pavimento a listoni.
  s.rect(0, 0, 320, 136, HOUSE.wall);
  for (let x = 4; x < 320; x += 12) s.rect(x, 0, 4, 136, HOUSE.wallDk);
  s.rect(0, 136, 320, 4, HOUSE.skirt);
  s.rect(0, 140, 320, 40, HOUSE.floor);
  for (let y = 140, row = 0; y < 180; y += 8, row++) {
    s.rect(0, y, 320, 1, HOUSE.floorDk);
    for (let x = (row % 2) * 24; x < 320; x += 48) s.rect(x, y, 1, 8, HOUSE.floorDk);
  }
  shape(s, 0, 0, ellipse(150, 164, 60, 8), HOUSE.rug, HOUSE.rugDk, [88, 154, 212, 174]);
  // Finestra sul giardino.
  s.rect(38, 38, 56, 50, P.woodDk);
  s.rect(42, 42, 48, 42, HOUSE.sky);
  blob(s, 0, 0, 55, 52, 7, 3, "#ffffff");
  blob(s, 0, 0, 62, 50, 5, 3, "#ffffff");
  s.rect(42, 72, 48, 12, P.grass);
  s.rect(42, 72, 48, 1, P.grassHi);
  s.rect(65, 42, 2, 42, P.woodDk);
  s.rect(42, 62, 48, 2, P.woodDk);
  s.rect(34, 88, 64, 3, P.wood);
  // Il ritratto del bisnonno, con i baffi.
  s.rect(130, 48, 36, 38, HOUSE.gold);
  s.rect(132, 50, 32, 34, HOUSE.goldDk);
  s.rect(134, 52, 28, 30, "#3d5a3a");
  shape(s, 0, 0, ellipse(148, 70, 7, 11), P.pickle, P.pickleOut, [138, 56, 158, 82]);
  s.set(145, 66, P.ink);
  s.set(151, 66, P.ink);
  s.rect(144, 71, 8, 1, "#ffffff");
  s.rect(145, 72, 6, 1, "#ffffff");
  // Cassettiera.
  s.rect(12, 110, 40, 28, P.woodDk);
  s.rect(13, 111, 38, 26, P.wood);
  for (const y of [114, 122, 130]) {
    s.rect(15, y, 34, 6, P.woodDk);
    s.rect(16, y + 1, 32, 4, P.woodHi);
    s.rect(31, y + 2, 2, 2, HOUSE.gold);
  }
  s.rect(12, 138, 3, 2, P.woodDk);
  s.rect(49, 138, 3, 2, P.woodDk);
  // Vaso con la pianta.
  s.rect(202, 110, 1, 16, P.leafDk);
  blob(s, 0, 0, 203, 108, 8, 6, P.leaf);
  blob(s, 0, 0, 199, 104, 4, 3, P.leafHi);
  blob(s, 0, 0, 208, 111, 4, 3, P.leafDk);
  shape(s, 0, 0, roundRect(196, 124, 210, 139), HOUSE.pot, HOUSE.potDk, [196, 124, 210, 139]);
  s.rect(197, 127, 13, 1, HOUSE.potDk);
  // Porta.
  s.rect(265, 93, 34, 47, P.woodDk);
  s.rect(268, 96, 28, 44, P.wood);
  s.rect(271, 99, 22, 16, P.woodDk);
  s.rect(272, 100, 20, 14, P.woodHi);
  s.rect(271, 119, 22, 18, P.woodDk);
  s.rect(272, 120, 20, 16, P.woodHi);
  s.rect(290, 117, 3, 3, HOUSE.gold);
  s.set(291, 121, P.ink);
  s.save("stanza.png");
}

/** Il nonno visto di lato, rivolto a sinistra, con cappello, baffi e bastone. */
function drawNonnoSide(c, ox, frame) {
  shape(c, ox, 0, ellipse(8.5, 15.5, 5.5, 8.5), P.pickle, P.pickleOut, [0, 6, 15, 23]);
  c.rect(ox + 4, 5, 10, 2, HOUSE.hat);
  c.rect(ox + 6, 2, 6, 3, HOUSE.hat);
  c.set(ox + 5, 10, frame ? P.pickleOut : P.ink);
  c.rect(ox + 3, 13, 5, 1, "#ffffff");
  c.rect(ox + 4, 14, 3, 1, "#ffffff");
  c.rect(ox + 1, 13, 1, 11, P.woodDk);
  c.rect(ox + 1, 13, 3, 1, P.woodDk);
}
{
  const n = new Pix(32, 24);
  drawNonnoSide(n, 0, 0);
  drawNonnoSide(n, 16, 1);
  n.save("nonno_lato.png");
  const k = new Pix(16, 16);
  shape(k, 0, 0, ellipse(5, 8, 3.6, 3.6), HOUSE.gold, HOUSE.goldDk, [0, 3, 10, 13]);
  k.set(4, 7, HOUSE.goldDk);
  k.rect(8, 7, 7, 2, HOUSE.gold);
  k.rect(8, 7, 7, 1, "#fff0a0");
  k.rect(12, 9, 1, 2, HOUSE.gold);
  k.rect(14, 9, 1, 3, HOUSE.gold);
  k.save("chiave.png");
}

const HOUSE_ASSETS = [
  { id: "stanza", type: "image", src: "assets/stanza.png" },
  {
    id: "nonno_lato",
    type: "image",
    src: "assets/nonno_lato.png",
    frameWidth: 16,
    frameHeight: 24,
    animations: { idle: { frames: [0, 0, 0, 0, 1], fps: 3, loop: true } },
  },
  { id: "chiave", type: "image", src: "assets/chiave.png" },
];

/** Oggetti dell'avventura: si tengono nell'inventario e si usano sui Punti cliccabili. */
const HOUSE_ITEMS = [
  { id: "moneta", name: "Moneta", icon: "coin", kind: "key", description: "Una moneta luccicante." },
  { id: "chiave", name: "Chiave", icon: "chiave", kind: "key", description: "La chiave della porta di casa." },
];

const NONNO_CHIAVE = {
  id: "nonno_chiave",
  name: "Il nonno e la chiave",
  lines: [
    { id: "c1", speaker: "Nonno Cetriolo", portrait: "ritratti", portraitFrame: 1, text: "Pepino! Ho chiuso la porta e ho nascosto la chiave in un posto sicuro..." },
    { id: "c2", speaker: "Nonno Cetriolo", portrait: "ritratti", portraitFrame: 1, text: "...ma non mi ricordo più dove! Alla mia età la memoria va a monete." },
    { id: "c3", speaker: "Pepino", portrait: "ritratti", portraitFrame: 0, text: "Va a monete?" },
    { id: "c4", speaker: "Nonno Cetriolo", portrait: "ritratti", portraitFrame: 1, text: "Dammi una moneta per il gelato e mi tornerà in mente tutto!" },
  ],
};

function levelHouse() {
  const W = 20;
  const H = 12;
  const FLOOR = 160; // la linea su cui cammina Pepino
  const hotspot = (id, name, x, y, w, h, props = {}, extra = []) => ({
    id,
    name,
    x,
    y,
    blocks: [...extra, { type: "Hotspot", props: { name, width: w, height: h, ...props } }],
  });
  const isVar = (variable, value) => ({ type: "var.compare", params: { variable, op: "==", value: String(value) } });
  const clicked = (id, event = "clicked") => ({ type: "event", params: { target: `@${id}`, event } });
  return {
    id: "casa",
    name: "La casa del nonno",
    width: W,
    height: H,
    background: "#5a3a22",
    ySort: false,
    openBottom: false,
    music: "musica",
    layers: [makeLayer("vuoto", "Vuoto", W, H, new Array(W * H).fill(-1), 0, false)],
    entities: [
      { id: "sfondo_stanza", name: "Sfondo", x: 0, y: 0, z: -50, blocks: [{ type: "Sprite", props: { image: "stanza", origin: "topleft", flipWithFacing: false } }] },
      hotspot("finestra", "Finestra", 66, 88, 56, 50, { description: "Fuori c'è il giardino. Devo trovare il modo di uscire!" }),
      hotspot("quadro", "Quadro", 148, 86, 36, 38, { description: "Il bisnonno Cetriolo. Che bei baffi!" }),
      hotspot("cassettiera", "Cassettiera", 32, 138, 40, 28, { description: "Calzini, calzini e ancora calzini. Niente chiave.", standX: 14 }),
      hotspot("vaso", "Vaso", 203, 140, 18, 36, { standX: -14 }),
      hotspot("porta", "Porta", 282, 140, 32, 46, {
        description: "La porta è chiusa a chiave.",
        needs: "chiave",
        rightText: "La chiave gira... la porta si apre!",
        wrongText: "Non entra nella serratura.",
        standX: -20,
      }),
      hotspot("moneta_pavimento", "Moneta", 96, 166, 12, 12, { give: "moneta", description: "Una moneta! La metto in tasca.", sound: "moneta" }, [
        { type: "Sprite", props: { image: "coin", flipWithFacing: false } },
        { type: "Animator", props: {} },
      ]),
      {
        id: "nonno_casa",
        name: "Nonno Cetriolo",
        x: 244,
        y: FLOOR,
        tags: ["npc"],
        blocks: [
          { type: "Sprite", props: { image: "nonno_lato", flipWithFacing: false } },
          { type: "Animator", props: {} },
          { type: "Hotspot", props: { name: "Nonno Cetriolo", width: 16, height: 24, standX: -22, needs: "moneta", wrongText: "No grazie, non mi serve." } },
        ],
      },
      {
        id: "pepino_casa",
        name: "Pepino",
        x: 120,
        y: FLOOR,
        tags: ["giocatore"],
        blocks: [
          { type: "Sprite", props: { image: "pepino" } },
          { type: "Animator", props: {} },
          { type: "PointClickMover", props: { mode: "horizontal", speed: 3.5 } },
        ],
      },
      {
        id: "inventario_hud",
        name: "HUD · Inventario",
        x: 4,
        y: 4,
        z: 100,
        tags: ["interfaccia"],
        blocks: [{ type: "Inventory", props: { slots: 5, size: 20, sound: "moneta" } }],
      },
    ],
    rules: [
      rule("pc_inizio", "Come si gioca", { type: "scene.start", params: {} }, [], [say("Clicca per camminare. Clicca le cose per guardarle, raccoglierle o usarle.", 4)]),
      rule("pc_nonno_parla", "Il nonno racconta della chiave", clicked("nonno_casa"), [isVar("indizio", 0)], [
        { type: "dialogue.start", params: { dialogue: "nonno_chiave", speaker: "@nonno_casa" } },
      ]),
      rule("pc_nonno_ricorda", "Il nonno ripete dov'è la chiave", clicked("nonno_casa"), [isVar("indizio", 1)], [say("Nel vaso, Pepino! La chiave è nel vaso.", 3)]),
      rule("pc_moneta_al_nonno", "Con la moneta il nonno si ricorda", clicked("nonno_casa", "rightItem"), [], [
        say("Grazie! Ora mi ricordo: la chiave è nel vaso!", 3),
        { type: "var.set", params: { variable: "indizio", value: "1" } },
      ]),
      // L'ordine conta: la regola del vaso vuoto viene prima di quella che dà la chiave.
      rule("pc_vaso_vuoto", "Nel vaso non c'è più niente", clicked("vaso"), [isVar("chiave_presa", 1)], [say("Ormai nel vaso c'è solo terra.", 2.5)]),
      rule("pc_vaso", "Un vaso qualsiasi", clicked("vaso"), [isVar("indizio", 0)], [say("Un vaso con una pianta. È pieno di terra.", 2.5)]),
      rule("pc_vaso_chiave", "La chiave è nel vaso", clicked("vaso"), [isVar("indizio", 1), isVar("chiave_presa", 0)], [
        { type: "inventory.add", params: { item: "chiave", qty: 1 } },
        { type: "var.set", params: { variable: "chiave_presa", value: "1" } },
        { type: "audio.play", params: { sound: "moneta" } },
        say("Nel vaso c'era la chiave!", 2.5),
      ]),
      rule("pc_porta", "Con la chiave si esce", clicked("porta", "rightItem"), [], [
        { type: "wait", params: { seconds: 2 } },
        { type: "scene.goto", params: { scene: "fine", fade: 0.6 } },
      ]),
    ],
  };
}

// ---- Fine livello (usata dai modelli di progetto)
function levelEnd(restartScene) {
  return {
    id: "fine",
    name: "Livello completato",
    width: 20,
    height: 12,
    background: "#14261a",
    ySort: false,
    openBottom: false,
    layers: [makeLayer("vuoto", "Vuoto", 20, 12, new Array(20 * 12).fill(-1), 0, false)],
    entities: [
      { id: "titolo_fine", name: "Titolo", x: 160, y: 46, blocks: [{ type: "Text", props: { text: "Livello completato!", size: 18, align: "center" } }] },
      { id: "monete_fine", name: "Monete raccolte", x: 160, y: 80, blocks: [{ type: "Text", props: { text: "Monete: {monete}", size: 9, align: "center" } }] },
      {
        id: "ricomincia",
        name: "Ricomincia",
        x: 160,
        y: 112,
        blocks: [{ type: "Button", props: { text: "Ricomincia", scene: restartScene, order: 0, sound: "moneta" } }],
      },
    ],
    rules: [
      rule("azzera", "Ricominciando si riparte da zero", { type: "event", params: { target: "@ricomincia", event: "pressed" } }, [], [
        { type: "var.set", params: { variable: "monete", value: "0" } },
        { type: "var.set", params: { variable: "vita", value: "3" } },
      ]),
    ],
  };
}

// Teppista: nemico del beat 'em up. Insegue, attacca da solo quando è vicino, sprizza scintille quando è colpito.
const TEPPISTA = {
  id: "teppista",
  name: "Teppista",
  tags: ["nemico"],
  blocks: [
    { type: "Sprite", props: { image: "slime", tint: "#c9a2ff", shadow: true } },
    { type: "Body", props: { width: 12, height: 8, group: "nemici", collidesWith: ["giocatore"] } },
    { type: "BeatEmUpController", props: { input: "ai", speed: 2.2, depthSpeed: 1.6, jumpHeight: 0 } },
    { type: "Chaser", props: { target: "giocatore", seeRange: 9, loseRange: 16, lineOfSight: false, stopDistance: 0.7, giveUp: 5 } },
    {
      type: "Attack",
      props: { mode: "auto", target: "giocatore", damage: 1, reach: 10, width: 14, height: 12, startup: 0.3, active: 0.1, recovery: 0.3, cooldown: 1.1, slashColor: "#ff8a8acc" },
    },
    { type: "Health", props: { max: 3, invulnerability: 0, knockback: 7 } },
    { type: "Particles", props: { burstOn: "hurt", burstCount: 10, speed: 3.5, lifetime: 0.35, sizeStart: 2.5, additive: true, offsetY: -6 } },
    { type: "SpriteFX", props: { onJump: "none", onHurt: "hit", onAppear: "pop", onDeath: "vanish" } },
    { type: "Animator", props: {} },
  ],
};

// Capo dei teppisti: boss con le fasi. Carica, salta e schiaccia, chiama altri teppisti; dopo ogni attacco è stanco.
const CAPO = {
  id: "capo",
  name: "Capo dei teppisti",
  tags: ["nemico", "boss"],
  blocks: [
    { type: "Sprite", props: { image: "boss", shadow: true } },
    { type: "Body", props: { width: 22, height: 10, group: "nemici", collidesWith: ["giocatore"] } },
    {
      type: "Boss",
      props: { title: "Capo dei teppisti", wakeRange: 6, speed: 1.6, damage: 1, summon: true, minion: "teppista", minions: 2, restTime: 1.4 },
    },
    { type: "Health", props: { max: 24, invulnerability: 0.12, knockback: 0, onDeath: "destroy" } },
    { type: "SpriteFX", props: { idle: "breathe", onJump: "none", onHurt: "hit", onDeath: "vanish", strength: 1.2 } },
    {
      type: "Particles",
      props: { burstOn: "slam", burstCount: 18, speed: 3, spread: 180, direction: -90, lifetime: 0.45, sizeStart: 3, colorStart: "#c9c2b8", colorEnd: "#c9c2b800", gravity: 6, offsetY: -2 },
    },
    { type: "Animator", props: {} },
  ],
};

// ---- Menù iniziale
function levelMenu() {
  const W = 20;
  const H = 12;
  const ground = new Array(W * H).fill(-1);
  const sky = new Array(W * H).fill(-1);
  for (let x = 0; x < W; x++) {
    ground[10 * W + x] = 0;
    ground[11 * W + x] = 1;
  }
  for (const [x, y] of [[2, 2], [14, 1], [9, 4]]) {
    sky[y * W + x] = 16;
    sky[y * W + x + 1] = 17;
  }
  const dark = { color: "#1d3b1f", shadow: false, align: "center" };
  return {
    id: "menu",
    name: "Menù iniziale",
    width: W,
    height: H,
    background: "#8fd3ff",
    music: "musica",
    layers: [
      makeLayer("cielo", "Cielo", W, H, sky, -20, false),
      makeLayer("terreno", "Terreno", W, H, ground, 0, true),
    ],
    entities: [
      {
        id: "titolo",
        name: "Titolo",
        x: 160,
        y: 20,
        blocks: [
          { type: "Text", props: { text: "PEPINO", size: 30, align: "center", font: "pixel-bold", outline: true } },
          { type: "Fluttua", props: { height: 3, speed: 0.4 } },
        ],
      },
      {
        id: "sottotitolo",
        name: "Sottotitolo",
        x: 160,
        y: 62,
        blocks: [{ type: "Text", props: { text: "Una piccola avventura fatta con Pepino", size: 8, ...dark } }],
      },
      { id: "nuova", name: "Nuova partita", x: 160, y: 94, blocks: [{ type: "Button", props: { text: "Nuova partita", scene: "livello1", order: 0, sound: "moneta" } }] },
      { id: "continua", name: "Continua", x: 160, y: 118, blocks: [{ type: "Button", props: { text: "Continua", order: 1, sound: "moneta" } }] },
      { id: "lingua", name: "Lingua", x: 160, y: 142, blocks: [{ type: "Button", props: { text: "Lingua: Italiano", order: 2, sound: "moneta" } }] },
      {
        id: "istruzioni",
        name: "Istruzioni menù",
        x: 160,
        y: 165,
        blocks: [{ type: "Text", props: { text: "↑ ↓ scegli   ·   Z o Invio conferma", size: 6, ...dark } }],
      },
      {
        id: "pepino_menu",
        name: "Pepino (decorazione)",
        x: 64,
        y: 160,
        blocks: [
          { type: "Sprite", props: { image: "pepino", flipWithFacing: false } },
          { type: "Animator", props: {} },
        ],
      },
      {
        id: "slime_menu",
        name: "Slime (decorazione)",
        x: 256,
        y: 160,
        blocks: [
          { type: "Sprite", props: { image: "slime", flipWithFacing: false } },
          { type: "Animator", props: {} },
          { type: "Saltella", props: { altezza: 1, pausa: 1.5 } },
        ],
      },
    ],
    rules: [
      rule("nuova_partita", "Nuova partita azzera le monete", { type: "event", params: { target: "@nuova", event: "pressed" } }, [], [
        { type: "var.set", params: { variable: "monete", value: "0" } },
      ]),
      rule(
        "nascondi_continua",
        "Senza salvataggio non si può continuare",
        { type: "scene.start", params: {} },
        [{ type: "save.exists", params: {}, not: true }],
        [{ type: "object.visible", params: { visible: "hide", target: "@continua" } }],
      ),
      rule("continua", "Continua carica la partita salvata", { type: "event", params: { target: "@continua", event: "pressed" } }, [], [
        { type: "game.load", params: {} },
      ]),
      rule("lingua", "Il pulsante Lingua passa dall'italiano all'inglese e viceversa", { type: "event", params: { target: "@lingua", event: "pressed" } }, [], [
        { type: "lang.next", params: {} },
      ]),
    ],
  };
}

// ---------------------------------------------------------------- Traduzione inglese (scheda Testi)
// La chiave è il testo originale: se un testo cambia, il controllo del progetto segnala la traduzione mancante.

const EN = {
  PEPINO: "PEPINO",
  "Punti {punti}": "Score {punti}",
  "Punti: {punti}": "Score: {punti}",
  "Frecce: muoviti · Z: spara · X: rallenta": "Arrows: move · Z: fire · X: slow down",
  "Clicca una piazzola per costruire una torretta (20 monete)": "Click a build spot to build a tower (20 coins)",
  "Ondata {ondata}/5": "Wave {ondata}/5",
  "Gli slime sono passati!": "The slimes got through!",
  "Hai difeso il villaggio!": "You defended the village!",
  "↑ acceleri · ↓ freni · ← → sterzi. Resta sull'asfalto!": "↑ throttle · ↓ brake · ← → steer. Stay on the tarmac!",
  3: "3",
  2: "2",
  1: "1",
  "Via!": "Go!",
  "Ultimo giro!": "Final lap!",
  "Arrivo! Posizione {posizione} su 4": "Finish! Position {posizione} of 4",
  "Giro {giro}/3": "Lap {giro}/3",
  "Posizione {posizione}/4": "Position {posizione}/4",
  "Tempo {tempo}": "Time {tempo}",
  "Gara finita!": "Race over!",
  "Tempo: {tempo} s · Giro migliore: {migliore} s": "Time: {tempo} s · Best lap: {migliore} s",
  "Clicca per camminare. Clicca le cose per guardarle, raccoglierle o usarle.": "Click to walk. Click things to look at them, pick them up or use them.",
  Finestra: "Window",
  Quadro: "Painting",
  Cassettiera: "Chest of drawers",
  Vaso: "Vase",
  Porta: "Door",
  Moneta: "Coin",
  Chiave: "Key",
  "Fuori c'è il giardino. Devo trovare il modo di uscire!": "The garden is outside. I have to find a way out!",
  "Il bisnonno Cetriolo. Che bei baffi!": "Great-grandpa Pickle. What a moustache!",
  "Calzini, calzini e ancora calzini. Niente chiave.": "Socks, socks and more socks. No key.",
  "La porta è chiusa a chiave.": "The door is locked.",
  "La chiave gira... la porta si apre!": "The key turns... the door opens!",
  "Non entra nella serratura.": "It doesn't fit in the lock.",
  "Una moneta! La metto in tasca.": "A coin! Into my pocket it goes.",
  "No grazie, non mi serve.": "No thanks, I don't need that.",
  "Non funziona.": "That doesn't work.",
  "Usa {oggetto} con {punto}": "Use {oggetto} with {punto}",
  "Nel vaso, Pepino! La chiave è nel vaso.": "In the vase, Pepino! The key is in the vase.",
  "Grazie! Ora mi ricordo: la chiave è nel vaso!": "Thanks! Now I remember: the key is in the vase!",
  "Ormai nel vaso c'è solo terra.": "Now there's only soil in the vase.",
  "Un vaso con una pianta. È pieno di terra.": "A vase with a plant. It's full of soil.",
  "Nel vaso c'era la chiave!": "The key was in the vase!",
  "Pepino! Ho chiuso la porta e ho nascosto la chiave in un posto sicuro...": "Pepino! I locked the door and hid the key in a safe place...",
  "...ma non mi ricordo più dove! Alla mia età la memoria va a monete.": "...but I can't remember where! At my age, memory runs on coins.",
  "Va a monete?": "Runs on coins?",
  "Dammi una moneta per il gelato e mi tornerà in mente tutto!": "Give me a coin for an ice cream and it'll all come back to me!",
  "Sei uscito dalla casa!": "You got out of the house!",
  // Oggetti, potenziamenti e negozio
  Pozione: "Potion",
  "Recupera un cuore.": "Restores one heart.",
  "Stivali veloci": "Speed boots",
  "Corri più veloce per 10 secondi.": "Run faster for 10 seconds.",
  Stella: "Star",
  "Invincibile per 8 secondi.": "Invincible for 8 seconds.",
  Calamita: "Magnet",
  "Attira le monete vicine per 12 secondi.": "Pulls nearby coins for 12 seconds.",
  Scudo: "Shield",
  "Para il prossimo colpo.": "Blocks the next hit.",
  "Fungo saltarello": "Bouncy mushroom",
  "Salti più in alto per 10 secondi.": "Jump higher for 10 seconds.",
  "Una moneta luccicante.": "A shiny coin.",
  "La chiave della porta di casa.": "The key to the front door.",
  Velocità: "Speed",
  "Super salto": "Super jump",
  Invincibilità: "Invincibility",
  "Più forza": "Strength",
  "Salto in più": "Extra jump",
  Esci: "Leave",
  "Comprato!": "Bought!",
  "Non ti bastano": "You can't afford it",
  "Ne hai già il massimo": "You already have the maximum",
  "Non si può usare adesso": "It can't be used now",
  "↑ ↓ scegli · Azione compra · Esc esci": "↑ ↓ choose · Action buys · Esc leaves",
  "Bottega di Zia Zucca": "Auntie Pumpkin's Shop",
  "C  Bottega": "C  Shop",
  Monete: "Coins",
  // Prima persona
  Munizioni: "Ammo",
  "Dieci semi per la sparasemi.": "Ten seeds for the seed shooter.",
  Medikit: "Medkit",
  "Recupera due cuori.": "Restores two hearts.",
  // Gioco a ritmo
  "← ↓ ↑ → quando la nota tocca la linea. Non perdere il ritmo!": "← ↓ ↑ → when the note touches the line. Don't lose the beat!",
  "Concerto finito!": "Show over!",
  "Punti: {punti} · Note mancate: {mancate}": "Score: {punti} · Missed notes: {mancate}",
  "Perfetto!": "Perfect!",
  "Bene!": "Good!",
  Mancata: "Missed",
  Combo: "Combo",
  "Pronti…": "Ready…",
  "Finito!": "Done!",
  // Gioco della paura
  Ombra: "Shadow",
  Fusibile: "Fuse",
  Pila: "Battery",
  Armadio: "Wardrobe",
  Cancello: "Gate",
  "Torcia {batteria}%": "Torch {batteria}%",
  "Fusibili {fusibili}/3": "Fuses {fusibili}/3",
  Coraggio: "Courage",
  "Q accende e spegne la torcia · C per nasconderti negli armadi. Trova 3 fusibili e scappa dal cancello!":
    "Q turns the torch on and off · C hides you in the wardrobes. Find 3 fuses and escape through the gate!",
  "Pila nuova!": "Fresh battery!",
  "Hai tutti i fusibili: il cancello si apre!": "You have all the fuses: the gate opens!",
  "Il cancello è bloccato: mancano dei fusibili.": "The gate is locked: some fuses are missing.",
  "Troppa paura!": "Too scared!",
  "Sei uscito dalla serra!": "You got out of the greenhouse!",
  "Il nonno non ci crederà mai.": "Grandpa will never believe it.",
  // Gioco di carte
  "Fine turno": "End turn",
  "Il tuo turno": "Your turn",
  "Hai vinto!": "You won!",
  "Hai perso!": "You lost!",
  "Non hai abbastanza energia": "Not enough energy",
  Attacca: "Attacks",
  "Si cura": "Heals",
  "Si difende": "Defends",
  Energia: "Energy",
  Mazzo: "Deck",
  Scarti: "Discard",
  Colpisce: "Hits",
  Cura: "Heals",
  "Pesca carte": "Draws cards",
  "Dà energia": "Gives energy",
  Zampata: "Paw swipe",
  Zappata: "Hoe hit",
  "Foglia dura": "Tough leaf",
  Innaffiata: "Watering",
  "Buona idea": "Good idea",
  Peperoncino: "Chilli",
  "Cavolo Nero": "Black Cabbage",
  Barbabietola: "Beetroot",
  Corazza: "Armour",
  Morso: "Bite",
  Testata: "Headbutt",
  Radici: "Roots",
  Zuccherino: "Sugar lump",
  "← → scegli la carta · C la giochi · X chiude il turno. Puoi anche cliccare!":
    "← → pick the card · C plays it · X ends the turn. You can click too!",
  "Hai imparato il Peperoncino!": "You learned the Chilli!",
  "Ultimo duello: usa il Peperoncino al momento giusto!": "Last duel: play the Chilli at the right moment!",
  "Torneo vinto!": "Tournament won!",
  "Il Peperoncino resta nel tuo mazzo.": "The Chilli stays in your deck.",
  "Ti hanno battuto!": "They beat you!",
  "Riprova: le carte imparate si perdono.": "Try again: the cards you learned are lost.",
  // Roguelike
  "Piano {piano}": "Floor {piano}",
  "Piano {piano}!": "Floor {piano}!",
  "Frecce per muoverti · V colpisci · trova la scala e scendi. Ogni piano è diverso!":
    "Arrows to move · V hits · find the stairs and go down. Every floor is different!",
  // Picchiaduro 1 contro 1
  Peperone: "Pepper",
  Round: "Round",
  "Lotta!": "Fight!",
  "K.O.": "K.O.",
  "Tempo scaduto": "Time up",
  "Vince {0}!": "{0} wins!",
  "Incontro finito!": "Match over!",
  "Ci rivediamo sul tetto!": "See you on the roof!",
  "← → muoviti · tieni indietro per parare · ↓ abbassati · Z salta · V colpisci (tre colpi in fila)":
    "← → move · hold back to guard · ↓ crouch · Z jump · V hit (three hits in a row)",
  "Semi {munizioni} · Peperoncini {peperoncini}": "Seeds {munizioni} · Peppers {peperoncini}",
  Sparasemi: "Seed shooter",
  Lanciapeperoncini: "Pepper launcher",
  "La seconda arma: peperoncini che bruciano.": "The second weapon: peppers that burn.",
  "Lanciapeperoncini! Premi E per cambiare arma.": "Pepper launcher! Press E to switch weapon.",
  "↑ ↓ cammina · ← → gira · X + ← → passo di lato · V spara · E cambia arma. Trova l'uscita!":
    "↑ ↓ walk · ← → turn · X + ← → sidestep · V shoots · E switches weapon. Find the exit!",
  "Sei uscito dal labirinto!": "You got out of the maze!",
  "Il nonno ti aspetta in giardino.": "Grandpa is waiting for you in the garden.",
  "Una piccola avventura fatta con Pepino": "A little adventure made with Pepino",
  "Nuova partita": "New game",
  Continua: "Continue",
  "Lingua: Italiano": "Language: English",
  "↑ ↓ scegli   ·   Z o Invio conferma": "↑ ↓ choose   ·   Z or Enter confirm",
  "← →  muoviti     Z  salta (anche in aria)": "← →  move     Z  jump (in the air too)",
  "X  dash     ↑ ↓  scale     F1  debug": "X  dash     ↑ ↓  ladders     F1  debug",
  Vita: "Life",
  "Monete {monete}": "Coins {monete}",
  "Boing! Questa molla è un blocco scritto in Python: guardalo nella scheda Codice.": "Boing! This spring is a block written in Python: look at it in the Code tab.",
  "Raccogli le monete e raggiungi la porta in fondo al livello!": "Collect the coins and reach the door at the end of the level!",
  "Dieci monete! Continua così.": "Ten coins! Keep it up.",
  C: "C",
  Pepinopoli: "Pepinopolis",
  "Benvenuto a Pepinopoli! La partita è stata salvata.": "Welcome to Pepinopolis! The game has been saved.",
  "«Le porte collegano i mondi. Vicino a un cartello premi C per leggerlo.»": "“Doors connect the worlds. Next to a sign, press C to read it.”",
  "Hai il mestolo! Premi V per colpire gli slime.": "You have the ladle! Press V to hit the slimes.",
  "Pepinopoli è salva! Il nonno ti regala 10 monete.": "Pepinopolis is safe! Grandpa gives you 10 coins.",
  "Strada dei teppisti": "Thugs' Street",
  "Strada dei teppisti! ↑ ↓ cammini in profondità, Z salta, V colpisce.": "Thugs' Street! ↑ ↓ walk in depth, Z jumps, V hits.",
  "Avanti!": "Go on!",
  "Avanti, il capo ti aspetta in fondo alla strada!": "Go on, the boss is waiting at the end of the street!",
  "Hai sconfitto il Capo dei teppisti! La porta in fondo riporta al villaggio.": "You beat the Thug Boss! The door at the end leads back to the village.",
  "Capo dei teppisti": "Thug Boss",
  "Nonno Cetriolo": "Grandpa Cucumber",
  "Pepino! Gli slime sono scappati dal laghetto e ora inseguono chiunque passi.":
    "Pepino! The slimes escaped from the pond and now they chase anyone who walks by.",
  "Te la senti di dargli una lezione?": "Do you feel like teaching them a lesson?",
  "Certo, ci penso io!": "Sure, leave it to me!",
  "Magari più tardi...": "Maybe later...",
  "Prendi il mio vecchio mestolo. Premi V per colpire.": "Take my old ladle. Press V to hit.",
  Pepino: "Pepino",
  "Grazie nonno, vado subito!": "Thanks Grandpa, I'm on my way!",
  "Va bene, ma stai lontano dagli slime. Torna a parlarmi quando sei pronto.":
    "All right, but stay away from the slimes. Come back and talk to me when you're ready.",
  Pausa: "Paused",
  "Premi Esc (o Start) per riprendere": "Press Esc (or Start) to resume",
  "Livello completato!": "Level complete!",
  "Monete: {monete}": "Coins: {monete}",
  Ricomincia: "Play again",
};

// ---------------------------------------------------------------- Script (blocchi in codice)

const SCRIPT_FLUTTUA = `// Blocco scritto in JavaScript: fa salire e scendere dolcemente l'oggetto.
Pepino.defineBlock({
  name: "Fluttua",
  label: "Fluttua",
  description: "Fa salire e scendere l'oggetto piano piano (scritto in JavaScript).",
  props: {
    height: { type: "number", label: "Altezza", unit: "px", default: 4, min: 0 },
    speed: { type: "number", label: "Velocità", unit: "giri/s", default: 0.5, min: 0, step: 0.1 },
  },

  init(self) {
    self.data.baseY = self.entity.y;
    self.data.t = 0;
  },

  update(self, dt) {
    self.data.t += dt * self.props.speed;
    self.entity.y = self.data.baseY + Math.sin(self.data.t * Math.PI * 2) * self.props.height;
  },
});
`;

const SCRIPT_MOLLA = `# Blocco scritto in Python: Pepino lo traduce in JavaScript.
# Quando il giocatore tocca la molla scendendo (o camminandoci sopra), viene lanciato in alto.
name = "Molla"
label = "Molla"
description = "Lancia in alto chi la tocca (scritto in Python)."
requires = ["Body"]
props = {
    "force": {"type": "number", "label": "Forza", "unit": "tile/s", "default": 22, "min": 0},
    "target": {"type": "tag", "label": "Chi lancia", "default": "giocatore"},
    "sound": {"type": "audio", "label": "Suono", "default": "", "optional": True},
}
events = [{"id": "launched", "label": "Ha lanciato qualcuno"}]
actions = {
    "potenzia": {
        "label": "Cambia la forza",
        "params": {"force": {"type": "number", "label": "Forza", "unit": "tile/s", "default": 30}},
    },
}


def update(self, dt):
    for other in self.body.touching(self.props.target):
        if other.body and other.body.vy >= 0:
            other.body.vy = -self.props.force * self.scene.tileSize
            if self.props.sound:
                self.game.audio.play(self.props.sound)
            self.emit("launched", other)


def potenzia(self, force):
    self.props.force = force
`;

const SCRIPT_SALTELLA = `# Blocco scritto in Pepino Language: fa un saltello ogni tanto.
# Il pulsante «In inglese» lo riscrive con le parole inglesi.
blocco Saltella "Saltella":
    descrizione "Fa un saltello ogni tanto (scritto in Pepino Language)."
    proprietà altezza = 1 tile, "Altezza del salto", da 0 a 5
    proprietà pausa = 1.5 s, "Pausa tra i salti", da 0 a 10
    evento saltello "Ha fatto un saltello"

    base_y = 0

    quando inizia:
        base_y = oggetto.y
        ripeti:
            aspetta pausa
            salta()
            emetti saltello

    # Su e giù in mezzo secondo, un fotogramma alla volta.
    funzione salta():
        t = 0 s
        mentre t < 0.5 s:
            t += dt
            oggetto.y = base_y - sen(limita(t / 0.5 s, 0, 1) * 180) * altezza
            aspetta
        oggetto.y = base_y
`;

// ---------------------------------------------------------------- Progetto

const project = {
  format: "pepino",
  version: 1,
  name: "Pepino Demo",
  settings: {
    resolution: { width: 320, height: 180 },
    pixelPerfect: true,
    tileSize: TS,
    startScene: "menu",
    background: "#8fd3ff",
    font: "pixel",
    collisionGroups: ["giocatore", "nemici", "raccoglibili", "trigger", "proiettili"],
  },
  input: {
    left: ["Key:ArrowLeft", "Key:KeyA", "Pad:DPadLeft", "Pad:LeftStickLeft"],
    right: ["Key:ArrowRight", "Key:KeyD", "Pad:DPadRight", "Pad:LeftStickRight"],
    up: ["Key:ArrowUp", "Key:KeyW", "Pad:DPadUp", "Pad:LeftStickUp"],
    down: ["Key:ArrowDown", "Key:KeyS", "Pad:DPadDown", "Pad:LeftStickDown"],
    jump: ["Key:Space", "Key:KeyZ", "Pad:A"],
    dash: ["Key:ShiftLeft", "Key:KeyX", "Pad:RB", "Pad:B"],
    action: ["Key:KeyC", "Key:Enter", "Pad:X"],
    attack: ["Key:KeyV", "Key:KeyJ", "Pad:Y"],
    pause: ["Key:Escape", "Pad:Start"],
  },
  variables: { monete: 0, vita: 3, missione: 0, inventario: "" },
  items: BASE_ITEMS,
  assets: [
    ITEM_ICONS,
    { id: "tiles", type: "image", src: "assets/tiles.png" },
    {
      id: "pepino",
      type: "image",
      src: "assets/pepino.png",
      frameWidth: 16,
      frameHeight: 24,
      animations: HERO_ANIMS,
    },
    {
      id: "pepino_td",
      type: "image",
      src: "assets/pepino_td.png",
      frameWidth: 16,
      frameHeight: 16,
      animations: {
        idle: { frames: [0], fps: 1, loop: true },
        walk: { frames: [0, 1], fps: 6, loop: true },
        idle_down: { frames: [0], fps: 1, loop: true },
        walk_down: { frames: [0, 1], fps: 6, loop: true },
        idle_up: { frames: [2], fps: 1, loop: true },
        walk_up: { frames: [2, 3], fps: 6, loop: true },
        idle_side: { frames: [4], fps: 1, loop: true },
        walk_side: { frames: [4, 5], fps: 6, loop: true },
      },
    },
    {
      id: "slime",
      type: "image",
      src: "assets/slime.png",
      frameWidth: 16,
      frameHeight: 16,
      animations: {
        idle: { frames: [0, 1], fps: 3, loop: true },
        run: { frames: [0, 1], fps: 6, loop: true },
        walk: { frames: [0, 1], fps: 5, loop: true },
        fall: { frames: [0], fps: 1, loop: true },
      },
    },
    {
      id: "coin",
      type: "image",
      src: "assets/coin.png",
      frameWidth: 16,
      frameHeight: 16,
      animations: { idle: { frames: [0, 1, 2, 3], fps: 8, loop: true } },
    },
    { id: "door", type: "image", src: "assets/door.png" },
    { id: "cartello", type: "image", src: "assets/sign.png" },
    {
      id: "nonno",
      type: "image",
      src: "assets/nonno.png",
      frameWidth: 16,
      frameHeight: 16,
      animations: { idle: { frames: [0, 0, 0, 0, 1], fps: 4, loop: true } },
    },
    { id: "ritratti", type: "image", src: "assets/ritratti.png", frameWidth: 32, frameHeight: 32 },
    { id: "seme", type: "image", src: "assets/seme.png" },
    { id: "molla", type: "image", src: "assets/molla.png" },
    { id: "lampione", type: "image", src: "assets/lampione.png" },
    {
      id: "boss",
      type: "image",
      src: "assets/boss.png",
      frameWidth: 32,
      frameHeight: 32,
      animations: {
        idle: { frames: [0, 1], fps: 3, loop: true },
        walk: { frames: [2, 3], fps: 6, loop: true },
        windup: { frames: [4], fps: 1, loop: true },
        attack: { frames: [5], fps: 1, loop: true },
        charge: { frames: [6, 3], fps: 10, loop: true },
        jump: { frames: [5], fps: 1, loop: true },
        slam: { frames: [4], fps: 1, loop: true },
        shoot: { frames: [5, 0], fps: 8, loop: true },
        summon: { frames: [4, 5], fps: 6, loop: true },
        tired: { frames: [7], fps: 1, loop: true },
      },
    },
    {
      id: "sputasemi",
      type: "image",
      src: "assets/sputasemi.png",
      frameWidth: 16,
      frameHeight: 16,
      animations: { idle: { frames: [0, 1], fps: 2, loop: true } },
    },
    { id: "salto", type: "audio", src: "assets/jump.wav" },
    { id: "moneta", type: "audio", src: "assets/coin.wav" },
    { id: "colpo", type: "audio", src: "assets/hurt.wav" },
    { id: "schiaccia", type: "audio", src: "assets/stomp.wav" },
    { id: "dash", type: "audio", src: "assets/dash.wav" },
    { id: "musica", type: "audio", src: "assets/music.wav" },
  ],
  tilesets: [
    {
      id: "tiles",
      name: "Natura",
      image: "tiles",
      tileSize: TS,
      columns: COLS,
      count: 23,
      tiles: {
        0: { collision: "solid" },
        1: { collision: "solid" },
        2: { collision: "solid" },
        3: { collision: "oneway" },
        4: { collision: "ladder" },
        5: { collision: "hazard" },
        11: { collision: "solid" },
        12: { collision: "solid" },
        13: { collision: "solid" },
        15: { collision: "solid" },
        21: { collision: "solid" },
      },
    },
  ],
  prefabs: [
    {
      id: "slime",
      name: "Slime",
      tags: ["nemico"],
      blocks: [
        { type: "Sprite", props: { image: "slime" } },
        { type: "Body", props: { width: 12, height: 9, group: "nemici", collidesWith: ["giocatore"] } },
        { type: "PlatformController", props: { input: "ai", speed: 1.5, airJumps: 0, dash: false } },
        { type: "Patrol", props: {} },
        { type: "Health", props: { max: 1, knockback: 0, invulnerability: 0 } },
        { type: "ContactDamage", props: { target: "giocatore", stompSound: "schiaccia" } },
        { type: "Animator", props: {} },
      ],
    },
    {
      id: "slime_td",
      name: "Slime vagante",
      tags: ["nemico"],
      blocks: [
        { type: "Sprite", props: { image: "slime" } },
        { type: "Body", props: { width: 12, height: 8, group: "nemici", collidesWith: ["giocatore"] } },
        { type: "TopDownController", props: { input: "ai", speed: 1.8, directions: "4" } },
        { type: "Patrol", props: { axis: "vertical", turnAtEdges: false } },
        { type: "Chaser", props: { target: "giocatore", seeRange: 4.5, loseRange: 7 } },
        { type: "Health", props: { max: 2, invulnerability: 0.4, knockback: 7 } },
        { type: "ContactDamage", props: { target: "giocatore", stompable: false } },
        { type: "Animator", props: {} },
      ],
    },
    {
      id: "moneta",
      name: "Moneta",
      tags: ["moneta"],
      blocks: [
        { type: "Sprite", props: { image: "coin", origin: "center", flipWithFacing: false } },
        { type: "Body", props: { width: 8, height: 8, group: "raccoglibili", collidesWith: ["giocatore"], world: false } },
        { type: "Collectible", props: { variable: "monete", sound: "moneta" } },
        { type: "Animator", props: {} },
      ],
    },
    {
      id: "porta",
      name: "Porta",
      tags: ["uscita"],
      blocks: [
        { type: "Sprite", props: { image: "door", flipWithFacing: false } },
        { type: "Body", props: { width: 10, height: 20, group: "trigger", collidesWith: ["giocatore"], world: false } },
        { type: "SceneExit", props: { scene: "" } },
      ],
    },
    {
      id: "seme",
      name: "Seme",
      tags: ["proiettile"],
      blocks: [
        { type: "Sprite", props: { image: "seme", origin: "center" } },
        { type: "Body", props: { width: 6, height: 6, group: "proiettili", collidesWith: [], world: true } },
        { type: "Projectile", props: { target: "giocatore", damage: 1, lifetime: 3 } },
      ],
    },
    {
      id: "sputasemi",
      name: "Sputasemi",
      tags: ["nemico"],
      blocks: [
        { type: "Sprite", props: { image: "sputasemi" } },
        { type: "Body", props: { width: 12, height: 13, group: "nemici", collidesWith: ["giocatore"], world: false } },
        { type: "Health", props: { max: 1, invulnerability: 0, knockback: 0 } },
        { type: "ContactDamage", props: { target: "giocatore", stompSound: "schiaccia" } },
        { type: "Shooter", props: { projectile: "seme", mode: "auto", aim: "target", range: 7, interval: 2.2, speed: 5, offsetX: 4, offsetY: -8 } },
        { type: "Animator", props: {} },
      ],
    },
    TEPPISTA,
    CAPO,
  ],
  scenes: [levelMenu(), levelPlatform(), levelVillage(), levelStreet()],
  languages: [
    { id: "it", name: "Italiano" },
    { id: "en", name: "English" },
  ],
  translations: { en: EN },
  scripts: [
    { id: "fluttua", name: "Fluttua", language: "js", code: SCRIPT_FLUTTUA },
    { id: "molla", name: "Molla", language: "py", code: SCRIPT_MOLLA },
    { id: "saltella", name: "Saltella", language: "pep", code: SCRIPT_SALTELLA },
  ],
  dialogues: [
    {
      id: "nonno",
      name: "Nonno Cetriolo",
      lines: [
        { id: "b1", speaker: "Nonno Cetriolo", portrait: "ritratti", portraitFrame: 1, text: "Pepino! Gli slime sono scappati dal laghetto e ora inseguono chiunque passi." },
        {
          id: "b2",
          speaker: "Nonno Cetriolo",
          portrait: "ritratti",
          portraitFrame: 1,
          text: "Te la senti di dargli una lezione?",
          choices: [
            { text: "Certo, ci penso io!", goto: "b3", setVar: "missione", setValue: "1" },
            { text: "Magari più tardi...", goto: "b5" },
          ],
        },
        { id: "b3", speaker: "Nonno Cetriolo", portrait: "ritratti", portraitFrame: 1, text: "Prendi il mio vecchio mestolo. Premi V per colpire." },
        { id: "b4", speaker: "Pepino", portrait: "ritratti", portraitFrame: 0, text: "Grazie nonno, vado subito!", goto: "fine" },
        {
          id: "b5",
          speaker: "Nonno Cetriolo",
          portrait: "ritratti",
          portraitFrame: 1,
          text: "Va bene, ma stai lontano dagli slime. Torna a parlarmi quando sei pronto.",
        },
      ],
    },
  ],
};

// Il progetto qui sopra è la base dei modelli (asset, modelli, oggetti).

// ---------------------------------------------------------------- Modelli per «Nuovo progetto»
// Un gioco piccolo ma completo per genere. Usano gli asset di samples/templates/assets: l'editor li copia nel nuovo progetto.

const TEMPLATES_DIR = join(ROOT, "samples", "templates");
mkdirSync(TEMPLATES_DIR, { recursive: true });

/** Tutte le porte della scena portano a `scene`. */
const doorsTo = (s, scene) => ({
  ...s,
  entities: s.entities.map((e) =>
    e.prefab === "porta" ? { ...e, blocks: e.blocks.map((b) => (b.type === "SceneExit" ? { ...b, props: { ...b.props, scene } } : b)) } : e,
  ),
});
/** Cambia il testo del blocco Testo di un oggetto della scena. */
const retext = (s, entityId, text) => ({
  ...s,
  entities: s.entities.map((e) =>
    e.id === entityId ? { ...e, blocks: e.blocks.map((b) => (b.type === "Text" ? { ...b, props: { ...b.props, text } } : b)) } : e,
  ),
});
const without = (s, entityIds, ruleIds = []) => ({
  ...s,
  entities: s.entities.filter((e) => !entityIds.includes(e.id) && !entityIds.includes(e.name)),
  rules: (s.rules ?? []).filter((r) => !ruleIds.includes(r.id)),
});

/** Progetto vuoto: una scena senza oggetti, con i layer pronti da dipingere. */
function emptyScene() {
  const W = 40;
  const H = 17;
  const empty = () => new Array(W * H).fill(-1);
  return {
    id: "scena",
    name: "Scena 1",
    width: W,
    height: H,
    background: "#8fd3ff",
    layers: [makeLayer("sfondo", "Sfondo", W, H, empty(), -10, false), makeLayer("terreno", "Terreno", W, H, empty(), 0, true)],
    entities: [],
    rules: [],
  };
}

const templates = {
  vuoto: {
    name: "Il mio gioco",
    start: "scena",
    touch: { mode: "auto", buttons: ["jump", "action"] },
    scenes: [emptyScene()],
    variables: {},
    prefabs: null,
    items: null,
  },
  platform: {
    name: "Il mio platform",
    start: "livello1",
    touch: { mode: "auto", buttons: ["jump", "dash", "action"] },
    scenes: [doorsTo(without(levelPlatform(), ["molla"], ["boing"]), "fine"), levelEnd("livello1")],
  },
  topdown: {
    name: "La mia avventura top-down",
    start: "villaggio",
    touch: { mode: "auto", buttons: ["attack", "action"] },
    scenes: [doorsTo(without(levelVillage(), ["Porta della città"]), "fine"), levelEnd("villaggio")],
    dialogues: project.dialogues,
  },
  beatemup: {
    name: "Il mio beat 'em up",
    start: "strada",
    touch: { mode: "auto", buttons: ["attack", "jump"] },
    scenes: [levelStreet("fine"), levelEnd("strada")],
  },
  shmup: {
    name: "Il mio shoot'em up",
    start: "spazio",
    touch: { mode: "auto", buttons: ["jump", "dash"] },
    scenes: [levelSpace(), retext(levelEnd("spazio"), "monete_fine", "Punti: {punti}")],
    assets: SPACE_ASSETS,
    prefabs: SPACE_PREFABS,
    variables: { punti: 0, vita: 3, monete: 0 },
  },
  towerdefense: {
    name: "Il mio tower defense",
    start: "difesa",
    touch: { mode: "off", buttons: [] },
    scenes: [levelDefense(), levelEnd("difesa")],
    assets: TD_ASSETS,
    prefabs: TD_PREFABS,
    variables: { monete: 50, vita: 10, ondata: 0 },
  },
  racing: {
    name: "Il mio gioco di corse",
    start: "circuito",
    touch: { mode: "auto", buttons: [] },
    scenes: [
      levelRace(),
      retext(retext(levelEnd("circuito"), "titolo_fine", "Gara finita!"), "monete_fine", "Tempo: {tempo} s · Giro migliore: {migliore} s"),
    ],
    assets: RACE_ASSETS,
    variables: { giro: 1, posizione: 4, tempo: 0, migliore: 0, monete: 0, vita: 3 },
  },
  pointclick: {
    name: "La mia avventura punta e clicca",
    start: "casa",
    touch: { mode: "off", buttons: [] },
    scenes: [levelHouse(), houseEnd()],
    assets: HOUSE_ASSETS,
    items: HOUSE_ITEMS,
    dialogues: [NONNO_CHIAVE],
    variables: { inventario: "", indizio: 0, chiave_presa: 0, monete: 0, vita: 3 },
  },
  ritmo: {
    name: "Il mio gioco a ritmo",
    start: "palco",
    touch: { mode: "auto", buttons: [] },
    scenes: [levelStage(), stageEnd()],
    assets: RH_ASSETS,
    items: null,
    variables: { punti: 0, combo: 0, mancate: 0, monete: 0, vita: 3 },
  },
  horror: {
    name: "Il mio gioco della paura",
    start: "serra",
    touch: { mode: "auto", buttons: ["item", "action"] },
    scenes: [levelHaunted(), hauntedEnd()],
    assets: HR_ASSETS,
    prefabs: HR_PREFABS,
    items: null,
    variables: { vita: 3, coraggio: 100, batteria: 100, fusibili: 0, monete: 0 },
  },
  carte: {
    name: "Il mio gioco di carte",
    start: "duello1",
    touch: { mode: "off", buttons: [] },
    scenes: [levelCards1(), levelCards2(), cardsEnd(), cardsLost()],
    assets: CARD_ASSETS,
    items: null,
    variables: { vita: 24, vita_nemico: 20, vinto: 0, carte: "", monete: 0 },
  },
  roguelike: {
    name: "Il mio roguelike",
    start: "sotterraneo",
    touch: { mode: "auto", buttons: ["attack", "action"] },
    scenes: [levelDungeon()],
    assets: RL_ASSETS,
    prefabs: RL_PREFABS,
    variables: { vita: 3, monete: 0, piano: 1, inventario: "" },
  },
  picchiaduro: {
    name: "Il mio picchiaduro",
    start: "arena",
    touch: { mode: "auto", buttons: ["attack", "jump"] },
    scenes: [levelArena(), arenaEnd()],
    assets: VS_ASSETS,
    items: null,
    variables: { vita: 10, vincitore: 0, monete: 0, inventario: "" },
  },
  fps: {
    name: "Il mio gioco in prima persona",
    start: "labirinto",
    touch: { mode: "auto", buttons: ["attack", "dash"] },
    scenes: [levelMaze(), mazeEnd()],
    assets: FP_ASSETS,
    prefabs: FP_PREFABS,
    items: FP_ITEMS,
    variables: { vita: 5, munizioni: 20, peperoncini: 0, arma2: 0, punti: 0, monete: 0, inventario: "" },
  },
};

/** Fine dell'avventura: «Ricomincia» svuota anche l'inventario e rimette la chiave nel vaso. */
function houseEnd() {
  const s = retext(retext(levelEnd("casa"), "titolo_fine", "Sei uscito dalla casa!"), "monete_fine", "Il nonno ti aspetta in giardino.");
  s.rules[0].actions.push(
    { type: "var.set", params: { variable: "inventario", value: "" } },
    { type: "var.set", params: { variable: "indizio", value: "0" } },
    { type: "var.set", params: { variable: "chiave_presa", value: "0" } },
  );
  return s;
}

for (const [id, t] of Object.entries(templates)) {
  const { scripts: _scripts, ...base } = project;
  const data = {
    ...base,
    name: t.name,
    settings: { ...project.settings, startScene: t.start, touch: t.touch },
    variables: t.variables ?? { monete: 0, vita: 3, missione: 0, inventario: "" },
    // Oggetti dell'archivio: quelli di base più quelli del genere (il progetto vuoto non ne ha).
    items: t.items === null ? [] : [...(base.items ?? []), ...(t.items ?? [])],
    // Asset e modelli propri del genere si aggiungono a quelli di base.
    assets: [...base.assets, ...(t.assets ?? [])],
    // Il progetto vuoto non ha modelli (prefabs: null); gli altri aggiungono i loro a quelli di base.
    prefabs: t.prefabs === null ? [] : [...base.prefabs, ...(t.prefabs ?? [])],
    scenes: t.scenes,
    dialogues: t.dialogues ?? [],
    rules: [],
  };
  writeFileSync(join(TEMPLATES_DIR, `${id}.json`), JSON.stringify(data, null, 2));
}
console.log(`Modelli di progetto generati in ${TEMPLATES_DIR}`);

// ---------------------------------------------------------------- Giochi di esempio (facoltativi)
// Ogni cartella scripts/<nome>/ con un build.mjs che esporta `example` ({ id, name: { it, en }, description })
// e `build()` genera un gioco in samples/<id>/. L'indice samples/esempi.json alimenta il menu «Esempi» dell'editor.
const examples = [];
for (const dir of readdirSync(join(ROOT, "scripts"), { withFileTypes: true })) {
  const file = join(ROOT, "scripts", dir.name, "build.mjs");
  if (!dir.isDirectory() || !existsSync(file)) continue;
  const mod = await import(pathToFileURL(file).href);
  if (!mod.example || typeof mod.build !== "function") continue;
  mod.build();
  examples.push(mod.example);
  console.log(`Esempio «${mod.example.name.it}» generato in samples/${mod.example.id}`);
}
const INDEX = join(ROOT, "samples", "esempi.json");
if (examples.length) writeFileSync(INDEX, JSON.stringify(examples, null, 2));
else rmSync(INDEX, { force: true });

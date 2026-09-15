// Genera il progetto di esempio "Pepino Demo" in samples/demo:
// pixel art (PNG), suoni e musica (WAV) e due scene: un livello platform e un villaggio top-down.
// Tutto è creato da codice, così il repository non dipende da asset esterni.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "samples", "demo");
const ASSETS = join(OUT, "assets");
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

/**
 * Pepino, il cetriolo. (l, t, r, b) = corpo; legs = [x, y del piede]; arms = braccia abbassate.
 * hArms = braccia tese [x, y, lunghezza] con il pugno; hLegs = gambe tese [x, y, lunghezza] (calci).
 */
function pickle(
  c,
  ox,
  oy,
  { l = 3, t = 4, r = 12, b = 19, legs = [[5, 23], [9, 23]], view = "front", arms = [], lines = false, hArms = [], hLegs = [] } = {},
) {
  for (const [lx, foot] of legs) c.rect(ox + lx, oy + b + 1, 2, Math.max(0, foot - b), P.pickleOut);
  for (const [lx, ly, len] of hLegs) {
    c.rect(ox + lx, oy + ly, len, 2, P.pickleOut);
    c.rect(ox + lx + len - 1, oy + ly - 1, 1, 3, P.pickleOut);
  }
  shape(c, ox, oy, roundRect(l, t, r, b), P.pickle, P.pickleOut, [l, t, r, b]);
  c.rect(ox + l + 2, oy + t + 2, 1, Math.max(0, b - t - 5), P.pickleHi);
  for (const [bx, by] of [[l + 5, t + 9], [l + 3, t + 12], [r - 2, t + 7], [r - 3, b - 3]]) {
    if (by < b && bx < r && bx > l) c.set(ox + bx, oy + by, P.pickleDk);
  }
  const w = r - l + 1;
  const ey = t + (b - t > 12 ? 4 : 3);
  if (view === "back") {
    c.rect(ox + Math.floor((l + r) / 2), oy + t + 2, 1, b - t - 4, P.pickleDk);
  } else if (view === "down") {
    for (const ex of [l + 1, r - 2]) {
      c.rect(ox + ex, oy + ey, 2, 3, P.white);
      c.rect(ox + ex, oy + ey + 2, 2, 1, P.pickleOut);
    }
    c.rect(ox + Math.floor((l + r) / 2), oy + ey + 5, 2, 1, P.pickleOut);
  } else {
    const [e1, e2] = w >= 10 ? [3, 6] : [2, 5];
    for (const ex of [l + e1, l + e2]) {
      c.rect(ox + ex, oy + ey, 2, 3, P.white);
      c.rect(ox + ex + 1, oy + ey + 1, 1, 2, P.pickleOut);
    }
    c.rect(ox + l + e2 - 1, oy + ey + 5, 2, 1, P.pickleOut);
  }
  for (const [ax, ay] of arms) c.rect(ox + ax, oy + ay, 1, 3, P.pickleOut);
  for (const [ax, ay, len] of hArms) {
    c.rect(ox + ax, oy + ay, len, 1, P.pickleOut);
    c.rect(ox + ax + len - 1, oy + ay - 1, 2, 3, P.pickleOut);
  }
  if (lines) for (const [lx, ly, lw] of [[0, 11, 3], [1, 14, 2], [0, 17, 3]]) c.rect(ox + lx, oy + ly, lw, 1, P.pickleHi);
}

// 0-10: fermo, corsa, salto, caduta, dash, scale. 11-19: mosse del beat 'em up e reazioni ai colpi.
const hero = new Pix(8 * 16, 3 * 24);
[
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
].forEach((f, i) => pickle(hero, (i % 8) * 16, Math.floor(i / 8) * 24, f));
hero.save("pepino.png");

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
        ],
      },
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
        ],
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
      { type: "Projectile", props: { target: "nemico", damage: 1, lifetime: 1.2, destroyOnWall: false } },
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
// Nel demo lo usa il titolo del menù.
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
  variables: { monete: 0, vita: 3, missione: 0 },
  assets: [
    { id: "tiles", type: "image", src: "assets/tiles.png" },
    {
      id: "pepino",
      type: "image",
      src: "assets/pepino.png",
      frameWidth: 16,
      frameHeight: 24,
      animations: {
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
      },
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

writeFileSync(join(OUT, "project.json"), JSON.stringify(project, null, 2));

// ---------------------------------------------------------------- Modelli per «Nuovo progetto»
// Un gioco piccolo ma completo per genere. Usano gli asset della demo: l'editor li copia nel nuovo progetto.

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

const templates = {
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
};

for (const [id, t] of Object.entries(templates)) {
  const { scripts: _scripts, ...base } = project;
  const data = {
    ...base,
    name: t.name,
    settings: { ...project.settings, startScene: t.start, touch: t.touch },
    variables: t.variables ?? { monete: 0, vita: 3, missione: 0 },
    // Asset e modelli propri del genere si aggiungono a quelli della demo.
    assets: [...base.assets, ...(t.assets ?? [])],
    prefabs: [...base.prefabs, ...(t.prefabs ?? [])],
    scenes: t.scenes,
    dialogues: t.dialogues ?? [],
    rules: [],
  };
  writeFileSync(join(TEMPLATES_DIR, `${id}.json`), JSON.stringify(data, null, 2));
}
console.log(`Modelli di progetto generati in ${TEMPLATES_DIR}`);
console.log(`Progetto demo generato in ${OUT}`);

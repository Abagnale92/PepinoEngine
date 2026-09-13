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
}

drawTiles();
tiles.save("tiles.png");

// ---------------------------------------------------------------- Personaggi

/** Pepino, il cetriolo. (l, t, r, b) = corpo; legs = [x, y del piede]. */
function pickle(c, ox, oy, { l = 3, t = 4, r = 12, b = 19, legs = [[5, 23], [9, 23]], view = "front", arms = [], lines = false } = {}) {
  for (const [lx, foot] of legs) c.rect(ox + lx, oy + b + 1, 2, Math.max(0, foot - b), P.pickleOut);
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
  if (lines) for (const [lx, ly, lw] of [[0, 11, 3], [1, 14, 2], [0, 17, 3]]) c.rect(ox + lx, oy + ly, lw, 1, P.pickleHi);
}

const hero = new Pix(8 * 16, 2 * 24);
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

  const coins = [[6, 10], [11, 10], [19, 10], [24, 10], [15, 4], [15, 16], [3, 3], [27, 17]];

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
      { id: "titolo", name: "Titolo", x: 160, y: 20, blocks: [{ type: "Text", props: { text: "PEPINO", size: 30, align: "center" } }] },
      {
        id: "sottotitolo",
        name: "Sottotitolo",
        x: 160,
        y: 62,
        blocks: [{ type: "Text", props: { text: "Una piccola avventura fatta con Pepino", size: 8, ...dark } }],
      },
      { id: "nuova", name: "Nuova partita", x: 160, y: 94, blocks: [{ type: "Button", props: { text: "Nuova partita", scene: "livello1", order: 0, sound: "moneta" } }] },
      { id: "continua", name: "Continua", x: 160, y: 118, blocks: [{ type: "Button", props: { text: "Continua", order: 1, sound: "moneta" } }] },
      {
        id: "istruzioni",
        name: "Istruzioni menù",
        x: 160,
        y: 138,
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
    ],
  };
}

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
      count: 19,
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
  ],
  scenes: [levelMenu(), levelPlatform(), levelVillage()],
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
console.log(`Progetto demo generato in ${OUT}`);

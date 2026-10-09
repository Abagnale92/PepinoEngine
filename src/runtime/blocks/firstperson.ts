import { frameRect, type LoadedImage } from "../assets/assets";
import { defineBlock, listRows, type BlockInstance, type ListRow } from "../core/block";
import type { Entity } from "../core/entity";
import { hexColor, packColor, parseColor } from "../math";
import { COLL, type CollisionGrid } from "../physics/collision";
import type { TilesetData } from "../project/format";
import type { Renderer } from "../render/renderer";
import { lineOfSight } from "../world/pathfinding";
import { boosted, itemDef } from "../items/items";
import { bodyCenter } from "./targets";

// Vista in prima persona: la scena si costruisce vista dall'alto e si gioca dagli occhi del giocatore.
// I tile solidi diventano muri (disegnati con il raycasting, una colonna di pixel alla volta), gli oggetti con uno
// Sprite diventano figure sempre rivolte verso chi guarda.

const TAU = Math.PI * 2;
const wrap = (a: number) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

export interface RayHit {
  /** Distanza perpendicolare al piano della camera, in tile. */
  dist: number;
  /** 0 = muro verticale (nord-sud), 1 = orizzontale. */
  side: 0 | 1;
  mapX: number;
  mapY: number;
  /** Punto del muro colpito, 0..1 lungo il tile. */
  wallX: number;
}

/** Lancia un raggio sulla griglia dei tile (DDA) da (x, y) in tile, verso (dx, dy). */
export function castRay(g: CollisionGrid, x: number, y: number, dx: number, dy: number, maxSteps = 96): RayHit | null {
  let mapX = Math.floor(x);
  let mapY = Math.floor(y);
  const deltaX = dx === 0 ? 1e30 : Math.abs(1 / dx);
  const deltaY = dy === 0 ? 1e30 : Math.abs(1 / dy);
  const stepX = dx < 0 ? -1 : 1;
  const stepY = dy < 0 ? -1 : 1;
  let sideX = (dx < 0 ? x - mapX : mapX + 1 - x) * deltaX;
  let sideY = (dy < 0 ? y - mapY : mapY + 1 - y) * deltaY;
  let side: 0 | 1 = 0;
  for (let i = 0; i < maxSteps; i++) {
    if (sideX < sideY) {
      sideX += deltaX;
      mapX += stepX;
      side = 0;
    } else {
      sideY += deltaY;
      mapY += stepY;
      side = 1;
    }
    if (g.get(mapX, mapY) !== COLL.solid) continue;
    const dist = Math.max(1e-4, side === 0 ? sideX - deltaX : sideY - deltaY);
    let wallX = side === 0 ? y + dist * dy : x + dist * dx;
    wallX -= Math.floor(wallX);
    return { dist, side, mapX, mapY, wallX };
  }
  return null;
}

/** Il controller in prima persona dell'oggetto (angolo dello sguardo in radianti). */
const viewAngle = (e: Entity): number => Number(e.get("FirstPersonController")?.data.angle ?? 0);

// ------------------------------------------------------------------ Controller prima persona

defineBlock({
  name: "FirstPersonController",
  label: "Controller prima persona",
  category: "Movimento",
  description:
    "Cammina in prima persona: su e giù vanno avanti e indietro, sinistra e destra girano lo sguardo, e tenendo premuto Dash (Maiusc o X) si fa il passo laterale. La scena si costruisce vista dall'alto: i tile solidi sono i muri.",
  requires: ["Body"],
  priority: 20,
  props: {
    speed: { type: "number", label: "Velocità", unit: "tile/s", default: 3.5, min: 0, step: 0.5 },
    turn: { type: "number", label: "Velocità di rotazione", unit: "°/s", default: 150, min: 0, step: 10 },
    startAngle: { type: "number", label: "Guarda verso", unit: "°", default: 0, step: 15, help: "0 = destra, 90 = giù, 180 = sinistra, -90 = su (sulla mappa vista dall'alto)." },
    strafe: { type: "input", label: "Passo laterale tenendo", default: "dash" },
  },
  states: [
    { id: "idle", label: "Fermo" },
    { id: "walk", label: "Cammina" },
  ],
  actions: {
    lookAt: {
      label: "Guarda verso",
      params: { angle: { type: "number", label: "Angolo", unit: "°", default: 0, step: 15 } },
      run: (self, angle: number) => void (self.data.angle = (Number(angle) * Math.PI) / 180),
    },
  },
  init(self) {
    self.data.angle = (Number(self.props.startAngle) * Math.PI) / 180;
    self.data.bob = 0;
    self.data.moving = false;
  },
  update(self, dt) {
    const b = self.body;
    if (!b) return;
    const e = self.entity;
    const p = self.props;
    const d = self.data;
    const input = self.game.input;
    input.readIntent(e.intent);
    const it = e.intent;
    if (e.stunned > 0) {
      e.stunned -= dt;
      return;
    }
    const strafing = !!p.strafe && input.isDown(p.strafe);
    const side = strafing ? it.x : 0;
    const forward = -it.y;
    if (!strafing) d.angle = wrap(d.angle + it.x * ((p.turn * Math.PI) / 180) * dt);
    const cos = Math.cos(d.angle);
    const sin = Math.sin(d.angle);
    let vx = cos * forward - sin * side;
    let vy = sin * forward + cos * side;
    const len = Math.hypot(vx, vy);
    if (len > 1) {
      vx /= len;
      vy /= len;
    }
    const speed = p.speed * self.scene.tileSize * e.boost("speed");
    b.vx = vx * speed;
    b.vy = vy * speed;
    d.moving = len > 0.05;
    if (d.moving) d.bob += dt * 9;
    e.facingX = cos >= 0 ? 1 : -1;
    e.direction = Math.abs(cos) >= Math.abs(sin) ? (cos >= 0 ? "right" : "left") : sin >= 0 ? "down" : "up";
    self.state = d.moving ? "walk" : "idle";
  },
});

// ------------------------------------------------------------------ Vista in prima persona

interface Billboard {
  img: LoadedImage;
  frame: number;
  depth: number;
  screenX: number;
  worldH: number;
  rgb: number[];
  alpha: number;
  flash: number;
  flashColor: number;
  flip: boolean;
}

/** Il tile disegnato sul muro in (mx, my): il più alto dei layer che collidono. */
function wallTile(self: BlockInstance, mx: number, my: number): { tileset: TilesetData; index: number } | null {
  const scene = self.scene;
  const layers = scene.data.layers.filter((l) => l.collides).sort((a, b) => b.z - a.z);
  for (const l of layers) {
    if (mx < 0 || my < 0 || mx >= l.width || my >= l.height) continue;
    const index = l.data[my * l.width + mx];
    if (index < 0) continue;
    const tileset = self.game.project.tilesets.find((t) => t.id === l.tileset);
    if (tileset) return { tileset, index };
  }
  return null;
}

function shade(rgb: number[], k: number, a = 1) {
  return packColor(rgb[0] * k, rgb[1] * k, rgb[2] * k, a);
}

defineBlock({
  name: "FirstPersonView",
  label: "Vista in prima persona",
  category: "Camera",
  description:
    "Disegna la scena dagli occhi dell'oggetto che ha il Controller prima persona: i tile solidi diventano muri alti con la loro immagine, gli oggetti con uno Sprite (nemici, oggetti, proiettili) diventano figure sempre rivolte verso chi guarda. Più sono lontani, più sono scuri. In alto c'è la mappa, al centro il mirino.",
  requires: ["FirstPersonController"],
  priority: 90,
  props: {
    fov: { type: "number", label: "Campo visivo", unit: "°", default: 66, min: 30, max: 120, step: 2 },
    wallHeight: { type: "number", label: "Altezza dei muri", default: 1, min: 0.3, max: 3, step: 0.1 },
    spriteSize: { type: "number", label: "Grandezza delle figure", default: 0.9, min: 0.1, max: 4, step: 0.1, help: "1 = una figura di 16 px è alta come un tile." },
    ceiling: { type: "color", label: "Colore del soffitto", default: "#2b3040" },
    floor: { type: "color", label: "Colore del pavimento", default: "#4d4338" },
    fog: { type: "number", label: "Buio in lontananza", unit: "tile", default: 12, min: 2, step: 1, help: "Oltre questa distanza i muri sono quasi neri." },
    minimap: { type: "boolean", label: "Mappa in alto", default: true },
    crosshair: { type: "boolean", label: "Mirino", default: true },
  },
  init(self) {
    self.scene.firstPerson = self;
    self.data.zbuf = new Float32Array(0);
  },
  destroy(self) {
    if (self.scene.firstPerson === self) self.scene.firstPerson = null;
  },
  render(self, r) {
    const p = self.props;
    const e = self.entity;
    const scene = self.scene;
    const game = self.game;
    const W = Math.round(scene.camera.viewW);
    const H = Math.round(scene.camera.viewH);
    const ts = scene.tileSize;
    const c = bodyCenter(e);
    const px = c.x / ts;
    const py = c.y / ts;
    const angle = viewAngle(e);
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const half = Math.tan(((p.fov * Math.PI) / 180) / 2);
    const planeX = -dirY * half;
    const planeY = dirX * half;
    const bob = e.get("FirstPersonController")?.data.moving ? Math.sin(Number(e.get("FirstPersonController")?.data.bob ?? 0)) * 1.2 : 0;
    const horizon = H / 2 + bob;
    // Pixel quadrati: in verticale la stessa proiezione che in orizzontale.
    const scale = (W / (2 * half)) * p.wallHeight;

    // Soffitto e pavimento: fasce sempre più scure verso l'orizzonte.
    const ceil = parseColor(p.ceiling);
    const flo = parseColor(p.floor);
    const bands = 12;
    for (let i = 0; i < bands; i++) {
      const k = 1 - 0.8 * (i / bands);
      const hTop = horizon / bands;
      r.rect(0, i * hTop, W, hTop + 1, shade(ceil, k));
      const hBot = (H - horizon) / bands;
      r.rect(0, H - (i + 1) * hBot, W, hBot + 1, shade(flo, k));
    }

    // Muri: un raggio per ogni colonna dello schermo.
    let zbuf = self.data.zbuf as Float32Array;
    if (zbuf.length !== W) zbuf = self.data.zbuf = new Float32Array(W);
    const grid = scene.grid;
    for (let x = 0; x < W; x++) {
      const camX = (2 * (x + 0.5)) / W - 1;
      const rx = dirX + planeX * camX;
      const ry = dirY + planeY * camX;
      const hit = castRay(grid, px, py, rx, ry);
      if (!hit) {
        zbuf[x] = 1e9;
        continue;
      }
      zbuf[x] = hit.dist;
      const lineH = scale / hit.dist;
      const k = Math.max(0.12, 1 - hit.dist / p.fog) * (hit.side ? 0.78 : 1);
      const wall = wallTile(self, hit.mapX, hit.mapY);
      const img = wall ? game.assets.image(wall.tileset.image) : undefined;
      if (!wall || !img) {
        r.rect(x, horizon - lineH / 2, 1, lineH, packColor(0.45 * k, 0.45 * k, 0.5 * k, 1));
        continue;
      }
      const tsz = wall.tileset.tileSize;
      const cols = Math.max(1, wall.tileset.columns);
      let texX = Math.floor(hit.wallX * tsz);
      if ((hit.side === 0 && rx > 0) || (hit.side === 1 && ry < 0)) texX = tsz - texX - 1;
      const sx = (wall.index % cols) * tsz + Math.min(tsz - 1, Math.max(0, texX));
      const sy = Math.floor(wall.index / cols) * tsz;
      r.draw(img.tex, sx, sy, 1, tsz, x, horizon - lineH / 2, 1, lineH, packColor(k, k, k, 1));
    }

    // Figure: nemici, oggetti, proiettili. Dalla più lontana alla più vicina, nascoste dietro i muri.
    const invDet = 1 / (planeX * dirY - dirX * planeY);
    const list: Billboard[] = [];
    for (const o of scene.entities) {
      if (o === e || o.destroyed || !o.visible) continue;
      let img: LoadedImage | undefined;
      let frame = 0;
      let rgb = [1, 1, 1];
      let alpha = 1;
      let flash = 0;
      let flashColor = 0xffffff;
      let flip = false;
      const s = o.sprite;
      if (s && s.visible && s.opacity > 0) {
        img = game.assets.image(s.image);
        frame = s.frame;
        flash = Math.max(s.flash, o.fx.flash);
        flashColor = o.fx.flash > s.flash ? o.fx.flashColor : 0xffffff;
        flip = !!o.get("Sprite")?.props.flipWithFacing && o.facingX < 0;
        rgb = parseColor(s.tint);
        alpha = s.opacity * o.fx.alpha;
      } else if (o.has("ItemPickup")) {
        const def = itemDef(game.project, o.get("ItemPickup")!.props.item);
        img = def?.icon ? game.assets.image(def.icon) : undefined;
        frame = def?.frame ?? 0;
      }
      if (!img) continue;
      const dx = o.worldX / ts - px;
      const dy = (o.worldY - 2) / ts - py;
      const tx = invDet * (dirY * dx - dirX * dy);
      const depth = invDet * (-planeY * dx + planeX * dy);
      if (depth <= 0.15) continue;
      const f = frameRect(img, frame);
      list.push({
        img,
        frame,
        depth,
        screenX: (W / 2) * (1 + tx / depth),
        worldH: (f.fh / ts) * p.spriteSize * Math.abs(o.scaleY),
        rgb,
        alpha,
        flash,
        flashColor,
        flip,
      });
    }
    list.sort((a, b) => b.depth - a.depth);
    for (const bb of list) {
      const f = frameRect(bb.img, bb.frame);
      const h = (scale / bb.depth) * (bb.worldH / p.wallHeight);
      const w = h * (f.fw / f.fh);
      const floorY = horizon + scale / bb.depth / 2;
      const top = floorY - h;
      const x0 = bb.screenX - w / 2;
      const k = Math.max(0.15, 1 - bb.depth / p.fog);
      const col = packColor(bb.rgb[0] * k, bb.rgb[1] * k, bb.rgb[2] * k, bb.alpha);
      const from = Math.max(0, Math.floor(x0));
      const to = Math.min(W - 1, Math.ceil(x0 + w));
      for (let x = from; x <= to; x++) {
        if (bb.depth >= zbuf[x]) continue;
        let tx = Math.floor(((x + 0.5 - x0) / w) * f.fw);
        if (tx < 0 || tx >= f.fw) continue;
        if (bb.flip) tx = f.fw - 1 - tx;
        r.draw(bb.img.tex, f.sx + tx, f.sy, 1, f.fh, x, top, 1, h, col, false, bb.flash, bb.flashColor);
      }
    }
  },
  renderScreen(self, r) {
    const p = self.props;
    const W = r.width;
    const H = r.height;
    const t = Math.max(0.5, 1 / r.pixelScale);
    if (p.crosshair) {
      const c = hexColor("#ffffff", 0.8);
      r.rect(W / 2 - 4, H / 2 - t / 2, 3, t, c);
      r.rect(W / 2 + 1, H / 2 - t / 2, 3, t, c);
      r.rect(W / 2 - t / 2, H / 2 - 4, t, 3, c);
      r.rect(W / 2 - t / 2, H / 2 + 1, t, 3, c);
    }
    if (!p.minimap) return;
    // Mappa: i muri, il giocatore con lo sguardo, i nemici vicini.
    const g = self.scene.grid;
    const size = 56;
    const cell = Math.max(1, Math.min(size / g.cols, size / g.rows));
    const mw = g.cols * cell;
    const mh = g.rows * cell;
    const ox = W - mw - 6;
    const oy = 6;
    r.rect(ox - 2, oy - 2, mw + 4, mh + 4, hexColor("#000000", 0.5));
    const wallC = hexColor("#c8d4c2", 0.75);
    for (let y = 0; y < g.rows; y++) for (let x = 0; x < g.cols; x++) if (g.get(x, y) === COLL.solid) r.rect(ox + x * cell, oy + y * cell, cell, cell, wallC);
    const ts = self.scene.tileSize;
    const dot = (e: Entity, color: number, s: number) => {
      const c = bodyCenter(e);
      r.rect(ox + (c.x / ts) * cell - s / 2, oy + (c.y / ts) * cell - s / 2, s, s, color);
    };
    for (const o of self.scene.findAll("nemico")) dot(o, hexColor("#e5695f"), 2);
    const e = self.entity;
    dot(e, hexColor("#9be26a"), 3);
    const c = bodyCenter(e);
    const a = viewAngle(e);
    for (let i = 1; i <= 4; i++) {
      r.rect(ox + (c.x / ts) * cell + Math.cos(a) * i - 0.5, oy + (c.y / ts) * cell + Math.sin(a) * i - 0.5, 1, 1, hexColor("#9be26a"));
    }
  },
});

// ------------------------------------------------------------------ Armi in prima persona

/** Quanto dura il cambio arma: metà per abbassare quella in mano, metà per alzare la nuova. */
const SWITCH_TIME = 0.36;

/** Le armi scritte nell'elenco del blocco. */
const weaponRows = (self: BlockInstance): ListRow[] => listRows(self.def.props.weapons, self.props.weapons);

/** L'arma è disponibile? (con «Disponibile se la variabile» serve che la variabile sia almeno 1) */
function weaponReady(self: BlockInstance, row: ListRow | undefined): boolean {
  if (!row) return false;
  const v = String(row.unlock ?? "");
  return !v || Number(self.game.vars[v] ?? 0) >= 1;
}

/** I numeri (da 0) delle armi che si possono avere in mano adesso. */
const readyWeapons = (self: BlockInstance): number[] =>
  weaponRows(self)
    .map((row, i) => (weaponReady(self, row) ? i : -1))
    .filter((i) => i >= 0);

/** L'arma in mano in questo momento (durante il cambio è ancora quella vecchia, finché non si abbassa). */
const heldWeapon = (self: BlockInstance): ListRow | undefined => weaponRows(self)[self.data.i];

/** Inizia il cambio: l'arma di adesso si abbassa, poi quella nuova si alza. */
function startSwitch(self: BlockInstance, index: number): void {
  const d = self.data;
  if (d.switching > 0 || index === d.i || !readyWeapons(self).includes(index)) return;
  d.nextI = index;
  d.switching = SWITCH_TIME;
}

/** Passa all'arma successiva tra quelle disponibili (dopo l'ultima si torna alla prima). */
function cycleWeapon(self: BlockInstance, step = 1): void {
  const list = readyWeapons(self);
  if (list.length < 2) return;
  const at = list.indexOf(self.data.i);
  startSwitch(self, list[(((at < 0 ? 0 : at + step) % list.length) + list.length) % list.length]);
}

/** Tiene aggiornata l'arma in mano: sceglie la prima disponibile, fa scorrere il cambio, legge il comando. */
function updateArsenal(self: BlockInstance, dt: number): void {
  const d = self.data;
  const list = readyWeapons(self);
  if (!list.length) {
    d.i = -1;
    d.switching = 0;
    return;
  }
  if (d.switching > 0) {
    const before = d.switching;
    d.switching = Math.max(0, d.switching - dt);
    // A metà strada l'arma vecchia è sparita in basso: si cambia e si rialza quella nuova.
    if (before > SWITCH_TIME / 2 && d.switching <= SWITCH_TIME / 2) takeWeapon(self, d.nextI);
    return;
  }
  // Nessuna arma in mano (o quella di prima non è più disponibile): si prende la prima.
  if (!list.includes(d.i)) return takeWeapon(self, list[0]);
  const cmd = String(self.props.switchCommand ?? "");
  if (cmd && self.game.input.pressed(cmd)) cycleWeapon(self);
}

/** Prende in mano l'arma numero `index` (da 0): il nome compare per un attimo in basso. */
function takeWeapon(self: BlockInstance, index: number): void {
  const d = self.data;
  // Appena presa in mano dopo un cambio, l'arma aspetta un attimo prima di sparare (all'avvio no).
  if (d.i >= 0) d.cd = Math.max(d.cd, 0.1);
  d.i = index;
  d.nameT = 1.2;
  self.emit("switched", { weapon: index + 1 });
}

function fire(self: BlockInstance) {
  const d = self.data;
  const e = self.entity;
  const game = self.game;
  const w = heldWeapon(self);
  if (!w) return;
  const ammo = String(w.ammo ?? "");
  if (ammo) {
    const left = Number(game.vars[ammo] ?? 0);
    if (left <= 0) {
      d.cd = 0.3;
      self.emit("empty");
      if (w.emptySound) game.audio.play(String(w.emptySound));
      return;
    }
    game.vars[ammo] = left - 1;
  }
  d.cd = Number(w.interval);
  d.fireT = 0.12;
  self.emit("shot");
  if (w.sound) game.audio.play(String(w.sound));
  // Colpo diretto: il bersaglio più vicino al centro del mirino, se non c'è un muro in mezzo.
  const ts = self.scene.tileSize;
  const from = bodyCenter(e);
  const angle = viewAngle(e);
  const tolerance = (Number(self.props.aim) * Math.PI) / 180;
  let best: Entity | undefined;
  let bestDist = Infinity;
  for (const o of self.scene.findAll(self.props.target)) {
    if (o === e || !o.has("Health")) continue;
    const c = bodyCenter(o);
    const dist = Math.hypot(c.x - from.x, c.y - from.y);
    if (dist > Number(w.range) * ts || dist >= bestDist) continue;
    const halfW = Math.atan2((o.body?.w ?? 12) / 2, Math.max(1, dist)) + tolerance;
    if (Math.abs(wrap(Math.atan2(c.y - from.y, c.x - from.x) - angle)) > halfW) continue;
    if (!lineOfSight(self.scene.grid, from.x, from.y, c.x, c.y)) continue;
    best = o;
    bestDist = dist;
  }
  if (!best) return;
  best.get("Health")!.actions.damage(boosted(Number(w.damage), e), from);
  self.emit("hit", best);
}

defineBlock({
  name: "FirstPersonWeapon",
  label: "Armi in prima persona",
  category: "Combattimento",
  description:
    "Le armi che il personaggio tiene in mano nella vista in prima persona: premendo il comando colpiscono subito il bersaglio al centro del mirino, se non c'è un muro in mezzo. Ogni arma ha la sua immagine, il suo danno e le sue munizioni, e può essere disponibile solo dopo aver trovato qualcosa. In basso sullo schermo si vede l'arma, che ondeggia mentre si cammina; cambiandola quella in mano si abbassa e la nuova si alza.",
  requires: ["FirstPersonController"],
  priority: 45,
  props: {
    weapons: {
      type: "list",
      label: "Armi",
      rowLabel: "name",
      addLabel: " Aggiungi arma",
      default: [{ name: "Arma", image: "", idleFrame: 0, fireFrame: 1, scale: 2, damage: 1, interval: 0.35, range: 12, ammo: "", unlock: "", sound: "", emptySound: "" }],
      fields: {
        name: { type: "string", label: "Nome", default: "Arma", translatable: true, help: "Compare in basso per un attimo quando la prendi in mano." },
        image: { type: "image", label: "Immagine", default: "", optional: true },
        idleFrame: { type: "integer", label: "Fotogramma a riposo", default: 0, min: 0 },
        fireFrame: { type: "integer", label: "Fotogramma quando spara", default: 1, min: 0 },
        scale: { type: "number", label: "Grandezza", unit: "×", default: 2, min: 0.5, step: 0.5 },
        damage: { type: "integer", label: "Danno", default: 1, min: 0 },
        interval: { type: "number", label: "Tempo tra due colpi", unit: "s", default: 0.35, min: 0.05, step: 0.05 },
        range: { type: "number", label: "Distanza massima", unit: "tile", default: 12, min: 1, step: 1 },
        ammo: { type: "variable", label: "Munizioni nella variabile", default: "", optional: true, help: "Vuoto = colpi infiniti." },
        unlock: {
          type: "variable",
          label: "Disponibile se la variabile",
          default: "",
          optional: true,
          help: "Vuoto = sempre in mano. Altrimenti l'arma entra nell'arsenale solo quando la variabile arriva a 1.",
        },
        sound: { type: "audio", label: "Suono del colpo", default: "", optional: true },
        emptySound: { type: "audio", label: "Suono senza munizioni", default: "", optional: true },
      },
    },
    command: { type: "input", label: "Comando", default: "attack" },
    switchCommand: { type: "input", label: "Cambia arma con", default: "nextItem", help: "Passa all'arma successiva tra quelle disponibili." },
    hold: { type: "boolean", label: "Tenendo premuto spara di continuo", default: false },
    target: { type: "tag", label: "Colpisce chi ha l'etichetta", default: "nemico" },
    aim: { type: "number", label: "Tolleranza della mira", unit: "°", default: 3, min: 0, max: 30, step: 1, help: "Quanto si può sbagliare di poco e colpire lo stesso." },
  },
  events: [
    { id: "shot", label: "Ha sparato" },
    { id: "hit", label: "Ha colpito qualcuno" },
    { id: "empty", label: "È senza munizioni" },
    { id: "switched", label: "Ha cambiato arma" },
  ],
  conditions: {
    weaponIs: {
      label: "Ha in mano l'arma numero",
      params: { weapon: { type: "integer", label: "Numero dell'arma", default: 1, min: 1 } },
      test: (self, weapon) => self.data.i === Number(weapon) - 1,
    },
  },
  actions: {
    fire: { label: "Spara ora", run: (self) => fire(self) },
    next: { label: "Passa all'arma successiva", run: (self) => cycleWeapon(self) },
    prev: { label: "Torna all'arma precedente", run: (self) => cycleWeapon(self, -1) },
    select: {
      label: "Prendi in mano l'arma numero",
      params: { weapon: { type: "integer", label: "Numero dell'arma", default: 1, min: 1 } },
      run: (self, weapon) => startSwitch(self, Number(weapon) - 1),
    },
  },
  init(self) {
    self.data.i = -1;
    self.data.nextI = 0;
    self.data.switching = 0;
    self.data.cd = 0;
    self.data.fireT = 0;
    self.data.nameT = 0;
  },
  update(self, dt) {
    const p = self.props;
    const d = self.data;
    d.cd -= dt;
    if (d.fireT > 0) d.fireT -= dt;
    if (d.nameT > 0) d.nameT -= dt;
    updateArsenal(self, dt);
    // Mentre l'arma si abbassa e si rialza non si spara.
    if (d.switching > 0 || d.i < 0 || d.cd > 1e-6) return;
    const input = self.game.input;
    if (p.hold ? input.isDown(p.command) : input.pressed(p.command)) fire(self);
  },
  renderScreen(self, r) {
    const d = self.data;
    const w = heldWeapon(self);
    if (!w) return;
    const ctrl = self.entity.get("FirstPersonController");
    // Cambio arma: la prima metà del tempo scende quella vecchia, la seconda sale quella nuova.
    const half = SWITCH_TIME / 2;
    const sw = Number(d.switching);
    const slide = sw <= 0 ? 0 : sw > half ? (SWITCH_TIME - sw) / half : sw / half;
    const img = w.image ? self.game.assets.image(String(w.image)) : undefined;
    if (img) {
      const f = frameRect(img, Number(d.fireT > 0 ? w.fireFrame : w.idleFrame));
      const bob = ctrl?.data.moving ? Number(ctrl.data.bob ?? 0) : 0;
      const scale = Number(w.scale) || 1;
      const width = f.fw * scale;
      const height = f.fh * scale;
      const x = r.width / 2 - width / 2 + Math.sin(bob) * 4;
      const y = r.height - height + Math.abs(Math.cos(bob)) * 3 + (d.fireT > 0 ? 3 : 0) + 2 + slide * (height + 8);
      r.draw(img.tex, f.sx, f.sy, f.fw, f.fh, x, y, width, height);
    }
    // Il nome dell'arma appena presa in mano.
    if (d.nameT > 0 && w.name) {
      r.text(self.game.t(String(w.name)), r.width / 2, r.height - 16, { size: 8, align: "center", outline: true, color: "#ffe9a8" });
    }
  },
});


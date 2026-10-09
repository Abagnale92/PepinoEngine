import { defineBlock, listRows, type BlockInstance, type ListRow } from "../core/block";
import type { Entity } from "../core/entity";
import type { TileLayerData } from "../project/format";
import { buildCollisionGrid } from "../world/tilemap";

/**
 * Sotterranei costruiti dal computer: stanze rettangolari collegate da corridoi, scavate nei tile
 * del layer che collide. Poi il giocatore va nella prima stanza, l'uscita nella più lontana
 * e nemici e tesori si sparpagliano nelle altre. Ogni piano è diverso dal precedente.
 */

interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}

const roomCenter = (r: Room) => ({ x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) });
const overlapsRoom = (a: Room, b: Room) => a.x - 1 < b.x + b.w && a.x + a.w + 1 > b.x && a.y - 1 < b.y + b.h && a.y + a.h + 1 > b.y;

/** Numeri a caso ripetibili: con lo stesso seme esce sempre lo stesso sotterraneo. */
function makeRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Il layer dove si scava: il primo che collide (i muri della scena). */
function digLayer(self: BlockInstance): TileLayerData | undefined {
  return self.scene.data.layers.find((l) => l.collides);
}

/** Scava stanze e corridoi nel layer e restituisce le stanze, dalla prima all'ultima. */
function carve(self: BlockInstance, rnd: () => number, layer: TileLayerData): Room[] {
  const p = self.props;
  const W = layer.width;
  const H = layer.height;
  const wall = Number(p.wallTile);
  const floor = Number(p.floorTile);
  // Si riparte sempre da una mappa piena: le stanze sono buchi nella roccia.
  const data = new Array(W * H).fill(wall);
  const rooms: Room[] = [];
  const min = Math.max(2, Math.min(p.roomMin, p.roomMax));
  const max = Math.max(min, p.roomMax);
  for (let tries = 0; tries < p.rooms * 40 && rooms.length < p.rooms; tries++) {
    const w = min + Math.floor(rnd() * (max - min + 1));
    const h = min + Math.floor(rnd() * (max - min + 1));
    const x = 1 + Math.floor(rnd() * Math.max(1, W - w - 2));
    const y = 1 + Math.floor(rnd() * Math.max(1, H - h - 2));
    const room = { x, y, w, h };
    if (rooms.some((r) => overlapsRoom(room, r))) continue;
    rooms.push(room);
  }
  const dig = (x: number, y: number) => {
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return;
    data[y * W + x] = floor;
  };
  for (const r of rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) dig(x, y);
  // Corridoi a elle: prima in orizzontale, poi in verticale (o viceversa, a caso).
  for (let i = 1; i < rooms.length; i++) {
    const a = roomCenter(rooms[i - 1]);
    const b = roomCenter(rooms[i]);
    const horizontalFirst = rnd() < 0.5;
    const hx = (y: number) => {
      for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) {
        dig(x, y);
        dig(x, y + 1);
      }
    };
    const vy = (x: number) => {
      for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) {
        dig(x, y);
        dig(x + 1, y);
      }
    };
    if (horizontalFirst) {
      hx(a.y);
      vy(b.x);
    } else {
      vy(a.x);
      hx(b.y);
    }
  }
  layer.data = data;
  return rooms;
}

/** Un punto a caso dentro la stanza, in pixel (al centro di un tile). */
function spotIn(self: BlockInstance, r: Room, rnd: () => number): { x: number; y: number } {
  const ts = self.scene.tileSize;
  const x = r.x + Math.floor(rnd() * r.w);
  const y = r.y + Math.floor(rnd() * r.h);
  return { x: x * ts + ts / 2, y: y * ts + ts / 2 };
}

/** Rifà la griglia delle collisioni dopo aver cambiato i tile. */
function refreshGrid(self: BlockInstance): void {
  const grid = buildCollisionGrid(self.game.project, self.scene.data);
  self.scene.grid.cells.set(grid.cells);
}

function generate(self: BlockInstance): void {
  const p = self.props;
  const scene = self.scene;
  const layer = digLayer(self);
  if (!layer) {
    self.game.log("Sotterraneo a caso: la scena non ha un layer che collide in cui scavare", "warn");
    return;
  }
  const seed = Number(p.seed) || Math.floor(Math.random() * 1e9);
  const rnd = makeRandom(seed);
  const rooms = carve(self, rnd, layer);
  refreshGrid(self);
  self.data.rooms = rooms;
  if (!rooms.length) return;

  // Il giocatore nella prima stanza, l'uscita nella più lontana.
  const first = roomCenter(rooms[0]);
  const ts = scene.tileSize;
  const hero = p.player ? scene.find(String(p.player)) : undefined;
  if (hero) {
    hero.x = first.x * ts + ts / 2;
    hero.y = first.y * ts + ts / 2;
    if (hero.body) {
      hero.body.vx = 0;
      hero.body.vy = 0;
    }
  }
  let last = rooms[rooms.length - 1];
  let far = 0;
  for (const r of rooms.slice(1)) {
    const c = roomCenter(r);
    const d = Math.hypot(c.x - first.x, c.y - first.y);
    if (d > far) {
      far = d;
      last = r;
    }
  }
  if (p.exit) {
    const c = roomCenter(last);
    scene.spawn(String(p.exit), c.x * ts + ts / 2, c.y * ts + ts / 2);
  }
  // Nemici e tesori nelle stanze di mezzo: più se ne trovano man mano che si scende.
  const floorNo = p.floorVar ? Math.max(1, Number(self.game.vars[p.floorVar] ?? 1)) : 1;
  const others = rooms.slice(1).filter((r) => r !== last);
  const pool = others.length ? others : rooms.slice(1);
  for (const row of listRows(self.def.props.spawns, p.spawns) as ListRow[]) {
    const prefab = String(row.prefab ?? "");
    if (!prefab) continue;
    const n = Math.max(0, Math.round(Number(row.count ?? 0) + Number(row.perFloor ?? 0) * (floorNo - 1)));
    for (let i = 0; i < n; i++) {
      const room = pool[Math.floor(rnd() * pool.length)] ?? rooms[0];
      const spot = spotIn(self, room, rnd);
      scene.spawn(prefab, spot.x, spot.y);
    }
  }
  self.emit("generated", { rooms: rooms.length, floor: floorNo });
}

defineBlock({
  name: "DungeonGenerator",
  label: "Sotterraneo a caso",
  category: "Gameplay",
  description:
    "All'avvio costruisce da solo la mappa: stanze collegate da corridoi scavate nel layer che collide. Porta il giocatore nella prima stanza, mette l'uscita in quella più lontana e sparpaglia nelle altre i modelli che scegli. Ogni partita la mappa è diversa, e più si scende più cose compaiono.",
  priority: 5,
  props: {
    rooms: { type: "integer", label: "Numero di stanze", default: 7, min: 2, max: 20 },
    roomMin: { type: "integer", label: "Stanza più piccola", unit: "tile", default: 3, min: 2 },
    roomMax: { type: "integer", label: "Stanza più grande", unit: "tile", default: 7, min: 2 },
    floorTile: { type: "integer", label: "Tile del pavimento", default: 10, min: -1, help: "Il numero del tile nel tileset: deve essere attraversabile. -1 = nessun tile." },
    wallTile: { type: "integer", label: "Tile del muro", default: 13, min: 0, help: "Il numero del tile nel tileset: deve essere solido." },
    seed: { type: "integer", label: "Seme", default: 0, min: 0, help: "0 = sempre diverso. Un numero fisso rifà sempre lo stesso sotterraneo." },
    player: { type: "tag", label: "Porta nella prima stanza chi ha l'etichetta", default: "giocatore" },
    exit: { type: "prefab", label: "Uscita nella stanza più lontana", default: "", optional: true },
    floorVar: {
      type: "variable",
      label: "Piano nella variabile",
      default: "",
      optional: true,
      help: "A ogni piano compaiono più nemici e più tesori.",
    },
    spawns: {
      type: "list",
      label: "Cosa mettere nelle stanze",
      rowLabel: "prefab",
      addLabel: "Aggiungi modello",
      default: [],
      fields: {
        prefab: { type: "prefab", label: "Modello", default: "" },
        count: { type: "integer", label: "Quanti al primo piano", default: 3, min: 0 },
        perFloor: { type: "number", label: "Quanti in più a ogni piano", default: 1, min: 0, step: 0.5 },
      },
    },
  },
  events: [{ id: "generated", label: "Ha costruito il sotterraneo" }],
  actions: { regenerate: { label: "Rifai il sotterraneo", run: (self) => generate(self) } },
  init(self) {
    self.data.rooms = [];
    generate(self);
  },
  renderDebug(self, r) {
    const ts = self.scene.tileSize;
    for (const room of (self.data.rooms ?? []) as Room[]) {
      r.strokeRect(room.x * ts, room.y * ts, room.w * ts, room.h * ts, 1, 0x7affb1cc);
    }
  },
});

// ------------------------------------------------------------------ Uscita che porta al piano dopo

defineBlock({
  name: "FloorExit",
  label: "Scala per il piano dopo",
  category: "Gameplay",
  description:
    "Quando il giocatore la tocca, aumenta di uno la variabile del piano e ricarica la scena: con il Sotterraneo a caso questo vuol dire un livello nuovo, più difficile. Può anche curare o dare qualcosa con le Regole, ascoltando l'evento.",
  requires: ["Body"],
  priority: 40,
  props: {
    target: { type: "tag", label: "Chi la usa", default: "giocatore" },
    floorVar: { type: "variable", label: "Piano nella variabile", default: "piano" },
    fade: { type: "number", label: "Dissolvenza", unit: "s", default: 0.4, min: 0, step: 0.1 },
    sound: { type: "audio", label: "Suono", default: "", optional: true },
  },
  events: [{ id: "used", label: "Il giocatore è sceso" }],
  init(self) {
    self.data.used = false;
    self.listen<{ other: Entity }>("contact", ({ other }) => {
      if (self.data.used || !other.hasTag(String(self.props.target))) return;
      self.data.used = true;
      const v = String(self.props.floorVar);
      if (v) self.game.vars[v] = Number(self.game.vars[v] ?? 1) + 1;
      if (self.props.sound) self.game.audio.play(String(self.props.sound));
      self.emit("used", other);
      self.game.goToScene(self.scene.data.id, Number(self.props.fade));
    });
  },
});

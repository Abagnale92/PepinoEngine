import { defineBlock, type BlockInstance } from "../../core/block";
import type { Entity } from "../../core/entity";
import { frameRect } from "../../assets/assets";
import { hexColor, packColor } from "../../math";
import { COLL } from "../../physics/collision";
import { drawRay } from "../../render/shapes";
import { BONUS_KINDS, huntersOf, isBonus, runnersOf, isRunning, toScreen } from "./shared";
import { bodyCenter } from "../targets";

// Il mondo dei giochi di gruppo: caramelle e bonus da raccogliere, cose che i fantasmi infestano, trappole.

// ------------------------------------------------------------------ Bonus da raccogliere

const ITEM_OPTIONS = [
  { value: "candy", label: "Caramella" },
  { value: "flashlight", label: "Torcia" },
  { value: "turbo", label: "Caramella turbo" },
  { value: "cloak", label: "Mantello" },
  { value: "pumpkin", label: "Zucca esplosiva" },
  { value: "key", label: "Chiave" },
  { value: "random", label: "Un bonus a caso" },
];

/** Bonus a caso: la chiave esce più di rado. */
function randomBonus(): string {
  const r = Math.random();
  return r < 0.24 ? "flashlight" : r < 0.48 ? "turbo" : r < 0.7 ? "cloak" : r < 0.9 ? "pumpkin" : "key";
}

function settle(self: BlockInstance): void {
  const k = String(self.props.kind);
  self.data.kind = k === "random" ? randomBonus() : k;
}

/** Il bonus (o la caramella) è a terra e si può prendere. */
export const itemAvailable = (item: BlockInstance): boolean => !item.data.gone && !item.entity.destroyed;

/** Un Fuggitivo prende il bonus: suono, evento e poi sparisce (o aspetta di ricomparire). Restituisce cos'era. */
export function consumeItem(item: BlockInstance, by: Entity): { kind: string; value: number } {
  const out = { kind: String(item.data.kind), value: Math.max(1, Number(item.props.value) || 1) };
  if (item.props.sound) item.game.audio.play(item.props.sound);
  item.emit("taken", by);
  const wait = Number(item.props.respawn) || 0;
  if (wait > 0) {
    item.data.gone = true;
    item.data.wait = wait;
  } else item.entity.destroy();
  return out;
}

defineBlock({
  name: "PartyItem",
  label: "Bonus da raccogliere",
  category: "Gameplay",
  description:
    "Una caramella o un bonus a terra per i Fuggitivi. La caramella aumenta il conto della squadra; il bonus (torcia, caramella turbo, mantello, zucca esplosiva, chiave o uno a caso) va nelle tasche di chi lo prende e si usa con Azione. Può ricomparire dopo qualche secondo.",
  requires: ["Body"],
  priority: 40,
  props: {
    kind: { type: "select", label: "Che cos'è", default: "candy", options: ITEM_OPTIONS },
    value: { type: "integer", label: "Caramelle che vale", default: 1, min: 1 },
    respawn: { type: "number", label: "Ricompare dopo", unit: "s", default: 0, min: 0, step: 1, help: "0 = una volta preso non torna più." },
    image: {
      type: "image",
      label: "Icone",
      default: "",
      help: "Foglio con le icone: per i bonus il fotogramma è quello del bonus (0 torcia, 1 turbo, 2 mantello, 3 zucca, 4 chiave).",
    },
    frame: { type: "integer", label: "Fotogramma della caramella", default: 5, min: 0 },
    glow: { type: "color", label: "Luce", default: "#ffb35a" },
    sound: { type: "audio", label: "Suono", default: "", optional: true },
  },
  events: [
    { id: "taken", label: "È stato preso" },
    { id: "back", label: "È ricomparso" },
  ],
  conditions: {
    isAvailable: { label: "Si può prendere", test: (self) => itemAvailable(self) },
  },
  actions: {
    reset: {
      label: "Fallo ricomparire",
      run: (self) => {
        self.data.gone = false;
        self.data.wait = 0;
        self.data.pop = 0;
        settle(self);
      },
    },
  },
  init(self) {
    settle(self);
    self.data.gone = false;
    self.data.wait = 0;
    self.data.pop = 1;
    self.data.t = (self.entity.worldX * 0.37 + self.entity.worldY * 0.11) % 6;
  },
  update(self, dt) {
    const d = self.data;
    d.t += dt;
    if (d.pop < 1) d.pop = Math.min(1, d.pop + dt * 3);
    if (!d.gone) return;
    d.wait -= dt;
    if (d.wait > 0) return;
    d.gone = false;
    d.pop = 0;
    settle(self);
    self.emit("back");
  },
  render(self, r) {
    const d = self.data;
    if (d.gone) return;
    const img = self.game.assets.image(self.props.image);
    if (!img) return;
    const e = self.entity;
    const kind = String(d.kind);
    const frame = isBonus(kind) ? BONUS_KINDS.indexOf(kind) : Number(self.props.frame) || 0;
    const f = frameRect(img, frame);
    const bob = Math.round(Math.sin(d.t * 3.2) * 1.5);
    // Ombra a terra: si stringe quando l'oggetto sale.
    const sw = f.fw * (0.7 - bob * 0.04);
    r.drawUV(r.radial, 0, 0, 1, 1, e.worldX - sw / 2, e.worldY - 2.5, sw, 5, packColor(0, 0, 0, 0.45));
    const k = d.pop < 1 ? 0.4 + 0.6 * Math.sin((d.pop * Math.PI) / 2) * (1 + 0.25 * Math.sin(d.pop * Math.PI)) : 1;
    const w = f.fw * k;
    const h = f.fh * k;
    r.draw(img.tex, f.sx, f.sy, f.fw, f.fh, Math.round(e.worldX - w / 2), Math.round(e.worldY - 3 - h + bob), w, h);
  },
  renderLight(self, r) {
    if (self.data.gone) return;
    const e = self.entity;
    const big = isBonus(String(self.data.kind)) || Number(self.props.value) > 1;
    const rad = self.scene.tileSize * (big ? 1.5 : 0.9) * (1 + 0.08 * Math.sin(self.data.t * 4));
    r.drawUV(r.radial, 0, 0, 1, 1, e.worldX - rad, e.worldY - 8 - rad, rad * 2, rad * 2, hexColor(self.props.glow, big ? 0.9 : 0.55));
  },
});

// ------------------------------------------------------------------ Infestabile

const HAUNT_KINDS = [
  { value: "lamp", label: "Luce da spegnere" },
  { value: "gate", label: "Cancello da chiudere" },
  { value: "push", label: "Oggetto da spostare" },
  { value: "scare", label: "Qualcosa che spaventa" },
];

const PROMPTS: Record<string, string> = { lamp: "Spegni", gate: "Chiudi", push: "Sposta", scare: "Spaventa" };

/** Celle della griglia coperte dal corpo dell'oggetto (spostato di dx, dy pixel). */
function cellsOf(self: BlockInstance, dx = 0, dy = 0): number[] {
  const b = self.body;
  const g = self.scene.grid;
  if (!b) return [];
  const s = g.size;
  const out: number[] = [];
  const c0 = Math.floor((b.left + dx + 0.5) / s);
  const c1 = Math.floor((b.right + dx - 0.5) / s);
  const r0 = Math.floor((b.top + dy + 0.5) / s);
  const r1 = Math.floor((b.bottom + dy - 0.5) / s);
  for (let y = r0; y <= r1; y++) for (let x = c0; x <= c1; x++) if (x >= 0 && y >= 0 && x < g.cols && y < g.rows) out.push(y * g.cols + x);
  return out;
}

function setSolid(self: BlockInstance, cells: number[], solid: boolean): void {
  const g = self.scene.grid;
  const orig = self.data.orig as Map<number, number>;
  for (const i of cells) {
    if (!orig.has(i)) orig.set(i, g.cells[i]);
    g.cells[i] = solid ? COLL.solid : orig.get(i)!;
  }
}

/** Qualcuno che si ferma contro i muri sta sopra queste celle? (Non si chiude un cancello addosso a nessuno.) */
function occupied(self: BlockInstance, cells: number[]): boolean {
  const g = self.scene.grid;
  const s = g.size;
  for (const e of self.scene.entities) {
    const b = e.body;
    if (e === self.entity || e.destroyed || !b || !b.world) continue;
    if (!e.has("Runner") && !e.has("Hunter")) continue;
    for (const i of cells) {
      const x = (i % g.cols) * s;
      const y = Math.floor(i / g.cols) * s;
      if (b.left < x + s && b.right > x && b.top < y + s && b.bottom > y) return true;
    }
  }
  return false;
}

function lightOf(self: BlockInstance): BlockInstance | undefined {
  return self.entity.get("Light") ?? self.entity.children.map((c) => c.get("Light")).find(Boolean);
}

function stateOf(self: BlockInstance): string {
  const d = self.data;
  switch (self.props.kind) {
    case "lamp":
      return d.active > 0 ? "off" : "on";
    case "gate":
      return d.locked ? "locked" : d.closed ? "closed" : "open";
    case "push":
      return d.pushed ? "active" : "idle";
    default:
      return d.active > 0 ? "active" : "idle";
  }
}

function closeGate(self: BlockInstance): boolean {
  const cells = self.data.cells as number[];
  if (occupied(self, cells)) return false;
  setSolid(self, cells, true);
  self.data.closed = true;
  return true;
}

function openGate(self: BlockInstance): void {
  setSolid(self, self.data.cells, false);
  self.data.closed = false;
}

/** Il fantasma lo può usare adesso? */
export function hauntReady(h: BlockInstance): boolean {
  const d = h.data;
  const p = h.props;
  if (!p.ghosts || d.active > 0 || d.cd > 0 || d.moving) return false;
  if (p.kind === "gate") return !d.locked && !d.closed;
  if (p.kind === "lamp") return !!lightOf(h)?.data.on;
  return true;
}

/** Un fantasma (o una Regola) lo infesta. Vero se è successo qualcosa. */
export function haunt(self: BlockInstance, by?: Entity): boolean {
  const d = self.data;
  const p = self.props;
  if (d.active > 0 || d.moving) return false;
  const dur = Math.max(0.5, Number(p.duration) || 0);
  switch (p.kind) {
    case "lamp": {
      const l = lightOf(self);
      if (!l?.data.on) return false;
      l.data.on = false;
      d.active = dur;
      break;
    }
    case "gate":
      if (d.locked || d.closed || !closeGate(self)) return false;
      d.active = dur;
      break;
    case "push": {
      const ts = self.scene.tileSize;
      const dx = Math.round(Number(p.pushX) || 0) * ts;
      const dy = Math.round(Number(p.pushY) || 0) * ts;
      const from = d.cells as number[];
      const to = cellsOf(self, dx, dy);
      const g = self.scene.grid;
      const orig = d.orig as Map<number, number>;
      const blocked = to.some((i) => !from.includes(i) && (orig.get(i) ?? g.cells[i]) === COLL.solid);
      if (!to.length || blocked || occupied(self, to.filter((i) => !from.includes(i)))) return false;
      setSolid(self, from, false);
      setSolid(self, to, true);
      d.cells = to;
      d.tween = { x0: self.entity.x, y0: self.entity.y, x1: self.entity.x + dx, y1: self.entity.y + dy, t: 0 };
      d.moving = true;
      d.pushed = true;
      d.active = dur;
      break;
    }
    default: {
      d.active = 1;
      const ts = self.scene.tileSize;
      const c = bodyCenter(self.entity);
      const range = (Number(p.scareRange) || 0) * ts;
      for (const r of runnersOf(self.scene)) {
        if (!isRunning(r)) continue;
        const rc = bodyCenter(r.entity);
        if (Math.hypot(rc.x - c.x, rc.y - c.y) <= range) r.actions.scare(Number(p.scareTime) || 1);
      }
      d.burst = 0.6;
    }
  }
  if (p.sound) self.game.audio.play(p.sound);
  self.emit("haunted", by);
  return true;
}

function restore(self: BlockInstance): boolean {
  const d = self.data;
  const p = self.props;
  switch (p.kind) {
    case "lamp": {
      const l = lightOf(self);
      if (l) l.data.on = true;
      d.flicker = 0.45;
      break;
    }
    case "gate":
      if (d.locked) break;
      if (occupied(self, d.cells)) return false;
      openGate(self);
      break;
    case "push": {
      const ts = self.scene.tileSize;
      const dx = Math.round(Number(p.pushX) || 0) * ts;
      const dy = Math.round(Number(p.pushY) || 0) * ts;
      const home = cellsOf(self, -dx, -dy);
      const now = d.cells as number[];
      if (occupied(self, home.filter((i) => !now.includes(i)))) return false;
      setSolid(self, now, false);
      setSolid(self, home, true);
      d.cells = home;
      d.tween = { x0: self.entity.x, y0: self.entity.y, x1: self.entity.x - dx, y1: self.entity.y - dy, t: 0 };
      d.moving = true;
      d.pushed = false;
      break;
    }
  }
  if (p.endSound) self.game.audio.play(p.endSound);
  self.emit("restored");
  return true;
}

defineBlock({
  name: "Hauntable",
  label: "Infestabile",
  category: "Gameplay",
  description:
    "Qualcosa che un fantasma (un Fuggitivo preso) può usare per disturbare: una luce da spegnere, un cancello da chiudere, un oggetto da spostare per bloccare un passaggio o qualcosa che spaventa chi è vicino. Dopo un po' torna com'era. Un cancello può essere chiuso a chiave: si apre con la chiave dei bonus o con una Regola.",
  requires: ["Body"],
  priority: 30,
  props: {
    kind: { type: "select", label: "Che cos'è", default: "lamp", options: HAUNT_KINDS },
    duration: { type: "number", label: "L'effetto dura", unit: "s", default: 7, min: 0.5, step: 0.5 },
    cooldown: { type: "number", label: "Poi si riposa per", unit: "s", default: 4, min: 0, step: 0.5 },
    ghosts: { type: "boolean", label: "I fantasmi lo possono usare", default: true },
    locked: {
      type: "boolean",
      label: "Chiuso a chiave",
      default: false,
      help: "Solo cancelli: resta chiuso finché qualcuno non lo apre con la chiave dei bonus o con la Regola «Apri».",
    },
    pushX: { type: "number", label: "Si sposta in orizzontale di", unit: "tile", default: 1, step: 1, group: "Oggetto da spostare" },
    pushY: { type: "number", label: "Si sposta in verticale di", unit: "tile", default: 0, step: 1, group: "Oggetto da spostare" },
    scareRange: { type: "number", label: "Spaventa fino a", unit: "tile", default: 2.5, min: 0, step: 0.5, group: "Spavento" },
    scareTime: { type: "number", label: "Lo spavento dura", unit: "s", default: 2, min: 0, step: 0.25, group: "Spavento" },
    prompt: {
      type: "text",
      label: "Scritta per il fantasma",
      default: "",
      optional: true,
      translatable: true,
      help: "Compare sopra l'oggetto quando un fantasma comandato da un giocatore è abbastanza vicino. Vuoto = Spegni, Chiudi, Sposta o Spaventa.",
    },
    sound: { type: "audio", label: "Suono", default: "", optional: true },
    endSound: { type: "audio", label: "Suono quando torna com'era", default: "", optional: true },
  },
  states: [
    { id: "on", label: "Acceso" },
    { id: "off", label: "Spento" },
    { id: "open", label: "Aperto" },
    { id: "closed", label: "Chiuso" },
    { id: "locked", label: "Chiuso a chiave" },
    { id: "idle", label: "Tranquillo" },
    { id: "active", label: "Infestato" },
  ],
  events: [
    { id: "haunted", label: "Un fantasma l'ha infestato" },
    { id: "restored", label: "È tornato com'era" },
    { id: "unlocked", label: "È stato aperto con la chiave" },
  ],
  conditions: {
    isActive: { label: "È infestato adesso", test: (self) => self.data.active > 0 },
    isClosed: { label: "È chiuso", test: (self) => !!self.data.closed },
    isLocked: { label: "È chiuso a chiave", test: (self) => !!self.data.locked },
  },
  actions: {
    haunt: { label: "Infesta", run: (self) => void haunt(self) },
    open: {
      label: "Apri (anche se chiuso a chiave)",
      run: (self) => {
        if (self.props.kind !== "gate") return;
        self.data.locked = false;
        self.data.active = 0;
        openGate(self);
        self.emit("unlocked");
      },
    },
    close: {
      label: "Chiudi",
      run: (self) => {
        if (self.props.kind === "gate" && !self.data.closed) closeGate(self);
      },
    },
    unlock: {
      label: "Apri con la chiave",
      run: (self) => {
        if (self.props.kind !== "gate" || (!self.data.locked && !self.data.closed)) return;
        self.data.locked = false;
        self.data.active = 0;
        openGate(self);
        self.emit("unlocked");
      },
    },
  },
  texts: ["Spegni", "Chiudi", "Sposta", "Spaventa"],
  init(self) {
    const d = self.data;
    d.orig = new Map<number, number>();
    d.cells = cellsOf(self);
    d.active = 0;
    d.cd = 0;
    d.closed = false;
    d.locked = false;
    d.pushed = false;
    d.moving = false;
    d.flicker = 0;
    d.burst = 0;
    d.t = Math.random() * 10;
    if (self.props.kind === "gate" && self.props.locked) {
      d.locked = true;
      setSolid(self, d.cells, true);
      d.closed = true;
    }
    // Un oggetto da spostare è un ostacolo anche quando è al suo posto.
    if (self.props.kind === "push") setSolid(self, d.cells, true);
    self.state = stateOf(self);
  },
  update(self, dt) {
    const d = self.data;
    d.t += dt;
    if (d.burst > 0) d.burst -= dt;
    if (d.tween) {
      const tw = d.tween;
      tw.t = Math.min(1, tw.t + dt / 0.3);
      const k = 1 - (1 - tw.t) ** 3;
      self.entity.x = tw.x0 + (tw.x1 - tw.x0) * k;
      self.entity.y = tw.y0 + (tw.y1 - tw.y0) * k;
      if (tw.t >= 1) {
        d.tween = null;
        d.moving = false;
      }
    }
    if (d.flicker > 0) {
      // La luce torna con qualche scatto, come una lampadina vecchia.
      d.flicker -= dt;
      const l = lightOf(self);
      if (l) l.data.on = d.flicker <= 0 || Math.floor(d.flicker * 14) % 2 === 0;
    }
    if (d.active > 0) {
      d.active -= dt;
      if (d.active <= 0) {
        if (self.props.kind === "scare" || restore(self)) d.cd = Number(self.props.cooldown) || 0;
        else d.active = 0.25; // qualcuno è in mezzo: riprova tra poco
      }
    } else if (d.cd > 0) d.cd -= dt;
    self.state = stateOf(self);
  },
  render(self, r) {
    // Pipistrelli che scappano quando qualcosa spaventa.
    const d = self.data;
    if (d.burst <= 0) return;
    const c = bodyCenter(self.entity);
    const u = 1 - d.burst / 0.6;
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i - 2.5) * 0.45;
      const dist = 6 + u * 26;
      const x = c.x + Math.cos(a) * dist + Math.sin(d.t * 20 + i) * 2;
      const y = c.y - 6 + Math.sin(a) * dist;
      const flap = Math.sin(d.t * 30 + i * 2) > 0 ? 2 : 1;
      const col = packColor(0.08, 0.05, 0.12, 1 - u * 0.6);
      r.rect(x - 1, y, 2, 1, col);
      r.rect(x - 3, y - flap + 1, 2, 1, col);
      r.rect(x + 1, y - flap + 1, 2, 1, col);
    }
  },
  renderScreen(self, r) {
    if (!hauntReady(self)) return;
    const c = bodyCenter(self.entity);
    const ts = self.scene.tileSize;
    const near = runnersOf(self.scene).some((g) => {
      if (g.data.status !== "ghost" || !(g.data.slot > 0)) return false;
      const gc = bodyCenter(g.entity);
      return Math.hypot(gc.x - c.x, gc.y - c.y) <= (Number(g.props.hauntRange) || 1.5) * ts;
    });
    if (!near) return;
    const label = self.game.t(String(self.props.prompt || PROMPTS[self.props.kind] || ""));
    const b = self.body!;
    const p = toScreen(self.scene, c.x, b.top - 10);
    const w = r.measureText(label, { size: 7 }) + 8;
    const bob = Math.round(Math.sin(self.data.t * 6));
    r.rect(p.x - w / 2, p.y - 6 + bob, w, 11, packColor(0.07, 0.04, 0.16, 0.9));
    r.strokeRect(p.x - w / 2, p.y - 6 + bob, w, 11, Math.max(0.5, 1 / r.pixelScale), hexColor("#9fe7ff"));
    r.text(label, p.x, p.y - 5 + bob, { size: 7, align: "center", color: "#d8f6ff" });
  },
  renderLight(self, r) {
    if (self.props.kind !== "scare" || self.data.active <= 0) return;
    const c = bodyCenter(self.entity);
    const rad = (Number(self.props.scareRange) || 2) * self.scene.tileSize;
    r.drawUV(r.radial, 0, 0, 1, 1, c.x - rad, c.y - rad, rad * 2, rad * 2, hexColor("#9a6bff", 0.7 * Math.min(1, self.data.active)));
  },
  destroy(self) {
    // Le celle tornano com'erano: niente muri invisibili dopo che l'oggetto è sparito.
    const orig = self.data.orig as Map<number, number> | undefined;
    if (!orig) return;
    for (const [i, code] of orig) self.scene.grid.cells[i] = code;
  },
});

// ------------------------------------------------------------------ Trappola

defineBlock({
  name: "Trap",
  label: "Trappola",
  category: "Gameplay",
  description:
    "Si arma dopo un attimo e scatta quando un Cacciatore le passa vicino: un'esplosione lo stordisce per qualche secondo. Se nessuno ci passa, dopo un po' sparisce.",
  requires: ["Sprite"],
  priority: 45,
  props: {
    target: { type: "tag", label: "Scatta con chi ha l'etichetta", default: "mostro" },
    trigger: { type: "number", label: "Scatta a", unit: "tile", default: 1, min: 0.25, step: 0.25 },
    blast: { type: "number", label: "Raggio dell'esplosione", unit: "tile", default: 2, min: 0.5, step: 0.25 },
    stun: { type: "number", label: "Stordisce per", unit: "s", default: 2.5, min: 0, step: 0.25 },
    arm: { type: "number", label: "Si arma dopo", unit: "s", default: 0.6, min: 0, step: 0.1 },
    life: { type: "number", label: "Sparisce dopo", unit: "s", default: 30, min: 1, step: 1 },
    color: { type: "color", label: "Colore dell'esplosione", default: "#ff9a3c" },
    sound: { type: "audio", label: "Suono", default: "", optional: true },
  },
  events: [{ id: "triggered", label: "È scattata" }],
  init(self) {
    self.data.t = 0;
    self.data.boom = 0;
  },
  update(self, dt) {
    const d = self.data;
    const p = self.props;
    const e = self.entity;
    d.t += dt;
    if (d.boom > 0) {
      d.boom -= dt;
      if (d.boom <= 0) e.destroy();
      return;
    }
    if (d.t > p.life) {
      e.destroy();
      return;
    }
    const armed = d.t >= p.arm;
    // Armata: la miccia lampeggia sempre più veloce verso la fine.
    if (e.sprite) e.sprite.flash = armed && Math.floor(d.t * (d.t > p.life - 4 ? 12 : 4)) % 2 === 0 ? 0.6 : 0;
    if (!armed) return;
    const ts = self.scene.tileSize;
    const hunters = huntersOf(self.scene).filter((h) => h.entity.hasTag(p.target));
    const near = (h: BlockInstance, range: number) => {
      const c = bodyCenter(h.entity);
      return Math.hypot(c.x - e.worldX, c.y - (e.worldY - 4)) <= range * ts;
    };
    if (!hunters.some((h) => near(h, p.trigger))) return;
    for (const h of hunters) if (near(h, p.blast)) h.actions.stun(p.stun);
    if (p.sound) self.game.audio.play(p.sound);
    self.emit("triggered");
    self.scene.camera.shake(3, 0.3);
    d.boom = 0.45;
    if (e.sprite) e.sprite.visible = false;
  },
  render(self, r) {
    const d = self.data;
    if (d.boom <= 0) return;
    const e = self.entity;
    const u = 1 - d.boom / 0.45;
    const rad = self.props.blast * self.scene.tileSize * (0.3 + 0.7 * u);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + u;
      drawRay(r, e.worldX + Math.cos(a) * rad * 0.3, e.worldY - 4 + Math.sin(a) * rad * 0.3, a, rad * 0.6, 3 * (1 - u) + 0.5, self.props.color, 1 - u);
    }
  },
  renderLight(self, r) {
    const d = self.data;
    const e = self.entity;
    const ts = self.scene.tileSize;
    if (d.boom > 0) {
      const u = 1 - d.boom / 0.45;
      const rad = self.props.blast * ts * (0.8 + 0.8 * u);
      r.drawUV(r.radial, 0, 0, 1, 1, e.worldX - rad, e.worldY - 4 - rad, rad * 2, rad * 2, hexColor(self.props.color, 1.2 * (1 - u)));
      return;
    }
    const rad = ts * 0.8;
    r.drawUV(r.radial, 0, 0, 1, 1, e.worldX - rad, e.worldY - 10 - rad, rad * 2, rad * 2, hexColor(self.props.color, 0.6));
  },
});

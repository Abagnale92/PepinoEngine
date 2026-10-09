import { defineBlock, type BlockInstance } from "../core/block";
import type { Entity } from "../core/entity";
import type { Scene } from "../core/scene";
import { clamp, hexColor } from "../math";
import type { CollisionGrid } from "../physics/collision";
import type { Renderer } from "../render/renderer";
import { findPath, walkable } from "../world/pathfinding";
import { addItem, drawItemIcon, hasItem, inventory, itemDef, itemName, removeItem, useItem } from "../items/items";
import { interpolate, screenPos } from "./text";

// Blocchi per le avventure punta e clicca (si cammina dove si clicca, i punti cliccabili) e la barra dell'inventario.

// ------------------------------------------------------------------ Il puntatore nella scena

/** Cosa c'è sotto il puntatore in questo passo. Il clic si decide una volta sola per tutta la scena. */
interface PointerState {
  time: number;
  seen: boolean;
  /** Puntatore sullo schermo virtuale. */
  vx: number;
  vy: number;
  hover: Entity | null;
  overBar: boolean;
  /** Casella dell'inventario sotto il puntatore (-1 = nessuna). */
  slot: number;
  /** Oggetto dell'inventario scelto, da usare sul prossimo punto cliccato. */
  selected: string;
  /** Casella scelta con i tasti (Oggetto successivo). */
  cursor: number;
}

const states = new WeakMap<Scene, PointerState>();

function pointerState(scene: Scene): PointerState {
  let s = states.get(scene);
  if (!s) {
    s = { time: -1, seen: false, vx: 0, vy: 0, hover: null, overBar: false, slot: -1, selected: "", cursor: 0 };
    states.set(scene, s);
  }
  return s;
}

function firstBlock(scene: Scene, type: string): BlockInstance | undefined {
  for (const e of scene.entities) {
    const b = e.destroyed ? undefined : e.get(type);
    if (b?.enabled) return b;
  }
  return undefined;
}

/** Nelle avventure (ci sono Punti cliccabili) l'oggetto dell'inventario si sceglie e si usa su un punto; altrove si usa subito. */
const isAdventure = (scene: Scene) => !!firstBlock(scene, "Hotspot");

/** Zona cliccabile: il lato basso sui piedi dell'oggetto, come uno sprite. */
function hotspotArea(hs: BlockInstance) {
  const e = hs.entity;
  const { width: w, height: h } = hs.props;
  return { x: e.worldX - w / 2, y: e.worldY - h, w, h };
}

function hotspotAt(scene: Scene, x: number, y: number): Entity | null {
  let best: Entity | null = null;
  for (const e of scene.entities) {
    const hs = e.destroyed || !e.visible ? undefined : e.get("Hotspot");
    if (!hs?.enabled) continue;
    const a = hotspotArea(hs);
    if (x < a.x || x > a.x + a.w || y < a.y || y > a.y + a.h) continue;
    if (!best || e.z >= best.z) best = e;
  }
  return best;
}

function slotLayout(inv: BlockInstance) {
  const { x, y } = screenPos(inv, true);
  const size = inv.props.size as number;
  const gap = 2;
  return { x, y, size, gap, w: inv.props.slots * (size + gap) - gap };
}

function slotAt(inv: BlockInstance | undefined, vx: number, vy: number) {
  if (!inv || !inv.entity.visible) return { over: false, slot: -1 };
  const l = slotLayout(inv);
  if (vx < l.x || vx > l.x + l.w || vy < l.y || vy > l.y + l.size) return { over: false, slot: -1 };
  const i = Math.floor((vx - l.x) / (l.size + l.gap));
  return { over: true, slot: vx - l.x - i * (l.size + l.gap) <= l.size ? i : -1 };
}

/** Chi usa gli oggetti dell'inventario: il primo oggetto con l'etichetta scelta nella barra (di solito il giocatore). */
const ownerOf = (inv: BlockInstance) => inv.scene.findAll(String(inv.props.owner || "giocatore"))[0];

/** Usa l'oggetto della casella `slot` (fuori dalle avventure: pozioni, potenziamenti…). */
function useSlot(inv: BlockInstance, slot: number) {
  const stack = inventory(inv.game.vars)[slot];
  if (!stack) return;
  if (useItem(inv.scene, ownerOf(inv), stack.id) && inv.props.sound) inv.game.audio.play(inv.props.sound);
}

/** Aggiorna il puntatore e, se c'è un clic, decide chi lo riceve: inventario, punto cliccabile o pavimento. */
function resolve(self: BlockInstance): PointerState {
  const scene = self.scene;
  const s = pointerState(scene);
  if (s.time === scene.time) return s;
  s.time = scene.time;
  const game = self.game;
  const ptr = game.input.pointer;
  if (ptr.moved || ptr.pressed) {
    const v = game.renderer.toVirtual(ptr.x, ptr.y);
    s.vx = v.x;
    s.vy = v.y;
    s.seen = true;
  }
  if (s.selected && !hasItem(game.vars, s.selected)) s.selected = "";
  if (!s.seen) return s;
  const inv = firstBlock(scene, "Inventory");
  const hit = slotAt(inv, s.vx, s.vy);
  s.overBar = hit.over;
  s.slot = hit.slot;
  const cam = scene.camera;
  const wx = cam.left + s.vx / cam.zoom;
  const wy = cam.top + s.vy / cam.zoom;
  s.hover = s.overBar ? null : hotspotAt(scene, wx, wy);
  // Con i comandi bloccati (filmati, conto alla rovescia) i clic non fanno nulla.
  if (ptr.pressed && !game.controlsLocked) click(scene, s, inv, wx, wy);
  return s;
}

function click(scene: Scene, s: PointerState, inv: BlockInstance | undefined, wx: number, wy: number) {
  const game = scene.game;
  if (s.overBar) {
    const stack = inventory(game.vars)[s.slot];
    if (!stack || !inv) return;
    s.cursor = s.slot;
    if (!isAdventure(scene)) return useSlot(inv, s.slot);
    s.selected = s.selected === stack.id ? "" : stack.id;
    if (inv.props.sound) game.audio.play(inv.props.sound);
    return;
  }
  const walker = firstBlock(scene, "PointClickMover");
  const item = s.selected;
  s.selected = "";
  if (s.hover) {
    const hs = s.hover.get("Hotspot")!;
    const e = hs.entity;
    if (walker && hs.props.walkTo) walkTo(walker, e.worldX + hs.props.standX, e.worldY + hs.props.standY, { hotspot: hs, item });
    else activate(hs, item, walker?.entity);
  } else if (walker && !item) walkTo(walker, wx, wy);
}

function tell(hs: BlockInstance, text: unknown) {
  const t = String(text ?? "").trim();
  if (!t) return;
  const game = hs.game;
  const shown = interpolate(game.t(t), game.vars);
  // Un clic nuovo sostituisce la descrizione di prima: cliccando in fretta le scritte non si accumulano.
  game.replaceMessage(shown, Math.min(6, 1.5 + shown.length * 0.05));
}

/** Il punto cliccabile viene usato: a mani vuote o con un oggetto dell'inventario. */
function activate(hs: BlockInstance, item: string, actor?: Entity) {
  const p = hs.props;
  const e = hs.entity;
  const game = hs.game;
  if (actor && Math.abs(e.worldX - actor.worldX) > 2) actor.facingX = e.worldX > actor.worldX ? 1 : -1;
  if (item) {
    hs.data.usedItem = item;
    const right = !!p.needs && item === p.needs;
    if (right && p.consume) removeItem(game.vars, item, 1);
    tell(hs, right ? p.rightText : p.wrongText);
    hs.emit("itemUsed", item);
    hs.emit(right ? "rightItem" : "wrongItem", item);
    return;
  }
  tell(hs, p.description);
  if (p.give) {
    addItem(game.vars, p.give, 1, itemDef(game.project, p.give)?.max ?? 0);
    if (p.sound) game.audio.play(p.sound);
    hs.emit("pickedUp", p.give);
    e.destroy();
    return;
  }
  hs.emit("clicked");
}

const LABEL = { size: 8, align: "center" as const, color: "#ffffff", outline: true };

function drawLabel(r: Renderer, text: string, x: number, y: number) {
  if (!text) return;
  const w = r.measureText(text, LABEL);
  r.text(text, clamp(x, w / 2 + 2, r.width - w / 2 - 2), clamp(y, 2, r.height - 12), LABEL);
}

// ------------------------------------------------------------------ Cammina dove clicchi

interface Pending {
  hotspot: BlockInstance;
  item: string;
}

function placeAt(e: Entity, x: number, y: number) {
  e.x += x - e.worldX;
  e.y += y - e.worldY;
}

function nearestWalkable(g: CollisionGrid, cx: number, cy: number) {
  for (let r = 1; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r && walkable(g, cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
      }
    }
  }
  return null;
}

/** Vista dall'alto: i centri delle celle del percorso A*, poi il punto esatto. */
function route(self: BlockInstance, x: number, y: number) {
  const g = self.scene.grid;
  const e = self.entity;
  const ts = g.size;
  const cell = (v: number) => Math.floor(v / ts);
  let tx = cell(x);
  let ty = cell(y - 1);
  if (!walkable(g, tx, ty)) {
    // Si è cliccato su un muro (o un mobile): si va nella cella libera più vicina.
    const near = nearestWalkable(g, tx, ty);
    if (!near) return [{ x, y }];
    tx = near.x;
    ty = near.y;
    x = (tx + 0.5) * ts;
    y = (ty + 0.5) * ts;
  }
  const path = findPath(g, cell(e.worldX), cell(e.worldY - 1), tx, ty, { diagonal: true });
  if (!path) return [{ x, y }];
  return [...path.slice(0, -1).map((c) => ({ x: (c.x + 0.5) * ts, y: (c.y + 0.5) * ts })), { x, y }];
}

function walkTo(self: BlockInstance, x: number, y: number, pending?: Pending) {
  const e = self.entity;
  self.data.pending = pending ?? null;
  self.data.points =
    self.props.mode === "free" ? route(self, x, y) : [{ x: clamp(x, 4, Math.max(4, self.scene.widthPx - 4)), y: e.worldY }];
}

function arrive(self: BlockInstance) {
  self.state = "idle";
  self.emit("arrived");
  const pend = self.data.pending as Pending | null;
  self.data.pending = null;
  if (pend && !pend.hotspot.entity.destroyed && pend.hotspot.enabled) activate(pend.hotspot, pend.item, self.entity);
}

defineBlock({
  name: "PointClickMover",
  label: "Cammina dove clicchi",
  category: "Movimento",
  description:
    "Cammina fino al punto cliccato (o toccato) e, se lì c'è un Punto cliccabile, lo usa quando arriva. Visto di lato va solo a destra e a sinistra; visto dall'alto gira intorno ai muri.",
  priority: 20,
  props: {
    mode: {
      type: "select",
      label: "Direzioni",
      default: "horizontal",
      options: [
        { value: "horizontal", label: "Solo destra e sinistra (vista di lato)" },
        { value: "free", label: "Dappertutto, girando intorno ai muri (vista dall'alto)" },
      ],
    },
    speed: { type: "number", label: "Velocità", unit: "tile/s", default: 3, min: 0.1, step: 0.5 },
  },
  states: [
    { id: "idle", label: "Fermo" },
    { id: "walk", label: "Cammina" },
  ],
  events: [{ id: "arrived", label: "È arrivato" }],
  conditions: {
    isWalking: { label: "Sta camminando", test: (self) => (self.data.points?.length ?? 0) > 0 },
  },
  actions: {
    stop: {
      label: "Fermati",
      run: (self) => {
        self.data.points = [];
        self.data.pending = null;
      },
    },
  },
  init(self) {
    self.data.points = [];
    self.data.pending = null;
  },
  update(self, dt) {
    resolve(self);
    const e = self.entity;
    const pts = self.data.points as { x: number; y: number }[];
    if (!pts.length) {
      self.state = "idle";
      return;
    }
    let step = self.props.speed * self.scene.tileSize * dt * e.boost("speed");
    while (step > 0 && pts.length) {
      const t = pts[0];
      const dx = t.x - e.worldX;
      const dy = t.y - e.worldY;
      const dist = Math.hypot(dx, dy);
      if (Math.abs(dx) > 0.5) e.facingX = dx > 0 ? 1 : -1;
      if (dist > 0.01) e.direction = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
      if (dist <= step) {
        placeAt(e, t.x, t.y);
        step -= dist;
        pts.shift();
      } else {
        placeAt(e, e.worldX + (dx / dist) * step, e.worldY + (dy / dist) * step);
        step = 0;
      }
    }
    self.state = "walk";
    if (!pts.length) arrive(self);
  },
});

// ------------------------------------------------------------------ Punto cliccabile

defineBlock({
  name: "Hotspot",
  label: "Punto cliccabile",
  category: "Gameplay",
  description:
    "Una zona da cliccare (o toccare): sotto il puntatore compare il suo nome. Il personaggio con «Cammina dove clicchi» ci va, poi compare la descrizione e parte l'evento per le Regole. Può essere un oggetto dell'archivio da raccogliere, oppure chiedere un oggetto dell'inventario (una chiave per una porta).",
  priority: 90,
  props: {
    name: { type: "string", label: "Nome", default: "Oggetto", translatable: true },
    width: { type: "number", label: "Larghezza", unit: "px", default: 16, min: 1 },
    height: { type: "number", label: "Altezza", unit: "px", default: 16, min: 1 },
    description: {
      type: "text",
      label: "Descrizione",
      default: "",
      optional: true,
      translatable: true,
      help: "Messaggio mostrato quando lo si clicca. Vuoto = nessuno (ci pensano le Regole).",
    },
    walkTo: { type: "boolean", label: "Il personaggio ci va prima", default: true },
    standX: { type: "number", label: "Si ferma a X", unit: "px", default: 0, help: "Dove si ferma il personaggio, rispetto al punto: negativo = a sinistra." },
    standY: { type: "number", label: "Si ferma a Y", unit: "px", default: 0 },
    give: {
      type: "item",
      label: "Si raccoglie",
      default: "",
      optional: true,
      group: "Inventario",
      help: "Un oggetto dell'archivio: cliccandolo finisce nell'inventario e sparisce dalla scena.",
    },
    sound: { type: "audio", label: "Suono quando si raccoglie", default: "", optional: true, group: "Inventario" },
    needs: {
      type: "item",
      label: "Oggetto che serve",
      default: "",
      optional: true,
      group: "Inventario",
      help: "L'oggetto dell'inventario che si può usare qui (per esempio una chiave).",
    },
    consume: { type: "boolean", label: "L'oggetto si consuma", default: true, group: "Inventario" },
    rightText: { type: "text", label: "Messaggio con l'oggetto giusto", default: "", optional: true, translatable: true, group: "Inventario" },
    wrongText: { type: "text", label: "Messaggio con un altro oggetto", default: "Non funziona.", optional: true, translatable: true, group: "Inventario" },
  },
  events: [
    { id: "clicked", label: "È stato cliccato" },
    { id: "pickedUp", label: "È stato raccolto" },
    { id: "itemUsed", label: "Ci hanno usato un oggetto" },
    { id: "rightItem", label: "Ci hanno usato l'oggetto giusto" },
    { id: "wrongItem", label: "Ci hanno usato un altro oggetto" },
  ],
  conditions: {
    isHovered: { label: "Ha il puntatore sopra", test: (self) => pointerState(self.scene).hover === self.entity },
    usedItem: {
      label: "L'ultimo oggetto usato è",
      params: { item: { type: "item", label: "Oggetto", default: "" } },
      test: (self, item: string) => self.data.usedItem === item,
    },
  },
  init(self) {
    self.data.usedItem = "";
    // Un oggetto già raccolto non ricompare quando si torna nella scena.
    if (self.props.give && hasItem(self.game.vars, self.props.give)) self.entity.destroy();
  },
  update(self) {
    resolve(self);
  },
  renderDebug(self, r) {
    const a = hotspotArea(self);
    r.strokeRect(a.x, a.y, a.w, a.h, 1, hexColor("#fff3a6", 0.9));
  },
  renderScreen(self, r) {
    const s = pointerState(self.scene);
    if (s.hover !== self.entity) return;
    const game = self.game;
    const name = game.t(self.props.name);
    let label = name;
    if (s.selected) {
      const inv = firstBlock(self.scene, "Inventory");
      const phrase = game.t(String(inv?.props.useText ?? "Usa {oggetto} con {punto}"));
      label = phrase.replace("{oggetto}", itemName(game, s.selected)).replace("{punto}", name);
    }
    drawLabel(r, label, s.vx, s.vy - 14);
  },
});

// ------------------------------------------------------------------ Inventario

defineBlock({
  name: "Inventory",
  label: "Inventario",
  category: "Interfaccia",
  description:
    "La barra degli oggetti dell'inventario, fissa sullo schermo, con le quantità. Un clic (o Q, «Usa oggetto») usa l'oggetto scelto ed E passa al successivo; se nella scena c'è un personaggio che «Cammina dove clicchi», si sceglie un oggetto e poi si clicca un punto della scena per usarlo lì. Gli oggetti restano anche cambiando scena.",
  priority: 100,
  props: {
    slots: { type: "integer", label: "Caselle", default: 6, min: 1 },
    size: { type: "number", label: "Grandezza casella", unit: "px", default: 20, min: 8 },
    owner: { type: "tag", label: "Chi usa gli oggetti", default: "giocatore" },
    keys: { type: "boolean", label: "Si usa con i tasti", default: true, help: "Q (Usa oggetto) usa l'oggetto scelto, E (Oggetto successivo) cambia casella." },
    color: { type: "color", label: "Colore", default: "#0d180ecc" },
    border: { type: "color", label: "Bordo", default: "#8cc480" },
    selectColor: { type: "color", label: "Colore selezionato", default: "#fff3a6" },
    useText: {
      type: "string",
      label: "Frase «usa»",
      default: "Usa {oggetto} con {punto}",
      translatable: true,
      help: "Compare sotto il puntatore quando si è scelto un oggetto.",
    },
    sound: { type: "audio", label: "Suono", default: "", optional: true },
  },
  conditions: {
    hasSelected: { label: "Ha scelto un oggetto", test: (self) => !!pointerState(self.scene).selected },
  },
  actions: {
    deselect: { label: "Lascia l'oggetto scelto", run: (self) => void (pointerState(self.scene).selected = "") },
    useSelected: { label: "Usa l'oggetto scelto", run: (self) => useSlot(self, pointerState(self.scene).cursor) },
  },
  update(self) {
    const s = resolve(self);
    if (!self.props.keys || self.game.controlsLocked) return;
    const n = inventory(self.game.vars).length;
    if (!n) return;
    s.cursor = clamp(s.cursor, 0, n - 1);
    const input = self.game.input;
    if (input.pressed("nextItem")) s.cursor = (s.cursor + 1) % n;
    if (input.pressed("item")) useSlot(self, s.cursor);
  },
  renderScreen(self, r) {
    const s = pointerState(self.scene);
    const p = self.props;
    const game = self.game;
    const l = slotLayout(self);
    const stacks = inventory(game.vars);
    const t = Math.max(0.5, 1 / r.pixelScale);
    const adventure = isAdventure(self.scene);
    for (let i = 0; i < p.slots; i++) {
      const x = l.x + i * (l.size + l.gap);
      const st = stacks[i];
      const on = !!st && (adventure ? st.id === s.selected : p.keys && i === s.cursor);
      const hover = !!st && s.overBar && s.slot === i;
      r.rect(x, l.y, l.size, l.size, hexColor(p.color));
      r.strokeRect(x, l.y, l.size, l.size, t, hexColor(on ? p.selectColor : p.border, on || hover ? 1 : 0.6));
      if (!st) continue;
      drawItemIcon(game, r, st.id, x + l.size / 2, l.y + l.size / 2, l.size - 4);
      if (st.qty > 1) r.text(String(st.qty), x + l.size - 2, l.y + l.size - 8, { size: 6, align: "right", color: "#ffffff", outline: true });
    }
    const hovered = s.overBar ? stacks[s.slot] : undefined;
    if (hovered && !s.selected) drawLabel(r, itemName(game, hovered.id), l.x + s.slot * (l.size + l.gap) + l.size / 2, l.y + l.size + 3);
    // L'oggetto scelto segue il puntatore.
    const chosen = stacks.find((i) => i.id === s.selected);
    if (chosen && s.seen) {
      drawItemIcon(game, r, chosen.id, s.vx + 9, s.vy + 9, 12);
      if (!s.hover) drawLabel(r, itemName(game, chosen.id), s.vx, s.vy - 14);
    }
  },
});

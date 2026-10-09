import { defineBlock, type BlockInstance } from "../core/block";
import type { Entity } from "../core/entity";
import type { Scene } from "../core/scene";
import { approach, clamp, hexColor } from "../math";
import { INPUT_SOURCE_OPTIONS } from "./platform";
import { bodyCenter } from "./targets";

// Blocchi per i giochi di corse visti dall'alto: l'auto, i traguardi e il conteggio dei giri.

// ------------------------------------------------------------------ Controller Auto

/** Rimette l'auto dov'era in pista poco prima di uscire, ferma e con il muso nella direzione di allora. */
function backOnTrack(self: BlockInstance): boolean {
  const d = self.data;
  const trail = d.trail as { x: number; y: number; heading: number }[];
  const spot = trail[0];
  if (!spot) return false;
  const e = self.entity;
  e.x = spot.x;
  e.y = spot.y;
  d.heading = spot.heading;
  e.rotation = spot.heading;
  if (self.body) self.body.vx = self.body.vy = 0;
  d.offroad = false;
  d.offTime = 0;
  trail.length = 0;
  self.state = "idle";
  self.emit("reset");
  self.emit("ontrack");
  return true;
}

/** L'auto è fuori pista se sotto di lei il layer della pista non ha tile. */
function offTrack(self: BlockInstance): boolean {
  const name = String(self.props.trackLayer ?? "").trim();
  if (!name) return false;
  const layer = self.scene.data.layers.find((l) => l.name === name || l.id === name);
  if (!layer) return false;
  const c = bodyCenter(self.entity);
  const ts = self.scene.tileSize;
  const tx = Math.floor(c.x / ts);
  const ty = Math.floor(c.y / ts);
  if (tx < 0 || ty < 0 || tx >= layer.width || ty >= layer.height) return true;
  return layer.data[ty * layer.width + tx] < 0;
}

defineBlock({
  name: "CarController",
  label: "Controller Auto",
  category: "Movimento",
  description:
    "Guida vista dall'alto: su = gas, giù = freno e retromarcia, sinistra e destra sterzano (solo quando l'auto si muove). La sprite ruota con l'auto; con poca aderenza l'auto derapa in curva. Fuori dalla pista rallenta.",
  requires: ["Body"],
  priority: 20,
  props: {
    input: { type: "select", label: "Comandato da", default: "player", options: INPUT_SOURCE_OPTIONS },
    maxSpeed: { type: "number", label: "Velocità massima", unit: "tile/s", default: 9, min: 0, step: 0.5 },
    accel: { type: "number", label: "Accelerazione", unit: "tile/s²", default: 8, min: 0, step: 0.5 },
    brake: { type: "number", label: "Frenata", unit: "tile/s²", default: 14, min: 0, step: 0.5 },
    reverse: { type: "number", label: "Velocità in retromarcia", unit: "tile/s", default: 3, min: 0, step: 0.5 },
    drag: { type: "number", label: "Rallenta senza gas", unit: "tile/s²", default: 3, min: 0, step: 0.5 },
    turn: { type: "number", label: "Sterzo", unit: "°/s", default: 200, min: 0, step: 10 },
    grip: {
      type: "number",
      label: "Aderenza",
      default: 0.85,
      min: 0,
      max: 1,
      step: 0.05,
      help: "1 = incollata alla strada, più basso = derapa in curva.",
    },
    trackLayer: {
      type: "string",
      label: "Layer della pista",
      default: "",
      help: "Nome del layer con l'asfalto: dove non ci sono tile l'auto è fuori pista. Vuoto = sempre in pista.",
    },
    offroad: { type: "number", label: "Velocità fuori pista", default: 0.5, min: 0, max: 1, step: 0.05, help: "Frazione della velocità massima." },
    resetAfter: {
      type: "number",
      label: "Rimetti in pista dopo",
      unit: "s",
      default: 0,
      min: 0,
      step: 0.5,
      help: "Se l'auto resta fuori pista per questo tempo torna dov'era in pista poco prima, ferma. 0 = mai.",
    },
    startAngle: { type: "number", label: "Direzione iniziale", unit: "°", default: 0, step: 15, help: "-90 = verso l'alto, 0 = destra, 90 = giù, 180 = sinistra." },
  },
  states: [
    { id: "idle", label: "Fermo" },
    { id: "drive", label: "Alla guida" },
    { id: "drift", label: "Derapa" },
  ],
  events: [
    { id: "offroad", label: "Esce di pista" },
    { id: "ontrack", label: "Torna in pista" },
    { id: "reset", label: "È stata rimessa in pista" },
  ],
  conditions: {
    isOffroad: { label: "È fuori pista", test: (self) => !!self.data.offroad },
    isMoving: { label: "Si sta muovendo", test: (self) => !!self.body && Math.hypot(self.body.vx, self.body.vy) > 4 },
  },
  actions: {
    stop: {
      label: "Fermati",
      run: (self) => {
        if (self.body) self.body.vx = self.body.vy = 0;
      },
    },
  },
  init(self) {
    self.data.heading = (Number(self.props.startAngle) * Math.PI) / 180;
    self.data.offroad = false;
    self.data.offTime = 0;
    // Dove era l'auto in pista negli ultimi istanti (un punto ogni 0,1 s): serve per rimetterla in pista.
    self.data.trail = [] as { x: number; y: number; heading: number }[];
    self.data.trailT = 0;
    self.entity.rotation = self.data.heading;
  },
  update(self, dt) {
    const b = self.body;
    if (!b) return;
    const e = self.entity;
    const p = self.props;
    const d = self.data;
    const ts = self.scene.tileSize;
    if (p.input === "player") self.game.input.readIntent(e.intent);
    const it = e.intent;
    let fx = Math.cos(d.heading);
    let fy = Math.sin(d.heading);
    // Velocità in avanti e di lato (la derapata), rispetto al muso dell'auto.
    let fs = b.vx * fx + b.vy * fy;
    let ls = -b.vx * fy + b.vy * fx;
    const wasOff = !!d.offroad;
    d.offroad = offTrack(self);
    if (d.offroad !== wasOff) self.emit(d.offroad ? "offroad" : "ontrack");
    if (d.offroad) {
      d.offTime += dt;
      if (p.resetAfter > 0 && d.offTime >= p.resetAfter && backOnTrack(self)) return;
    } else {
      d.offTime = 0;
      d.trailT -= dt;
      if (d.trailT <= 0) {
        d.trailT = 0.1;
        const trail = d.trail as { x: number; y: number; heading: number }[];
        trail.push({ x: e.x, y: e.y, heading: d.heading });
        if (trail.length > 8) trail.shift();
      }
    }
    const max = p.maxSpeed * ts * (d.offroad ? p.offroad : 1) * e.boost("speed");
    const gas = it.y < -0.1;
    const brake = it.y > 0.1;
    if (gas) fs += p.accel * ts * dt * (fs < 0 ? 2 : 1);
    else if (brake) fs -= (fs > 0 ? p.brake : p.accel * 0.6) * ts * dt;
    else fs = approach(fs, 0, p.drag * ts * dt);
    if (fs > max) fs = Math.max(max, fs - p.brake * ts * dt);
    fs = Math.max(fs, -p.reverse * ts);
    ls *= Math.pow(Math.max(1e-4, 1 - clamp(p.grip, 0, 1)), dt * 4);
    // Da ferma l'auto non sterza; in retromarcia lo sterzo si inverte, come nella realtà.
    const steer = clamp(fs / (0.35 * Math.max(0.1, p.maxSpeed) * ts), -1, 1);
    d.heading += it.x * ((p.turn * Math.PI) / 180) * dt * steer;
    fx = Math.cos(d.heading);
    fy = Math.sin(d.heading);
    b.vx = fx * fs - fy * ls;
    b.vy = fy * fs + fx * ls;
    e.rotation = d.heading;
    self.state = Math.abs(fs) < 4 ? "idle" : Math.abs(ls) > 30 ? "drift" : "drive";
  },
});

// ------------------------------------------------------------------ Traguardo

defineBlock({
  name: "Checkpoint",
  label: "Traguardo",
  category: "Gameplay",
  description:
    "La linea d'arrivo o un punto di passaggio di una pista: il blocco «Giri» conta un giro quando si passa da tutti i traguardi in ordine, fino a tornare al numero 0 (la linea d'arrivo).",
  priority: 5,
  props: {
    order: { type: "integer", label: "Ordine", default: 0, min: 0, help: "0 = linea d'arrivo, poi 1, 2, 3… nell'ordine della pista." },
    width: { type: "number", label: "Larghezza", unit: "tile", default: 3, min: 0.5, step: 0.5 },
    height: { type: "number", label: "Altezza", unit: "tile", default: 3, min: 0.5, step: 0.5 },
  },
  renderDebug(self, r) {
    const a = checkpointArea(self.entity);
    if (a) r.strokeRect(a.x, a.y, a.w, a.h, 1, hexColor(self.props.order === 0 ? "#ffffff" : "#f0b43c", 0.9));
  },
});

function checkpointArea(e: Entity) {
  const cp = e.get("Checkpoint");
  if (!cp) return undefined;
  const ts = e.scene.tileSize;
  const w = cp.props.width * ts;
  const h = cp.props.height * ts;
  return { x: e.worldX - w / 2, y: e.worldY - h / 2, w, h, order: cp.props.order as number };
}

// ------------------------------------------------------------------ Giri

/** Chi ha già finito la gara, in ordine di arrivo (per la classifica). */
const arrivals = new WeakMap<Scene, Entity[]>();

function checkpoints(scene: Scene) {
  return scene.entities
    .filter((e) => !e.destroyed && e.get("Checkpoint"))
    .map((e) => checkpointArea(e)!)
    .sort((a, b) => a.order - b.order);
}

const inside = (e: Entity, a: { x: number; y: number; w: number; h: number } | undefined) => {
  if (!a) return false;
  const c = bodyCenter(e);
  return c.x >= a.x && c.x <= a.x + a.w && c.y >= a.y && c.y <= a.y + a.h;
};

function setVar(self: BlockInstance, name: string, value: number) {
  if (name) self.game.vars[name] = value;
}

defineBlock({
  name: "LapCounter",
  label: "Giri",
  category: "Gameplay",
  description:
    "Conta i giri di una gara passando dai Traguardi in ordine; tiene il tempo, il giro migliore e la posizione in classifica tra tutti quelli che hanno questo blocco (anche gli avversari). Quando i giri sono finiti, la gara è finita.",
  priority: 60,
  props: {
    laps: { type: "integer", label: "Giri", default: 3, min: 1 },
    lapVariable: { type: "variable", label: "Giro nella variabile", default: "", optional: true },
    timeVariable: { type: "variable", label: "Tempo nella variabile", default: "", optional: true, help: "Tempo di gara in secondi (con un decimale)." },
    bestVariable: { type: "variable", label: "Giro migliore nella variabile", default: "", optional: true },
    positionVariable: { type: "variable", label: "Posizione nella variabile", default: "", optional: true },
    startOnMove: { type: "boolean", label: "Il tempo parte quando si muove", default: true },
  },
  events: [
    { id: "checkpoint", label: "Ha passato un traguardo" },
    { id: "lap", label: "Ha finito un giro" },
    { id: "finished", label: "Ha finito la gara" },
  ],
  conditions: {
    isFinished: { label: "Ha finito la gara", test: (self) => !!self.data.finished },
  },
  init(self) {
    const d = self.data;
    const e = self.entity;
    d.lap = 0;
    d.time = 0;
    d.lapStart = 0;
    d.best = 0;
    d.finished = false;
    d.running = !self.props.startOnMove;
    d.x0 = e.worldX;
    d.y0 = e.worldY;
    d.next = -1;
    d.progress = 0;
    setVar(self, self.props.lapVariable, 1);
    setVar(self, self.props.timeVariable, 0);
  },
  update(self, dt) {
    const d = self.data;
    const p = self.props;
    const e = self.entity;
    if (d.finished) return;
    const cps = checkpoints(self.scene);
    if (!cps.length) return;
    // Alla partenza si è sulla linea d'arrivo: il primo traguardo da passare è il numero 1.
    if (d.next < 0) {
      d.next = cps.length > 1 ? 1 : 0;
      d.wasInside = inside(e, cps[d.next]);
    }
    if (!d.running && Math.hypot(e.worldX - d.x0, e.worldY - d.y0) > 2) d.running = true;
    if (d.running) {
      d.time += dt;
      setVar(self, p.timeVariable, Math.round(d.time * 10) / 10);
    }
    const target = cps[d.next % cps.length];
    const now = inside(e, target);
    if (now && !d.wasInside) {
      self.emit("checkpoint", target.order);
      if (d.next === 0) {
        d.lap++;
        const lapTime = d.time - d.lapStart;
        d.lapStart = d.time;
        if (!d.best || lapTime < d.best) {
          d.best = lapTime;
          setVar(self, p.bestVariable, Math.round(d.best * 10) / 10);
        }
        // Variabili e stato si aggiornano prima degli eventi: le Regole leggono già il giro nuovo.
        if (d.lap >= p.laps) {
          d.finished = true;
          const list = arrivals.get(self.scene) ?? [];
          list.push(e);
          arrivals.set(self.scene, list);
          d.progress = 1e9 - list.length;
          updatePosition(self);
          self.emit("lap", d.lap);
          self.emit("finished");
          return;
        }
        setVar(self, p.lapVariable, d.lap + 1);
        self.emit("lap", d.lap);
      }
      d.next = (d.next + 1) % cps.length;
      d.wasInside = inside(e, cps[d.next]);
    } else d.wasInside = now;
    // Avanzamento nella gara: traguardi passati, poi chi è più vicino al prossimo.
    const passed = d.lap * cps.length + (d.next === 0 ? cps.length : d.next);
    const next = cps[d.next];
    const c = bodyCenter(e);
    d.progress = passed * 1e5 - Math.hypot(next.x + next.w / 2 - c.x, next.y + next.h / 2 - c.y);
    updatePosition(self);
  },
});

function updatePosition(self: BlockInstance) {
  const name = self.props.positionVariable;
  if (!name) return;
  const mine = self.data.progress as number;
  let pos = 1;
  for (const o of self.scene.entities) {
    if (o === self.entity || o.destroyed) continue;
    const lc = o.get("LapCounter");
    if (lc && (lc.data.progress ?? 0) > mine) pos++;
  }
  self.game.vars[name] = pos;
}

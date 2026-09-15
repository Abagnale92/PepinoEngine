import { defineBlock, type BlockInstance } from "../core/block";
import type { Entity } from "../core/entity";
import { hexColor } from "../math";
import { screenPos } from "./text";

// Blocchi per i tower defense (e le corse): percorsi da seguire, piazzole dove costruire, nemici a ondate.

function placeAt(e: Entity, x: number, y: number) {
  e.x += x - e.worldX;
  e.y += y - e.worldY;
}

// ------------------------------------------------------------------ Punto del percorso

defineBlock({
  name: "Waypoint",
  label: "Punto del percorso",
  category: "IA",
  description:
    "Segna una tappa di un percorso: chi ha «Segue un percorso» passa dai punti con lo stesso nome di percorso, in ordine di numero. Nel gioco non si vede.",
  priority: 5,
  props: {
    path: { type: "string", label: "Percorso", default: "strada" },
    order: { type: "integer", label: "Ordine", default: 1, min: 0 },
  },
  renderDebug(self, r) {
    const e = self.entity;
    r.rect(e.worldX - 3, e.worldY - 3, 6, 6, hexColor("#f0b43c", 0.85));
  },
});

// ------------------------------------------------------------------ Segue un percorso

/** Punti del percorso nella scena, in ordine. */
function pathPoints(self: BlockInstance): { x: number; y: number }[] {
  const path = String(self.props.path);
  return self.scene.entities
    .filter((e) => !e.destroyed && e.get("Waypoint")?.props.path === path)
    .sort((a, b) => a.get("Waypoint")!.props.order - b.get("Waypoint")!.props.order)
    .map((e) => ({ x: e.worldX, y: e.worldY }));
}

defineBlock({
  name: "PathFollower",
  label: "Segue un percorso",
  category: "IA",
  description:
    "Cammina da solo lungo i Punti del percorso con lo stesso nome, uno dopo l'altro: i nemici dei tower defense, le auto avversarie nelle corse. Alla fine può sparire, ricominciare il giro o fermarsi.",
  priority: 21,
  props: {
    path: { type: "string", label: "Percorso", default: "strada" },
    speed: { type: "number", label: "Velocità", unit: "tile/s", default: 2, min: 0, step: 0.25 },
    atEnd: {
      type: "select",
      label: "Alla fine",
      default: "destroy",
      options: [
        { value: "destroy", label: "Sparisce" },
        { value: "loop", label: "Ricomincia il giro" },
        { value: "stop", label: "Si ferma" },
      ],
    },
    startAtFirst: {
      type: "boolean",
      label: "Parte dal primo punto",
      default: false,
      help: "Se attivo, l'oggetto viene messo sul primo punto appena compare.",
    },
    autoStart: {
      type: "boolean",
      label: "Parte da solo",
      default: true,
      help: "Se spento, aspetta l'azione «Riparti» (per esempio il via di una gara).",
    },
    rotate: { type: "boolean", label: "Ruota verso dove va", default: false, help: "La sprite gira nella direzione del movimento, come un'auto vista dall'alto." },
  },
  states: [
    { id: "idle", label: "Fermo" },
    { id: "walk", label: "Cammina" },
  ],
  events: [
    { id: "reachedPoint", label: "Ha raggiunto un punto" },
    { id: "lap", label: "Ha finito un giro" },
    { id: "reachedEnd", label: "È arrivato alla fine del percorso" },
  ],
  conditions: {
    isWalking: { label: "Sta camminando", test: (self) => !self.data.done && !self.data.stopped && self.data.points.length > 0 },
  },
  actions: {
    stop: { label: "Fermati", run: (self) => (self.data.stopped = true) },
    go: { label: "Riparti", run: (self) => (self.data.stopped = false) },
    setSpeed: {
      label: "Cambia velocità",
      params: { speed: { type: "number", label: "Velocità", unit: "tile/s", default: 2, min: 0, step: 0.25 } },
      run: (self, speed: number) => (self.props.speed = Math.max(0, Number(speed) || 0)),
    },
  },
  init(self) {
    const d = self.data;
    d.points = pathPoints(self);
    d.done = false;
    d.stopped = self.props.autoStart === false;
    d.i = 0;
    if (self.props.startAtFirst && d.points.length) {
      placeAt(self.entity, d.points[0].x, d.points[0].y);
      d.i = 1;
    }
  },
  update(self, dt) {
    const e = self.entity;
    const d = self.data;
    const p = self.props;
    const pts: { x: number; y: number }[] = d.points;
    if (e.body) {
      e.body.vx = 0;
      e.body.vy = 0;
    }
    if (d.done || d.stopped || !pts.length) {
      self.state = "idle";
      return;
    }
    self.state = "walk";
    // Con passi lunghi può superare un punto e proseguire verso il successivo nello stesso fotogramma.
    let step = p.speed * self.scene.tileSize * dt;
    for (let guard = 0; guard < pts.length + 1 && step > 0; guard++) {
      const t = pts[d.i];
      const dx = t.x - e.worldX;
      const dy = t.y - e.worldY;
      const dist = Math.hypot(dx, dy);
      if (dist > step) {
        placeAt(e, e.worldX + (dx / dist) * step, e.worldY + (dy / dist) * step);
        if (Math.abs(dx) > 0.01) e.facingX = dx > 0 ? 1 : -1;
        e.direction = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
        if (p.rotate) e.fx.rot = Math.atan2(dy, dx);
        return;
      }
      placeAt(e, t.x, t.y);
      step -= dist;
      self.emit("reachedPoint", d.i);
      d.i++;
      if (d.i < pts.length) continue;
      if (p.atEnd === "loop") {
        d.i = 0;
        self.emit("lap");
        continue;
      }
      d.done = true;
      self.state = "idle";
      self.emit("reachedEnd");
      if (p.atEnd === "destroy") e.destroy();
      return;
    }
  },
});

// ------------------------------------------------------------------ Piazzola

function build(self: BlockInstance) {
  const p = self.props;
  const d = self.data;
  if (d.built || !p.prefab) return;
  const money = Number(self.game.vars[p.variable] ?? 0);
  if (p.variable && money < p.cost) {
    self.emit("tooExpensive");
    return;
  }
  if (p.variable) self.game.vars[p.variable] = money - p.cost;
  const e = self.entity;
  const made = self.scene.spawn(p.prefab, e.worldX, e.worldY);
  d.built = true;
  d.hover = false;
  self.emit("built", made);
  if (p.sound) self.game.audio.play(p.sound);
}

defineBlock({
  name: "BuildSpot",
  label: "Piazzola",
  category: "Gameplay",
  description:
    "Un posto dove costruire con un clic (o un tocco): se la variabile dei soldi basta, crea il modello (per esempio una torretta) al suo posto e toglie il costo. Come nei tower defense.",
  priority: 95,
  props: {
    prefab: { type: "prefab", label: "Cosa costruisce", default: "" },
    cost: { type: "integer", label: "Costo", default: 20, min: 0 },
    variable: { type: "variable", label: "Paga con la variabile", default: "monete", optional: true },
    size: { type: "number", label: "Grandezza", unit: "px", default: 16, min: 4 },
    color: { type: "color", label: "Colore", default: "#ffffff" },
    sound: { type: "audio", label: "Suono", default: "" },
  },
  events: [
    { id: "built", label: "Ha costruito" },
    { id: "tooExpensive", label: "Non ci sono abbastanza soldi" },
  ],
  conditions: {
    isFree: { label: "È libera", test: (self) => !self.data.built },
  },
  actions: { build: { label: "Costruisci", run: (self) => build(self) } },
  init(self) {
    self.data.built = false;
    self.data.hover = false;
  },
  update(self) {
    const d = self.data;
    if (d.built) return;
    const ptr = self.game.input.pointer;
    if (!ptr.moved && !ptr.pressed) return;
    const v = self.game.renderer.toVirtual(ptr.x, ptr.y);
    const cam = self.scene.camera;
    const wx = cam.left + v.x / cam.zoom;
    const wy = cam.top + v.y / cam.zoom;
    const e = self.entity;
    const h = self.props.size / 2;
    // Il quadrato della piazzola ha il lato basso sui piedi dell'oggetto, come uno sprite.
    d.hover = Math.abs(wx - e.worldX) <= h && Math.abs(wy - (e.worldY - h)) <= h;
    if (d.hover && ptr.pressed) build(self);
  },
  render(self, r) {
    if (self.data.built) return;
    const e = self.entity;
    const s = self.props.size;
    const c = hexColor(self.props.color, self.data.hover ? 0.95 : 0.45);
    r.strokeRect(e.worldX - s / 2, e.worldY - s, s, s, 1, c);
    r.rect(e.worldX - 3, e.worldY - s / 2 - 0.5, 6, 1, c);
    r.rect(e.worldX - 0.5, e.worldY - s / 2 - 3, 1, 6, c);
  },
  renderScreen(self, r) {
    const p = self.props;
    if (self.data.built || !self.data.hover) return;
    const { x, y } = screenPos(self, false);
    const enough = !p.variable || Number(self.game.vars[p.variable] ?? 0) >= p.cost;
    r.text(String(p.cost), x, y - p.size - 10, { size: 7, align: "center", color: enough ? "#fff3a6" : "#e5695f", shadow: true });
  },
});

// ------------------------------------------------------------------ Ondate

function spawnOne(self: BlockInstance) {
  const p = self.props;
  const d = self.data;
  const special = !!p.altPrefab && p.altEvery > 0 && d.wave >= 2 && (d.spawnedInWave + 1) % p.altEvery === 0;
  const e = self.entity;
  const made = self.scene.spawn(special ? p.altPrefab : p.prefab, e.worldX, e.worldY);
  d.left--;
  d.spawnedInWave++;
  if (!made) return;
  d.alive.push(made);
  self.emit("spawned", made);
}

defineBlock({
  name: "Waves",
  label: "Ondate",
  category: "Gameplay",
  description:
    "Crea i nemici a ondate: in ogni ondata ne escono alcuni, uno dopo l'altro, poi c'è una pausa e l'ondata dopo è più numerosa. Avvisa quando le ondate sono finite e tutti i nemici sono spariti. Il numero dell'ondata può finire in una variabile per l'HUD.",
  priority: 40,
  props: {
    prefab: { type: "prefab", label: "Modello da creare", default: "" },
    altPrefab: {
      type: "prefab",
      label: "Nemico speciale",
      default: "",
      optional: true,
      help: "Facoltativo: dalla seconda ondata prende il posto di un nemico ogni tanto.",
    },
    altEvery: { type: "integer", label: "Uno ogni", default: 3, min: 0, help: "0 = mai." },
    waves: { type: "integer", label: "Ondate", default: 5, min: 1 },
    count: { type: "integer", label: "Nemici nella prima ondata", default: 5, min: 1 },
    increase: { type: "integer", label: "In più a ogni ondata", default: 2, min: 0 },
    interval: { type: "number", label: "Tempo tra un nemico e l'altro", unit: "s", default: 1, min: 0.05, step: 0.1 },
    pause: { type: "number", label: "Pausa tra le ondate", unit: "s", default: 5, min: 0, step: 0.5 },
    startDelay: { type: "number", label: "Il primo dopo", unit: "s", default: 3, min: 0, step: 0.5 },
    variable: { type: "variable", label: "Mostra nella variabile", default: "", optional: true },
  },
  events: [
    { id: "waveStarted", label: "Inizia un'ondata" },
    { id: "spawned", label: "Ha creato un oggetto" },
    { id: "cleared", label: "Tutte le ondate sono finite" },
  ],
  conditions: {
    isDone: { label: "Le ondate sono finite", test: (self) => !!self.data.cleared },
  },
  actions: { next: { label: "Fai partire subito l'ondata", run: (self) => (self.data.timer = 0) } },
  init(self) {
    const d = self.data;
    d.wave = 0;
    d.left = 0;
    d.spawnedInWave = 0;
    d.timer = self.props.startDelay;
    d.alive = [];
    d.cleared = false;
  },
  update(self, dt) {
    const p = self.props;
    const d = self.data;
    d.alive = (d.alive as Entity[]).filter((e) => !e.destroyed);
    if (d.cleared) return;
    d.timer -= dt;
    if (d.left > 0) {
      if (d.timer > 1e-6) return;
      spawnOne(self);
      d.timer = d.left > 0 ? p.interval : p.pause;
      return;
    }
    if (d.wave >= p.waves) {
      if (d.alive.length === 0) {
        d.cleared = true;
        self.emit("cleared");
      }
      return;
    }
    if (d.timer > 1e-6) return;
    d.wave++;
    d.left = p.count + (d.wave - 1) * p.increase;
    d.spawnedInWave = 0;
    d.timer = 0;
    if (p.variable) self.game.vars[p.variable] = d.wave;
    self.emit("waveStarted", d.wave);
  },
});

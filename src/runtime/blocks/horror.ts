import { defineBlock, type BlockInstance } from "../core/block";
import type { Entity } from "../core/entity";
import { clamp, hexColor } from "../math";
import { lineOfSight } from "../world/pathfinding";
import { findPath, type Cell } from "../world/pathfinding";
import { bodyCenter, facingVector, nearestTagged } from "./targets";

/**
 * Blocchi da gioco della paura: una torcia che consuma la batteria e illumina solo davanti,
 * qualcuno che ti cerca al buio seguendo i rumori, il coraggio che cala restando nel buio
 * e i nascondigli dove sparire finché non passa il pericolo.
 */

// ------------------------------------------------------------------ Torcia

defineBlock({
  name: "Flashlight",
  label: "Torcia",
  category: "Effetti",
  description:
    "Illumina solo davanti a sé, nella direzione in cui l'oggetto guarda, con un piccolo alone intorno. Si accende e si spegne con un comando e può consumare la batteria di una variabile: quando finisce, si spegne. Si vede quando la scena ha la «Luce ambiente» attiva.",
  priority: 85,
  props: {
    range: { type: "number", label: "Lunghezza del fascio", unit: "tile", default: 5, min: 0.5, step: 0.5 },
    spread: { type: "number", label: "Larghezza del fascio", unit: "tile", default: 1.6, min: 0.2, step: 0.2 },
    halo: { type: "number", label: "Alone intorno", unit: "tile", default: 1.2, min: 0, step: 0.2 },
    color: { type: "color", label: "Colore", default: "#ffeec2" },
    intensity: { type: "number", label: "Intensità", default: 1, min: 0.1, max: 3, step: 0.1 },
    command: { type: "input", label: "Accendi e spegni con", default: "item", optional: true, help: "Vuoto = sempre accesa." },
    battery: { type: "variable", label: "Batteria nella variabile", default: "", optional: true, help: "Da 100 a 0: quando arriva a 0 la torcia si spegne." },
    drain: { type: "number", label: "Consumo", unit: "al secondo", default: 2, min: 0, step: 0.5 },
    offsetY: { type: "number", label: "Altezza della torcia", unit: "px", default: -8 },
  },
  events: [
    { id: "switched", label: "Accesa o spenta" },
    { id: "dead", label: "La batteria è finita" },
  ],
  conditions: {
    isOn: { label: "È accesa", test: (self) => !!self.data.on && battery(self) > 0 },
    isLow: { label: "La batteria sta finendo", test: (self) => battery(self) > 0 && battery(self) < 25 },
  },
  actions: {
    on: { label: "Accendi", run: (self) => void (self.data.on = true) },
    off: { label: "Spegni", run: (self) => void (self.data.on = false) },
    toggle: { label: "Accendi o spegni", run: (self) => void (self.data.on = !self.data.on) },
    charge: {
      label: "Ricarica la batteria",
      params: { amount: { type: "number", label: "Quanta", default: 50, min: 0 } },
      run: (self, amount: number) => {
        const v = String(self.props.battery ?? "");
        if (!v) return;
        self.game.vars[v] = clamp(Number(self.game.vars[v] ?? 0) + Number(amount), 0, 100);
      },
    },
  },
  init(self) {
    self.data.on = true;
    self.data.flicker = 0;
  },
  update(self, dt) {
    const p = self.props;
    const d = self.data;
    if (p.command && self.game.input.pressed(p.command)) {
      d.on = !d.on;
      self.emit("switched", { on: d.on });
    }
    if (!d.on) return;
    const v = String(p.battery ?? "");
    if (!v || self.entity.hiding) return;
    const left = Number(self.game.vars[v] ?? 0);
    if (left <= 0) {
      d.on = false;
      self.emit("dead");
      return;
    }
    self.game.vars[v] = Math.max(0, left - p.drain * dt);
  },
  renderLight(self, r) {
    const d = self.data;
    const p = self.props;
    const e = self.entity;
    const charge = battery(self);
    if (!d.on || charge <= 0) return;
    const ts = self.scene.tileSize;
    const c = bodyCenter(e);
    const y = c.y + Number(p.offsetY) - e.elevation;
    // Con poca batteria la luce trema e si abbassa.
    const weak = charge > 0 && charge < 25 ? 0.6 + 0.4 * Math.abs(Math.sin(self.scene.time * 9)) : 1;
    const alpha = Math.min(1, p.intensity) * weak;
    const halo = p.halo * ts;
    if (halo > 0) r.drawUV(r.radial, 0, 0, 1, 1, c.x - halo, y - halo, halo * 2, halo * 2, hexColor(p.color, alpha * 0.8));
    const dir = facingVector(e);
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const dist = t * p.range * ts;
      const rad = (0.4 + t * p.spread) * ts;
      const x = c.x + dir.x * dist;
      const yy = y + dir.y * dist;
      r.drawUV(r.radial, 0, 0, 1, 1, x - rad, yy - rad, rad * 2, rad * 2, hexColor(p.color, alpha * (1 - t * 0.6) * 0.7));
    }
  },
});

/** Quanta batteria resta (100 se la torcia non ne usa). */
function battery(self: BlockInstance): number {
  const v = String(self.props.battery ?? "");
  return v ? Number(self.game.vars[v] ?? 0) : 100;
}

// ------------------------------------------------------------------ Inseguitore

/** Il bersaglio si può vedere? (non nascosto, dentro il cono, senza muri in mezzo) */
function canSee(self: BlockInstance, target: Entity): boolean {
  const p = self.props;
  const e = self.entity;
  const ts = self.scene.tileSize;
  if (target.hasTag(String(p.ignoreTag))) return false;
  const from = bodyCenter(e);
  const to = bodyCenter(target);
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  if (dist > p.seeRange * ts) return false;
  const dir = facingVector(e);
  const nx = (to.x - from.x) / (dist || 1);
  const ny = (to.y - from.y) / (dist || 1);
  const cos = dir.x * nx + dir.y * ny;
  if (cos < Math.cos((Number(p.fov) * Math.PI) / 360)) return false;
  return lineOfSight(self.scene.grid, from.x, from.y, to.x, to.y);
}

/** Quanto rumore fa il bersaglio adesso: fermo quasi niente, di corsa tanto. */
function noiseOf(target: Entity): number {
  const b = target.body;
  if (!b) return 0;
  return Math.hypot(b.vx, b.vy);
}

defineBlock({
  name: "Stalker",
  label: "Ti cerca al buio",
  category: "IA",
  description:
    "Gira per la scena finché non ti sente o non ti vede: i rumori lo portano nel punto giusto, la vista lo fa partire all'inseguimento. Se ti perde, cerca ancora un po' e poi torna a vagare. Chi è nascosto non viene né visto né sentito. Imposta il controller su «IA o Regole».",
  requires: ["Body"],
  priority: 12,
  props: {
    target: { type: "tag", label: "Cerca chi ha l'etichetta", default: "giocatore" },
    ignoreTag: { type: "tag", label: "Non vede chi ha l'etichetta", default: "nascosto" },
    seeRange: { type: "number", label: "Vede fino a", unit: "tile", default: 6, min: 0, step: 0.5 },
    fov: { type: "number", label: "Ampiezza dello sguardo", unit: "°", default: 110, min: 20, max: 360, step: 10 },
    hearRange: { type: "number", label: "Sente fino a", unit: "tile", default: 5, min: 0, step: 0.5 },
    hearSpeed: {
      type: "number",
      label: "Rumore minimo",
      unit: "tile/s",
      default: 2,
      min: 0,
      step: 0.5,
      help: "Chi si muove più piano di così non fa rumore.",
    },
    wanderSpeed: { type: "number", label: "Velocità mentre vaga", unit: "tile/s", default: 1.2, min: 0, step: 0.2 },
    chaseSpeed: { type: "number", label: "Velocità mentre insegue", unit: "tile/s", default: 2.6, min: 0, step: 0.2 },
    patience: { type: "number", label: "Cerca ancora per", unit: "s", default: 4, min: 0, step: 0.5 },
  },
  states: [
    { id: "idle", label: "Fermo" },
    { id: "walk", label: "Vaga" },
  ],
  events: [
    { id: "heard", label: "Ha sentito un rumore" },
    { id: "spotted", label: "Ti ha visto" },
    { id: "lost", label: "Ti ha perso" },
  ],
  conditions: {
    isHunting: { label: "Sta dando la caccia", test: (self) => self.data.mode === "hunt" },
    isCalm: { label: "Non si è accorto di niente", test: (self) => self.data.mode === "wander" },
  },
  actions: {
    alert: {
      label: "Insospettiscilo",
      run: (self) => {
        const t = nearestTagged(self.scene, self.entity, String(self.props.target));
        if (!t) return;
        self.data.goal = bodyCenter(t);
        self.data.mode = "search";
        self.data.patience = Number(self.props.patience);
      },
    },
  },
  init(self) {
    self.data.mode = "wander";
    self.data.goal = null;
    self.data.patience = 0;
    self.data.repath = 0;
    self.data.path = null;
  },
  update(self, dt) {
    const e = self.entity;
    const b = e.body;
    if (!b) return;
    const p = self.props;
    const d = self.data;
    const ts = self.scene.tileSize;
    const it = e.intent;
    it.jump = it.jumpPressed = false;
    const target = nearestTagged(self.scene, e, String(p.target));
    const from = bodyCenter(e);

    // Vista e udito.
    if (target && canSee(self, target)) {
      if (d.mode !== "hunt") self.emit("spotted", target);
      d.mode = "hunt";
      d.patience = Number(p.patience);
      d.goal = bodyCenter(target);
    } else if (target && !target.hasTag(String(p.ignoreTag))) {
      const to = bodyCenter(target);
      const dist = Math.hypot(to.x - from.x, to.y - from.y);
      const noise = noiseOf(target) / ts;
      if (dist <= p.hearRange * ts && noise >= p.hearSpeed) {
        if (d.mode === "wander") self.emit("heard", target);
        if (d.mode !== "hunt") d.mode = "search";
        d.goal = to;
        d.patience = Number(p.patience);
      }
    }
    if (d.mode === "hunt" && (!target || !canSee(self, target))) {
      d.mode = "search";
      self.emit("lost");
    }
    if (d.mode !== "wander") {
      d.patience -= dt;
      if (d.patience <= 0) {
        d.mode = "wander";
        d.goal = null;
      }
    }
    // Dove andare: il posto del rumore, oppure un angolo a caso della scena.
    if (!d.goal) {
      const g = self.scene.grid;
      for (let tries = 0; tries < 20 && !d.goal; tries++) {
        const gx = Math.floor(Math.random() * g.cols);
        const gy = Math.floor(Math.random() * g.rows);
        if (g.get(gx, gy) === 0) d.goal = { x: gx * ts + ts / 2, y: gy * ts + ts / 2 };
      }
      d.path = null;
    }
    const goal = d.goal as { x: number; y: number } | null;
    if (!goal) {
      it.x = it.y = 0;
      self.state = "idle";
      return;
    }
    if (Math.hypot(goal.x - from.x, goal.y - from.y) < ts * 0.4) {
      d.goal = null;
      it.x = it.y = 0;
      self.state = "idle";
      return;
    }
    // Strada tra i muri, ricalcolata ogni tanto.
    d.repath -= dt;
    if (d.repath <= 0 || !d.path) {
      d.repath = 0.4;
      d.path = findPath(self.scene.grid, Math.floor(from.x / ts), Math.floor(from.y / ts), Math.floor(goal.x / ts), Math.floor(goal.y / ts), {
        diagonal: true,
      });
    }
    let wx = goal.x;
    let wy = goal.y;
    const path = d.path as Cell[] | null;
    if (path && path.length > 1) {
      while (path.length > 1 && Math.hypot((path[0].x + 0.5) * ts - from.x, (path[0].y + 0.5) * ts - from.y) < ts * 0.3) path.shift();
      wx = (path[0].x + 0.5) * ts;
      wy = (path[0].y + 0.5) * ts;
    }
    const dx = wx - from.x;
    const dy = wy - from.y;
    const len = Math.hypot(dx, dy) || 1;
    it.x = dx / len;
    it.y = dy / len;
    self.state = "walk";
    // La velocità la decide il controller: qui si cambia solo quella scelta.
    const ctrl = e.get("TopDownController") ?? e.get("PlatformController");
    if (ctrl) ctrl.props.speed = d.mode === "hunt" ? p.chaseSpeed : p.wanderSpeed;
  },
  renderDebug(self, r) {
    const e = self.entity;
    const c = bodyCenter(e);
    const ts = self.scene.tileSize;
    const goal = self.data.goal as { x: number; y: number } | null;
    r.strokeRect(c.x - self.props.hearRange * ts, c.y - self.props.hearRange * ts, self.props.hearRange * ts * 2, self.props.hearRange * ts * 2, 1, hexColor("#8fd3ff", 0.3));
    if (goal) r.rect(goal.x - 2, goal.y - 2, 4, 4, hexColor("#ff4a4a", 0.7));
  },
});

// ------------------------------------------------------------------ Coraggio

defineBlock({
  name: "Sanity",
  label: "Coraggio",
  category: "Gameplay",
  description:
    "Una barra di coraggio che cala quando si resta al buio o quando il mostro è vicino, e risale nella luce o dentro un nascondiglio. Quando scende sotto la soglia lo schermo pulsa e parte un evento per le Regole; a zero parte l'evento «Il coraggio è finito».",
  priority: 60,
  props: {
    variable: { type: "variable", label: "Coraggio nella variabile", default: "coraggio" },
    max: { type: "number", label: "Coraggio massimo", default: 100, min: 1 },
    darkLoss: { type: "number", label: "Quanto cala al buio", unit: "al secondo", default: 4, min: 0, step: 0.5 },
    fearRange: { type: "number", label: "Il mostro fa paura entro", unit: "tile", default: 4, min: 0, step: 0.5 },
    fearLoss: { type: "number", label: "Quanto cala vicino al mostro", unit: "al secondo", default: 8, min: 0, step: 0.5 },
    monster: { type: "tag", label: "Chi fa paura", default: "mostro" },
    recover: { type: "number", label: "Quanto risale nella luce", unit: "al secondo", default: 3, min: 0, step: 0.5 },
    low: { type: "number", label: "Soglia della paura", default: 30, min: 0 },
    pulse: { type: "boolean", label: "Lo schermo pulsa quando hai paura", default: true },
  },
  events: [
    { id: "scared", label: "Il coraggio è sceso sotto la soglia" },
    { id: "calm", label: "Il coraggio è tornato su" },
    { id: "empty", label: "Il coraggio è finito" },
  ],
  conditions: {
    isScared: { label: "Ha paura", test: (self) => Number(self.game.vars[self.props.variable] ?? 0) < self.props.low },
  },
  actions: {
    restore: {
      label: "Ridai coraggio",
      params: { amount: { type: "number", label: "Quanto", default: 25, min: 0 } },
      run: (self, amount: number) => {
        const v = String(self.props.variable);
        self.game.vars[v] = clamp(Number(self.game.vars[v] ?? 0) + Number(amount), 0, self.props.max);
      },
    },
  },
  init(self) {
    const p = self.props;
    if (p.variable) self.game.vars[p.variable] = p.max;
    self.data.scared = false;
    self.data.emptyDone = false;
  },
  update(self, dt) {
    const p = self.props;
    const d = self.data;
    const e = self.entity;
    const v = String(p.variable);
    if (!v) return;
    let value = Number(self.game.vars[v] ?? p.max);
    // Al buio quando la torcia è spenta (o non c'è) e nessuna luce accesa è vicina.
    const torch = e.get("Flashlight");
    const lit = torch ? torch.test("isOn") : !!e.get("Light")?.data.on;
    const ts = self.scene.tileSize;
    const near = nearestTagged(self.scene, e, String(p.monster), p.fearRange * ts);
    const dark = !!self.scene.ambient && !lit;
    // Nascosti ci si sente al sicuro: il coraggio risale anche al buio e con il mostro vicino.
    if (e.hiding) value += p.recover * dt;
    else if (near) value -= p.fearLoss * dt;
    else if (dark) value -= p.darkLoss * dt;
    else value += p.recover * dt;
    value = clamp(value, 0, p.max);
    self.game.vars[v] = value;

    const scared = value < p.low;
    if (scared !== d.scared) {
      d.scared = scared;
      self.emit(scared ? "scared" : "calm");
    }
    if (value <= 0 && !d.emptyDone) {
      d.emptyDone = true;
      self.emit("empty");
    }
    if (value > 0) d.emptyDone = false;
  },
  renderScreen(self, r) {
    const p = self.props;
    if (!p.pulse) return;
    const value = Number(self.game.vars[p.variable] ?? p.max);
    if (value >= p.low) return;
    // Più il coraggio è basso, più i bordi pulsano di rosso.
    const k = 1 - value / Math.max(1, p.low);
    const a = (0.1 + 0.25 * k) * (0.6 + 0.4 * Math.sin(self.scene.time * 4));
    const band = 24;
    const color = hexColor("#6a0f14", Math.max(0, a));
    r.rect(0, 0, r.width, band, color);
    r.rect(0, r.height - band, r.width, band, color);
    r.rect(0, 0, band, r.height, color);
    r.rect(r.width - band, 0, band, r.height, color);
  },
});

// ------------------------------------------------------------------ Nascondiglio

defineBlock({
  name: "HidingSpot",
  label: "Nascondiglio",
  category: "Gameplay",
  description:
    "Un armadio, un cespuglio, un bidone: il giocatore vicino preme Azione e si nasconde dentro. Mentre è nascosto non si vede, non si muove, chi lo cerca non lo trova e non può colpirlo. Si esce premendo di nuovo Azione.",
  priority: 55,
  props: {
    target: { type: "tag", label: "Chi si può nascondere", default: "giocatore" },
    range: { type: "number", label: "Distanza per entrare", unit: "tile", default: 1, min: 0.2, step: 0.2 },
    command: { type: "input", label: "Comando", default: "action" },
    hideTag: { type: "tag", label: "Etichetta di chi è nascosto", default: "nascosto", help: "Chi cerca al buio non vede chi ha questa etichetta." },
    sound: { type: "audio", label: "Suono", default: "", optional: true },
  },
  events: [
    { id: "entered", label: "Qualcuno si è nascosto" },
    { id: "left", label: "È uscito dal nascondiglio" },
  ],
  conditions: {
    isUsed: { label: "C'è qualcuno dentro", test: (self) => !!self.data.who },
  },
  actions: { leave: { label: "Fallo uscire", run: (self) => leaveSpot(self) } },
  init(self) {
    self.data.who = null;
  },
  update(self) {
    const p = self.props;
    const d = self.data;
    const e = self.entity;
    const ts = self.scene.tileSize;
    const pressed = self.game.input.pressed(String(p.command));
    const who = d.who as Entity | null;
    if (who) {
      // Mentre è dentro resta fermo e invisibile.
      who.x = e.worldX;
      who.y = e.worldY;
      who.stunned = Math.max(who.stunned, 0.2);
      if (who.body) {
        who.body.vx = 0;
        who.body.vy = 0;
      }
      if (pressed) leaveSpot(self);
      return;
    }
    if (!pressed) return;
    const target = nearestTagged(self.scene, e, String(p.target), p.range * ts + 8);
    if (!target || target.hasTag(String(p.hideTag))) return;
    d.who = target;
    target.tags.add(String(p.hideTag));
    target.visible = false;
    target.hiding = true;
    if (p.sound) self.game.audio.play(String(p.sound));
    self.emit("entered", target);
  },
  destroy(self) {
    leaveSpot(self);
  },
});

/** Fa uscire chi è nascosto: torna visibile e perde l'etichetta. */
function leaveSpot(self: BlockInstance): void {
  const who = self.data.who as Entity | null;
  if (!who) return;
  self.data.who = null;
  who.tags.delete(String(self.props.hideTag));
  who.visible = true;
  who.hiding = false;
  who.stunned = 0;
  self.emit("left", who);
}

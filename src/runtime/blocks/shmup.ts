import { defineBlock, type BlockInstance } from "../core/block";
import type { Camera } from "../core/camera";
import type { Entity } from "../core/entity";
import { clamp } from "../math";
import { INPUT_SOURCE_OPTIONS } from "./platform";
import { bodyCenter, nearestTagged } from "./targets";

// Blocchi per gli shoot'em up: lo schermo che scorre da solo, la navicella e le traiettorie dei nemici.

const DIRS: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/** Dove può stare il centro della camera perché lo schermo resti dentro la scena. */
function cameraLimits(self: BlockInstance) {
  const cam = self.scene.camera;
  const W = self.scene.widthPx;
  const H = self.scene.heightPx;
  return {
    minX: Math.min(cam.halfW, W / 2),
    maxX: Math.max(W - cam.halfW, W / 2),
    minY: Math.min(cam.halfH, H / 2),
    maxY: Math.max(H - cam.halfH, H / 2),
  };
}

/** L'oggetto è dentro lo schermo (allargato di `margin` pixel per lato)? */
const onScreen = (e: Entity, cam: Camera, margin: number) =>
  Math.abs(e.worldX - cam.x) <= cam.halfW + margin && Math.abs(e.worldY - cam.y) <= cam.halfH + margin;

/** Mette l'oggetto in un punto del mondo, anche se è figlio di un altro oggetto. */
function placeAt(e: Entity, x: number, y: number) {
  e.x += x - e.worldX;
  e.y += y - e.worldY;
}

// ------------------------------------------------------------------ Scorrimento automatico

defineBlock({
  name: "AutoScroll",
  label: "Scorrimento automatico",
  category: "Camera",
  description:
    "La camera avanza da sola a velocità costante nella direzione scelta. Mettilo su un oggetto vuoto: l'oggetto viaggia con lo schermo, quindi può portare anche le Particelle per le stelle.",
  priority: 90,
  props: {
    direction: {
      type: "select",
      label: "Direzione",
      default: "up",
      options: [
        { value: "up", label: "Verso l'alto" },
        { value: "down", label: "Verso il basso" },
        { value: "right", label: "Verso destra" },
        { value: "left", label: "Verso sinistra" },
      ],
    },
    speed: { type: "number", label: "Velocità", unit: "tile/s", default: 1.5, min: 0, step: 0.25 },
    startDelay: { type: "number", label: "Parte dopo", unit: "s", default: 0, min: 0, step: 0.5 },
  },
  events: [{ id: "end", label: "È arrivato alla fine della scena" }],
  conditions: {
    isScrolling: { label: "Sta scorrendo", test: (self) => !self.data.done && !self.data.stopped },
  },
  actions: {
    stop: { label: "Ferma lo scorrimento", run: (self) => (self.data.stopped = true) },
    start: { label: "Riprendi lo scorrimento", run: (self) => (self.data.stopped = false) },
  },
  init(self) {
    const cam = self.scene.camera;
    const l = cameraLimits(self);
    cam.x = clamp(self.entity.worldX, l.minX, l.maxX);
    cam.y = clamp(self.entity.worldY, l.minY, l.maxY);
    self.data.t = 0;
    self.data.done = false;
    self.data.stopped = false;
  },
  late(self, dt) {
    const d = self.data;
    const p = self.props;
    if (d.done || d.stopped) return;
    d.t += dt;
    if (d.t < p.startDelay) return;
    const [dx, dy] = DIRS[p.direction] ?? DIRS.up;
    const cam = self.scene.camera;
    const l = cameraLimits(self);
    const step = p.speed * self.scene.tileSize * dt;
    const nx = clamp(cam.x + dx * step, l.minX, l.maxX);
    const ny = clamp(cam.y + dy * step, l.minY, l.maxY);
    // L'oggetto viaggia con lo schermo (stelle, sfondi, generatori attaccati).
    self.entity.x += nx - cam.x;
    self.entity.y += ny - cam.y;
    cam.x = nx;
    cam.y = ny;
    const atEnd = (dx > 0 && nx >= l.maxX) || (dx < 0 && nx <= l.minX) || (dy > 0 && ny >= l.maxY) || (dy < 0 && ny <= l.minY);
    if (atEnd) {
      d.done = true;
      self.emit("end");
    }
  },
});

// ------------------------------------------------------------------ Navicella

defineBlock({
  name: "ShipController",
  label: "Controller Navicella",
  category: "Movimento",
  description:
    "Movimento libero in 8 direzioni dentro i bordi dello schermo: l'oggetto non esce mai dalla vista e, se lo schermo scorre da solo, viene portato avanti con lui.",
  requires: ["Body"],
  priority: 20,
  props: {
    input: { type: "select", label: "Comandato da", default: "player", options: INPUT_SOURCE_OPTIONS },
    speed: { type: "number", label: "Velocità", unit: "tile/s", default: 7, min: 0, step: 0.5 },
    focus: { type: "input", label: "Rallenta tenendo premuto", default: "dash", help: "Movimento di precisione per schivare i proiettili." },
    focusSpeed: { type: "number", label: "Velocità rallentata", unit: "tile/s", default: 3, min: 0, step: 0.5 },
    margin: { type: "number", label: "Distanza dal bordo", unit: "px", default: 4, min: 0 },
    followScroll: { type: "boolean", label: "Si muove con lo schermo", default: true },
  },
  states: [
    { id: "idle", label: "Fermo" },
    { id: "left", label: "Va a sinistra" },
    { id: "right", label: "Va a destra" },
  ],
  init(self) {
    self.data.camX = self.scene.camera.x;
    self.data.camY = self.scene.camera.y;
  },
  update(self, dt) {
    const b = self.body;
    if (!b) return;
    const e = self.entity;
    const p = self.props;
    const d = self.data;
    const cam = self.scene.camera;
    if (p.followScroll) {
      e.x += cam.x - d.camX;
      e.y += cam.y - d.camY;
    }
    d.camX = cam.x;
    d.camY = cam.y;
    if (p.input === "player") self.game.input.readIntent(e.intent);
    if (e.stunned > 0) {
      e.stunned -= dt;
      return;
    }
    let x = e.intent.x;
    let y = e.intent.y;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    const slow = p.input === "player" && !!p.focus && self.game.input.isDown(p.focus);
    const speed = (slow ? p.focusSpeed : p.speed) * self.scene.tileSize * self.entity.boost("speed");
    b.vx = x * speed;
    b.vy = y * speed;
    if (x !== 0) e.facingX = x > 0 ? 1 : -1;
    self.state = x < -0.1 ? "left" : x > 0.1 ? "right" : "idle";
  },
  late(self) {
    const b = self.body;
    if (!b) return;
    const e = self.entity;
    const cam = self.scene.camera;
    const d = self.data;
    // Se lo scorrimento ha già mosso la camera in questo passo, la navicella la segue subito (niente ritardo).
    if (self.props.followScroll) {
      e.x += cam.x - d.camX;
      e.y += cam.y - d.camY;
      // Ferma, resta a pixel interi rispetto allo schermo: così non trema mentre lo schermo scorre.
      if (e.intent.x === 0 && e.intent.y === 0) {
        e.x = cam.x + Math.round(e.x - cam.x);
        e.y = cam.y + Math.round(e.y - cam.y);
      }
    }
    d.camX = cam.x;
    d.camY = cam.y;
    const m = self.props.margin;
    const r = b.rect();
    const left = cam.x - cam.halfW + m;
    const right = cam.x + cam.halfW - m;
    const top = cam.y - cam.halfH + m;
    const bottom = cam.y + cam.halfH - m;
    if (r.x < left) e.x += left - r.x;
    else if (r.x + r.w > right) e.x -= r.x + r.w - right;
    if (r.y < top) e.y += top - r.y;
    else if (r.y + r.h > bottom) e.y -= r.y + r.h - bottom;
  },
});

// ------------------------------------------------------------------ Traiettoria

function start(self: BlockInstance) {
  const d = self.data;
  const p = self.props;
  const e = self.entity;
  d.active = true;
  d.stopped = false;
  d.t = 0;
  d.x0 = e.worldX;
  d.y0 = e.worldY;
  let angle = (p.direction * Math.PI) / 180;
  if (p.pattern === "dive") {
    const t = nearestTagged(self.scene, e, p.target);
    if (t) {
      const a = bodyCenter(e);
      const c = bodyCenter(t);
      angle = Math.atan2(c.y - a.y, c.x - a.x);
    }
  }
  d.angle = angle;
  self.emit("started");
}

defineBlock({
  name: "MovePattern",
  label: "Traiettoria",
  category: "Movimento",
  description:
    "Muove l'oggetto da solo lungo una traiettoria: dritto, a onda, in picchiata verso il bersaglio o in cerchio. Per tutto ciò che si muove senza controller.",
  priority: 21,
  props: {
    pattern: {
      type: "select",
      label: "Traiettoria",
      default: "straight",
      options: [
        { value: "straight", label: "Dritto" },
        { value: "wave", label: "A onda" },
        { value: "dive", label: "In picchiata verso il bersaglio" },
        { value: "circle", label: "In cerchio" },
      ],
    },
    direction: { type: "number", label: "Direzione", unit: "°", default: 90, step: 15, help: "-90 = verso l'alto, 0 = destra, 90 = giù, 180 = sinistra." },
    speed: { type: "number", label: "Velocità", unit: "tile/s", default: 2, min: 0, step: 0.5 },
    amplitude: {
      type: "number",
      label: "Ampiezza",
      unit: "tile",
      default: 1.5,
      min: 0,
      step: 0.5,
      help: "A onda e in cerchio: quanto si allontana dalla linea dritta.",
    },
    frequency: { type: "number", label: "Frequenza", unit: "Hz", default: 0.5, min: 0, step: 0.1 },
    target: { type: "tag", label: "Bersaglio", default: "giocatore" },
    waitOnScreen: { type: "boolean", label: "Parte quando entra nello schermo", default: true },
    leaveScreen: { type: "boolean", label: "Sparisce quando esce dallo schermo", default: true },
  },
  events: [
    { id: "started", label: "È partito" },
    { id: "leftScreen", label: "È uscito dallo schermo" },
  ],
  conditions: {
    isMoving: { label: "Si sta muovendo", test: (self) => !!self.data.active },
  },
  actions: {
    start: { label: "Parti", run: (self) => start(self) },
    stop: {
      label: "Fermati",
      run: (self) => {
        self.data.active = false;
        self.data.stopped = true;
      },
    },
  },
  init(self) {
    self.data.active = false;
    self.data.seen = false;
    if (!self.props.waitOnScreen) start(self);
  },
  update(self, dt) {
    const e = self.entity;
    const d = self.data;
    const p = self.props;
    const cam = self.scene.camera;
    const ts = self.scene.tileSize;
    const visible = onScreen(e, cam, ts);
    if (!d.active) {
      if (d.stopped || !p.waitOnScreen || !visible || d.t !== undefined) return;
      start(self);
    }
    d.t += dt;
    const t = d.t;
    const ux = Math.cos(d.angle);
    const uy = Math.sin(d.angle);
    // Perpendicolare alla direzione: di lì si allontana l'onda.
    const px = -uy;
    const py = ux;
    const dist = p.speed * ts * t;
    const amp = p.amplitude * ts;
    const w = 2 * Math.PI * p.frequency;
    let ox = ux * dist;
    let oy = uy * dist;
    if (p.pattern === "wave") {
      const k = amp * Math.sin(w * t);
      ox += px * k;
      oy += py * k;
    } else if (p.pattern === "circle") {
      // Cerchio di raggio «Ampiezza» che parte dal punto iniziale, trascinato lungo la direzione.
      const a = amp * (1 - Math.cos(w * t));
      const b = amp * Math.sin(w * t);
      ox += ux * a + px * b;
      oy += uy * a + py * b;
    }
    const nx = d.x0 + ox;
    if (Math.abs(nx - e.worldX) > 0.01) e.facingX = nx > e.worldX ? 1 : -1;
    placeAt(e, nx, d.y0 + oy);
    if (e.body) {
      e.body.vx = 0;
      e.body.vy = 0;
    }
    if (visible) d.seen = true;
    else if (d.seen && p.leaveScreen && !onScreen(e, cam, ts * 2)) {
      self.emit("leftScreen");
      e.destroy();
    }
  },
});

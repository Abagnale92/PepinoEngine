import { defineBlock } from "../core/block";
import type { Intent } from "../core/entity";
import { approach, sign } from "../math";
import { COLL } from "../physics/collision";

export const INPUT_SOURCE_OPTIONS = [
  { value: "player", label: "Giocatore (tastiera / gamepad)" },
  { value: "ai", label: "IA o Regole" },
];

export const NO_INTENT: Intent = { x: 0, y: 0, jump: false, jumpPressed: false, dashPressed: false, actionPressed: false };

/**
 * Controller per platform. I parametri sono in tile e secondi:
 * da altezza del salto (h) e tempo al vertice (t) si ricava gravità = 2h/t² e spinta = 2h/t.
 */
defineBlock({
  name: "PlatformController",
  label: "Controller Platform",
  category: "Movimento",
  description: "Corsa, salto, doppio salto, dash e scale. Tu scegli altezze e tempi, la fisica la calcola Pepino.",
  requires: ["Body"],
  priority: 20,
  props: {
    input: { type: "select", label: "Comandato da", default: "player", options: INPUT_SOURCE_OPTIONS },
    speed: { type: "number", label: "Velocità", unit: "tile/s", default: 7, min: 0, step: 0.5, group: "Corsa" },
    accelTime: { type: "number", label: "Tempo per partire", unit: "s", default: 0.08, min: 0, step: 0.01, group: "Corsa" },
    decelTime: { type: "number", label: "Tempo per fermarsi", unit: "s", default: 0.06, min: 0, step: 0.01, group: "Corsa" },
    airControl: { type: "number", label: "Controllo in aria", default: 0.8, min: 0, max: 1, step: 0.05, group: "Corsa" },
    jumpHeight: { type: "number", label: "Altezza salto", unit: "tile", default: 3.5, min: 0, step: 0.25, group: "Salto" },
    timeToApex: { type: "number", label: "Tempo al vertice", unit: "s", default: 0.38, min: 0.05, step: 0.01, group: "Salto" },
    fallMultiplier: { type: "number", label: "Gravità in caduta", unit: "×", default: 1.6, min: 0.5, step: 0.1, group: "Salto" },
    maxFallSpeed: { type: "number", label: "Caduta massima", unit: "tile/s", default: 20, min: 1, group: "Salto" },
    variableJump: { type: "boolean", label: "Salto più basso se rilasci", default: true, group: "Salto" },
    airJumps: { type: "integer", label: "Salti in aria", default: 1, min: 0, max: 5, group: "Salto", help: "1 = doppio salto." },
    coyoteTime: {
      type: "number",
      label: "Coyote time",
      unit: "s",
      default: 0.1,
      min: 0,
      step: 0.01,
      group: "Salto",
      help: "Si può ancora saltare per un attimo dopo aver lasciato il bordo.",
    },
    jumpBuffer: {
      type: "number",
      label: "Memoria del salto",
      unit: "s",
      default: 0.12,
      min: 0,
      step: 0.01,
      group: "Salto",
      help: "Un salto premuto poco prima di atterrare parte comunque.",
    },
    dash: { type: "boolean", label: "Dash attivo", default: true, group: "Dash" },
    dashSpeed: { type: "number", label: "Velocità dash", unit: "tile/s", default: 18, min: 0, group: "Dash" },
    dashTime: { type: "number", label: "Durata dash", unit: "s", default: 0.16, min: 0.02, step: 0.01, group: "Dash" },
    dashCooldown: { type: "number", label: "Attesa tra due dash", unit: "s", default: 0.35, min: 0, step: 0.05, group: "Dash" },
    climbSpeed: { type: "number", label: "Velocità sulle scale", unit: "tile/s", default: 4, min: 0, group: "Scale" },
    jumpSound: { type: "audio", label: "Suono salto", default: "", group: "Suoni" },
    dashSound: { type: "audio", label: "Suono dash", default: "", group: "Suoni" },
  },
  states: [
    { id: "idle", label: "Fermo" },
    { id: "run", label: "Corsa" },
    { id: "jump", label: "Salto" },
    { id: "fall", label: "Caduta" },
    { id: "dash", label: "Dash" },
    { id: "climb", label: "Arrampicata" },
  ],
  events: [
    { id: "jumped", label: "Ha saltato" },
    { id: "landed", label: "È atterrato" },
    { id: "dashed", label: "Ha fatto un dash" },
  ],
  conditions: {
    isOnGround: { label: "È a terra", test: (self) => !!self.body?.onGround },
    isFalling: { label: "Sta cadendo", test: (self) => !!self.body && !self.body.onGround && self.body.vy > 0 },
    isDashing: { label: "Sta facendo un dash", test: (self) => self.data.dashT > 0 },
  },
  actions: {
    jump: { label: "Salta", run: (self) => (self.data.buffer = Math.max(self.props.jumpBuffer, 0.05)) },
    stop: { label: "Fermati", run: (self) => self.body && (self.body.vx = 0) },
  },
  init(self) {
    Object.assign(self.data, {
      coyote: 0,
      buffer: 0,
      airJumpsLeft: 0,
      dashT: 0,
      dashCd: 0,
      dashDir: 1,
      airDashUsed: false,
      climbing: false,
      jumping: false,
      wasGrounded: true,
    });
  },
  update(self, dt) {
    const b = self.body;
    if (!b) return;
    const e = self.entity;
    const p = self.props;
    const d = self.data;
    const ts = self.scene.tileSize;

    if (p.input === "player") self.game.input.readIntent(e.intent);
    const stunned = e.stunned > 0;
    if (stunned) e.stunned -= dt;
    const it = stunned ? NO_INTENT : e.intent;

    const h = p.jumpHeight * ts;
    const t = Math.max(0.05, p.timeToApex);
    const gravity = (2 * h) / (t * t);
    // Spinta corretta per il passo fisso: la formula continua 2h/t perderebbe ~h·dt/t in altezza.
    const halfStep = (gravity * dt) / 2;
    const jumpV = halfStep + Math.sqrt(halfStep * halfStep + 2 * gravity * h);
    const speed = p.speed * ts;
    const grounded = b.onGround;

    if (grounded) {
      d.coyote = p.coyoteTime;
      d.airJumpsLeft = p.airJumps;
      d.airDashUsed = false;
      if (!d.wasGrounded) self.emit("landed");
    } else {
      d.coyote -= dt;
    }
    d.wasGrounded = grounded;
    d.buffer = it.jumpPressed ? Math.max(p.jumpBuffer, 1e-4) : d.buffer - dt;
    d.dashCd -= dt;

    // --- Scale ---
    const ladderBelow = grounded && self.scene.grid.atPixel(e.worldX, b.bottom + 1) === COLL.ladder;
    const canClimb = b.onLadder || ladderBelow;
    if (!d.climbing && canClimb && d.dashT <= 0 && (it.y < 0 || (it.y > 0 && (ladderBelow || !grounded)))) {
      d.climbing = true;
    }
    if (d.climbing) {
      if (!canClimb || it.jumpPressed || (grounded && it.y > 0 && !ladderBelow)) {
        d.climbing = false;
      } else {
        if (ladderBelow && it.y > 0) b.dropThrough = 0.2;
        b.vx = it.x * speed * 0.4;
        b.vy = it.y * p.climbSpeed * ts;
        if (it.x === 0 && b.onLadder) e.x += (b.ladderX - e.worldX) * Math.min(1, dt * 12);
        self.state = "climb";
        return;
      }
    }

    // --- Dash ---
    if (d.dashT > 0) {
      d.dashT -= dt;
      b.vx = d.dashDir * p.dashSpeed * ts;
      b.vy = 0;
      if (d.dashT <= 0) b.vx = d.dashDir * speed;
      self.state = "dash";
      return;
    }
    if (p.dash && it.dashPressed && d.dashCd <= 0 && (grounded || !d.airDashUsed)) {
      d.dashT = p.dashTime;
      d.dashCd = p.dashCooldown + p.dashTime;
      d.dashDir = it.x !== 0 ? sign(it.x) : e.facingX;
      e.facingX = d.dashDir;
      if (!grounded) d.airDashUsed = true;
      b.vx = d.dashDir * p.dashSpeed * ts;
      b.vy = 0;
      self.state = "dash";
      self.emit("dashed");
      if (p.dashSound) self.game.audio.play(p.dashSound);
      return;
    }

    // --- Corsa ---
    if (!stunned) {
      const target = it.x * speed;
      let rate = target !== 0 ? speed / Math.max(p.accelTime, 1e-3) : speed / Math.max(p.decelTime, 1e-3);
      if (!grounded) rate *= p.airControl;
      b.vx = approach(b.vx, target, rate * dt);
      if (it.x !== 0) e.facingX = it.x > 0 ? 1 : -1;
    }

    // --- Salto ---
    if (grounded && b.groundCode === COLL.oneway && it.y > 0 && it.jumpPressed) {
      b.dropThrough = 0.25; // giù + salto: scende dalla piattaforma
      d.buffer = 0;
    }
    if (d.buffer > 0 && (d.coyote > 0 || d.airJumpsLeft > 0)) {
      if (d.coyote > 0) {
        b.vy = -jumpV;
        d.coyote = 0;
      } else {
        b.vy = -jumpV * 0.9;
        d.airJumpsLeft--;
      }
      d.buffer = 0;
      d.jumping = true;
      self.emit("jumped");
      if (p.jumpSound) self.game.audio.play(p.jumpSound, { rate: 0.95 + Math.random() * 0.1 });
    }
    if (d.jumping && b.vy < 0 && !it.jump && p.variableJump) {
      b.vy *= 0.5;
      d.jumping = false;
    }
    if (b.vy >= 0) d.jumping = false;

    // --- Gravità ---
    const g = b.vy > 0 ? gravity * p.fallMultiplier : gravity;
    b.vy = Math.min(b.vy + g * dt, p.maxFallSpeed * ts);

    if (!grounded || b.vy < 0) self.state = b.vy < 0 ? "jump" : "fall";
    else self.state = Math.abs(b.vx) > 1 ? "run" : "idle";
  },
});

import { defineBlock, type BlockInstance } from "../core/block";
import { approach } from "../math";
import { INPUT_SOURCE_OPTIONS, NO_INTENT } from "./platform";

const STEP = 1 / 60;
/** Caduta a terra dopo un colpo forte: gravità, spinta verso l'alto, tempo steso e tempo per rialzarsi. */
const KNOCK_GRAVITY = 900;
const KNOCK_LAUNCH = 170;
const DOWN_TIME = 0.7;
const GETUP_TIME = 0.35;

/** Gravità e spinta del salto, dalla stessa idea del Controller Platform (altezza e tempo al vertice). */
function jumpPhysics(self: BlockInstance) {
  const h = self.props.jumpHeight * self.scene.tileSize;
  const t = Math.max(0.05, self.props.timeToApex);
  const gravity = (2 * h) / (t * t);
  const halfStep = (gravity * STEP) / 2;
  return { gravity, jumpV: halfStep + Math.sqrt(halfStep * halfStep + 2 * gravity * h) };
}

function startJump(self: BlockInstance) {
  const d = self.data;
  if (d.air || d.down || self.entity.stunned > 0 || self.props.jumpHeight <= 0) return;
  d.air = true;
  d.vz = jumpPhysics(self).jumpV;
  self.emit("jumped");
  if (self.props.jumpSound) self.game.audio.play(self.props.jumpSound, { rate: 0.95 + Math.random() * 0.1 });
}

function knockdown(self: BlockInstance) {
  const d = self.data;
  if (d.down) return;
  d.down = true;
  d.downT = 0;
  d.air = true;
  d.vz = KNOCK_LAUNCH;
  // Steso a terra non risponde ai comandi: lo stordimento finisce quando si rialza.
  self.entity.stunned = 99;
  self.emit("knockedDown");
}

/**
 * Il personaggio cammina su un piano (x = destra/sinistra, y = profondità)
 * e salta su un terzo asse, l'altezza. Il corpo resta a terra: così i colpi valgono solo tra chi è
 * alla stessa profondità. Un colpo forte lo manda a terra: vola, resta steso, si rialza.
 */
defineBlock({
  name: "BeatEmUpController",
  label: "Controller Beat 'em up",
  category: "Movimento",
  description:
    "Cammina su un piano con la profondità (destra, sinistra, avanti e indietro) e salta con l'ombra a terra. I colpi forti lo mandano a terra e poi si rialza. Nella scena attiva «Ordina per Y».",
  requires: ["Body"],
  priority: 20,
  props: {
    input: { type: "select", label: "Comandato da", default: "player", options: INPUT_SOURCE_OPTIONS },
    speed: { type: "number", label: "Velocità", unit: "tile/s", default: 4, min: 0, step: 0.5, group: "Camminata" },
    depthSpeed: {
      type: "number",
      label: "Velocità in profondità",
      unit: "tile/s",
      default: 2.5,
      min: 0,
      step: 0.5,
      group: "Camminata",
      help: "Su e giù lungo la strada: di solito più lenta della camminata.",
    },
    accelTime: { type: "number", label: "Tempo per partire", unit: "s", default: 0.05, min: 0, step: 0.01, group: "Camminata" },
    decelTime: { type: "number", label: "Tempo per fermarsi", unit: "s", default: 0.05, min: 0, step: 0.01, group: "Camminata" },
    jumpHeight: { type: "number", label: "Altezza salto", unit: "tile", default: 2, min: 0, step: 0.25, group: "Salto" },
    timeToApex: { type: "number", label: "Tempo al vertice", unit: "s", default: 0.3, min: 0.05, step: 0.01, group: "Salto" },
    airControl: {
      type: "number",
      label: "Controllo in aria",
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.05,
      group: "Salto",
      help: "0 = in aria la direzione non cambia, 1 = come a terra.",
    },
    jumpSound: { type: "audio", label: "Suono salto", default: "", group: "Suoni" },
  },
  states: [
    { id: "idle", label: "Fermo" },
    { id: "walk", label: "Cammina" },
    { id: "jump", label: "Salto" },
    { id: "fall", label: "Caduta" },
    { id: "hurt", label: "Colpito" },
    { id: "down", label: "A terra" },
    { id: "getup", label: "Si rialza" },
  ],
  events: [
    { id: "jumped", label: "Ha saltato" },
    { id: "landed", label: "È atterrato" },
    { id: "knockedDown", label: "È finito a terra" },
    { id: "gotUp", label: "Si è rialzato" },
  ],
  conditions: {
    isOnGround: { label: "È a terra", test: (self) => !self.data.air },
    isJumping: { label: "È in aria", test: (self) => !!self.data.air && !self.data.down },
    isDown: { label: "È steso a terra", test: (self) => !!self.data.down },
  },
  actions: {
    jump: { label: "Salta", run: (self) => startJump(self) },
    stop: {
      label: "Fermati",
      run: (self) => {
        if (self.body) self.body.vx = self.body.vy = 0;
      },
    },
    knockdown: { label: "Manda a terra", run: (self) => knockdown(self) },
  },
  init(self) {
    Object.assign(self.data, { air: false, vz: 0, down: false, downT: 0 });
    self.entity.elevation = 0;
  },
  update(self, dt) {
    const b = self.body;
    if (!b) return;
    const e = self.entity;
    const p = self.props;
    const d = self.data;
    const ts = self.scene.tileSize;
    if (p.input === "player") self.game.input.readIntent(e.intent);
    // Durante il contraccolpo il corpo scivola con la sua velocità, senza comandi.
    const stunned = e.stunned > 0;
    if (stunned && !d.down) e.stunned -= dt;
    const it = stunned ? NO_INTENT : e.intent;

    if (!stunned) {
      let x = it.x;
      let y = it.y;
      const len = Math.hypot(x, y);
      if (len > 1) {
        x /= len;
        y /= len;
      }
      const control = d.air ? p.airControl : 1;
      const sx = p.speed * ts * self.entity.boost("speed");
      const sy = p.depthSpeed * ts;
      const acc = (sx / Math.max(p.accelTime, 1e-3)) * control;
      const dec = (sx / Math.max(p.decelTime, 1e-3)) * control;
      b.vx = approach(b.vx, x * sx, (x !== 0 ? acc : dec) * dt);
      b.vy = approach(b.vy, y * sy, (y !== 0 ? acc : dec) * dt);
      if (x !== 0) e.facingX = x > 0 ? 1 : -1;
      if (x !== 0 || y !== 0) e.direction = Math.abs(x) >= Math.abs(y) ? (x > 0 ? "right" : "left") : y > 0 ? "down" : "up";
      if (it.jumpPressed) startJump(self);
    }

    // Salto (o volo dopo un colpo) sull'asse dell'altezza: lo sprite sale, il corpo e l'ombra restano sulla strada.
    if (d.air) {
      d.vz -= (d.down ? KNOCK_GRAVITY : jumpPhysics(self).gravity) * dt;
      e.elevation += d.vz * dt;
      if (e.elevation <= 0) {
        e.elevation = 0;
        d.vz = 0;
        d.air = false;
        self.emit("landed");
      }
    }
    if (d.down && !d.air) {
      d.downT += dt;
      b.vx = approach(b.vx, 0, 500 * dt);
      b.vy = approach(b.vy, 0, 500 * dt);
      if (d.downT >= DOWN_TIME + GETUP_TIME) {
        d.down = false;
        e.stunned = 0;
        self.emit("gotUp");
      }
    }

    if (d.down) self.state = d.air || d.downT < DOWN_TIME ? "down" : "getup";
    else if (stunned) self.state = "hurt";
    else self.state = d.air ? (d.vz > 0 ? "jump" : "fall") : Math.hypot(b.vx, b.vy) > 4 ? "walk" : "idle";
  },
  destroy(self) {
    self.entity.elevation = 0;
  },
});

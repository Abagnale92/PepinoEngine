import { defineBlock, type BlockInstance, type PropSchema } from "../core/block";
import type { Entity } from "../core/entity";
import { overlaps, type Rect } from "../math";
import { drawArc } from "../render/shapes";
import { bodyCenter } from "./targets";
import { spawnImpact } from "./spritefx";
import { boosted } from "../items/items";

/**
 * Combo: premendo più volte il tasto d'attacco escono colpi diversi uno dopo l'altro
 * (es. pugno, pugno, calcio che manda a terra). Ogni colpo ha il suo stato, quindi la sua animazione.
 * Il tasto premuto durante un colpo viene ricordato: il colpo successivo parte appena possibile.
 */

interface Move {
  n: number;
  damage: number;
  reach: number;
  width: number;
  height: number;
  startup: number;
  active: number;
  recovery: number;
  push: number;
  knockdown: boolean;
  air: boolean;
}

/** Stato dell'oggetto durante ogni colpo: l'Animatore lo collega all'animazione con lo stesso nome. */
export const COMBO_STATES = ["", "attack1", "attack2", "attack3", "airAttack"];
const AIR = 4;

interface MoveDefaults {
  damage: number;
  reach: number;
  width: number;
  height: number;
  startup: number;
  active: number;
  recovery: number;
  push: number;
}

function moveProps(prefix: string, group: string, d: MoveDefaults): Record<string, PropSchema> {
  const n = (key: string, label: string, def: number, extra: Partial<PropSchema> = {}): [string, PropSchema] => [
    `${prefix}${key}`,
    { type: "number", label, default: def, min: 0, group, ...extra },
  ];
  return Object.fromEntries([
    [`${prefix}Damage`, { type: "integer", label: "Danno", default: d.damage, min: 0, group }],
    n("Reach", "Distanza dal centro", d.reach, { unit: "px" }),
    n("Width", "Larghezza del colpo", d.width, { unit: "px", min: 1 }),
    n("Height", "Altezza del colpo", d.height, { unit: "px", min: 1 }),
    n("Startup", "Preparazione", d.startup, { unit: "s", step: 0.01 }),
    n("Active", "Colpo attivo", d.active, { unit: "s", step: 0.01, min: 0.01 }),
    n("Recovery", "Recupero", d.recovery, { unit: "s", step: 0.01 }),
    n("Push", "Spinta sul nemico", d.push, { unit: "tile/s", step: 0.5 }),
  ]);
}

function moveOf(self: BlockInstance, n: number): Move {
  const p = self.props;
  const k = n === AIR ? "air" : `m${n}`;
  return {
    n,
    damage: p[`${k}Damage`],
    reach: p[`${k}Reach`],
    width: p[`${k}Width`],
    height: p[`${k}Height`],
    startup: p[`${k}Startup`],
    active: p[`${k}Active`],
    recovery: p[`${k}Recovery`],
    push: p[`${k}Push`],
    knockdown: n === AIR ? !!p.airKnockdown : n === p.moves && !!p.finisherKnockdown,
    air: n === AIR,
  };
}

/** In aria? Con il salto sull'asse dell'altezza (profondità) conta `air`, altrimenti non tocca terra. */
function airborne(e: Entity): boolean {
  const bu = e.get("BeatEmUpController");
  if (bu) return !!bu.data.air;
  return (e.has("PlatformController") || e.has("FighterController")) && !!e.body && !e.body.onGround;
}

const planar = (e: Entity) => e.has("TopDownController") || e.has("BeatEmUpController");
/** A terra (beat 'em up) o senza vita (K.O.): niente colpi. */
const isDown = (e: Entity) => {
  if (e.get("BeatEmUpController")?.data.down) return true;
  const hp = e.get("Health");
  return !!hp && (hp.data.dead || Number(hp.data.hp) <= 0);
};

function hitbox(self: BlockInstance, m: Move): Rect {
  const c = bodyCenter(self.entity);
  const f = self.entity.facingX;
  return { x: c.x + f * m.reach - m.width / 2, y: c.y - m.height / 2, w: m.width, h: m.height };
}

function start(self: BlockInstance, n: number) {
  const d = self.data;
  d.move = n;
  d.t = 0;
  d.queued = false;
  d.hit = new Set<Entity>();
  self.emit("attackStart", { move: n });
  if (self.props.sound) self.game.audio.play(self.props.sound, { rate: 0.95 + n * 0.05 });
}

function finish(self: BlockInstance, m: Move) {
  const d = self.data;
  const p = self.props;
  d.move = 0;
  if (m.air) return;
  const last = m.n >= p.moves;
  d.next = last ? 1 : m.n + 1;
  d.window = last ? 0 : p.comboWindow;
  if (last) self.emit("comboFinish");
}

function begin(self: BlockInstance) {
  const d = self.data;
  if (airborne(self.entity)) {
    if (!self.props.airAttack || d.airUsed) return;
    d.airUsed = true;
    start(self, AIR);
  } else start(self, d.window > 0 ? d.next : 1);
}

function hitTargets(self: BlockInstance, m: Move) {
  const e = self.entity;
  const p = self.props;
  const d = self.data;
  const box = hitbox(self, m);
  const from = bodyCenter(e);
  for (const o of self.scene.entities) {
    if (o === e || o.destroyed || !o.hasTag(p.target) || !o.body || d.hit.has(o) || isDown(o)) continue;
    // Chi è molto più in alto o più in basso (salto) non viene preso; i colpi in aria arrivano più lontano.
    if (Math.abs(o.elevation - e.elevation) > (m.air ? 40 : m.height)) continue;
    if (!overlaps(box, o.body.rect())) continue;
    d.hit.add(o);
    o.get("Health")?.actions.damage(boosted(m.damage, e), from, { push: m.push, knockdown: m.knockdown, stun: 0.3 });
    const oc = bodyCenter(o);
    spawnImpact(self.scene, (box.x + box.w / 2 + oc.x) / 2, oc.y - o.elevation - 4, p.impactColor);
    if (p.hitstop > 0) self.game.hitstop?.(m.knockdown ? p.hitstop * 2 : p.hitstop);
    if (m.knockdown) self.scene.camera.shake(2, 0.15);
    if (p.hitSound) self.game.audio.play(p.hitSound);
    self.emit("hit", o);
  }
}

defineBlock({
  name: "Combo",
  label: "Combo di colpi",
  category: "Combattimento",
  description:
    "Premendo più volte il tasto d'attacco escono colpi diversi uno dopo l'altro: l'ultimo manda a terra. C'è anche il colpo in aria. Ogni colpo è uno stato (attack1, attack2, attack3, airAttack): dai all'animazione lo stesso nome e si collega da sola.",
  priority: 22,
  props: {
    mode: {
      type: "select",
      label: "Comandato da",
      default: "player",
      options: [
        { value: "player", label: "Giocatore (comando)" },
        { value: "ai", label: "IA o Regole (azione «Attacca»)" },
      ],
    },
    command: { type: "input", label: "Comando", default: "attack" },
    target: { type: "tag", label: "Colpisce chi ha l'etichetta", default: "nemico" },
    moves: { type: "integer", label: "Colpi della combo", default: 3, min: 1, max: 3 },
    comboWindow: {
      type: "number",
      label: "Tempo per il colpo successivo",
      unit: "s",
      default: 0.35,
      min: 0,
      step: 0.05,
      help: "Dopo un colpo, per quanto tempo premere di nuovo continua la combo invece di ricominciarla.",
    },
    ...moveProps("m1", "Colpo 1", { damage: 1, reach: 11, width: 16, height: 12, startup: 0.05, active: 0.08, recovery: 0.12, push: 1.5 }),
    ...moveProps("m2", "Colpo 2", { damage: 1, reach: 12, width: 16, height: 12, startup: 0.05, active: 0.08, recovery: 0.14, push: 1.5 }),
    ...moveProps("m3", "Colpo finale", { damage: 2, reach: 13, width: 20, height: 14, startup: 0.09, active: 0.1, recovery: 0.25, push: 6 }),
    finisherKnockdown: { type: "boolean", label: "L'ultimo colpo manda a terra", default: true, group: "Colpo finale" },
    airAttack: { type: "boolean", label: "Colpo in aria", default: true, group: "In aria" },
    ...moveProps("air", "In aria", { damage: 2, reach: 11, width: 18, height: 16, startup: 0.04, active: 0.25, recovery: 0.08, push: 5 }),
    airKnockdown: { type: "boolean", label: "Manda a terra", default: true, group: "In aria" },
    hitstop: {
      type: "number",
      label: "Fermo sul colpo",
      unit: "s",
      default: 0.05,
      min: 0,
      max: 0.3,
      step: 0.01,
      group: "Sensazione",
      help: "Il gioco si ferma per un attimo quando un colpo va a segno: fa sentire l'impatto.",
    },
    stopMoving: { type: "boolean", label: "Si ferma mentre colpisce", default: true, group: "Sensazione" },
    swoosh: { type: "boolean", label: "Scia del colpo", default: true, group: "Sensazione" },
    swooshColor: { type: "color", label: "Colore della scia", default: "#ffffffcc", group: "Sensazione" },
    impactColor: { type: "color", label: "Colore dell'impatto", default: "#fff3a6", group: "Sensazione" },
    sound: { type: "audio", label: "Suono del colpo", default: "", group: "Sensazione" },
    hitSound: { type: "audio", label: "Suono quando va a segno", default: "", group: "Sensazione" },
  },
  states: [
    { id: "attack1", label: "Colpo 1" },
    { id: "attack2", label: "Colpo 2" },
    { id: "attack3", label: "Colpo finale" },
    { id: "airAttack", label: "Colpo in aria" },
  ],
  events: [
    { id: "attackStart", label: "Inizia un colpo" },
    { id: "hit", label: "Ha colpito qualcuno" },
    { id: "comboFinish", label: "Ha chiuso la combo" },
  ],
  conditions: {
    isAttacking: { label: "Sta colpendo", test: (self) => self.data.move > 0 },
  },
  actions: { attack: { label: "Attacca", run: (self) => (self.data.ai = true) } },
  init(self) {
    Object.assign(self.data, { move: 0, t: 0, next: 1, window: 0, queued: false, airUsed: false, ai: false, hit: new Set<Entity>() });
  },
  update(self, dt) {
    const p = self.props;
    const d = self.data;
    const e = self.entity;
    // Colpito o a terra: la combo si interrompe.
    if (e.stunned > 0 || isDown(e)) {
      d.move = 0;
      d.queued = false;
      d.window = 0;
      return;
    }
    if (!airborne(e)) d.airUsed = false;
    if (d.window > 0) {
      d.window -= dt;
      if (d.window <= 0) d.next = 1;
    }
    const pressed = (p.mode === "player" && self.game.input.pressed(p.command)) || d.ai;
    d.ai = false;
    if (pressed) {
      if (!d.move) begin(self);
      else d.queued = true;
    }
    if (!d.move) return;

    const m = moveOf(self, d.move);
    d.t += dt;
    self.state = COMBO_STATES[d.move];
    if (p.stopMoving && !m.air && e.body) {
      e.body.vx = 0;
      if (planar(e)) e.body.vy = 0;
    }
    if (d.t >= m.startup && d.t < m.startup + m.active) hitTargets(self, m);
    if (m.air && !airborne(e)) return finish(self, m);
    // Tasto già premuto: il colpo successivo parte appena finisce quello attivo, senza aspettare il recupero.
    if (!m.air && d.queued && d.t >= m.startup + m.active && d.move < p.moves) return start(self, d.move + 1);
    if (d.t >= m.startup + m.active + m.recovery) finish(self, m);
  },
  render(self, r) {
    const d = self.data;
    const p = self.props;
    if (!d.move || !p.swoosh) return;
    const m = moveOf(self, d.move);
    const act = d.t - m.startup;
    if (act < 0 || act > m.active + 0.06) return;
    const e = self.entity;
    const c = bodyCenter(e);
    const cy = c.y - e.elevation;
    const u = Math.min(1, act / m.active);
    const fade = act > m.active ? 1 - (act - m.active) / 0.06 : 1;
    const r1 = m.reach + m.width * 0.4;
    const r0 = r1 * 0.45;
    // L'arco spazza dall'alto in avanti (colpo in aria: più in basso, come un calcio volante).
    const from = m.air ? -0.2 : -1.15;
    const to = m.air ? 1.2 : 0.75;
    const head = from + (to - from) * u;
    const tail = Math.max(from, head - 1.1);
    const mirror = (a: number) => (e.facingX > 0 ? a : Math.PI - a);
    drawArc(r, c.x, cy, r0, r1, mirror(tail), mirror(head), p.swooshColor, fade);
  },
  renderDebug(self, r) {
    if (!self.data.move) return;
    const b = hitbox(self, moveOf(self, self.data.move));
    r.strokeRect(b.x, b.y, b.w, b.h, 1, 0xff4a4aff);
  },
});

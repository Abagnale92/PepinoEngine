import { defineBlock, type BlockInstance } from "../core/block";
import type { Entity } from "../core/entity";
import { hexColor, overlaps, type Rect } from "../math";
import { lineOfSight } from "../world/pathfinding";
import { bodyCenter, facingVector, nearestTagged } from "./targets";

// ------------------------------------------------------------------ Proiettile

defineBlock({
  name: "Projectile",
  label: "Proiettile",
  category: "Combattimento",
  description:
    "Vola dritto (o ad arco, con la gravità), ferisce il primo bersaglio che tocca e sparisce contro i muri. Di solito lo crea il blocco Spara.",
  requires: ["Body"],
  priority: 25,
  props: {
    target: { type: "tag", label: "Colpisce chi ha l'etichetta", default: "giocatore" },
    damage: { type: "integer", label: "Danno", default: 1, min: 0 },
    speed: { type: "number", label: "Velocità", unit: "tile/s", default: 8, min: 0, help: "Se lo lancia il blocco Spara, vale la velocità di Spara." },
    lifetime: { type: "number", label: "Dura", unit: "s", default: 3, min: 0.1, step: 0.1 },
    gravity: { type: "number", label: "Gravità", unit: "tile/s²", default: 0, step: 1, help: "0 = vola dritto; più alto = arco." },
    destroyOnWall: { type: "boolean", label: "Sparisce contro i muri", default: true },
    piercing: { type: "boolean", label: "Attraversa i bersagli", default: false },
  },
  events: [{ id: "hit", label: "Ha colpito" }],
  init(self) {
    self.data.life = self.props.lifetime;
    self.data.hit = new Set<Entity>();
    const b = self.body;
    if (b && b.vx === 0 && b.vy === 0) b.vx = self.entity.facingX * self.props.speed * self.scene.tileSize;
  },
  update(self, dt) {
    const e = self.entity;
    const b = self.body;
    if (!b) return;
    const p = self.props;
    const d = self.data;
    d.life -= dt;
    if (d.life <= 0) return e.destroy();
    if (p.gravity) b.vy += p.gravity * self.scene.tileSize * dt;
    if (p.destroyOnWall && (b.onWallLeft || b.onWallRight || b.onGround || b.onCeiling)) return e.destroy();
    const r = b.rect();
    for (const o of self.scene.entities) {
      if (o === e || o.destroyed || o === d.owner || !o.hasTag(p.target) || !o.body || d.hit.has(o)) continue;
      if (!overlaps(r, o.body.rect())) continue;
      d.hit.add(o);
      // Il contraccolpo spinge nella direzione di volo.
      o.get("Health")?.actions.damage(p.damage, { x: e.worldX - b.vx, y: e.worldY - b.vy });
      self.emit("hit", o);
      if (!p.piercing) return e.destroy();
    }
    if (b.vx) e.facingX = b.vx < 0 ? -1 : 1;
  },
});

// ------------------------------------------------------------------ Spara

function fire(self: BlockInstance, target?: Entity) {
  const p = self.props;
  const e = self.entity;
  const ts = self.scene.tileSize;
  if (!p.projectile) {
    if (!self.data.warned) self.game.log(`"${e.name}": scegli il proiettile nel blocco Spara`, "warn");
    self.data.warned = true;
    return;
  }
  let dir = facingVector(e);
  if (p.aim === "target") {
    const t = target ?? nearestTagged(self.scene, e, p.target, p.range * ts);
    if (t) {
      const a = bodyCenter(e);
      const c = bodyCenter(t);
      const len = Math.hypot(c.x - a.x, c.y - a.y) || 1;
      dir = { x: (c.x - a.x) / len, y: (c.y - a.y) / len };
      if (Math.abs(c.x - a.x) > 1) e.facingX = c.x < a.x ? -1 : 1;
    }
  }
  const side = dir.x < 0 ? -1 : 1;
  const pr = self.scene.spawn(p.projectile, e.worldX + side * p.offsetX, e.worldY + p.offsetY);
  if (!pr) return;
  if (pr.body) {
    pr.body.vx = dir.x * p.speed * ts;
    pr.body.vy = dir.y * p.speed * ts;
  }
  pr.facingX = side;
  const proj = pr.get("Projectile");
  if (proj) proj.data.owner = e;
  self.data.cd = p.interval;
  self.emit("shot", pr);
  if (p.sound) self.game.audio.play(p.sound);
}

defineBlock({
  name: "Shooter",
  label: "Spara",
  category: "Combattimento",
  description:
    "Crea un proiettile da un modello (con il blocco Proiettile) e lo lancia: quando il giocatore preme un comando, oppure da solo verso un bersaglio.",
  priority: 45,
  props: {
    projectile: { type: "prefab", label: "Proiettile (modello)", default: "" },
    mode: {
      type: "select",
      label: "Quando spara",
      default: "auto",
      options: [
        { value: "auto", label: "Da solo, quando vede il bersaglio" },
        { value: "player", label: "Quando il giocatore preme il comando" },
      ],
    },
    command: { type: "input", label: "Comando", default: "attack" },
    aim: {
      type: "select",
      label: "Mira",
      default: "target",
      options: [
        { value: "target", label: "Verso il bersaglio" },
        { value: "facing", label: "Dove sta guardando" },
      ],
    },
    target: { type: "tag", label: "Bersaglio", default: "giocatore" },
    range: { type: "number", label: "Distanza massima", unit: "tile", default: 8, min: 0, step: 0.5 },
    lineOfSight: { type: "boolean", label: "Solo se lo vede (muri in mezzo no)", default: true },
    interval: { type: "number", label: "Tempo tra due colpi", unit: "s", default: 1.5, min: 0.05, step: 0.1 },
    speed: { type: "number", label: "Velocità del proiettile", unit: "tile/s", default: 8, min: 0, step: 0.5 },
    offsetX: { type: "number", label: "Punto di sparo X", unit: "px", default: 6 },
    offsetY: { type: "number", label: "Punto di sparo Y", unit: "px", default: -8 },
    sound: { type: "audio", label: "Suono", default: "" },
  },
  events: [{ id: "shot", label: "Ha sparato" }],
  actions: { shoot: { label: "Spara ora", run: (self) => fire(self) } },
  init(self) {
    // Il primo colpo automatico arriva dopo mezzo intervallo, non subito.
    self.data.cd = self.props.mode === "auto" ? self.props.interval * 0.5 : 0;
  },
  update(self, dt) {
    const p = self.props;
    const d = self.data;
    d.cd -= dt;
    if (d.cd > 1e-6) return;
    if (p.mode === "player") {
      if (self.game.input.pressed(p.command)) fire(self);
      return;
    }
    const t = nearestTagged(self.scene, self.entity, p.target, p.range * self.scene.tileSize);
    if (!t) return;
    if (p.lineOfSight) {
      const a = bodyCenter(self.entity);
      const c = bodyCenter(t);
      if (!lineOfSight(self.scene.grid, a.x, a.y, c.x, c.y)) return;
    }
    fire(self, t);
  },
});

// ------------------------------------------------------------------ Attacco corpo a corpo

function hitbox(self: BlockInstance): Rect {
  const p = self.props;
  const c = bodyCenter(self.entity);
  const dir = facingVector(self.entity);
  const vertical = dir.x === 0;
  const w = vertical ? p.height : p.width;
  const h = vertical ? p.width : p.height;
  return { x: c.x + dir.x * p.reach - w / 2, y: c.y + dir.y * p.reach - h / 2, w, h };
}

function startAttack(self: BlockInstance) {
  const d = self.data;
  if (d.t >= 0) return;
  d.t = 0;
  d.hit = new Set<Entity>();
  self.emit("attackStart");
  if (self.props.sound) self.game.audio.play(self.props.sound);
}

const isActive = (self: BlockInstance) => self.data.t >= self.props.startup && self.data.t < self.props.startup + self.props.active;

/** Bersagli dentro la zona del colpo. Nei beat 'em up conta anche l'altezza: chi salta alto non viene preso. */
function targetsInReach(self: BlockInstance): Entity[] {
  const p = self.props;
  const e = self.entity;
  const box = hitbox(self);
  const out: Entity[] = [];
  for (const o of self.scene.entities) {
    if (o === e || o.destroyed || !o.hasTag(p.target) || !o.body) continue;
    if (Math.abs(o.elevation - e.elevation) > p.height) continue;
    if (overlaps(box, o.body.rect())) out.push(o);
  }
  return out;
}

defineBlock({
  name: "Attack",
  label: "Attacco corpo a corpo",
  category: "Combattimento",
  description:
    "Un colpo davanti a sé (spada, pugno, mestolo…). La zona che colpisce è attiva solo per un attimo: prima c'è la preparazione, dopo il recupero.",
  priority: 22,
  props: {
    mode: {
      type: "select",
      label: "Comandato da",
      default: "player",
      options: [
        { value: "player", label: "Giocatore (comando)" },
        { value: "auto", label: "Da solo, quando il bersaglio è a portata" },
        { value: "ai", label: "IA o Regole (azione «Attacca»)" },
      ],
    },
    command: { type: "input", label: "Comando", default: "attack" },
    cooldown: {
      type: "number",
      label: "Attesa tra due attacchi",
      unit: "s",
      default: 0.8,
      min: 0,
      step: 0.1,
      help: "Solo «Da solo»: quanto aspetta prima di colpire di nuovo.",
    },
    target: { type: "tag", label: "Colpisce chi ha l'etichetta", default: "nemico" },
    damage: { type: "integer", label: "Danno", default: 1, min: 0 },
    reach: { type: "number", label: "Distanza dal centro", unit: "px", default: 14, min: 0, group: "Zona che colpisce" },
    width: { type: "number", label: "Larghezza", unit: "px", default: 16, min: 1, group: "Zona che colpisce" },
    height: { type: "number", label: "Altezza", unit: "px", default: 14, min: 1, group: "Zona che colpisce" },
    startup: { type: "number", label: "Preparazione", unit: "s", default: 0.06, min: 0, step: 0.01, group: "Tempi" },
    active: { type: "number", label: "Colpo attivo", unit: "s", default: 0.12, min: 0.01, step: 0.01, group: "Tempi" },
    recovery: { type: "number", label: "Recupero", unit: "s", default: 0.14, min: 0, step: 0.01, group: "Tempi" },
    stopMoving: { type: "boolean", label: "Si ferma mentre attacca", default: true },
    slash: { type: "boolean", label: "Mostra il fendente", default: true },
    slashColor: { type: "color", label: "Colore del fendente", default: "#ffffffcc" },
    sound: { type: "audio", label: "Suono", default: "" },
  },
  states: [{ id: "attack", label: "Attacco" }],
  events: [
    { id: "attackStart", label: "Inizia un attacco" },
    { id: "hit", label: "Ha colpito qualcuno" },
  ],
  conditions: {
    isAttacking: { label: "Sta attaccando", test: (self) => self.data.t >= 0 },
  },
  actions: { attack: { label: "Attacca", run: (self) => startAttack(self) } },
  init(self) {
    self.data.t = -1;
    self.data.hit = new Set<Entity>();
    self.data.cool = 0;
  },
  update(self, dt) {
    const p = self.props;
    const d = self.data;
    const e = self.entity;
    // Colpito mentre si prepara: l'attacco viene annullato (come nei picchiaduro).
    if (d.t >= 0 && e.stunned > 0) d.t = -1;
    if (d.t < 0) {
      if (p.mode === "player" && self.game.input.pressed(p.command)) startAttack(self);
      else if (p.mode === "auto") {
        d.cool -= dt;
        if (d.cool <= 0 && e.stunned <= 0 && targetsInReach(self).length) {
          d.cool = p.cooldown;
          startAttack(self);
        }
      }
      if (d.t < 0) return;
    }
    d.t += dt;
    if (d.t >= p.startup + p.active + p.recovery) {
      d.t = -1;
      return;
    }
    self.state = "attack";
    if (p.stopMoving && e.body) {
      e.body.vx = 0;
      if (e.has("TopDownController")) e.body.vy = 0;
    }
    if (!isActive(self)) return;
    const from = bodyCenter(e);
    for (const o of targetsInReach(self)) {
      if (d.hit.has(o)) continue;
      d.hit.add(o);
      o.get("Health")?.actions.damage(p.damage, from);
      self.emit("hit", o);
    }
  },
  render(self, r) {
    if (!self.props.slash || self.data.t < 0 || !isActive(self)) return;
    const b = hitbox(self);
    const k = 1 - (self.data.t - self.props.startup) / self.props.active;
    r.rect(b.x, b.y - self.entity.elevation, b.w, b.h, hexColor(self.props.slashColor, 0.35 + 0.5 * k));
  },
  renderDebug(self, r) {
    if (self.data.t < 0) return;
    const b = hitbox(self);
    r.strokeRect(b.x, b.y, b.w, b.h, 1, hexColor(isActive(self) ? "#ff4a4a" : "#ffb14a"));
  },
});

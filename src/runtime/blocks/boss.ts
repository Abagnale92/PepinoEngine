import { defineBlock, type BlockInstance } from "../core/block";
import type { Entity } from "../core/entity";
import { hexColor, overlaps, packColor, type Rect } from "../math";
import { bodyCenter, nearestTagged } from "./targets";
import { spawnImpact } from "./spritefx";

/**
 * Boss: un nemico con una "macchina a stati". Dorme finché non vede il bersaglio, poi si avvicina,
 * si prepara (preavviso, lampeggia) ed esegue un attacco del suo repertorio, poi resta stanco per un po':
 * è il momento di colpirlo. Con la vita che scende passa alla fase 2 e alla fase 3 (furia): più veloce e con meno pause.
 * Si muove da solo (non serve un controller): va bene per beat 'em up e top-down.
 */

export const BOSS_ATTACKS = [
  { id: "melee", label: "Colpo ravvicinato" },
  { id: "charge", label: "Carica" },
  { id: "slam", label: "Salto e schiacciata" },
  { id: "shoot", label: "Raffica di proiettili" },
  { id: "summon", label: "Chiama aiutanti" },
];

/** Moltiplicatori per fase: velocità e durata delle pause. */
const SPEED = [1, 1.25, 1.55];
const REST = [1, 0.75, 0.5];
const SLAM_TIME = 0.75;
/** Distanza massima di un salto e schiacciata, in tile. */
const SLAM_RANGE = 6;

type Mode = "sleep" | "approach" | "windup" | "act" | "tired";

function set(self: BlockInstance, mode: Mode) {
  self.data.mode = mode;
  self.data.t = 0;
}

function stop(self: BlockInstance) {
  const b = self.body;
  if (b) b.vx = b.vy = 0;
}

function face(e: Entity, dx: number) {
  if (Math.abs(dx) > 1) e.facingX = dx < 0 ? -1 : 1;
}

function available(self: BlockInstance): string[] {
  const p = self.props;
  return BOSS_ATTACKS.map((a) => a.id).filter((id) => p[id] && (id !== "shoot" || p.projectile) && (id !== "summon" || p.minion));
}

/**
 * Prossimo attacco: gli attacchi a distanza in ordine (uno schema da imparare); da vicino alterna
 * il colpo ravvicinato con il resto dello schema, così non ripete sempre la stessa mossa.
 */
function nextAttack(self: BlockInstance, close: boolean): string {
  const d = self.data;
  const list = available(self);
  const ranged = list.filter((a) => a !== "melee");
  if (list.includes("melee") && (!ranged.length || (close && !d.lastMelee))) {
    d.lastMelee = true;
    return "melee";
  }
  d.lastMelee = false;
  if (!ranged.length) return "melee";
  d.cycle = (d.cycle + 1) % ranged.length;
  return ranged[d.cycle];
}

function hurt(self: BlockInstance, o: Entity, knockdown: boolean) {
  o.get("Health")?.actions.damage(self.props.damage, bodyCenter(self.entity), { push: 6, knockdown, stun: 0.35 });
}

function targets(self: BlockInstance): Entity[] {
  return self.scene.entities.filter((o) => !o.destroyed && o !== self.entity && o.hasTag(self.props.target) && o.body);
}

function begin(self: BlockInstance, target?: Entity) {
  const d = self.data;
  const e = self.entity;
  const b = self.body!;
  set(self, "act");
  d.hitDone = false;
  d.shots = 0;
  d.spawned = false;
  d.landed = false;
  if (target) face(e, target.worldX - e.worldX);
  if (d.attack === "charge") d.dir = target ? Math.sign(target.worldX - e.worldX) || e.facingX : e.facingX;
  if (d.attack === "slam") {
    // Salta verso il bersaglio, ma non più lontano di qualche tile: non attraversa mezzo livello.
    let dx = target ? target.worldX - e.worldX : 0;
    let dy = target ? target.worldY - e.worldY : 0;
    const len = Math.hypot(dx, dy);
    const max = SLAM_RANGE * self.scene.tileSize;
    if (len > max) {
      dx *= max / len;
      dy *= max / len;
    }
    b.vx = dx / SLAM_TIME;
    b.vy = dy / SLAM_TIME;
  }
  self.emit("attackStart", d.attack);
}

function act(self: BlockInstance, target: Entity | undefined, k: number) {
  const d = self.data;
  const e = self.entity;
  const b = self.body!;
  const p = self.props;
  const ts = self.scene.tileSize;
  const tired = () => {
    stop(self);
    e.elevation = 0;
    set(self, "tired");
  };
  switch (d.attack) {
    case "melee": {
      stop(self);
      self.state = "attack";
      if (!d.hitDone && d.t >= 0.05) {
        d.hitDone = true;
        const c = bodyCenter(e);
        const box: Rect = { x: c.x + e.facingX * ts - ts * 0.9, y: c.y - 9, w: ts * 1.8, h: 18 };
        for (const o of targets(self)) if (overlaps(box, o.body!.rect()) && o.elevation < 18) hurt(self, o, true);
        self.scene.camera.shake(2, 0.15);
      }
      if (d.t > 0.4) tired();
      return;
    }
    case "charge": {
      self.state = "charge";
      b.vx = d.dir * p.chargeSpeed * ts * k;
      b.vy = 0;
      e.facingX = d.dir < 0 ? -1 : 1;
      for (const o of targets(self)) {
        if (d.hitDone || o.elevation > 18 || !overlaps(b.rect(), o.body!.rect())) continue;
        d.hitDone = true;
        hurt(self, o, true);
        spawnImpact(self.scene, (e.worldX + o.worldX) / 2, o.worldY - 10);
      }
      const cam = self.scene.camera;
      const outside = e.worldX < cam.x - cam.halfW + 8 || e.worldX > cam.x + cam.halfW - 8;
      if (d.t > 1.2 || b.onWallLeft || b.onWallRight || (d.t > 0.2 && outside)) {
        self.scene.camera.shake(2, 0.2);
        tired();
      }
      return;
    }
    case "slam": {
      const u = d.t / SLAM_TIME;
      if (u < 1) {
        self.state = "jump";
        e.elevation = Math.sin(Math.PI * u) * p.slamHeight;
        return;
      }
      e.elevation = 0;
      stop(self);
      self.state = "slam";
      if (!d.landed) {
        d.landed = true;
        const c = bodyCenter(e);
        for (const o of targets(self)) {
          const oc = bodyCenter(o);
          if (o.elevation < 16 && Math.hypot(oc.x - c.x, (oc.y - c.y) * 1.6) <= p.slamRadius * ts) hurt(self, o, true);
        }
        self.scene.camera.shake(4, 0.35);
        e.get("Particles")?.actions.burst(18);
        self.emit("slam");
      }
      if (d.t > SLAM_TIME + 0.3) tired();
      return;
    }
    case "shoot": {
      stop(self);
      self.state = "shoot";
      if (d.shots < p.shots && d.t >= d.shots * 0.15) {
        const i = d.shots++;
        const a = bodyCenter(e);
        const c = target ? bodyCenter(target) : { x: a.x + e.facingX * 100, y: a.y };
        const base = Math.atan2(c.y - a.y, c.x - a.x);
        const ang = base + (i - (p.shots - 1) / 2) * 0.2;
        const pr = self.scene.spawn(p.projectile, e.worldX + e.facingX * 8, e.worldY - 12 - e.elevation);
        if (pr?.body) {
          pr.body.vx = Math.cos(ang) * p.projectileSpeed * ts;
          pr.body.vy = Math.sin(ang) * p.projectileSpeed * ts;
          pr.facingX = pr.body.vx < 0 ? -1 : 1;
          const proj = pr.get("Projectile");
          if (proj) proj.data.owner = e;
        }
      }
      if (d.shots >= p.shots && d.t > d.shots * 0.15 + 0.3) tired();
      return;
    }
    case "summon": {
      stop(self);
      self.state = "summon";
      if (!d.spawned && d.t >= 0.35) {
        d.spawned = true;
        d.minions = ((d.minions ?? []) as Entity[]).filter((m) => !m.destroyed);
        const offsets = [
          [-28, -8],
          [28, 8],
          [-20, 12],
          [22, -12],
        ];
        for (let i = 0; i < p.minions && d.minions.length < p.minions * 2; i++) {
          const [ox, oy] = offsets[i % offsets.length];
          const m = self.scene.spawn(p.minion, e.worldX + ox, e.worldY + oy);
          if (m) d.minions.push(m);
        }
        self.scene.camera.shake(1.5, 0.2);
      }
      if (d.t > 0.8) tired();
      return;
    }
  }
}

defineBlock({
  name: "Boss",
  label: "Boss",
  category: "IA",
  description:
    "Nemico finale con fasi: dorme finché non ti vede, poi alterna un repertorio di attacchi con un preavviso (lampeggia) e resta stanco dopo ognuno: è il momento di colpirlo. Sotto il 60% e il 30% di vita diventa più veloce e cattivo. Mostra la sua barra della vita in alto. Si muove da solo, senza controller.",
  requires: ["Body", "Health"],
  priority: 12,
  props: {
    title: { type: "string", label: "Nome sullo schermo", default: "Boss", translatable: true },
    target: { type: "tag", label: "Bersaglio", default: "giocatore" },
    wakeRange: { type: "number", label: "Si sveglia quando il bersaglio è a", unit: "tile", default: 7, min: 0, step: 0.5 },
    speed: { type: "number", label: "Velocità", unit: "tile/s", default: 1.6, min: 0, step: 0.1 },
    damage: { type: "integer", label: "Danno dei suoi attacchi", default: 1, min: 0 },
    windupTime: { type: "number", label: "Preavviso prima di attaccare", unit: "s", default: 0.5, min: 0, step: 0.05 },
    restTime: { type: "number", label: "Stanco dopo un attacco", unit: "s", default: 1.3, min: 0, step: 0.1, help: "Il momento giusto per colpirlo." },
    melee: { type: "boolean", label: "Colpo ravvicinato", default: true, group: "Attacchi" },
    charge: { type: "boolean", label: "Carica", default: true, group: "Attacchi" },
    chargeSpeed: { type: "number", label: "Velocità della carica", unit: "tile/s", default: 7, min: 0, group: "Attacchi" },
    slam: { type: "boolean", label: "Salto e schiacciata", default: true, group: "Attacchi" },
    slamHeight: { type: "number", label: "Altezza del salto", unit: "px", default: 48, min: 0, group: "Attacchi" },
    slamRadius: { type: "number", label: "Raggio della schiacciata", unit: "tile", default: 1.6, min: 0, step: 0.1, group: "Attacchi" },
    shoot: { type: "boolean", label: "Raffica di proiettili", default: false, group: "Attacchi" },
    projectile: { type: "prefab", label: "Proiettile (modello)", default: "", optional: true, group: "Attacchi" },
    shots: { type: "integer", label: "Proiettili per raffica", default: 5, min: 1, max: 12, group: "Attacchi" },
    projectileSpeed: { type: "number", label: "Velocità dei proiettili", unit: "tile/s", default: 5, min: 0, group: "Attacchi" },
    summon: { type: "boolean", label: "Chiama aiutanti", default: false, group: "Attacchi" },
    minion: { type: "prefab", label: "Aiutante (modello)", default: "", optional: true, group: "Attacchi" },
    minions: { type: "integer", label: "Aiutanti per volta", default: 2, min: 1, max: 4, group: "Attacchi" },
    phase2: { type: "number", label: "Fase 2 sotto il", unit: "% vita", default: 60, min: 0, max: 100, group: "Fasi" },
    phase3: { type: "number", label: "Fase 3 (furia) sotto il", unit: "% vita", default: 30, min: 0, max: 100, group: "Fasi" },
    bar: { type: "boolean", label: "Barra della vita in alto", default: true, group: "Fasi" },
    barColor: { type: "color", label: "Colore della barra", default: "#e5484d", group: "Fasi" },
  },
  states: [
    { id: "idle", label: "Dorme" },
    { id: "walk", label: "Si avvicina" },
    { id: "windup", label: "Si prepara" },
    { id: "attack", label: "Colpo ravvicinato" },
    { id: "charge", label: "Carica" },
    { id: "jump", label: "Salta" },
    { id: "slam", label: "Schiacciata" },
    { id: "shoot", label: "Spara" },
    { id: "summon", label: "Chiama aiutanti" },
    { id: "tired", label: "Stanco" },
  ],
  events: [
    { id: "awake", label: "Si sveglia" },
    { id: "attackStart", label: "Inizia un attacco" },
    { id: "slam", label: "Atterra dalla schiacciata" },
    { id: "phase2", label: "Passa alla fase 2" },
    { id: "phase3", label: "Passa alla fase 3 (furia)" },
  ],
  conditions: {
    isAwake: { label: "È sveglio", test: (self) => !!self.data.awake },
    inPhase: {
      label: "È nella fase",
      params: { phase: { type: "integer", label: "Fase", default: 2, min: 1, max: 3 } },
      test: (self, phase) => self.data.phase === Number(phase),
    },
    isTired: { label: "È stanco (si può colpire)", test: (self) => self.data.mode === "tired" },
  },
  actions: {
    wake: {
      label: "Sveglialo",
      run: (self) => {
        if (self.data.awake) return;
        self.data.awake = true;
        self.emit("awake");
        set(self, "approach");
      },
    },
  },
  init(self) {
    Object.assign(self.data, { mode: "sleep", t: 0, phase: 1, cycle: -1, awake: false, attack: "melee", minions: [] });
  },
  update(self, dt) {
    const e = self.entity;
    const b = self.body;
    const p = self.props;
    const d = self.data;
    const hp = e.get("Health");
    if (!b || hp?.data.dead) return;
    // Super armatura: i colpi gli tolgono vita ma non lo interrompono.
    e.stunned = 0;
    if (hp) {
      const ratio = hp.data.hp / hp.props.max;
      const phase = ratio <= p.phase3 / 100 ? 3 : ratio <= p.phase2 / 100 ? 2 : 1;
      if (phase > d.phase) {
        d.phase = phase;
        self.emit(`phase${phase}`);
        self.scene.camera.shake(3, 0.4);
        if (e.sprite) e.sprite.flash = 1;
      }
    }
    const k = SPEED[d.phase - 1];
    const ts = self.scene.tileSize;
    const target = nearestTagged(self.scene, e, p.target);
    d.t += dt;
    switch (d.mode as Mode) {
      case "sleep": {
        stop(self);
        self.state = "idle";
        if (target) {
          const a = bodyCenter(e);
          const c = bodyCenter(target);
          if (Math.hypot(c.x - a.x, c.y - a.y) <= p.wakeRange * ts) self.actions.wake();
        }
        return;
      }
      case "approach": {
        if (!target) {
          stop(self);
          self.state = "idle";
          return;
        }
        const a = bodyCenter(e);
        const c = bodyCenter(target);
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        face(e, dx);
        const close = Math.abs(dx) < ts * 1.8 && Math.abs(dy) < 10;
        const ranged = available(self).some((x) => x !== "melee");
        if (close || (ranged && d.t > 1.4 / k)) {
          d.attack = nextAttack(self, close);
          stop(self);
          set(self, "windup");
          return;
        }
        const v = p.speed * ts * k;
        b.vx = (dx / len) * v;
        b.vy = (dy / len) * v * 0.8;
        self.state = "walk";
        return;
      }
      case "windup": {
        stop(self);
        self.state = "windup";
        if (e.sprite) e.sprite.flash = Math.max(e.sprite.flash, 0.25 + 0.25 * Math.sin(d.t * 30));
        if (d.t >= p.windupTime / k) begin(self, target);
        return;
      }
      case "act":
        act(self, target, k);
        return;
      case "tired": {
        b.vx *= 0.85;
        b.vy *= 0.85;
        self.state = "tired";
        if (d.t >= p.restTime * REST[d.phase - 1]) set(self, "approach");
        return;
      }
    }
  },
  renderScreen(self, r) {
    const p = self.props;
    const d = self.data;
    const hp = self.entity.get("Health");
    if (!p.bar || !d.awake || !hp || hp.data.dead) return;
    const W = r.width;
    const w = Math.min(200, W - 40);
    const x = (W - w) / 2;
    const y = 16;
    const ratio = Math.max(0, hp.data.hp / hp.props.max);
    r.text(self.game.t(p.title), W / 2, y - 11, { size: 7, align: "center", shadow: true });
    r.rect(x - 1, y - 1, w + 2, 7, packColor(0, 0, 0, 0.75));
    r.rect(x, y, w, 5, packColor(0.25, 0.08, 0.08, 1));
    r.rect(x, y, w * ratio, 5, hexColor(p.barColor));
    r.rect(x, y, w * ratio, 1, packColor(1, 1, 1, 0.35));
    for (const pc of [p.phase2, p.phase3]) if (pc > 0 && pc < 100) r.rect(x + (w * pc) / 100, y, 1, 5, packColor(0, 0, 0, 0.6));
  },
});

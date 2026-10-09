import { defineBlock, type BlockInstance } from "../core/block";
import type { Entity } from "../core/entity";
import { clamp, hexColor } from "../math";
import { NO_INTENT, INPUT_SOURCE_OPTIONS } from "./platform";
import { bodyCenter, nearestTagged } from "./targets";

/**
 * Scontro uno contro uno: due personaggi uno di fronte all'altro su un pavimento piatto.
 * Si avanza, si indietreggia (tenendo indietro si para), ci si abbassa e si salta;
 * la Regia dell'incontro conta round, tempo e vittorie e disegna le barre della vita.
 */

/** L'avversario più vicino con quell'etichetta. */
const rival = (self: BlockInstance): Entity | undefined => nearestTagged(self.scene, self.entity, String(self.props.opponent));

/** Sta facendo un colpo? (blocco Combo o Attacco corpo a corpo) */
const busy = (e: Entity): boolean => Number(e.get("Combo")?.data.move ?? 0) > 0 || Number(e.get("Attack")?.data.t ?? -1) >= 0;

// ------------------------------------------------------------------ Controller Picchiaduro

defineBlock({
  name: "FighterController",
  label: "Controller Picchiaduro",
  category: "Movimento",
  description:
    "Due personaggi uno di fronte all'altro: si guardano sempre, avanzano e indietreggiano, saltano e si abbassano. Tenendo indietro si para: i colpi che arrivano da davanti non fanno male. Gli attacchi si aggiungono con la Combo di colpi o l'Attacco corpo a corpo.",
  requires: ["Body"],
  priority: 20,
  props: {
    input: { type: "select", label: "Comandato da", default: "player", options: INPUT_SOURCE_OPTIONS },
    opponent: { type: "tag", label: "Avversario (etichetta)", default: "avversario", help: "Il personaggio da guardare sempre in faccia." },
    speed: { type: "number", label: "Velocità in avanti", unit: "tile/s", default: 4, min: 0, step: 0.5 },
    backSpeed: { type: "number", label: "Velocità all'indietro", unit: "tile/s", default: 3, min: 0, step: 0.5 },
    jumpHeight: { type: "number", label: "Altezza salto", unit: "tile", default: 2.5, min: 0, step: 0.25, group: "Salto" },
    timeToApex: { type: "number", label: "Tempo al vertice", unit: "s", default: 0.32, min: 0.05, step: 0.01, group: "Salto" },
    fallMultiplier: { type: "number", label: "Gravità in caduta", unit: "×", default: 1.4, min: 0.5, step: 0.1, group: "Salto" },
    airSpeed: { type: "number", label: "Spinta del salto in avanti", unit: "tile/s", default: 3, min: 0, step: 0.5, group: "Salto" },
    crouch: { type: "boolean", label: "Si abbassa con Giù", default: true, group: "Difesa", help: "Da abbassato il corpo è più basso: i colpi alti passano sopra." },
    guard: { type: "boolean", label: "Para tenendo indietro", default: true, group: "Difesa" },
    guardSound: { type: "audio", label: "Suono della parata", default: "", group: "Difesa" },
  },
  states: [
    { id: "idle", label: "Fermo" },
    { id: "walk", label: "Avanza" },
    { id: "walkBack", label: "Indietreggia" },
    { id: "crouch", label: "Abbassato" },
    { id: "guard", label: "In guardia" },
    { id: "jump", label: "Salto" },
    { id: "fall", label: "Caduta" },
    { id: "hurt", label: "Colpito" },
    { id: "down", label: "A terra (K.O.)" },
  ],
  events: [
    { id: "jumped", label: "Ha saltato" },
    { id: "landed", label: "È atterrato" },
  ],
  conditions: {
    isGuarding: { label: "Sta parando", test: (self) => !!self.data.guarding },
    isCrouching: { label: "È abbassato", test: (self) => !!self.data.crouching },
    isOnGround: { label: "È a terra", test: (self) => !!self.body?.onGround },
  },
  actions: {
    jump: { label: "Salta", run: (self) => (self.data.wantJump = true) },
    stop: { label: "Fermati", run: (self) => self.body && (self.body.vx = 0) },
  },
  init(self) {
    Object.assign(self.data, { guarding: false, crouching: false, wantJump: false, wasGrounded: true, h0: 0, oy0: 0 });
    self.listen("blocked", () => {
      if (self.props.guardSound) self.game.audio.play(self.props.guardSound);
    });
  },
  update(self, dt) {
    const b = self.body;
    if (!b) return;
    const e = self.entity;
    const p = self.props;
    const d = self.data;
    const ts = self.scene.tileSize;
    if (!d.h0) {
      d.h0 = b.h;
      d.oy0 = b.oy;
    }

    if (p.input === "player") self.game.input.readIntent(e.intent);
    const stunned = e.stunned > 0;
    if (stunned) e.stunned -= dt;
    const it = stunned ? NO_INTENT : e.intent;
    const grounded = b.onGround;

    // Si guarda sempre in faccia l'avversario (in aria si resta girati come si era).
    const other = rival(self);
    if (other && grounded) e.facingX = other.worldX >= e.worldX ? 1 : -1;

    const h = p.jumpHeight * ts * e.boost("jump");
    const t = Math.max(0.05, p.timeToApex);
    const gravity = (2 * h) / (t * t);
    const halfStep = (gravity * dt) / 2;
    const jumpV = halfStep + Math.sqrt(halfStep * halfStep + 2 * gravity * h);

    // K.O.: senza vita resta a terra, fermo, finché il round dopo non lo rimette in piedi.
    const health = e.get("Health");
    if (health && (health.data.dead || Number(health.data.hp) <= 0)) {
      if (b.onGround) b.vx = 0;
      b.vy += gravity * p.fallMultiplier * dt;
      d.guarding = e.guarding = false;
      self.state = "down";
      return;
    }

    const forward = it.x * e.facingX; // 1 = verso l'avversario, -1 = lontano
    const attacking = busy(e);
    d.crouching = !!p.crouch && grounded && it.y > 0 && !attacking;
    d.guarding = !!p.guard && grounded && !attacking && forward < 0;
    e.guarding = d.guarding;

    // Da abbassato il corpo diventa più basso: i colpi alti passano sopra.
    const wantH = d.crouching ? d.h0 / 2 : d.h0;
    if (b.h !== wantH) {
      b.h = wantH;
      b.oy = d.oy0 + (d.h0 - wantH);
    }

    if (grounded) {
      if (!d.wasGrounded) self.emit("landed");
      const walk = d.crouching || attacking ? 0 : it.x;
      const speed = (forward > 0 ? p.speed : p.backSpeed) * ts * e.boost("speed");
      b.vx = walk * speed;
      if ((it.jumpPressed || d.wantJump) && !attacking) {
        b.vy = -jumpV;
        b.vx = it.x * p.airSpeed * ts;
        self.emit("jumped");
      }
    }
    d.wantJump = false;
    d.wasGrounded = grounded;
    b.vy += gravity * (b.vy > 0 ? p.fallMultiplier : 1) * dt;

    if (stunned) self.state = "hurt";
    else if (!grounded) self.state = b.vy < 0 ? "jump" : "fall";
    else if (d.guarding) self.state = "guard";
    else if (d.crouching) self.state = "crouch";
    else if (it.x !== 0) self.state = forward > 0 ? "walk" : "walkBack";
    else self.state = "idle";
  },
  destroy(self) {
    self.entity.guarding = false;
  },
});

// ------------------------------------------------------------------ Avversario del picchiaduro

defineBlock({
  name: "FighterAI",
  label: "Avversario 1 contro 1",
  category: "IA",
  description:
    "Fa giocare il computer in uno scontro uno contro uno: si avvicina, colpisce quando è a tiro, ogni tanto indietreggia, para o salta. Imposta il Controller Picchiaduro su «IA o Regole».",
  requires: ["FighterController"],
  priority: 12,
  props: {
    target: { type: "tag", label: "Combatte contro chi ha l'etichetta", default: "giocatore" },
    reach: { type: "number", label: "Distanza del colpo", unit: "px", default: 20, min: 4 },
    aggression: { type: "number", label: "Quanto attacca", default: 0.6, min: 0, max: 1, step: 0.05, help: "0 = resta sulla difensiva, 1 = attacca sempre." },
    think: { type: "number", label: "Cambia idea ogni", unit: "s", default: 0.35, min: 0.05, step: 0.05 },
    jumpChance: { type: "number", label: "Quanto salta", default: 0.15, min: 0, max: 1, step: 0.05 },
  },
  conditions: {
    isAttacking: { label: "Sta attaccando", test: (self) => self.data.plan === "attack" },
  },
  init(self) {
    self.data.t = 0;
    self.data.plan = "close";
  },
  update(self, dt) {
    const e = self.entity;
    const p = self.props;
    const d = self.data;
    const it = e.intent;
    it.jump = it.jumpPressed = false;
    // Fermo quando è stordito, a terra o quando i comandi sono bloccati (annunci, K.O., filmati).
    const health = e.get("Health");
    const down = !!health && (health.data.dead || Number(health.data.hp) <= 0);
    if (e.stunned > 0 || down || self.game.controlsLocked) {
      it.x = it.y = 0;
      return;
    }
    const target = nearestTagged(self.scene, e, p.target);
    if (!target) {
      it.x = it.y = 0;
      return;
    }
    const from = bodyCenter(e);
    const to = bodyCenter(target);
    const dist = Math.abs(to.x - from.x);
    const near = dist <= p.reach;

    d.t -= dt;
    if (d.t <= 0) {
      d.t = p.think;
      const r = Math.random();
      // Vicino: colpisce o si difende. Lontano: si avvicina, ogni tanto saltando.
      if (near) d.plan = r < p.aggression ? "attack" : r < p.aggression + 0.35 ? "guard" : "back";
      else d.plan = r < p.jumpChance ? "jump" : "close";
    }
    const dir = Math.sign(to.x - from.x) || 1;
    switch (d.plan) {
      case "attack":
        it.x = near ? 0 : dir;
        e.get("Combo")?.actions.attack();
        e.get("Attack")?.actions.attack();
        d.plan = "close";
        break;
      case "guard":
        it.x = -dir;
        break;
      case "back":
        it.x = -dir;
        break;
      case "jump":
        it.x = dir;
        if (self.body?.onGround) it.jump = it.jumpPressed = true;
        d.plan = "close";
        break;
      default:
        it.x = near ? 0 : dir;
    }
    it.y = 0;
  },
});

// ------------------------------------------------------------------ Regia dell'incontro

interface Side {
  entity: Entity;
  health?: BlockInstance;
  x: number;
  y: number;
  wins: number;
}

/** I due lottatori, con la posizione di partenza da rimettere a ogni round. */
function sides(self: BlockInstance): [Side | null, Side | null] {
  const d = self.data;
  return [d.a ?? null, d.b ?? null];
}

const hpOf = (s: Side | null): number => (s?.health ? Number(s.health.data.hp) : 0);
const maxOf = (s: Side | null): number => (s?.health ? Math.max(1, Number(s.health.props.max)) : 1);

/** Rimette in piedi un lottatore all'inizio del round: vita piena e posto di partenza. */
function reset(s: Side | null): void {
  if (!s) return;
  const e = s.entity;
  e.x = s.x;
  e.y = s.y;
  e.stunned = 0;
  e.guarding = false;
  e.state = "idle";
  if (e.body) {
    e.body.vx = 0;
    e.body.vy = 0;
  }
  const h = s.health;
  if (!h) return;
  h.data.hp = h.props.max;
  h.data.dead = false;
  h.data.invuln = 0;
  if (h.props.variable) h.game.vars[h.props.variable] = h.data.hp;
  if (e.sprite) e.sprite.opacity = h.data.baseOpacity ?? 1;
}

/** Annuncio al centro dello schermo («Round 1», «Lotta!», «K.O.»). */
function announce(self: BlockInstance, text: string, seconds: number): void {
  self.data.text = text;
  self.data.textT = seconds;
}

function startRound(self: BlockInstance): void {
  const d = self.data;
  const [a, b] = sides(self);
  reset(a);
  reset(b);
  d.phase = "intro";
  d.timer = Number(self.props.time);
  d.phaseT = 1.6;
  announce(self, `${self.game.t("Round")} ${d.round}`, 1.6);
  self.game.lockControls = true;
}

/** Fine del round: 1 = ha vinto il primo, 2 = il secondo, 0 = pari. */
function endRound(self: BlockInstance, winner: number): void {
  const d = self.data;
  const [a, b] = sides(self);
  if (winner === 1 && a) a.wins++;
  if (winner === 2 && b) b.wins++;
  d.phase = "ko";
  d.phaseT = 2;
  self.game.lockControls = true;
  announce(self, self.game.t(winner === 0 ? "Tempo scaduto" : "K.O."), 2);
  self.emit("roundEnd", { winner });
}

defineBlock({
  name: "FightMatch",
  label: "Regia dell'incontro",
  category: "Gameplay",
  description:
    "Fa da arbitro a uno scontro uno contro uno: conta i round, il tempo e le vittorie, disegna le barre della vita con i nomi e annuncia «Round 1», «K.O.» e chi ha vinto. All'inizio di ogni round rimette i due al loro posto con la vita piena. Mettilo su un oggetto vuoto della scena.",
  priority: 70,
  props: {
    fighter1: { type: "tag", label: "Primo (etichetta)", default: "giocatore" },
    fighter2: { type: "tag", label: "Secondo (etichetta)", default: "avversario" },
    name1: { type: "string", label: "Nome del primo", default: "Pepino", translatable: true },
    name2: { type: "string", label: "Nome del secondo", default: "Rivale", translatable: true },
    rounds: { type: "integer", label: "Round da vincere", default: 2, min: 1, max: 5 },
    time: { type: "number", label: "Durata del round", unit: "s", default: 60, min: 0, step: 5, help: "0 = senza tempo." },
    winner: { type: "variable", label: "Chi vince nella variabile", default: "", optional: true, help: "1 = il primo, 2 = il secondo." },
    color1: { type: "color", label: "Colore del primo", default: "#8cc480", group: "Aspetto" },
    color2: { type: "color", label: "Colore del secondo", default: "#e5695f", group: "Aspetto" },
  },
  events: [
    { id: "roundStart", label: "Inizia un round" },
    { id: "roundEnd", label: "Finisce un round" },
    { id: "matchEnd", label: "Finisce l'incontro" },
  ],
  conditions: {
    isOver: { label: "L'incontro è finito", test: (self) => self.data.phase === "over" },
    isFighting: { label: "Si sta combattendo", test: (self) => self.data.phase === "fight" },
  },
  actions: {
    restart: {
      label: "Ricomincia l'incontro",
      run: (self) => {
        const [a, b] = sides(self);
        if (a) a.wins = 0;
        if (b) b.wins = 0;
        self.data.round = 1;
        startRound(self);
      },
    },
  },
  texts: ["Round", "Lotta!", "K.O.", "Tempo scaduto", "Vince {0}!"],
  init(self) {
    const p = self.props;
    const find = (tag: string): Side | null => {
      const e = self.scene.find(tag);
      return e ? { entity: e, health: e.get("Health"), x: e.x, y: e.y, wins: 0 } : null;
    };
    const d = self.data;
    d.a = find(p.fighter1);
    d.b = find(p.fighter2);
    d.round = 1;
    d.text = "";
    d.textT = 0;
    if (!d.a || !d.b) self.game.log(`Regia dell'incontro: mancano i lottatori con etichetta "${p.fighter1}" o "${p.fighter2}"`, "warn");
    startRound(self);
  },
  update(self, dt) {
    const d = self.data;
    const [a, b] = sides(self);
    if (d.textT > 0) d.textT -= dt;
    if (d.phaseT > 0) d.phaseT -= dt;

    if (d.phase === "intro") {
      if (d.phaseT > 0) return;
      d.phase = "fight";
      self.game.lockControls = false;
      announce(self, self.game.t("Lotta!"), 0.9);
      self.emit("roundStart", { round: d.round });
      return;
    }
    if (d.phase === "fight") {
      if (Number(self.props.time) > 0) d.timer = Math.max(0, d.timer - dt);
      const downA = !a || hpOf(a) <= 0;
      const downB = !b || hpOf(b) <= 0;
      if (downA || downB) return endRound(self, downA && downB ? 0 : downB ? 1 : 2);
      if (Number(self.props.time) > 0 && d.timer <= 0) {
        const ka = hpOf(a) / maxOf(a);
        const kb = hpOf(b) / maxOf(b);
        return endRound(self, ka === kb ? 0 : ka > kb ? 1 : 2);
      }
      return;
    }
    if (d.phase === "ko") {
      if (d.phaseT > 0) return;
      const need = Number(self.props.rounds);
      const winner = (a?.wins ?? 0) >= need ? 1 : (b?.wins ?? 0) >= need ? 2 : 0;
      if (!winner) {
        d.round++;
        return startRound(self);
      }
      d.phase = "over";
      self.game.lockControls = true;
      const name = self.game.t(winner === 1 ? self.props.name1 : self.props.name2);
      announce(self, self.game.t("Vince {0}!").replace("{0}", name), 99);
      if (self.props.winner) self.game.vars[self.props.winner] = winner;
      self.emit("matchEnd", { winner });
    }
  },
  renderScreen(self, r) {
    const p = self.props;
    const d = self.data;
    const [a, b] = sides(self);
    const W = r.width;
    const barW = W / 2 - 26;
    const t = Math.max(0.5, 1 / r.pixelScale);
    // Barre della vita: il primo da sinistra, il secondo da destra verso il centro.
    const bar = (x: number, k: number, color: string, mirror: boolean) => {
      r.rect(x - 1, 7, barW + 2, 8, hexColor("#000000", 0.55));
      const w = barW * clamp(k, 0, 1);
      r.rect(mirror ? x + barW - w : x, 8, w, 6, hexColor(color));
      r.strokeRect(x - 1, 7, barW + 2, 8, t, hexColor("#ffffff", 0.35));
    };
    bar(8, hpOf(a) / maxOf(a), p.color1, false);
    bar(W / 2 + 18, hpOf(b) / maxOf(b), p.color2, true);
    r.text(self.game.t(p.name1), 8, 17, { size: 7, outline: true });
    r.text(self.game.t(p.name2), W - 8, 17, { size: 7, align: "right", outline: true });
    // Tempo che resta e pallini dei round vinti.
    if (Number(p.time) > 0) r.text(String(Math.ceil(d.timer)), W / 2, 6, { size: 11, align: "center", outline: true });
    const need = Number(p.rounds);
    for (let i = 0; i < need; i++) {
      const on1 = (a?.wins ?? 0) > i;
      const on2 = (b?.wins ?? 0) > i;
      r.rect(W / 2 - 16 - i * 6, 18, 4, 4, hexColor(p.color1, on1 ? 1 : 0.25));
      r.rect(W / 2 + 12 + i * 6, 18, 4, 4, hexColor(p.color2, on2 ? 1 : 0.25));
    }
    if (d.textT > 0 && d.text) {
      r.text(String(d.text), W / 2, r.height / 2 - 14, { size: 16, align: "center", outline: true, color: "#fff3a6" });
    }
  },
});

import { defineBlock, type BlockInstance } from "../../core/block";
import type { Entity } from "../../core/entity";
import { frameRect } from "../../assets/assets";
import { hexColor, packColor } from "../../math";
import { drawArc } from "../../render/shapes";
import { lineOfSight } from "../../world/pathfinding";
import { bodyCenter } from "../targets";
import {
  BONUS_OPTIONS,
  CONTROL_PROPS,
  Nav,
  PLAYER_COLORS,
  bodyTouches,
  cellCenter,
  cellIndex,
  claimsOf,
  controlLabel,
  controlOf,
  flood,
  hauntablesOf,
  huntersFree,
  huntersOf,
  isBonus,
  isRunning,
  itemsOf,
  pathTo,
  playing,
  readHuman,
  runnersOf,
  skillOf,
  stopIntent,
  toScreen,
  type Field,
} from "./shared";
import { consumeItem, haunt, hauntReady, itemAvailable } from "./world";

/**
 * Fuggitivo: scappa, raccoglie caramelle e bonus e li usa. Se il Cacciatore lo prende diventa un fantasma
 * che passa nei muri, infesta lampioni, cancelli e oggetti e spaventa chi scappa ancora.
 * status: run (scappa) → turning (sta diventando fantasma) → ghost; oppure out (è fuggito dall'uscita).
 */

const TURN_TIME = 0.9;
const TIMERS = ["turbo", "cloak", "invuln", "scared", "booCd", "hauntCd", "flash", "booAnim", "pop"] as const;

const ts = (self: BlockInstance) => self.scene.tileSize;
const runTag = (self: BlockInstance) => String(self.props.tag || "ragazzo");

// ------------------------------------------------------------------ bonus

function useBonus(self: BlockInstance, kind: string): void {
  const d = self.data;
  const e = self.entity;
  const k = Math.max(0.25, Number(self.props.bonusTime) || 1);
  switch (kind) {
    case "flashlight": {
      // Un lampo tutto intorno: stordisce i Cacciatori vicini che non hanno un muro in mezzo.
      d.flash = 0.4;
      const c = bodyCenter(e);
      for (const h of huntersOf(self.scene)) {
        const hc = bodyCenter(h.entity);
        if (Math.hypot(hc.x - c.x, hc.y - c.y) <= 3.5 * ts(self) && lineOfSight(self.scene.grid, c.x, c.y, hc.x, hc.y)) h.actions.stun(2 * k);
      }
      break;
    }
    case "turbo":
      d.turbo = 4 * k;
      break;
    case "cloak":
      d.cloak = 4 * k;
      break;
    case "pumpkin":
      if (self.props.trap) self.scene.spawn(String(self.props.trap), e.worldX, e.worldY);
      else if (!d.warnedTrap) {
        d.warnedTrap = true;
        self.game.log(`"${e.name}": scegli il modello della zucca esplosiva nel blocco Fuggitivo`, "warn");
      }
      break;
  }
  if (self.props.useSound) self.game.audio.play(self.props.useSound);
  self.emit("used", kind);
}

/** Azione: usa il primo bonus in tasca (la chiave no: quella si usa da sola davanti a un cancello). */
function useNext(self: BlockInstance): void {
  const held = self.data.held as string[];
  const i = held.findIndex((k) => k !== "key");
  if (i < 0) return;
  const [kind] = held.splice(i, 1);
  useBonus(self, kind);
}

function exitTagOf(self: BlockInstance) {
  return String(self.props.exitTag || "");
}

/** Cancelli chiusi (non l'uscita) vicini: la chiave li apre. */
function useKey(self: BlockInstance): void {
  const held = self.data.held as string[];
  const k = held.indexOf("key");
  if (k < 0) return;
  const exit = exitTagOf(self);
  for (const h of hauntablesOf(self.scene)) {
    if (h.props.kind !== "gate" || (!h.data.locked && !h.data.closed)) continue;
    if (exit && h.entity.hasTag(exit)) continue;
    if (!bodyTouches(self.entity, h.entity, 4)) continue;
    h.actions.unlock();
    held.splice(k, 1);
    if (self.props.useSound) self.game.audio.play(self.props.useSound);
    self.emit("used", "key");
    return;
  }
}

function collect(self: BlockInstance): void {
  const d = self.data;
  const e = self.entity;
  const slots = Math.max(1, Number(self.props.slots) || 1);
  for (const item of itemsOf(self.scene)) {
    if (!itemAvailable(item) || !bodyTouches(e, item.entity, 1)) continue;
    const kind = String(item.data.kind);
    if (isBonus(kind) && d.held.length >= slots) continue;
    const got = consumeItem(item, e);
    if (got.kind === "candy") {
      d.candies += got.value;
      const v = String(self.props.candyVar || "");
      if (v) self.game.vars[v] = Number(self.game.vars[v] ?? 0) + got.value;
      d.popText = `+${got.value}`;
      d.pop = 0.8;
      if (self.props.candySound) self.game.audio.play(self.props.candySound);
      self.emit("candy", got.value);
    } else {
      d.held.push(got.kind);
      if (self.props.bonusSound) self.game.audio.play(self.props.bonusSound);
      self.emit("bonus", got.kind);
    }
  }
}

/** L'uscita è aperta (nessuna uscita chiusa, o un cancello con l'etichetta dell'uscita aperto). */
function exitOpen(self: BlockInstance): Entity[] {
  const tag = exitTagOf(self);
  if (!tag) return [];
  return self.scene.findAll(tag).filter((o) => {
    const h = o.get("Hauntable");
    return !h || !h.data.closed;
  });
}

function checkExit(self: BlockInstance): void {
  for (const o of exitOpen(self)) {
    if (bodyTouches(self.entity, o, 2)) {
      escape(self);
      return;
    }
  }
}

function escape(self: BlockInstance): void {
  const d = self.data;
  const e = self.entity;
  if (d.status !== "run") return;
  d.status = "out";
  e.tags.delete(runTag(self));
  e.visible = false;
  if (e.body) {
    e.body.vx = e.body.vy = 0;
    e.body.world = false;
  }
  stopIntent(e.intent);
  claimsOf(self.scene).forEach((who, cell, m) => who === e && m.delete(cell));
  if (self.props.escapeSound) self.game.audio.play(self.props.escapeSound);
  self.emit("escaped");
}

// ------------------------------------------------------------------ presa e fantasma

/** Il Cacciatore lo tocca: resiste (se ha ancora «prese da sopportare») o comincia a diventare un fantasma. */
export function catchRunner(self: BlockInstance, hunter: Entity): "caught" | "hit" | false {
  const d = self.data;
  const e = self.entity;
  if (d.status !== "run" || d.invuln > 0 || d.cloak > 0) return false;
  const hc = bodyCenter(hunter);
  const c = bodyCenter(e);
  if (d.hits > 0) {
    // Resiste: viene spinto via e per un attimo non si fa prendere.
    d.hits--;
    d.invuln = 1.6;
    const dx = c.x - hc.x;
    const dy = c.y - hc.y;
    const len = Math.hypot(dx, dy) || 1;
    if (e.body) {
      e.body.vx = (dx / len) * 11 * ts(self);
      e.body.vy = (dy / len) * 11 * ts(self);
    }
    e.stunned = 0.22;
    if (self.props.hitSound) self.game.audio.play(self.props.hitSound);
    self.emit("hit", hunter);
    return "hit";
  }
  d.status = "turning";
  d.turnT = 0;
  d.held = [];
  d.turbo = d.scared = 0;
  e.tags.delete(runTag(self));
  if (e.body) e.body.vx = e.body.vy = 0;
  stopIntent(e.intent);
  claimsOf(self.scene).forEach((who, cell, m) => who === e && m.delete(cell));
  if (self.props.caughtSound) self.game.audio.play(self.props.caughtSound);
  self.emit("caught", hunter);
  return "caught";
}

function becomeGhost(self: BlockInstance): void {
  const d = self.data;
  const e = self.entity;
  d.status = "ghost";
  e.tags.delete(runTag(self));
  if (self.props.ghostTag) e.tags.add(String(self.props.ghostTag));
  if (e.sprite && self.props.ghostImage) {
    e.sprite.image = String(self.props.ghostImage);
    e.sprite.frame = 0;
  }
  e.z = Math.max(e.z, 20);
  if (e.body) e.body.world = false;
  const ctrl = e.get("TopDownController");
  if (ctrl) ctrl.props.speed = Number(self.props.ghostSpeed) || ctrl.props.speed;
  d.nav.clear();
  d.think = 0.3;
  self.emit("ghost");
}

function boo(self: BlockInstance): void {
  const d = self.data;
  d.booCd = Number(self.props.booCooldown) || 0;
  d.booAnim = 0.55;
  const c = bodyCenter(self.entity);
  const range = (Number(self.props.booRange) || 1.5) * ts(self);
  for (const r of runnersOf(self.scene)) {
    if (r === self || !isRunning(r)) continue;
    const rc = bodyCenter(r.entity);
    if (Math.hypot(rc.x - c.x, rc.y - c.y) <= range) r.actions.scare(Number(self.props.scareTime) || 1);
  }
  if (self.props.booSound) self.game.audio.play(self.props.booSound);
  self.emit("boo");
}

/** La cosa infestabile pronta più vicina, entro la distanza del fantasma. */
function nearestHauntable(self: BlockInstance): BlockInstance | undefined {
  const c = bodyCenter(self.entity);
  const range = (Number(self.props.hauntRange) || 1.5) * ts(self);
  let best: BlockInstance | undefined;
  let bestD = range;
  for (const h of hauntablesOf(self.scene)) {
    if (!hauntReady(h)) continue;
    const hc = bodyCenter(h.entity);
    const dd = Math.hypot(hc.x - c.x, hc.y - c.y);
    if (dd <= bestD) {
      best = h;
      bestD = dd;
    }
  }
  return best;
}

function ghostAction(self: BlockInstance): void {
  const d = self.data;
  const h = d.hauntCd <= 0 ? nearestHauntable(self) : undefined;
  if (h && haunt(h, self.entity)) {
    d.hauntCd = 1.2;
    self.emit("haunt", h.entity);
    return;
  }
  if (d.booCd <= 0) boo(self);
}

/** I fantasmi passano nei muri ma non escono dalla scena. */
function keepInside(self: BlockInstance): void {
  const e = self.entity;
  const s = ts(self);
  const minX = s * 0.6;
  const maxX = self.scene.widthPx - s * 0.6;
  const minY = s * 1.2;
  const maxY = self.scene.heightPx - s * 0.6;
  if (e.x < minX) e.x = minX;
  if (e.x > maxX) e.x = maxX;
  if (e.y < minY) e.y = minY;
  if (e.y > maxY) e.y = maxY;
}

// ------------------------------------------------------------------ cervello del computer

interface Threat {
  h: BlockInstance;
  dist: number;
  sees: boolean;
}

function nearestThreat(self: BlockInstance): Threat | null {
  if (!huntersFree(self.scene)) return null;
  const c = bodyCenter(self.entity);
  let best: Threat | null = null;
  for (const h of huntersOf(self.scene)) {
    if (h.data.stun > 0 || h.data.status === "absent") continue;
    const hc = bodyCenter(h.entity);
    const dist = Math.hypot(hc.x - c.x, hc.y - c.y);
    if (best && dist >= best.dist) continue;
    best = { h, dist, sees: lineOfSight(self.scene.grid, c.x, c.y, hc.x, hc.y) };
  }
  return best;
}

/** Lampioni accesi, per preferire le zone illuminate quando scappa. */
function lamps(self: BlockInstance): { x: number; y: number; r2: number }[] {
  const tag = String(self.props.lightTag || "");
  if (!tag) return [];
  const out: { x: number; y: number; r2: number }[] = [];
  for (const e of self.scene.findAll(tag)) {
    const l = e.get("Light");
    if (!l?.enabled || !l.data.on) continue;
    const r = Number(l.props.radius ?? 0) * ts(self) * 0.6;
    out.push({ x: e.worldX, y: e.worldY, r2: r * r });
  }
  return out;
}

function planFlee(self: BlockInstance, hunter: BlockInstance, fK: Field): void {
  const grid = self.scene.grid;
  const hc = bodyCenter(hunter.entity);
  const fH = flood(grid, cellIndex(grid, hc.x, hc.y), 60);
  const light = lamps(self);
  let best = -1;
  let bestS = -Infinity;
  let far = -1;
  let farD = -1;
  for (let i = 0; i < fK.dist.length; i++) {
    const dk = fK.dist[i];
    if (dk < 1 || dk > 14) continue;
    const dh = fH.dist[i] < 0 ? 40 : fH.dist[i];
    if (dh > farD && dk <= 10) {
      farD = dh;
      far = i;
    }
    if (dk < 2 || dh <= dk) continue;
    let s = dh - 0.75 * dk + Math.random() * 0.8;
    const cc = cellCenter(grid, i);
    if (light.some((l) => (cc.x - l.x) ** 2 + (cc.y - l.y) ** 2 < l.r2)) s += 3.5;
    if (s > bestS) {
      bestS = s;
      best = i;
    }
  }
  const goal = best >= 0 ? best : far;
  self.data.nav.set(pathTo(fK, goal), goal);
  self.data.mode = "flee";
}

function claim(self: BlockInstance, cell: number): void {
  const m = claimsOf(self.scene);
  m.forEach((who, c) => who === self.entity && m.delete(c));
  if (cell >= 0) m.set(cell, self.entity);
}

function planGoal(self: BlockInstance, fK: Field, threat: Threat | null): void {
  const d = self.data;
  const grid = self.scene.grid;
  const s = ts(self);
  // 1) L'uscita è aperta: si scappa.
  const exits = exitOpen(self);
  if (exits.length) {
    let best = -1;
    let bestD = Infinity;
    for (const o of exits) {
      const b = o.body;
      const pts = b ? [bodyCenter(o), { x: b.left + 2, y: b.top + b.h / 2 }, { x: b.right - 2, y: b.top + b.h / 2 }] : [{ x: o.worldX, y: o.worldY }];
      for (const p of pts) {
        const i = cellIndex(grid, p.x, p.y);
        const dd = fK.dist[i];
        if (dd >= 0 && dd < bestD) {
          bestD = dd;
          best = i;
        }
      }
    }
    if (best >= 0) {
      d.nav.set(pathTo(fK, best), best);
      d.mode = "exit";
      claim(self, -1);
      return;
    }
  }
  const hc = threat ? bodyCenter(threat.h.entity) : null;
  const claims = claimsOf(self.scene);
  const slots = Math.max(1, Number(self.props.slots) || 1);
  let best = -1;
  let bestCost = Infinity;
  // 2) Con la chiave: un cancello chiuso a chiave vicino (le scorciatoie nascondono caramelle).
  if (d.held.includes("key")) {
    const exit = exitTagOf(self);
    for (const h of hauntablesOf(self.scene)) {
      if (h.props.kind !== "gate" || !h.data.locked || (exit && h.entity.hasTag(exit))) continue;
      for (const cell of h.data.cells as number[]) {
        for (const n of [cell - 1, cell + 1, cell - grid.cols, cell + grid.cols]) {
          const dd = n >= 0 && n < fK.dist.length ? fK.dist[n] : -1;
          if (dd >= 0 && dd < 20 && dd - 6 < bestCost) {
            bestCost = dd - 6;
            best = n;
          }
        }
      }
    }
  }
  // 3) Caramelle e bonus: i più vicini, quelli che valgono di più, lontano dal mostro e da quelli presi di mira da altri.
  for (const item of itemsOf(self.scene)) {
    if (!itemAvailable(item)) continue;
    const kind = String(item.data.kind);
    const bonus = isBonus(kind);
    if (bonus && d.held.length >= slots) continue;
    const ic = bodyCenter(item.entity);
    const cell = cellIndex(grid, ic.x, ic.y);
    const dd = fK.dist[cell];
    if (dd < 0) continue;
    let cost = dd - (bonus ? (d.held.length ? 1 : 3) : Math.min(4, Number(item.props.value) || 1) * 2.2);
    if (hc) {
      const near = Math.hypot(hc.x - ic.x, hc.y - ic.y) / s;
      if (near < 5) cost += (5 - near) * 2.5;
    }
    const owner = claims.get(cell);
    if (owner && owner !== self.entity && !owner.destroyed) cost += 7;
    if (cost < bestCost) {
      bestCost = cost;
      best = cell;
    }
  }
  if (best >= 0) {
    d.nav.set(pathTo(fK, best), best);
    d.mode = "collect";
    claim(self, best);
    return;
  }
  // 4) Niente da fare: gira per il quartiere.
  const choices: number[] = [];
  for (let i = 0; i < fK.dist.length; i++) if (fK.dist[i] >= 5 && fK.dist[i] <= 14) choices.push(i);
  const goal = choices.length ? choices[Math.floor(Math.random() * choices.length)] : -1;
  d.nav.set(goal >= 0 ? pathTo(fK, goal) : null, goal);
  d.mode = "wander";
  claim(self, -1);
}

/** Usa un bonus quando il mostro è vicino (più spesso se è bravo). */
function wantsBonus(self: BlockInstance, t: Threat, skill: number, dt: number): boolean {
  const held = self.data.held as string[];
  const kind = held.find((k) => k !== "key");
  if (!kind) return false;
  const s = ts(self);
  const ok =
    (kind === "flashlight" && t.dist < 3 * s && t.sees) ||
    (kind === "pumpkin" && t.dist < 4 * s) ||
    (kind === "cloak" && t.dist < 2.2 * s) ||
    (kind === "turbo" && t.dist < 3.5 * s);
  return ok && Math.random() < [2, 4, 8][skill - 1] * dt;
}

function runnerBrain(self: BlockInstance, dt: number): boolean {
  const d = self.data;
  const e = self.entity;
  const grid = self.scene.grid;
  const skill = skillOf(self);
  const threat = nearestThreat(self);
  const fear = [4.5, 6, 7.5][skill - 1] * ts(self) * (threat?.h.data.lungeT > 0 ? 1.4 : 1);
  const danger = !!threat && threat.dist < fear && (threat.sees || threat.dist < 3 * ts(self));
  const act = !!threat && wantsBonus(self, threat, skill, dt);
  d.think -= dt;
  if (danger && d.mode !== "flee") d.think = Math.min(d.think, [0.25, 0.12, 0.04][skill - 1]);
  if (!danger && d.mode === "flee" && d.think > 0.15) d.think = 0.15;
  if (d.think <= 0 || d.nav.stuck) {
    d.think = [0.55, 0.38, 0.26][skill - 1] + Math.random() * 0.1;
    const c = bodyCenter(e);
    const fK = flood(grid, cellIndex(grid, c.x, c.y));
    if (danger && threat) planFlee(self, threat.h, fK);
    else planGoal(self, fK, threat);
  }
  if (d.nav.follow(e, e.intent, dt) && d.mode !== "flee") d.think = Math.min(d.think, 0.05);
  return act;
}

function ghostBrain(self: BlockInstance, dt: number): boolean {
  const d = self.data;
  const e = self.entity;
  const it = e.intent;
  const s = ts(self);
  const c = bodyCenter(e);
  d.think -= dt;
  if (d.think <= 0) {
    d.think = 0.4 + Math.random() * 0.15;
    const kids = runnersOf(self.scene).filter((r) => r !== self && isRunning(r) && !(r.data.cloak > 0));
    d.goal = null;
    if (kids.length) {
      const kidNear = (x: number, y: number) =>
        Math.min(...kids.map((k) => {
          const kc = bodyCenter(k.entity);
          return Math.hypot(kc.x - x, kc.y - y);
        }));
      if (d.hauntCd <= 0 && Math.random() < 0.85) {
        let bestCost = Infinity;
        for (const h of hauntablesOf(self.scene)) {
          if (!hauntReady(h)) continue;
          const hc = bodyCenter(h.entity);
          const kn = kidNear(hc.x, hc.y);
          const far = Math.hypot(hc.x - c.x, hc.y - c.y);
          if (kn > 5 * s || far > 16 * s) continue;
          const cost = far / s + (kn / s) * 0.8 + (h.props.kind === "lamp" ? 0 : 1);
          if (cost < bestCost) {
            bestCost = cost;
            d.goal = { haunt: h, x: hc.x, y: hc.y };
          }
        }
      }
      if (!d.goal) {
        let kid = kids[0];
        let kd = Infinity;
        for (const k of kids) {
          const kc = bodyCenter(k.entity);
          const dd = Math.hypot(kc.x - c.x, kc.y - c.y);
          if (dd < kd) {
            kd = dd;
            kid = k;
          }
        }
        d.goal = { kid: kid.entity, x: 0, y: 0 };
      }
    }
  }
  const g = d.goal as { haunt?: BlockInstance; kid?: Entity; x: number; y: number } | null;
  if (!g) {
    stopIntent(it);
    return false;
  }
  let act = false;
  let tx = g.x;
  let ty = g.y;
  let stopAt = 0;
  if (g.haunt) {
    stopAt = (Number(self.props.hauntRange) || 1.5) * s * 0.6;
    if (!hauntReady(g.haunt)) {
      d.goal = null;
      d.think = 0;
    } else if (Math.hypot(tx - c.x, ty - c.y) <= stopAt + 2) act = true;
  } else if (g.kid) {
    if (g.kid.destroyed || !g.kid.get("Runner") || !isRunning(g.kid.get("Runner")!)) {
      d.goal = null;
      d.think = 0;
      stopIntent(it);
      return false;
    }
    const kc = bodyCenter(g.kid);
    tx = kc.x;
    ty = kc.y;
    const dist = Math.hypot(tx - c.x, ty - c.y);
    if (d.booCd <= 0) {
      stopAt = (Number(self.props.booRange) || 1.5) * s * 0.55;
      if (dist <= stopAt + 3) act = true;
    } else {
      // Aspetta di poter spaventare di nuovo girando intorno, a un paio di tile.
      const a = self.scene.time * 1.3 + e.uid;
      tx += Math.cos(a) * 2.5 * s;
      ty += Math.sin(a) * 2 * s;
    }
  }
  const vx = tx - c.x;
  const vy = ty - c.y;
  const len = Math.hypot(vx, vy);
  if (len <= stopAt || len < 1) {
    it.x = it.y = 0;
  } else {
    const k = len > 3 * s ? 1 : 0.75;
    it.x = (vx / len) * k;
    it.y = (vy / len) * k;
  }
  return act;
}

// ------------------------------------------------------------------ blocco

defineBlock({
  name: "Runner",
  label: "Fuggitivo",
  category: "Personaggi",
  description:
    "Un personaggio che scappa e raccoglie: prende le caramelle e i bonus che tocca (torcia, caramella turbo, mantello, zucca esplosiva, chiave) e li usa con Azione; esce dall'uscita quando è aperta. Se un Cacciatore lo prende diventa un fantasma: passa nei muri, spegne le luci, chiude i cancelli, sposta gli oggetti e fa «Buh!» a chi scappa ancora. Lo comanda un giocatore con i suoi tasti o il computer.",
  requires: ["Body", "TopDownController"],
  priority: 10,
  props: {
    ...CONTROL_PROPS,
    name: { type: "text", label: "Nome", default: "Ragazzo", translatable: true, group: "Personaggio" },
    portrait: { type: "image", label: "Ritratto", default: "", optional: true, group: "Personaggio" },
    portraitFrame: { type: "integer", label: "Fotogramma del ritratto", default: 0, min: 0, group: "Personaggio" },
    color: { type: "color", label: "Colore", default: "#b46cff", group: "Personaggio" },
    extraHits: {
      type: "integer",
      label: "Prese da sopportare",
      default: 0,
      min: 0,
      max: 5,
      group: "Personaggio",
      help: "Quante volte il Cacciatore lo può toccare prima che diventi un fantasma.",
    },
    stealth: {
      type: "number",
      label: "Visibilità",
      default: 1,
      min: 0.2,
      max: 1.5,
      step: 0.05,
      group: "Personaggio",
      help: "1 = normale, 0.5 = il computer lo vede solo da metà distanza e la sua lucina è più piccola.",
    },
    slots: { type: "integer", label: "Bonus che può tenere", default: 1, min: 1, max: 3, group: "Bonus" },
    bonusTime: { type: "number", label: "Durata dei bonus", unit: "×", default: 1, min: 0.25, step: 0.25, group: "Bonus" },
    candyVar: { type: "variable", label: "Caramelle della squadra", default: "caramelle", optional: true, group: "Bonus" },
    trap: { type: "prefab", label: "Modello della zucca esplosiva", default: "", optional: true, group: "Bonus" },
    tag: { type: "tag", label: "Etichetta mentre scappa", default: "ragazzo", group: "Etichette" },
    ghostTag: { type: "tag", label: "Etichetta da fantasma", default: "fantasma", group: "Etichette" },
    exitTag: { type: "tag", label: "Uscita", default: "uscita", group: "Etichette" },
    lightTag: { type: "tag", label: "Luci che proteggono", default: "lampione", group: "Etichette" },
    ghostImage: { type: "image", label: "Sprite da fantasma", default: "", optional: true, group: "Fantasma" },
    ghostSpeed: { type: "number", label: "Velocità da fantasma", unit: "tile/s", default: 4.5, min: 0, step: 0.5, group: "Fantasma" },
    hauntRange: { type: "number", label: "Infesta da", unit: "tile", default: 1.5, min: 0.5, step: 0.25, group: "Fantasma" },
    booRange: { type: "number", label: "«Buh!» fino a", unit: "tile", default: 1.8, min: 0.5, step: 0.25, group: "Fantasma" },
    booCooldown: { type: "number", label: "Pausa tra due «Buh!»", unit: "s", default: 4, min: 0, step: 0.5, group: "Fantasma" },
    scareTime: { type: "number", label: "Lo spavento dura", unit: "s", default: 1.6, min: 0, step: 0.1, group: "Fantasma" },
    candySound: { type: "audio", label: "Caramella", default: "", optional: true, group: "Suoni" },
    bonusSound: { type: "audio", label: "Bonus raccolto", default: "", optional: true, group: "Suoni" },
    useSound: { type: "audio", label: "Bonus usato", default: "", optional: true, group: "Suoni" },
    hitSound: { type: "audio", label: "Toccato ma resiste", default: "", optional: true, group: "Suoni" },
    caughtSound: { type: "audio", label: "Preso", default: "", optional: true, group: "Suoni" },
    booSound: { type: "audio", label: "«Buh!»", default: "", optional: true, group: "Suoni" },
    escapeSound: { type: "audio", label: "Fuggito", default: "", optional: true, group: "Suoni" },
  },
  states: [
    { id: "idle", label: "Fermo" },
    { id: "walk", label: "Cammina" },
    { id: "scared", label: "Spaventato" },
    { id: "caught", label: "Preso" },
    { id: "boo", label: "Fa «Buh!» (fantasma)" },
  ],
  events: [
    { id: "candy", label: "Ha preso una caramella" },
    { id: "bonus", label: "Ha preso un bonus" },
    { id: "used", label: "Ha usato un bonus" },
    { id: "hit", label: "Toccato, ma resiste" },
    { id: "caught", label: "È stato preso" },
    { id: "ghost", label: "È diventato un fantasma" },
    { id: "haunt", label: "Da fantasma ha infestato qualcosa" },
    { id: "boo", label: "Da fantasma ha fatto «Buh!»" },
    { id: "scared", label: "Si è spaventato" },
    { id: "escaped", label: "È fuggito dall'uscita" },
  ],
  conditions: {
    isRunning: { label: "Scappa ancora", test: (self) => self.data.status === "run" },
    isGhost: { label: "È un fantasma", test: (self) => self.data.status === "ghost" || self.data.status === "turning" },
    hasEscaped: { label: "È fuggito", test: (self) => self.data.status === "out" },
    isHuman: { label: "Lo comanda un giocatore", test: (self) => self.data.slot > 0 },
    holds: {
      label: "Ha in tasca un bonus",
      params: {
        kind: {
          type: "select",
          label: "Bonus",
          default: "flashlight",
          options: BONUS_OPTIONS,
        },
      },
      test: (self, kind: string) => (self.data.held as string[] | undefined)?.includes(kind) ?? false,
    },
  },
  actions: {
    makeGhost: {
      label: "Diventa un fantasma",
      run: (self) => {
        if (self.data.status !== "run") return;
        self.data.invuln = self.data.cloak = self.data.hits = 0;
        catchRunner(self, self.entity);
      },
    },
    scare: {
      label: "Spaventalo",
      params: { seconds: { type: "number", label: "Per quanti secondi", default: 1.5, min: 0, step: 0.25 } },
      run: (self, seconds: number) => {
        const d = self.data;
        if (d.status !== "run" || d.cloak > 0) return;
        d.scared = Math.max(d.scared, Number(seconds) || 0);
        self.emit("scared");
      },
    },
    giveBonus: {
      label: "Dagli un bonus",
      params: {
        kind: { type: "select", label: "Bonus", default: "flashlight", options: BONUS_OPTIONS },
      },
      run: (self, kind: string) => {
        if (self.data.status === "run" && isBonus(kind)) self.data.held.push(kind);
      },
    },
    escape: { label: "Fallo fuggire", run: (self) => escape(self) },
  },
  texts: ["TU", "Buh!"],
  init(self) {
    const d = self.data;
    const e = self.entity;
    d.slot = controlOf(self);
    d.held = [];
    d.candies = 0;
    d.nav = new Nav();
    d.think = Math.random() * 0.3;
    d.mode = "";
    for (const k of TIMERS) d[k] = 0;
    if (d.slot < 0) {
      // Non partecipa a questa partita.
      d.status = "absent";
      e.destroy();
      return;
    }
    d.status = "run";
    d.hits = Math.max(0, Number(self.props.extraHits) || 0);
    e.tags.add(runTag(self));
    const ctrl = e.get("TopDownController");
    if (ctrl) ctrl.props.input = "ai";
  },
  update(self, dt) {
    const d = self.data;
    const e = self.entity;
    const it = e.intent;
    if (d.status === "absent") return;
    for (const k of TIMERS) if (d[k] > 0) d[k] = Math.max(0, d[k] - dt);
    if (d.status === "out") return stopIntent(it);
    if (d.status === "turning") {
      stopIntent(it);
      d.turnT += dt;
      if (d.turnT >= TURN_TIME) becomeGhost(self);
      return;
    }
    const live = playing(self.scene);
    let act = false;
    if (!live) stopIntent(it);
    else if (d.slot > 0) act = readHuman(self, d.slot, it);
    else act = d.status === "ghost" ? ghostBrain(self, dt) : runnerBrain(self, dt);
    if (live && d.status === "run") {
      if (d.scared > 0) {
        // Spaventato: le gambe tremano e la strada sbanda.
        const w = self.scene.time * 9 + e.uid;
        it.x += Math.sin(w) * 0.6;
        it.y += Math.cos(w * 1.3) * 0.6;
      }
      collect(self);
      useKey(self);
      if (act) useNext(self);
      checkExit(self);
    } else if (live && d.status === "ghost") {
      if (act) ghostAction(self);
    }
    if (d.status === "ghost") keepInside(self);
    e.boosts.speed = d.status === "run" ? (d.turbo > 0 ? 1.6 : 1) * (d.scared > 0 ? 0.45 : 1) : 1;
  },
  late(self) {
    const d = self.data;
    const e = self.entity;
    const s = e.sprite;
    if (!s || d.status === "absent") return;
    const t = self.scene.time;
    e.fx.dy = 0;
    if (d.status === "turning") {
      e.state = "caught";
      const u = d.turnT / TURN_TIME;
      e.fx.dy = -u * 6;
      s.opacity = 1 - u * 0.5;
      s.flash = Math.floor(u * 10) % 2 ? 0.7 : 0;
    } else if (d.status === "ghost") {
      if (d.booAnim > 0) e.state = "boo";
      e.fx.dy = Math.round(Math.sin(t * 3 + e.uid) * 1.5) - 2;
      s.opacity = 0.82 + 0.1 * Math.sin(t * 5 + e.uid);
      s.flash = 0;
    } else if (d.status === "run") {
      if (d.scared > 0) e.state = "scared";
      s.opacity = d.cloak > 0 ? 0.22 + 0.08 * Math.sin(t * 20) : d.invuln > 0 && Math.floor(t * 12) % 2 === 0 ? 0.35 : 1;
      s.flash = 0;
    }
  },
  render(self, r) {
    const d = self.data;
    const e = self.entity;
    if (d.status === "turning") {
      // Un vortice viola mentre diventa un fantasma.
      const u = d.turnT / TURN_TIME;
      const c = bodyCenter(e);
      const a = self.scene.time * 9;
      drawArc(r, c.x, c.y - 4, 6 + u * 6, 9 + u * 8, a, a + 2.4, "#b98cff", 1 - u * 0.4);
      drawArc(r, c.x, c.y - 4, 6 + u * 6, 9 + u * 8, a + Math.PI, a + Math.PI + 2.4, "#7fe6ff", 1 - u * 0.4);
    } else if (d.status === "run" && d.turbo > 0 && e.body && Math.hypot(e.body.vx, e.body.vy) > 20) {
      // Scia della caramella turbo.
      const c = bodyCenter(e);
      const len = Math.hypot(e.body.vx, e.body.vy);
      const nx = -e.body.vx / len;
      const ny = -e.body.vy / len;
      for (let i = 1; i <= 3; i++) r.rect(c.x + nx * i * 4 - 1 + (i % 2) * 2, c.y + ny * i * 4 - 4 + i, 2, 1, hexColor("#5ee0ff", 0.8 - i * 0.2));
    }
  },
  renderScreen(self, r) {
    const d = self.data;
    const e = self.entity;
    if (d.status === "absent" || d.status === "out") return;
    const sp = e.sprite;
    const img = sp ? self.game.assets.image(sp.image) : undefined;
    const top = e.worldY - (img ? frameRect(img, sp!.frame).fh : 20) + e.fx.dy;
    const p = toScreen(self.scene, e.worldX, top);
    const bob = Math.round(Math.sin(self.scene.time * 5 + e.uid) * 1);
    // Chi è comandato da un giocatore ha la sua etichetta colorata sopra la testa.
    if (d.slot > 0) {
      const label = controlLabel(self, d.slot);
      const col = PLAYER_COLORS[(d.slot - 1) % PLAYER_COLORS.length];
      const w = r.measureText(label, { size: 6 }) + 5;
      const y = p.y - 11 + bob;
      r.rect(p.x - w / 2, y, w, 8, hexColor(col, d.status === "ghost" ? 0.7 : 1));
      r.rect(p.x - 1, y + 8, 3, 1, hexColor(col));
      r.rect(p.x, y + 9, 1, 1, hexColor(col));
      r.text(label, p.x, y + 0.5, { size: 6, align: "center", color: "#1a0f2a" });
    }
    if (d.pop > 0 && d.popText) {
      const u = 1 - d.pop / 0.8;
      r.text(d.popText, p.x + 6, p.y - 4 - u * 10, { size: 7, align: "center", color: "#ffe066", outline: true });
    }
    if (d.status === "run" && d.scared > 0) r.text("!", p.x, p.y - 20 + bob, { size: 10, align: "center", color: "#ff6b5e", outline: true });
    if (d.status === "ghost" && d.booAnim > 0) {
      const u = 1 - d.booAnim / 0.55;
      r.text(self.game.t("Buh!"), p.x, p.y - 14 - u * 6, { size: 8 + u * 3, align: "center", color: "#bff4ff", outline: "#2a1a4a" });
    }
  },
  renderLight(self, r) {
    const d = self.data;
    const e = self.entity;
    if (d.status === "absent" || d.status === "out") return;
    const s = ts(self);
    const c = bodyCenter(e);
    const glow = (rad: number, col: string, a: number, dy = -6) =>
      r.drawUV(r.radial, 0, 0, 1, 1, c.x - rad, c.y + dy - rad, rad * 2, rad * 2, hexColor(col, a));
    if (d.status === "ghost") glow(1.6 * s, "#7fd8ff", 0.75, -8);
    else if (d.status === "turning") glow((1 + d.turnT * 2) * s, "#b98cff", 0.9);
    else {
      const k = Math.max(0.3, Number(self.props.stealth) || 1);
      glow(1.5 * s * k, d.cloak > 0 ? "#c58bff" : "#ffcf8a", d.cloak > 0 ? 0.35 : 0.8 * Math.min(1, k + 0.2));
    }
    if (d.flash > 0) glow(5 * s * (1 - d.flash / 0.4 + 0.4), "#fff6d8", 2.5 * (d.flash / 0.4));
  },
  renderDebug(self, r) {
    const path = self.data.nav?.path as { x: number; y: number }[] | null;
    if (!path) return;
    const s = ts(self);
    for (const c of path) r.rect(c.x * s + 6, c.y * s + 6, s - 12, s - 12, packColor(0.4, 0.8, 1, 0.5));
  },
  destroy(self) {
    const m = claimsOf(self.scene);
    m.forEach((who, cell) => who === self.entity && m.delete(cell));
  },
});

/** Il Fuggitivo è comandato da un giocatore: 1..4, 0 = il computer. */
export const runnerSlot = (r: BlockInstance): number => Number(r.data.slot) || 0;

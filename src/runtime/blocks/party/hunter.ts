import { defineBlock, type BlockInstance } from "../../core/block";
import type { Entity } from "../../core/entity";
import { frameRect } from "../../assets/assets";
import { hexColor, packColor } from "../../math";
import { lineOfSight } from "../../world/pathfinding";
import { bodyCenter } from "../targets";
import {
  CONTROL_PROPS,
  Nav,
  PLAYER_COLORS,
  bodyTouches,
  cellIndex,
  clearLine,
  controlLabel,
  controlOf,
  flood,
  huntersFree,
  isRunning,
  itemsOf,
  litAt,
  pathTo,
  playing,
  readHuman,
  runnersOf,
  skillOf,
  stopIntent,
  toScreen,
} from "./shared";
import { catchRunner } from "./runner";
import { itemAvailable } from "./world";

/**
 * Cacciatore: insegue e prende i Fuggitivi toccandoli. Con Azione fa uno scatto in avanti;
 * la torcia e le trappole lo stordiscono, nella luce dei lampioni rallenta.
 */

const TIMERS = ["stun", "lungeT", "lungeCd", "pause", "immune"] as const;

const ts = (self: BlockInstance) => self.scene.tileSize;

function startLunge(self: BlockInstance): void {
  const d = self.data;
  const e = self.entity;
  let x = e.intent.x;
  let y = e.intent.y;
  if (!x && !y) {
    x = e.direction === "left" ? -1 : e.direction === "right" ? 1 : 0;
    y = e.direction === "up" ? -1 : e.direction === "down" ? 1 : 0;
  }
  const len = Math.hypot(x, y) || 1;
  d.lx = x / len;
  d.ly = y / len;
  const speed = Math.max(1, Number(self.props.lungeSpeed) || 12);
  d.lungeT = (Number(self.props.lungeDistance) || 2) / speed;
  d.lungeCd = Number(self.props.lungeCooldown) || 0;
  if (self.props.lungeSound) self.game.audio.play(self.props.lungeSound);
  self.emit("lunge");
}

function stun(self: BlockInstance, seconds: number): void {
  const d = self.data;
  if (d.immune > 0 || !(seconds > 0)) return;
  d.stun = Math.max(d.stun, seconds);
  d.immune = seconds + (Number(self.props.stunImmunity) || 0);
  d.lungeT = 0;
  const b = self.entity.body;
  if (b) b.vx = b.vy = 0;
  stopIntent(self.entity.intent);
  if (self.props.stunSound) self.game.audio.play(self.props.stunSound);
  self.emit("stunned");
}

function tryCatch(self: BlockInstance): void {
  const d = self.data;
  const e = self.entity;
  const target = String(self.props.target || "");
  for (const r of runnersOf(self.scene)) {
    if (!isRunning(r) || (target && !r.entity.hasTag(target))) continue;
    if (!bodyTouches(e, r.entity, 2)) continue;
    const res = catchRunner(r, e);
    if (res === "caught") {
      d.captures++;
      d.pause = Number(self.props.catchPause) || 0;
      d.lungeT = 0;
      if (e.body) e.body.vx = e.body.vy = 0;
      if (self.props.catchSound) self.game.audio.play(self.props.catchSound);
      self.scene.camera.shake(3, 0.35);
      self.emit("caught", r.entity);
    } else if (res === "hit") d.pause = Math.max(d.pause, 0.4);
  }
}

// ------------------------------------------------------------------ cervello del computer

interface Memory {
  e: Entity;
  x: number;
  y: number;
  t: number;
}

function hunterBrain(self: BlockInstance, dt: number): boolean {
  const d = self.data;
  const e = self.entity;
  const it = e.intent;
  const scene = self.scene;
  const grid = scene.grid;
  const s = ts(self);
  const skill = skillOf(self);
  const c = bodyCenter(e);
  const sight = (Number(self.props.sight) || 8) * s * [0.78, 1, 1.22][skill - 1];
  const now = scene.time;
  const mem = d.memory as Map<number, Memory>;
  const target = String(self.props.target || "");
  // Chi vede (o sente, se è vicinissimo) lo ricorda per qualche secondo.
  for (const r of runnersOf(scene)) {
    if (!isRunning(r) || r.data.cloak > 0 || (target && !r.entity.hasTag(target))) {
      mem.delete(r.entity.uid);
      continue;
    }
    const rc = bodyCenter(r.entity);
    const dist = Math.hypot(rc.x - c.x, rc.y - c.y);
    const stealth = Math.max(0.2, Number(r.props.stealth) || 1);
    const seen = dist < 2.5 * s || (dist < sight * stealth && lineOfSight(grid, c.x, c.y, rc.x, rc.y));
    if (seen) mem.set(r.entity.uid, { e: r.entity, x: rc.x, y: rc.y, t: now });
  }
  for (const [k, m] of mem) if (now - m.t > 4 || m.e.destroyed) mem.delete(k);

  d.think -= dt;
  if (d.think <= 0 || d.nav.stuck) {
    d.think = [0.42, 0.3, 0.2][skill - 1];
    const field = flood(grid, cellIndex(grid, c.x, c.y));
    let best: Memory | null = null;
    let bestCost = Infinity;
    for (const m of mem.values()) {
      const dd = field.dist[cellIndex(grid, m.x, m.y)];
      if (dd < 0) continue;
      // Resta sulla stessa preda se un'altra non è molto più vicina.
      const cost = dd + (now - m.t) * 2 - (d.prey === m.e.uid ? 3 : 0);
      if (cost < bestCost) {
        bestCost = cost;
        best = m;
      }
    }
    if (best) {
      d.prey = best.e.uid;
      const cell = cellIndex(grid, best.x, best.y);
      d.nav.set(pathTo(field, cell), cell);
      d.mode = "chase";
    } else if (d.mode !== "wander" || !d.nav.path?.length) {
      d.prey = 0;
      d.mode = "wander";
      // Va dove ci sono ancora caramelle (lì arriveranno i ragazzi) o, se è aperta, verso l'uscita.
      const spots: number[] = [];
      const exitTag = String(self.props.guardTag || "");
      const exits = exitTag ? scene.findAll(exitTag).filter((o) => !o.get("Hauntable")?.data.closed) : [];
      if (exits.length && Math.random() < 0.6) {
        for (const o of exits) {
          const oc = bodyCenter(o);
          for (let k = 0; k < 6; k++) spots.push(cellIndex(grid, oc.x + (Math.random() - 0.7) * 6 * s, oc.y + (Math.random() - 0.5) * 6 * s));
        }
      } else {
        for (const item of itemsOf(scene)) if (itemAvailable(item)) spots.push(cellIndex(grid, item.entity.worldX, item.entity.worldY - 4));
      }
      const ok = spots.filter((i) => field.dist[i] >= 4);
      const pool = ok.length ? ok : [...Array(field.dist.length).keys()].filter((i) => field.dist[i] >= 6 && field.dist[i] <= 20);
      const goal = pool.length ? pool[Math.floor(Math.random() * pool.length)] : -1;
      d.nav.set(goal >= 0 ? pathTo(field, goal) : null, goal);
    }
  }

  // Preda vicina e in vista: le va dritto addosso (e magari scatta).
  const prey = d.prey ? mem.get(d.prey) : undefined;
  if (prey && now - prey.t < 0.05) {
    const pc = bodyCenter(prey.e);
    const dist = Math.hypot(pc.x - c.x, pc.y - c.y);
    const b = e.body!;
    if (dist < 2 * s && clearLine(grid, c.x, c.y, pc.x, pc.y, b.w / 2, b.h / 2)) {
      it.x = (pc.x - c.x) / (dist || 1);
      it.y = (pc.y - c.y) / (dist || 1);
    } else d.nav.follow(e, it, dt);
    const reach = (Number(self.props.lungeDistance) || 2) * s;
    if (d.lungeCd <= 0 && dist > 0.8 * s && dist < reach * 0.95 && clearLine(grid, c.x, c.y, pc.x, pc.y, b.w / 2, b.h / 2)) {
      if (Math.random() < [1.2, 3, 6][skill - 1] * dt) {
        it.x = (pc.x - c.x) / dist;
        it.y = (pc.y - c.y) / dist;
        return true;
      }
    }
    return false;
  }
  d.nav.follow(e, it, dt);
  return false;
}

// ------------------------------------------------------------------ blocco

defineBlock({
  name: "Hunter",
  label: "Cacciatore",
  category: "Personaggi",
  description:
    "Insegue i Fuggitivi e li prende toccandoli (diventano fantasmi). Con Azione fa uno scatto in avanti, poi deve aspettare un po'. Una torcia o una trappola lo stordiscono per qualche secondo; nella luce dei lampioni accesi rallenta. Lo comanda un giocatore con i suoi tasti o il computer, che ricorda dove ha visto qualcuno e va a cercarlo.",
  requires: ["Body", "TopDownController"],
  priority: 11,
  props: {
    ...CONTROL_PROPS,
    name: { type: "text", label: "Nome", default: "Mostro", translatable: true, group: "Personaggio" },
    portrait: { type: "image", label: "Ritratto", default: "", optional: true, group: "Personaggio" },
    portraitFrame: { type: "integer", label: "Fotogramma del ritratto", default: 0, min: 0, group: "Personaggio" },
    color: { type: "color", label: "Colore", default: "#ff8a2a", group: "Personaggio" },
    target: { type: "tag", label: "Prende chi ha l'etichetta", default: "ragazzo", group: "Caccia" },
    sight: { type: "number", label: "Il computer vede fino a", unit: "tile", default: 9, min: 1, step: 0.5, group: "Caccia" },
    guardTag: {
      type: "tag",
      label: "Sorveglia",
      default: "uscita",
      optional: true,
      group: "Caccia",
      help: "Il computer, quando non vede nessuno, va spesso a fare la guardia agli oggetti con questa etichetta (se non sono chiusi).",
    },
    catchPause: { type: "number", label: "Dopo una presa si ferma per", unit: "s", default: 0.8, min: 0, step: 0.1, group: "Caccia" },
    lungeDistance: { type: "number", label: "Lunghezza dello scatto", unit: "tile", default: 2.5, min: 0.5, step: 0.25, group: "Scatto" },
    lungeSpeed: { type: "number", label: "Velocità dello scatto", unit: "tile/s", default: 13, min: 1, step: 0.5, group: "Scatto" },
    lungeCooldown: { type: "number", label: "Pausa tra due scatti", unit: "s", default: 3, min: 0, step: 0.25, group: "Scatto" },
    lightTag: { type: "tag", label: "Luci che lo rallentano", default: "lampione", optional: true, group: "Luce e stordimento" },
    lightSlow: { type: "number", label: "Velocità nella luce", unit: "×", default: 0.6, min: 0.1, max: 1, step: 0.05, group: "Luce e stordimento" },
    stunImmunity: {
      type: "number",
      label: "Dopo uno stordimento resiste per",
      unit: "s",
      default: 1.5,
      min: 0,
      step: 0.25,
      group: "Luce e stordimento",
    },
    lungeSound: { type: "audio", label: "Scatto", default: "", optional: true, group: "Suoni" },
    catchSound: { type: "audio", label: "Presa", default: "", optional: true, group: "Suoni" },
    stunSound: { type: "audio", label: "Stordito", default: "", optional: true, group: "Suoni" },
  },
  states: [
    { id: "idle", label: "Fermo" },
    { id: "walk", label: "Cammina" },
    { id: "lunge", label: "Scatta" },
    { id: "stunned", label: "Stordito" },
    { id: "laugh", label: "Ride (dopo una presa)" },
    { id: "sleep", label: "Aspetta la partenza" },
  ],
  events: [
    { id: "caught", label: "Ha preso qualcuno" },
    { id: "lunge", label: "Ha fatto uno scatto" },
    { id: "stunned", label: "È stato stordito" },
  ],
  conditions: {
    isStunned: { label: "È stordito", test: (self) => self.data.stun > 0 },
    isHuman: { label: "Lo comanda un giocatore", test: (self) => self.data.slot > 0 },
    inLight: { label: "È nella luce", test: (self) => !!self.data.lit },
  },
  actions: {
    stun: {
      label: "Stordiscilo",
      params: { seconds: { type: "number", label: "Per quanti secondi", default: 2, min: 0, step: 0.25 } },
      run: (self, seconds: number) => stun(self, Number(seconds)),
    },
  },
  init(self) {
    const d = self.data;
    const e = self.entity;
    d.slot = controlOf(self);
    d.captures = 0;
    d.nav = new Nav();
    d.memory = new Map<number, Memory>();
    d.think = 0;
    d.prey = 0;
    d.mode = "";
    d.lit = false;
    for (const k of TIMERS) d[k] = 0;
    if (d.slot < 0) {
      d.status = "absent";
      e.destroy();
      return;
    }
    d.status = "hunt";
    const ctrl = e.get("TopDownController");
    if (ctrl) {
      ctrl.props.input = "ai";
      d.baseSpeed = Number(ctrl.props.speed) || 5;
    }
  },
  update(self, dt) {
    const d = self.data;
    const e = self.entity;
    const it = e.intent;
    if (d.status === "absent") return;
    for (const k of TIMERS) if (d[k] > 0) d[k] = Math.max(0, d[k] - dt);
    const s = ts(self);
    const c = bodyCenter(e);
    d.lit = litAt(self.scene, c.x, c.y, String(self.props.lightTag || ""));
    d.asleep = !huntersFree(self.scene);
    if (!playing(self.scene) || d.asleep || d.stun > 0 || d.pause > 0) {
      stopIntent(it);
      if (d.stun > 0 && e.body) e.body.vx = e.body.vy = 0;
      e.boosts.speed = 1;
      return;
    }
    let act = false;
    if (d.lungeT > 0) {
      it.x = d.lx;
      it.y = d.ly;
    } else if (d.slot > 0) act = readHuman(self, d.slot, it);
    else act = hunterBrain(self, dt);
    if (act && d.lungeCd <= 0 && d.lungeT <= 0) startLunge(self);
    const base = d.baseSpeed || 5;
    const bot = d.slot > 0 ? 1 : [0.9, 1, 1.07][skillOf(self) - 1];
    e.boosts.speed = d.lungeT > 0 ? (Number(self.props.lungeSpeed) || 12) / base : (d.lit ? Number(self.props.lightSlow) || 1 : 1) * bot;
    void s;
    tryCatch(self);
  },
  late(self) {
    const d = self.data;
    const e = self.entity;
    if (d.status === "absent") return;
    if (d.stun > 0) e.state = "stunned";
    else if (d.pause > 0) e.state = "laugh";
    else if (d.lungeT > 0) e.state = "lunge";
    else if (d.asleep) e.state = "sleep";
    if (e.sprite) e.sprite.flash = d.stun > 0 && Math.floor(self.scene.time * 10) % 2 === 0 ? 0.35 : 0;
  },
  renderScreen(self, r) {
    const d = self.data;
    const e = self.entity;
    if (d.status === "absent") return;
    const sp = e.sprite;
    const img = sp ? self.game.assets.image(sp.image) : undefined;
    const top = e.worldY - (img ? frameRect(img, sp!.frame).fh : 28);
    const p = toScreen(self.scene, e.worldX, top);
    if (d.slot > 0) {
      const label = controlLabel(self, d.slot);
      const col = PLAYER_COLORS[(d.slot - 1) % PLAYER_COLORS.length];
      const w = r.measureText(label, { size: 6 }) + 5;
      const y = p.y - 10 + Math.round(Math.sin(self.scene.time * 5) * 1);
      r.rect(p.x - w / 2, y, w, 8, hexColor(col));
      r.rect(p.x - 1, y + 8, 3, 1, hexColor(col));
      r.rect(p.x, y + 9, 1, 1, hexColor(col));
      r.text(label, p.x, y + 0.5, { size: 6, align: "center", color: "#1a0f2a" });
    }
    if (d.stun > 0) {
      // Stelline che girano sopra la testa.
      const star = hexColor("#ffe066");
      for (let i = 0; i < 3; i++) {
        const a = self.scene.time * 6 + (i * Math.PI * 2) / 3;
        const x = Math.round(p.x + Math.cos(a) * 8);
        const y = Math.round(p.y + 4 + Math.sin(a) * 3);
        r.rect(x - 1, y, 3, 1, star);
        r.rect(x, y - 1, 1, 3, star);
      }
    } else if (d.asleep) {
      const u = (self.scene.time * 0.8) % 1;
      r.text("z", p.x + 6 + u * 6, p.y - u * 8, { size: 6 + u * 3, align: "center", color: "#cfc2ff", outline: true });
    }
  },
  renderLight(self, r) {
    const d = self.data;
    if (d.status === "absent") return;
    const e = self.entity;
    const s = ts(self);
    // Gli occhi della zucca brillano nel buio.
    const sp = e.sprite;
    const img = sp ? self.game.assets.image(sp.image) : undefined;
    const h = img ? frameRect(img, sp!.frame).fh : 32;
    const rad = s * (d.lungeT > 0 ? 2.2 : 1.6) * (1 + 0.1 * Math.sin(self.scene.time * 8));
    r.drawUV(r.radial, 0, 0, 1, 1, e.worldX - rad, e.worldY - h * 0.7 - rad, rad * 2, rad * 2, hexColor(self.props.color, d.stun > 0 ? 0.35 : 0.85));
  },
  renderDebug(self, r) {
    const path = self.data.nav?.path as { x: number; y: number }[] | null;
    if (!path) return;
    const s = ts(self);
    for (const c of path) r.rect(c.x * s + 5, c.y * s + 5, s - 10, s - 10, packColor(1, 0.5, 0.2, 0.5));
  },
});

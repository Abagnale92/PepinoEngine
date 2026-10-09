import { defineBlock, listRows, type BlockInstance, type ListRow } from "../../core/block";
import { frameRect } from "../../assets/assets";
import { hexColor, packColor } from "../../math";
import type { Renderer } from "../../render/renderer";
import { PLAYER_COLORS } from "./shared";

/**
 * Scelta dei personaggi per i giochi di gruppo: ogni giocatore entra premendo il suo tasto Azione,
 * sceglie un personaggio e si dice pronto. Chi non è scelto lo comanda il computer.
 * Alla fine scrive nelle variabili chi comanda ogni personaggio e passa alla scena della partita.
 */

/** Il tasto Azione principale di ogni giocatore, da mostrare. */
const JOIN_KEYS = ["Spazio", "Invio", "U", "0 del tastierino"];
const SKILLS = ["Facile", "Normale", "Difficile"];

/** Le mappe tra cui scegliere (righe dell'elenco «Mappe»). */
const mapsOf = (self: BlockInstance): ListRow[] => listRows(self.def.props.maps, self.props.maps).filter((m) => m.scene);

/** Le impostazioni in fondo alla schermata: la mappa c'è solo se ce n'è più di una. */
function settingsOf(self: BlockInstance): string[] {
  return ["kids", "skill", ...(mapsOf(self).length > 1 ? ["map"] : []), "back"];
}

interface Seat {
  state: "out" | "pick" | "ready";
  cursor: number;
  /** 0 = sui personaggi, 1 = sulle impostazioni (solo chi è entrato per primo). */
  row: number;
  item: number;
  joinedAt: number;
}

const rowsOf = (self: BlockInstance): ListRow[] => listRows(self.def.props.characters, self.props.characters);
const isHunter = (row: ListRow) => row.role === "hunter";

function seatsOf(self: BlockInstance): Seat[] {
  return self.data.seats as Seat[];
}

/** Chi è entrato per primo comanda le impostazioni. */
function host(self: BlockInstance): number {
  let best = -1;
  seatsOf(self).forEach((s, i) => {
    if (s.state !== "out" && (best < 0 || s.joinedAt < seatsOf(self)[best].joinedAt)) best = i;
  });
  return best;
}

/** Il personaggio è già stato preso da un altro giocatore pronto? */
function takenBy(self: BlockInstance, index: number, except = -1): number {
  return seatsOf(self).findIndex((s, i) => i !== except && s.state === "ready" && s.cursor === index);
}

function runnerCount(self: BlockInstance): number {
  return rowsOf(self).filter((r) => !isHunter(r)).length;
}

function minKids(self: BlockInstance): number {
  const rows = rowsOf(self);
  const humanKids = seatsOf(self).filter((s) => s.state === "ready" && rows[s.cursor] && !isHunter(rows[s.cursor])).length;
  return Math.max(Math.min(3, runnerCount(self)), humanKids, 1);
}

function canStart(self: BlockInstance): boolean {
  const seats = seatsOf(self);
  return seats.some((s) => s.state === "ready") && seats.every((s) => s.state !== "pick");
}

function play(self: BlockInstance, key: string): void {
  const s = self.props[key];
  if (s) self.game.audio.play(String(s));
}

function start(self: BlockInstance): void {
  const d = self.data;
  if (d.started) return;
  d.started = true;
  const vars = self.game.vars;
  const rows = rowsOf(self);
  const seats = seatsOf(self);
  const chosen = new Map<number, number>();
  seats.forEach((s, i) => {
    if (s.state === "ready") chosen.set(s.cursor, i + 1);
  });
  const kids = Math.max(minKids(self), Math.min(runnerCount(self), Number(d.kids) || runnerCount(self)));
  // I ragazzi del computer: tra quelli non scelti, a caso.
  const free = rows.map((r, i) => i).filter((i) => !isHunter(rows[i]) && !chosen.has(i));
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  const humanKids = [...chosen.keys()].filter((i) => !isHunter(rows[i])).length;
  const bots = new Set(free.slice(0, Math.max(0, kids - humanKids)));
  let hunterDone = false;
  rows.forEach((row, i) => {
    const v = String(row.variable || "");
    if (!v) return;
    let value = -1;
    if (chosen.has(i)) value = chosen.get(i)!;
    else if (isHunter(row)) value = [...chosen.keys()].some((k) => isHunter(rows[k])) || hunterDone ? -1 : 0;
    else if (bots.has(i)) value = 0;
    if (isHunter(row) && value >= 0) hunterDone = true;
    vars[v] = value;
  });
  const p = self.props;
  if (p.playersVar) vars[String(p.playersVar)] = chosen.size;
  if (p.kidsVar) vars[String(p.kidsVar)] = kids;
  if (p.skillVar) vars[String(p.skillVar)] = d.skill;
  if (p.mapVar) vars[String(p.mapVar)] = d.map;
  play(self, "startSound");
  self.emit("start");
  const maps = mapsOf(self);
  const scene = maps.length ? String(maps[Math.min(maps.length - 1, Number(d.map) || 0)].scene) : String(p.scene || "");
  if (scene) self.game.goToScene(scene, 0.6);
}

function useSetting(self: BlockInstance, index: number, dir: number): void {
  const d = self.data;
  const item = settingsOf(self)[index];
  if (item === "kids") {
    const lo = minKids(self);
    const hi = Math.max(lo, runnerCount(self));
    let k = (Number(d.kids) || hi) + dir;
    if (k > hi) k = lo;
    if (k < lo) k = hi;
    d.kids = k;
  } else if (item === "skill") {
    d.skill = ((Number(d.skill) - 1 + dir + 3) % 3) + 1;
  } else if (item === "map") {
    const n = mapsOf(self).length;
    d.map = ((Number(d.map) || 0) + dir + n) % n;
  } else if (item === "back" && self.props.backScene) {
    d.started = true;
    self.game.goToScene(String(self.props.backScene), 0.5);
  }
  play(self, "moveSound");
}

function join(self: BlockInstance, i: number): void {
  const seat = seatsOf(self)[i];
  const rows = rowsOf(self);
  seat.state = "pick";
  seat.row = 0;
  seat.joinedAt = ++self.data.joins;
  // Il primo personaggio libero (i ragazzi prima del mostro).
  const order = rows.map((_, k) => k).sort((a, b) => Number(isHunter(rows[a])) - Number(isHunter(rows[b])));
  seat.cursor = order.find((k) => takenBy(self, k) < 0 && !seatsOf(self).some((s, j) => j !== i && s.state === "pick" && s.cursor === k)) ?? 0;
  play(self, "joinSound");
}

function confirm(self: BlockInstance, i: number): void {
  const seat = seatsOf(self)[i];
  if (takenBy(self, seat.cursor, i) >= 0) {
    play(self, "moveSound");
    return;
  }
  seat.state = "ready";
  play(self, "readySound");
  const d = self.data;
  d.kids = Math.max(Number(d.kids) || 0, minKids(self));
  self.emit("ready", i + 1);
}

function cardRect(self: BlockInstance, r: { width: number }, i: number) {
  const n = Math.max(1, rowsOf(self).length);
  const w = Math.min(96, Math.floor((r.width - 40 - (n - 1) * 8) / n));
  const x0 = Math.round((r.width - (n * w + (n - 1) * 8)) / 2);
  return { x: x0 + i * (w + 8), y: 40, w, h: 172 };
}

/** Riquadri delle impostazioni: la mappa ha il nome più lungo e prende più spazio, «Menù» il meno. */
const SETTING_WEIGHT: Record<string, number> = { kids: 1.2, skill: 1.2, map: 2.1, back: 0.7 };

function settingRect(r: { width: number }, i: number, items: string[]) {
  const gap = 10;
  const total = items.reduce((s, k) => s + (SETTING_WEIGHT[k] ?? 1), 0);
  const unit = Math.min(125, (r.width - 40 - gap * (items.length - 1)) / total);
  const widths = items.map((k) => Math.floor(unit * (SETTING_WEIGHT[k] ?? 1)));
  const full = widths.reduce((s, w) => s + w, 0) + gap * (items.length - 1);
  const x = r.width / 2 - full / 2 + widths.slice(0, i).reduce((s, w) => s + w + gap, 0);
  return { x, y: 286, w: widths[i], h: 16 };
}

const inside = (v: { x: number; y: number }, b: { x: number; y: number; w: number; h: number }) => v.x >= b.x && v.x <= b.x + b.w && v.y >= b.y && v.y <= b.y + b.h;

function wrap(r: Renderer, text: string, maxW: number, size: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const test = line ? `${line} ${word}` : word;
    if (line && r.measureText(test, { size }) > maxW) {
      out.push(line);
      line = word;
    } else line = test;
  }
  if (line) out.push(line);
  return out;
}

defineBlock({
  name: "CharacterSelect",
  label: "Scelta dei personaggi",
  category: "Interfaccia",
  description:
    "La schermata in cui da 1 a 4 giocatori scelgono il loro personaggio sullo stesso schermo: ognuno entra premendo il suo tasto Azione (Spazio, Invio, U, 0 del tastierino o A del suo gamepad), sceglie con le frecce e conferma. I personaggi non scelti li comanda il computer. Chi entra per primo decide quanti ragazzi giocano, quanto è bravo il computer e, se ce n'è più di una, la mappa. Poi scrive nelle variabili chi comanda ogni personaggio (0 = computer, da 1 a 4 = giocatore, -1 = non gioca) e passa alla partita.",
  priority: 100,
  props: {
    characters: {
      type: "list",
      label: "Personaggi",
      default: [],
      rowLabel: "name",
      addLabel: "+ Personaggio",
      fields: {
        name: { type: "text", label: "Nome", default: "Personaggio", translatable: true },
        trait: { type: "text", label: "Com'è", default: "", translatable: true, optional: true },
        badge: { type: "text", label: "Ruolo da mostrare", default: "", translatable: true, optional: true },
        role: {
          type: "select",
          label: "Ruolo",
          default: "runner",
          options: [
            { value: "runner", label: "Fuggitivo" },
            { value: "hunter", label: "Cacciatore" },
          ],
        },
        image: { type: "image", label: "Sprite", default: "" },
        frame: { type: "integer", label: "Fotogramma", default: 0, min: 0 },
        anim: { type: "string", label: "Animazione quando è scelto", default: "walk_down", optional: true },
        variable: { type: "variable", label: "Chi lo comanda (variabile)", default: "" },
      },
    },
    scene: { type: "scene", label: "Scena della partita", default: "", optional: true, help: "Se ci sono più mappe nell'elenco qui sotto, si gioca su quella scelta." },
    maps: {
      type: "list",
      label: "Mappe",
      default: [],
      rowLabel: "name",
      addLabel: "+ Mappa",
      help: "Con più di una mappa compare l'impostazione «Mappa»: la sceglie chi è entrato per primo.",
      fields: {
        name: { type: "text", label: "Nome", default: "Mappa", translatable: true },
        scene: { type: "scene", label: "Scena", default: "" },
      },
    },
    mapVar: { type: "variable", label: "Mappa scelta nella variabile", default: "", optional: true, help: "Il numero della mappa (da 0): la volta dopo si riparte da quella." },
    backScene: { type: "scene", label: "«Menù» porta a", default: "", optional: true },
    title: { type: "text", label: "Titolo", default: "Scegli il tuo personaggio", translatable: true },
    playersVar: { type: "variable", label: "Numero di giocatori nella variabile", default: "", optional: true },
    kidsVar: { type: "variable", label: "Ragazzi in gioco nella variabile", default: "", optional: true },
    skillVar: { type: "variable", label: "Bravura del computer nella variabile", default: "", optional: true },
    moveSound: { type: "audio", label: "Spostamento", default: "", optional: true, group: "Suoni" },
    joinSound: { type: "audio", label: "Un giocatore entra", default: "", optional: true, group: "Suoni" },
    readySound: { type: "audio", label: "Pronto", default: "", optional: true, group: "Suoni" },
    startSound: { type: "audio", label: "Si parte", default: "", optional: true, group: "Suoni" },
  },
  events: [
    { id: "ready", label: "Un giocatore è pronto" },
    { id: "start", label: "Si parte" },
  ],
  texts: [
    ...JOIN_KEYS,
    ...SKILLS,
    "Premi {0} per entrare",
    "o A sul gamepad {0}",
    "Sceglie…",
    "Pronto!",
    "Preso",
    "CPU",
    "Ragazzi in gioco: {0}",
    "Mappa: {0}",
    "Computer: {0}",
    "Menù",
    "Tutti pronti! Premi Azione per iniziare",
    "Frecce o WASD: scegli · Azione: conferma",
    "Chi è entrato per primo scende per le impostazioni",
  ],
  init(self) {
    const d = self.data;
    d.seats = [0, 1, 2, 3].map(() => ({ state: "out", cursor: 0, row: 0, item: 0, joinedAt: 0 }) as Seat);
    d.joins = 0;
    d.kids = runnerCount(self);
    d.skill = Math.max(1, Math.min(3, Number(self.game.vars[String(self.props.skillVar || "")] ?? 2) || 2));
    if (self.props.kidsVar) {
      const k = Number(self.game.vars[String(self.props.kidsVar)]);
      if (k > 0) d.kids = Math.min(runnerCount(self), k);
    }
    d.map = 0;
    if (self.props.mapVar) {
      const k = Math.round(Number(self.game.vars[String(self.props.mapVar)]) || 0);
      d.map = Math.max(0, Math.min(Math.max(0, mapsOf(self).length - 1), k));
    }
    d.started = false;
    d.t = 0;
  },
  update(self, dt) {
    const d = self.data;
    d.t += dt;
    if (d.started) return;
    const input = self.game.input;
    const rows = rowsOf(self);
    const n = rows.length;
    if (!n) return;
    const seats = seatsOf(self);
    const h = host(self);
    seats.forEach((seat, i) => {
      const p = `p${i + 1}.`;
      const act = input.pressed(`${p}action`);
      const left = input.pressed(`${p}left`);
      const right = input.pressed(`${p}right`);
      const up = input.pressed(`${p}up`);
      const down = input.pressed(`${p}down`);
      if (seat.state === "out") {
        if (act) join(self, i);
        return;
      }
      if (seat.state === "ready") {
        if (act && canStart(self)) start(self);
        else if (left || right || up || down) {
          seat.state = "pick";
          play(self, "moveSound");
        }
        return;
      }
      if (seat.row === 1) {
        if (up || i !== h) seat.row = 0;
        else if (left) seat.item = (seat.item + settingsOf(self).length - 1) % settingsOf(self).length;
        else if (right) seat.item = (seat.item + 1) % settingsOf(self).length;
        else if (act) useSetting(self, seat.item, 1);
        if (left || right || up) play(self, "moveSound");
        return;
      }
      if (left || right) {
        seat.cursor = (seat.cursor + (right ? 1 : n - 1)) % n;
        play(self, "moveSound");
      } else if (down && i === h) {
        seat.row = 1;
        play(self, "moveSound");
      } else if (act) confirm(self, i);
    });
    if (d.started) return;
    // Mouse e tocco: un clic su un personaggio lo sceglie per il primo giocatore.
    const ptr = input.pointer;
    if (!ptr.pressed) return;
    const v = self.game.renderer.toVirtual(ptr.x, ptr.y);
    for (let i = 0; i < n; i++) {
      if (!inside(v, cardRect(self, self.game.renderer, i))) continue;
      const k = h >= 0 ? h : 0;
      const seat = seats[k];
      if (seat.state === "out") join(self, k);
      if (seat.state === "ready" && seat.cursor === i && canStart(self)) return start(self);
      seat.state = "pick";
      seat.row = 0;
      seat.cursor = i;
      confirm(self, k);
      return;
    }
    const items = settingsOf(self);
    for (let i = 0; i < items.length; i++) if (inside(v, settingRect(self.game.renderer, i, items))) return useSetting(self, i, 1);
    if (canStart(self) && v.y >= 316 && v.y <= 334) start(self);
  },
  renderScreen(self, r) {
    const d = self.data;
    const rows = rowsOf(self);
    const seats = seatsOf(self);
    const W = r.width;
    const t = d.t as number;
    const game = self.game;
    r.text(game.t(String(self.props.title)), W / 2, 12, { size: 16, align: "center", color: "#ffb35a", outline: "#2a1040", bold: true });
    // Le carte dei personaggi.
    rows.forEach((row, i) => {
      const c = cardRect(self, r, i);
      const hunter = isHunter(row);
      const owner = takenBy(self, i);
      const pickers = seats.map((s, k) => (s.state === "pick" && s.row === 0 && s.cursor === i ? k : -1)).filter((k) => k >= 0);
      const accent = hunter ? "#ff8a2a" : "#b98cff";
      r.rect(c.x, c.y, c.w, c.h, hunter ? packColor(0.2, 0.08, 0.05, 0.92) : packColor(0.12, 0.06, 0.22, 0.92));
      r.strokeRect(c.x, c.y, c.w, c.h, 1, hexColor(accent, owner >= 0 || pickers.length ? 1 : 0.55));
      if (row.badge) {
        const badge = game.t(String(row.badge));
        r.text(badge, c.x + c.w / 2, c.y + 5, { size: 6, align: "center", color: accent, bold: true });
      }
      const img = row.image ? game.assets.image(String(row.image)) : undefined;
      if (img) {
        let frame = Number(row.frame) || 0;
        const anim = img.data.animations?.[String(row.anim || "")];
        if (anim && (pickers.length || owner >= 0) && anim.frames.length) frame = anim.frames[Math.floor(t * anim.fps) % anim.frames.length];
        const f = frameRect(img, frame);
        const k = Math.max(1, Math.floor(Math.min((c.w - 12) / f.fw, 92 / f.fh)));
        const bounce = owner >= 0 ? Math.round(Math.abs(Math.sin(t * 6)) * -3) : 0;
        const bx = Math.round(c.x + c.w / 2 - (f.fw * k) / 2);
        const by = c.y + 112 - f.fh * k + bounce;
        r.drawUV(r.radial, 0, 0, 1, 1, c.x + c.w / 2 - 26, c.y + 106, 52, 10, packColor(0, 0, 0, 0.5));
        r.draw(img.tex, f.sx, f.sy, f.fw, f.fh, bx, by, f.fw * k, f.fh * k);
      }
      r.text(game.t(String(row.name)), c.x + c.w / 2, c.y + 118, { size: 9, align: "center", color: "#ffffff", bold: true });
      wrap(r, game.t(String(row.trait || "")), c.w - 10, 6).slice(0, 3).forEach((line, k) => {
        r.text(line, c.x + c.w / 2, c.y + 132 + k * 8, { size: 6, align: "center", color: "#c8b8f0" });
      });
      // Cursori dei giocatori che stanno scegliendo.
      pickers.forEach((k, j) => {
        const col = hexColor(PLAYER_COLORS[k]);
        const g = 2 + j * 3;
        if (Math.floor(t * 4) % 4 !== 3) r.strokeRect(c.x - g, c.y - g, c.w + g * 2, c.h + g * 2, 1.5, col);
        r.rect(c.x + 2 + j * 18, c.y + c.h - 14, 16, 10, col);
        r.text(`P${k + 1}`, c.x + 10 + j * 18, c.y + c.h - 13, { size: 6, align: "center", color: "#1a0f2a", bold: true });
      });
      if (owner >= 0) {
        const col = PLAYER_COLORS[owner];
        r.strokeRect(c.x - 2, c.y - 2, c.w + 4, c.h + 4, 2, hexColor(col));
        r.rect(c.x, c.y + c.h - 16, c.w, 16, hexColor(col));
        r.text(`P${owner + 1} ${game.t("Pronto!")}`, c.x + c.w / 2, c.y + c.h - 12, { size: 7, align: "center", color: "#1a0f2a", bold: true });
      }
    });
    // Chi gioca: un riquadro per ogni giocatore.
    const bw = 142;
    const bx0 = W / 2 - (bw * 4 + 8 * 3) / 2;
    seats.forEach((s, i) => {
      const x = bx0 + i * (bw + 8);
      const y = 224;
      const col = PLAYER_COLORS[i];
      const on = s.state !== "out";
      r.rect(x, y, bw, 52, packColor(0.08, 0.04, 0.16, on ? 0.92 : 0.6));
      r.strokeRect(x, y, bw, 52, 1, hexColor(col, on ? 1 : 0.35));
      r.text(`P${i + 1}`, x + 6, y + 5, { size: 12, color: on ? col : "#6c6288", bold: true });
      let line1: string;
      let line2 = "";
      if (s.state === "out") {
        line1 = game.t("Premi {0} per entrare").replace("{0}", game.t(JOIN_KEYS[i]));
        line2 = game.t("o A sul gamepad {0}").replace("{0}", String(i + 1));
      } else if (s.state === "pick") line1 = game.t("Sceglie…");
      else line1 = `${game.t("Pronto!")} ${game.t(String(rows[s.cursor]?.name ?? ""))}`;
      const blink = s.state === "out" && Math.floor(t * 2 + i) % 2 === 0;
      r.text(line1, x + 6, y + 24, { size: 7, color: s.state === "ready" ? col : blink ? "#ffffff" : "#c8b8f0" });
      if (line2) r.text(line2, x + 6, y + 36, { size: 6, color: "#8a7cb0" });
    });
    // Impostazioni (le cambia chi è entrato per primo).
    const h = host(self);
    const hs = h >= 0 ? seats[h] : null;
    const maps = mapsOf(self);
    const items = settingsOf(self);
    const labels = items.map((item) => {
      if (item === "kids") return game.t("Ragazzi in gioco: {0}").replace("{0}", String(Math.max(minKids(self), Number(d.kids) || 0)));
      if (item === "skill") return game.t("Computer: {0}").replace("{0}", game.t(SKILLS[(Number(d.skill) || 2) - 1]));
      if (item === "map") return game.t("Mappa: {0}").replace("{0}", game.t(String(maps[Number(d.map) || 0]?.name ?? "")));
      return game.t("Menù");
    });
    labels.forEach((label, i) => {
      const b = settingRect(r, i, items);
      const on = !!hs && hs.state === "pick" && hs.row === 1 && hs.item === i;
      r.rect(b.x, b.y, b.w, b.h, on ? hexColor(PLAYER_COLORS[h]) : packColor(0.14, 0.08, 0.26, 0.9));
      r.text(on && items[i] !== "back" ? `◀ ${label} ▶` : label, b.x + b.w / 2, b.y + 4, { size: 7, align: "center", color: on ? "#1a0f2a" : "#e8e0ff", bold: on });
    });
    // Come si parte.
    if (canStart(self)) {
      if (Math.floor(t * 3) % 3 !== 2) r.text(game.t("Tutti pronti! Premi Azione per iniziare"), W / 2, 318, { size: 10, align: "center", color: "#9dff8a", outline: "#1a0a2a", bold: true });
    } else {
      r.text(game.t("Frecce o WASD: scegli · Azione: conferma"), W / 2, 316, { size: 7, align: "center", color: "#c8b8f0" });
      r.text(game.t("Chi è entrato per primo scende per le impostazioni"), W / 2, 328, { size: 6, align: "center", color: "#8a7cb0" });
    }
  },
});

import { defineBlock, type BlockInstance } from "../../core/block";
import { frameRect } from "../../assets/assets";
import type { Input } from "../../input/input";
import { hexColor, packColor } from "../../math";
import type { Renderer } from "../../render/renderer";
import { BONUS_KINDS, PLAYER_COLORS, huntersOf, isBonus, runnersOf, soloGame } from "./shared";

/**
 * Partita a squadre: i Fuggitivi devono raccogliere insieme un certo numero di caramelle,
 * poi l'uscita si apre e devono raggiungerla prima che finisca il tempo. Il Cacciatore (e i fantasmi) li fermano.
 * Disegna l'HUD (caramelle, tempo, uscita, una scheda per ogni personaggio) e alla fine i risultati.
 */

const BAR = 18;
const BUTTONS = ["Rivincita", "Cambia personaggi", "Menù"];

/** Azione premuta da qualcuno (tasti di sempre o di uno dei 4 giocatori). */
function anyPressed(input: Input, action: string): boolean {
  if (input.pressed(action)) return true;
  for (let i = 1; i <= 4; i++) if (input.pressed(`p${i}.${action}`)) return true;
  return false;
}

const fmtTime = (s: number) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

function toast(self: BlockInstance, text: string, color = "#ffffff"): void {
  const list = self.data.toasts as { text: string; t: number; color: string }[];
  list.push({ text, t: 2.6, color });
  if (list.length > 3) list.shift();
}

const nameOf = (self: BlockInstance, b: BlockInstance) => self.game.t(String(b.props.name || b.entity.name));

/** Accorcia un testo con «…» finché non sta nella larghezza data. */
function fit(r: Renderer, text: string, maxW: number, size: number): string {
  if (r.measureText(text, { size }) <= maxW) return text;
  let s = text;
  while (s.length > 1 && r.measureText(`${s}…`, { size }) > maxW) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

function openExit(self: BlockInstance): void {
  const d = self.data;
  if (d.exitOpen) return;
  d.exitOpen = true;
  const tag = String(self.props.exitTag || "");
  if (tag) for (const e of self.scene.findAll(tag)) e.get("Hauntable")?.actions.open();
  if (self.props.gateSound) self.game.audio.play(self.props.gateSound);
  self.scene.camera.shake(2, 0.4);
  toast(self, self.game.t("Il cancello è aperto! Scappate!"), "#9dff8a");
  self.emit("exitOpen");
}

function finish(self: BlockInstance, midnight: boolean): void {
  const d = self.data;
  if (d.phase === "ended") return;
  d.phase = "ended";
  d.endT = 0;
  d.midnight = midnight;
  const runners = runnersOf(self.scene);
  d.escaped = runners.filter((r) => r.data.status === "out").length;
  d.result = d.escaped > 0 ? "runners" : "hunter";
  const v = String(self.props.resultVar || "");
  if (v) self.game.vars[v] = d.result === "runners" ? "ragazzi" : "mostro";
  if (midnight) toast(self, self.game.t("MEZZANOTTE!"), "#ffb35a");
  const snd = d.result === "runners" ? self.props.winSound : self.props.loseSound;
  if (snd) self.game.audio.play(snd);
  self.emit(d.result === "runners" ? "runnersWin" : "hunterWins");
  self.emit("ended");
}

function press(self: BlockInstance, i: number): void {
  const d = self.data;
  if (d.chosen) return;
  d.chosen = true;
  const game = self.game;
  if (i === 0) {
    self.emit("rematch");
    game.restartScene(0.5);
  } else if (i === 1) {
    self.emit("quit");
    if (self.props.selectScene) game.goToScene(String(self.props.selectScene), 0.5);
  } else {
    self.emit("quit");
    if (self.props.menuScene) game.goToScene(String(self.props.menuScene), 0.5);
  }
}

// ------------------------------------------------------------------ disegno

function icon(self: BlockInstance, r: Renderer, image: string, frame: number, x: number, y: number, size: number, alpha = 1): void {
  const img = image ? self.game.assets.image(image) : undefined;
  if (!img) return;
  const f = frameRect(img, frame);
  const k = size / Math.max(f.fw, f.fh);
  r.draw(img.tex, f.sx, f.sy, f.fw, f.fh, x, y, f.fw * k, f.fh * k, hexColor("#ffffff", alpha));
}

function portrait(self: BlockInstance, r: Renderer, b: BlockInstance, x: number, y: number, size: number, ghost = false): void {
  const img = b.props.portrait ? self.game.assets.image(String(b.props.portrait)) : undefined;
  r.rect(x, y, size, size, packColor(0.1, 0.06, 0.18, 1));
  if (!img) return;
  const f = frameRect(img, Number(b.props.portraitFrame) || 0);
  r.draw(img.tex, f.sx, f.sy, f.fw, f.fh, x, y, size, size, ghost ? hexColor("#9fe7ff", 0.75) : hexColor("#ffffff"));
}

function slotColor(slot: number): string {
  return slot > 0 ? PLAYER_COLORS[(slot - 1) % PLAYER_COLORS.length] : "#6c6288";
}

function drawTopBar(self: BlockInstance, r: Renderer): void {
  const d = self.data;
  const p = self.props;
  const W = r.width;
  const t = self.scene.time;
  r.rect(0, 0, W, BAR, packColor(0.06, 0.03, 0.12, 0.86));
  r.rect(0, BAR, W, 1, hexColor("#ff8a2a", 0.8));
  // Caramelle della squadra.
  const goal = Math.max(1, Number(p.goal) || 1);
  const candies = Math.min(goal, Number(self.game.vars[String(p.candyVar)] ?? 0));
  icon(self, r, String(p.candyIcon || ""), Number(p.candyFrame) || 0, 6, 2, 13);
  r.text(`${candies}/${goal}`, 23, 2, { size: 9, color: candies >= goal ? "#9dff8a" : "#ffe9b0", bold: true });
  const bx = 23;
  const bw = 70;
  r.rect(bx, 13, bw, 3, packColor(0.2, 0.12, 0.3, 1));
  r.rect(bx, 13, (bw * candies) / goal, 3, hexColor(candies >= goal ? "#9dff8a" : "#ff9a3c"));
  r.text(self.game.t("Caramelle"), bx + bw + 6, 5, { size: 6, color: "#b8a8e0" });
  // Tempo che manca alla mezzanotte.
  const left = d.phase === "countdown" ? Number(p.duration) : d.time;
  const hurry = left <= 30 && d.phase === "play";
  r.text(self.game.t("Mezzanotte tra"), W / 2 - 4, 5, { size: 6, align: "right", color: "#b8a8e0" });
  r.text(fmtTime(left), W / 2 + 2, 1, { size: 12, color: hurry ? (Math.floor(t * 4) % 2 ? "#ff6b5e" : "#ffd0c0") : "#ffffff", bold: true });
  // Uscita.
  const open = !!d.exitOpen;
  const gate = self.game.t(open ? "Uscita aperta!" : "Uscita chiusa");
  r.text(gate, W - 8, 5, { size: 7, align: "right", color: open ? (Math.floor(t * 3) % 2 ? "#9dff8a" : "#e0ffd8") : "#b8a8e0", bold: open });
}

function drawChips(self: BlockInstance, r: Renderer): void {
  const W = r.width;
  const H = r.height;
  const p = self.props;
  const list: BlockInstance[] = [...huntersOf(self.scene), ...runnersOf(self.scene)].filter((b) => b.data.status !== "absent");
  if (!list.length) return;
  const y = H - BAR;
  r.rect(0, y - 1, W, 1, hexColor("#ff8a2a", 0.8));
  r.rect(0, y, W, BAR, packColor(0.06, 0.03, 0.12, 0.86));
  const cw = Math.min(104, Math.floor((W - 8) / list.length));
  const x0 = Math.round((W - cw * list.length) / 2);
  list.forEach((b, i) => {
    const x = x0 + i * cw + 2;
    const slot = Number(b.data.slot) || 0;
    const hunter = b.def.type === "Hunter";
    const status = String(b.data.status);
    const col = slotColor(slot);
    r.rect(x - 1, y + 1, 16, 16, hexColor(col));
    portrait(self, r, b, x, y + 2, 14, status === "ghost" || status === "turning");
    const label = slot > 0 ? (soloGame(b) ? self.game.t("TU") : `P${slot}`) : self.game.t("CPU");
    r.text(label, x + 18, y + 2, { size: 6, color: col, bold: true });
    const nx = x + 18 + r.measureText(label, { size: 6, bold: true }) + 3;
    r.text(fit(r, nameOf(self, b), x + cw - 4 - nx, 6), nx, y + 2, { size: 6, color: "#e8e0ff" });
    let line = "";
    let lineCol = "#ffe9b0";
    if (hunter) {
      line = self.game.t("Prese: {0}").replace("{0}", String(b.data.captures ?? 0));
      if (b.data.stun > 0) {
        line = self.game.t("Stordito!");
        lineCol = "#ffe066";
      }
    } else if (status === "ghost" || status === "turning") {
      line = self.game.t("Fantasma");
      lineCol = "#9fe7ff";
    } else if (status === "out") {
      line = self.game.t("In salvo!");
      lineCol = "#9dff8a";
    }
    if (line) r.text(line, x + 18, y + 10, { size: 6, color: lineCol });
    else {
      icon(self, r, String(p.candyIcon || ""), Number(p.candyFrame) || 0, x + 18, y + 9, 7);
      r.text(String(b.data.candies ?? 0), x + 27, y + 10, { size: 6, color: "#ffe9b0" });
      const held = (b.data.held as string[]) ?? [];
      held.forEach((k, j) => {
        if (isBonus(k)) icon(self, r, String(p.icons || ""), BONUS_KINDS.indexOf(k), x + 40 + j * 10, y + 8, 9);
      });
      const hits = Number(b.data.hits) || 0;
      for (let j = 0; j < hits; j++) r.rect(x + cw - 8 - j * 4, y + 11, 3, 3, hexColor("#f2e6c8"));
    }
  });
}

function drawToasts(self: BlockInstance, r: Renderer): void {
  const list = self.data.toasts as { text: string; t: number; color: string }[];
  list.forEach((m, i) => {
    const a = Math.min(1, m.t / 0.4);
    const y = BAR + 8 + i * 12;
    const w = r.measureText(m.text, { size: 8 }) + 12;
    r.rect(r.width / 2 - w / 2, y - 1, w, 11, packColor(0.06, 0.03, 0.12, 0.7 * a));
    r.text(m.text, r.width / 2, y, { size: 8, align: "center", color: m.color, outline: true });
  });
}

function drawCountdown(self: BlockInstance, r: Renderer): void {
  const d = self.data;
  const W = r.width;
  const H = r.height;
  if (d.phase === "countdown") {
    const n = Math.ceil(d.t);
    const u = d.t - Math.floor(d.t);
    const size = Math.round(28 + u * 18);
    r.text(String(n), W / 2, H / 2 - size * 0.7, { size, align: "center", color: "#ffb35a", outline: "#2a1040", bold: true });
    const help = String(self.props.intro || "");
    if (help) {
      const text = self.game.t(help).replace("{0}", String(self.props.goal));
      const w = r.measureText(text, { size: 8 }) + 16;
      r.rect(W / 2 - w / 2, H / 2 + 26, w, 14, packColor(0.06, 0.03, 0.12, 0.8));
      r.text(text, W / 2, H / 2 + 29, { size: 8, align: "center", color: "#ffe9b0" });
    }
  } else if (d.phase === "play" && d.elapsed < 0.8) {
    const u = d.elapsed / 0.8;
    if (u < 0.85) r.text(self.game.t("VIA!"), W / 2, H / 2 - 24 - u * 8, { size: Math.round(30 + u * 10), align: "center", color: "#ffd65a", outline: "#2a1040", bold: true });
  }
  const delay = Number(self.props.hunterDelay) || 0;
  if (d.phase === "play" && d.elapsed < delay) {
    const text = self.game.t("Il mostro si sveglia tra {0}…").replace("{0}", String(Math.ceil(delay - d.elapsed)));
    r.text(text, W / 2, BAR + 6, { size: 8, align: "center", color: "#ff9a3c", outline: true });
  }
}

function drawResults(self: BlockInstance, r: Renderer): void {
  const d = self.data;
  const W = r.width;
  const H = r.height;
  const u = Math.min(1, d.endT / 0.6);
  if (d.endT < 1) return;
  const k = Math.min(1, (d.endT - 1) / 0.4);
  r.rect(0, 0, W, H, packColor(0.03, 0.01, 0.07, 0.65 * k));
  void u;
  const runners = runnersOf(self.scene).filter((b) => b.data.status !== "absent");
  const hunters = huntersOf(self.scene).filter((b) => b.data.status !== "absent");
  const rows = [...hunters, ...runners];
  const pw = 360;
  const ph = 92 + rows.length * 18;
  const px = (W - pw) / 2;
  const py = (H - ph) / 2 + (1 - k) * 20;
  const win = d.result === "runners";
  const accent = win ? "#9dff8a" : "#ff8a2a";
  r.rect(px, py, pw, ph, packColor(0.08, 0.04, 0.16, 0.96));
  r.strokeRect(px, py, pw, ph, 1, hexColor(accent));
  r.strokeRect(px + 2, py + 2, pw - 4, ph - 4, 0.5, hexColor(accent, 0.4));
  r.text(self.game.t(win ? "VINCONO I RAGAZZI!" : "VINCE IL MOSTRO!"), W / 2, py + 8, { size: 16, align: "center", color: accent, outline: "#1a0a2a", bold: true });
  const total = runners.length;
  const sub = d.escaped > 0 ? self.game.t("{0} su {1} in salvo").replace("{0}", String(d.escaped)).replace("{1}", String(total)) : self.game.t("Nessuno è uscito prima di mezzanotte");
  r.text(sub, W / 2, py + 30, { size: 8, align: "center", color: "#e8e0ff" });
  rows.forEach((b, i) => {
    const y = py + 46 + i * 18;
    const slot = Number(b.data.slot) || 0;
    const status = String(b.data.status);
    r.rect(px + 15, y - 1, 16, 16, hexColor(slotColor(slot)));
    portrait(self, r, b, px + 16, y, 14, status === "ghost" || status === "turning");
    const label = slot > 0 ? (soloGame(b) ? self.game.t("TU") : `P${slot}`) : self.game.t("CPU");
    r.text(label, px + 36, y + 3, { size: 7, color: slotColor(slot), bold: true });
    r.text(nameOf(self, b), px + 62, y + 3, { size: 8, color: "#ffffff" });
    let what: string;
    let col = "#e8e0ff";
    if (b.def.type === "Hunter") {
      what = self.game.t("Prese: {0}").replace("{0}", String(b.data.captures ?? 0));
      col = "#ffb35a";
    } else if (status === "out") {
      what = self.game.t("In salvo!");
      col = "#9dff8a";
    } else if (status === "run") {
      what = self.game.t("Fuori a mezzanotte");
      col = "#ff8a8a";
    } else {
      what = self.game.t("Fantasma");
      col = "#9fe7ff";
    }
    r.text(what, px + 190, y + 3, { size: 8, color: col });
    if (b.def.type === "Runner") {
      icon(self, r, String(self.props.candyIcon || ""), Number(self.props.candyFrame) || 0, px + pw - 52, y + 1, 10);
      r.text(String(b.data.candies ?? 0), px + pw - 38, y + 3, { size: 8, color: "#ffe9b0" });
    }
  });
  if (d.endT < 1.6) return;
  const by = py + ph - 26;
  const bw = 100;
  const gap = 10;
  const bx0 = W / 2 - (bw * 3 + gap * 2) / 2;
  d.buttonRects = BUTTONS.map((_, i) => ({ x: bx0 + i * (bw + gap), y: by, w: bw, h: 16 }));
  BUTTONS.forEach((b, i) => {
    const on = d.focus === i;
    const x = bx0 + i * (bw + gap);
    r.rect(x, by, bw, 16, on ? hexColor(accent) : packColor(0.16, 0.1, 0.28, 1));
    if (on) r.strokeRect(x - 1, by - 1, bw + 2, 18, 0.5, hexColor("#ffffff"));
    r.text(self.game.t(b), x + bw / 2, by + 4, { size: 8, align: "center", color: on ? "#1a0a2a" : "#e8e0ff", bold: on });
  });
}

// ------------------------------------------------------------------ blocco

defineBlock({
  name: "PartyMatch",
  label: "Partita a squadre",
  category: "Gameplay",
  description:
    "Le regole di una partita a squadre: i Fuggitivi raccolgono insieme le caramelle; quando sono abbastanza l'uscita si apre e devono raggiungerla prima che finisca il tempo, mentre il Cacciatore e i fantasmi li fermano. Vincono i Fuggitivi se almeno uno esce, altrimenti vince il Cacciatore. Mostra il conto alla rovescia, l'HUD (caramelle, tempo, uscita, una scheda per personaggio) e alla fine i risultati con Rivincita, Cambia personaggi e Menù.",
  priority: 5,
  props: {
    goal: { type: "integer", label: "Caramelle da raccogliere", default: 30, min: 1 },
    candyVar: { type: "variable", label: "Caramelle della squadra", default: "caramelle" },
    duration: { type: "number", label: "Durata", unit: "s", default: 180, min: 10, step: 10 },
    timeVar: { type: "variable", label: "Tempo rimasto nella variabile", default: "", optional: true },
    countdown: { type: "number", label: "Conto alla rovescia", unit: "s", default: 3, min: 0, step: 1 },
    hunterDelay: { type: "number", label: "Il Cacciatore parte dopo", unit: "s", default: 3, min: 0, step: 0.5 },
    exitTag: { type: "tag", label: "Uscita", default: "uscita" },
    resultVar: {
      type: "variable",
      label: "Chi ha vinto nella variabile",
      default: "",
      optional: true,
      help: "Alla fine vale «ragazzi» o «mostro».",
    },
    intro: {
      type: "text",
      label: "Spiegazione durante il conto alla rovescia",
      default: "Raccogliete {0} caramelle e scappate dal cancello prima di mezzanotte!",
      translatable: true,
      optional: true,
    },
    icons: { type: "image", label: "Icone dei bonus", default: "", optional: true, group: "HUD" },
    candyIcon: { type: "image", label: "Icona della caramella", default: "", optional: true, group: "HUD" },
    candyFrame: { type: "integer", label: "Fotogramma della caramella", default: 5, min: 0, group: "HUD" },
    hud: { type: "boolean", label: "Mostra l'HUD", default: true, group: "HUD" },
    selectScene: { type: "scene", label: "«Cambia personaggi» porta a", default: "", optional: true, group: "Fine" },
    menuScene: { type: "scene", label: "«Menù» porta a", default: "", optional: true, group: "Fine" },
    tickSound: { type: "audio", label: "Conto alla rovescia", default: "", optional: true, group: "Suoni" },
    goSound: { type: "audio", label: "Via!", default: "", optional: true, group: "Suoni" },
    gateSound: { type: "audio", label: "Uscita aperta", default: "", optional: true, group: "Suoni" },
    winSound: { type: "audio", label: "Vincono i Fuggitivi", default: "", optional: true, group: "Suoni" },
    loseSound: { type: "audio", label: "Vince il Cacciatore", default: "", optional: true, group: "Suoni" },
  },
  events: [
    { id: "start", label: "La partita comincia (Via!)" },
    { id: "exitOpen", label: "L'uscita si è aperta" },
    { id: "hurry", label: "Mancano 30 secondi" },
    { id: "runnersWin", label: "Vincono i Fuggitivi" },
    { id: "hunterWins", label: "Vince il Cacciatore" },
    { id: "ended", label: "La partita è finita" },
    { id: "rematch", label: "Si rigioca" },
    { id: "quit", label: "Si esce dalla partita" },
  ],
  conditions: {
    isPlaying: { label: "Si sta giocando", test: (self) => self.data.phase === "play" },
    isOver: { label: "È finita", test: (self) => self.data.phase === "ended" },
    exitIsOpen: { label: "L'uscita è aperta", test: (self) => !!self.data.exitOpen },
  },
  actions: {
    openExit: { label: "Apri l'uscita", run: (self) => openExit(self) },
    end: { label: "Finisci la partita", run: (self) => finish(self, false) },
    addTime: {
      label: "Aggiungi tempo",
      params: { seconds: { type: "number", label: "Secondi", default: 15, step: 5 } },
      run: (self, seconds: number) => (self.data.elapsed -= Number(seconds) || 0),
    },
  },
  texts: [
    "Caramelle",
    "Mezzanotte tra",
    "Uscita aperta!",
    "Uscita chiusa",
    "Il cancello è aperto! Scappate!",
    "{0} ora è un fantasma!",
    "{0} è in salvo!",
    "MEZZANOTTE!",
    "VIA!",
    "Il mostro si sveglia tra {0}…",
    "VINCONO I RAGAZZI!",
    "VINCE IL MOSTRO!",
    "{0} su {1} in salvo",
    "Nessuno è uscito prima di mezzanotte",
    "In salvo!",
    "Fantasma",
    "Fuori a mezzanotte",
    "Prese: {0}",
    "Stordito!",
    "CPU",
    "TU",
    "30 secondi a mezzanotte!",
    ...BUTTONS,
  ],
  init(self) {
    const d = self.data;
    const p = self.props;
    d.phase = Number(p.countdown) > 0 ? "countdown" : "play";
    d.t = Number(p.countdown) || 0;
    d.elapsed = 0;
    d.time = Number(p.duration) || 0;
    d.exitOpen = false;
    d.toasts = [];
    d.focus = 0;
    d.endT = 0;
    d.escaped = 0;
    d.hurried = false;
    d.lastTick = Math.ceil(d.t) + 1;
    // Ogni partita parte da zero: le caramelle (e il tempo e l'esito) della partita prima non contano.
    // Senza questo, tornando dalla scelta dei personaggi la squadra avrebbe già le caramelle di prima
    // e il cancello si aprirebbe dopo pochi secondi.
    if (p.candyVar) self.game.vars[String(p.candyVar)] = 0;
    if (p.timeVar) self.game.vars[String(p.timeVar)] = Math.ceil(Number(p.duration) || 0);
    if (p.resultVar) self.game.vars[String(p.resultVar)] = "";
    if (d.phase === "play") self.emit("start");
    const ev = self.scene.events;
    d.unsub = [
      ev.on("ghost", ({ entity }: { entity?: { get(t: string): BlockInstance | undefined } }) => {
        const b = entity?.get("Runner");
        if (b) toast(self, self.game.t("{0} ora è un fantasma!").replace("{0}", nameOf(self, b)), "#9fe7ff");
      }),
      ev.on("escaped", ({ entity }: { entity?: { get(t: string): BlockInstance | undefined } }) => {
        const b = entity?.get("Runner");
        if (b) toast(self, self.game.t("{0} è in salvo!").replace("{0}", nameOf(self, b)), "#9dff8a");
      }),
    ];
  },
  update(self, dt) {
    const d = self.data;
    const p = self.props;
    for (const m of d.toasts as { t: number }[]) m.t -= dt;
    d.toasts = (d.toasts as { t: number }[]).filter((m) => m.t > 0);
    if (d.phase === "countdown") {
      d.t -= dt;
      const n = Math.ceil(d.t);
      if (n !== d.lastTick && n > 0) {
        d.lastTick = n;
        if (p.tickSound) self.game.audio.play(p.tickSound);
      }
      if (d.t <= 0) {
        d.phase = "play";
        if (p.goSound) self.game.audio.play(p.goSound);
        self.emit("start");
      }
      return;
    }
    if (d.phase === "play") {
      d.elapsed += dt;
      d.time = Math.max(0, (Number(p.duration) || 0) - d.elapsed);
      if (p.timeVar) self.game.vars[String(p.timeVar)] = Math.ceil(d.time);
      if (!d.hurried && d.time <= 30) {
        d.hurried = true;
        toast(self, self.game.t("30 secondi a mezzanotte!"), "#ffb35a");
        self.emit("hurry");
      }
      if (d.time <= 10 && Math.ceil(d.time) !== d.lastTick) {
        d.lastTick = Math.ceil(d.time);
        if (p.tickSound && d.time > 0) self.game.audio.play(p.tickSound);
      }
      const candies = Number(self.game.vars[String(p.candyVar)] ?? 0);
      if (!d.exitOpen && candies >= (Number(p.goal) || 1)) openExit(self);
      const runners = runnersOf(self.scene).filter((r) => r.data.status !== "absent");
      if (runners.length && !runners.some((r) => r.data.status === "run")) finish(self, false);
      else if (d.time <= 0) finish(self, true);
      return;
    }
    // Fine partita: si sceglie cosa fare.
    d.endT += dt;
    if (d.endT < 1.6 || d.chosen) return;
    const input = self.game.input;
    if (anyPressed(input, "right") || anyPressed(input, "down")) d.focus = (d.focus + 1) % BUTTONS.length;
    if (anyPressed(input, "left") || anyPressed(input, "up")) d.focus = (d.focus + BUTTONS.length - 1) % BUTTONS.length;
    const ptr = input.pointer;
    const rects = d.buttonRects as { x: number; y: number; w: number; h: number }[] | undefined;
    if (rects && (ptr.moved || ptr.pressed)) {
      const v = self.game.renderer.toVirtual(ptr.x, ptr.y);
      const i = rects.findIndex((b) => v.x >= b.x && v.x <= b.x + b.w && v.y >= b.y && v.y <= b.y + b.h);
      if (i >= 0) {
        d.focus = i;
        if (ptr.pressed) return press(self, i);
      }
    }
    if (anyPressed(input, "action") || input.pressed("jump")) press(self, d.focus);
  },
  renderScreen(self, r) {
    if (self.props.hud) {
      drawTopBar(self, r);
      drawChips(self, r);
    }
    drawToasts(self, r);
    drawCountdown(self, r);
    if (self.data.phase === "ended") drawResults(self, r);
  },
  destroy(self) {
    for (const u of (self.data.unsub as (() => void)[]) ?? []) u();
  },
});

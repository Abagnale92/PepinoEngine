import { defineBlock, type BlockInstance } from "../core/block";
import { hexColor } from "../math";

/**
 * Gioco a ritmo: le note scendono lungo le corsie verso la linea in basso e vanno premute
 * quando la toccano. Ogni nota dà Perfetto, Bene o Mancato; i colpi di fila fanno la combo.
 * Le note si scrivono come una fila di numeri (1 = prima corsia) oppure le inventa il computer.
 */

interface Note {
  /** Quando va premuta, in secondi dall'inizio della canzone. */
  time: number;
  lane: number;
  /** Già giudicata? */
  done: boolean;
}

const LANE_KEYS = ["key1", "key2", "key3", "key4"] as const;
const LANE_COLORS = ["#e5695f", "#ffd84a", "#6cc24a", "#4a8fd6"];

/** Le note della canzone, lette dal disegno o inventate a caso. */
function buildNotes(self: BlockInstance): Note[] {
  const p = self.props;
  const lanes = Math.max(1, Math.min(4, Number(p.lanes)));
  const step = 60 / Math.max(1, Number(p.bpm)) / Math.max(1, Number(p.perBeat));
  const out: Note[] = [];
  const pattern = String(p.pattern ?? "").replace(/\s+/g, "");
  if (pattern) {
    [...pattern].forEach((ch, i) => {
      const lane = Number(ch);
      if (!Number.isFinite(lane) || lane < 1 || lane > lanes) return;
      out.push({ time: i * step, lane: lane - 1, done: false });
    });
    return out;
  }
  // Niente disegno: una canzone inventata, sempre uguale con lo stesso seme.
  let s = (Number(p.seed) || 12345) >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const steps = Math.max(1, Math.round(Number(p.bars) * Number(p.perBeat) * 4));
  for (let i = 0; i < steps; i++) {
    if (rnd() > Number(p.density)) continue;
    out.push({ time: i * step, lane: Math.floor(rnd() * lanes), done: false });
  }
  return out;
}

/** Giudica una nota: 2 = perfetto, 1 = bene, 0 = mancata. */
function judge(self: BlockInstance, note: Note, delta: number): void {
  const p = self.props;
  const d = self.data;
  note.done = true;
  const ms = Math.abs(delta) * 1000;
  const good = ms <= Number(p.goodWindow);
  const perfect = ms <= Number(p.perfectWindow);
  if (!good) return miss(self, note);
  d.combo++;
  d.best = Math.max(d.best, d.combo);
  d.hits++;
  if (perfect) d.perfects++;
  const points = (perfect ? 100 : 50) + Math.min(50, d.combo * 2);
  d.score += points;
  writeVars(self);
  flash(self, self.game.t(perfect ? "Perfetto!" : "Bene!"), perfect ? "#ffe9a8" : "#9be26a");
  if (p.hitSound) self.game.audio.play(String(p.hitSound));
  self.emit("hit", { perfect, lane: note.lane, combo: d.combo });
}

function miss(self: BlockInstance, note: Note): void {
  const d = self.data;
  note.done = true;
  d.combo = 0;
  d.misses++;
  writeVars(self);
  flash(self, self.game.t("Mancata"), "#e5695f");
  if (self.props.missSound) self.game.audio.play(String(self.props.missSound));
  self.emit("miss", { lane: note.lane });
}

function flash(self: BlockInstance, text: string, color: string): void {
  self.data.msg = text;
  self.data.msgColor = color;
  self.data.msgT = 0.45;
}

function writeVars(self: BlockInstance): void {
  const p = self.props;
  const d = self.data;
  if (p.scoreVar) self.game.vars[p.scoreVar] = d.score;
  if (p.comboVar) self.game.vars[p.comboVar] = d.combo;
  if (p.missVar) self.game.vars[p.missVar] = d.misses;
}

/** La nota più vicina al momento giusto in quella corsia. */
function nearestNote(self: BlockInstance, lane: number): Note | undefined {
  const d = self.data;
  const window = Number(self.props.goodWindow) / 1000;
  let best: Note | undefined;
  let bestDt = Infinity;
  for (const n of d.notes as Note[]) {
    if (n.done || n.lane !== lane) continue;
    const dt = Math.abs(n.time - d.time);
    if (dt <= window && dt < bestDt) {
      best = n;
      bestDt = dt;
    }
  }
  return best;
}

defineBlock({
  name: "RhythmTrack",
  label: "Note a tempo",
  category: "Gameplay",
  description:
    "Le note scendono lungo le corsie e vanno premute quando arrivano sulla linea in basso: chi va a tempo prende Perfetto, chi arriva tardi Bene, chi sbaglia perde la combo. Punteggio, combo e note mancate finiscono in tre variabili. Le note si scrivono come una fila di numeri (1 = prima corsia, - = pausa) oppure le inventa il computer.",
  priority: 60,
  props: {
    lanes: { type: "integer", label: "Corsie", default: 4, min: 1, max: 4 },
    bpm: { type: "number", label: "Battiti al minuto", default: 120, min: 20, step: 5 },
    perBeat: { type: "integer", label: "Note per battito", default: 2, min: 1, max: 4, help: "2 = ottavi: ogni carattere del disegno dura mezzo battito." },
    pattern: {
      type: "text",
      label: "Disegno delle note",
      default: "",
      help: "Una fila di numeri: 1-4 la corsia, - la pausa. Vuoto = le note le inventa il computer.",
    },
    bars: { type: "integer", label: "Battute inventate", default: 16, min: 1, group: "Se inventate" },
    density: { type: "number", label: "Quante note", default: 0.45, min: 0.05, max: 1, step: 0.05, group: "Se inventate" },
    seed: { type: "integer", label: "Seme", default: 7, min: 0, group: "Se inventate", help: "Con lo stesso seme esce sempre la stessa canzone." },
    speed: { type: "number", label: "Velocità delle note", unit: "px/s", default: 110, min: 20, step: 10 },
    delay: { type: "number", label: "Attesa prima di partire", unit: "s", default: 2, min: 0, step: 0.5 },
    perfectWindow: { type: "number", label: "Finestra «Perfetto»", unit: "ms", default: 70, min: 10, step: 10 },
    goodWindow: { type: "number", label: "Finestra «Bene»", unit: "ms", default: 140, min: 20, step: 10 },
    key1: { type: "input", label: "Tasto corsia 1", default: "left", group: "Comandi" },
    key2: { type: "input", label: "Tasto corsia 2", default: "down", group: "Comandi" },
    key3: { type: "input", label: "Tasto corsia 3", default: "up", group: "Comandi" },
    key4: { type: "input", label: "Tasto corsia 4", default: "right", group: "Comandi" },
    scoreVar: { type: "variable", label: "Punteggio nella variabile", default: "punti", optional: true },
    comboVar: { type: "variable", label: "Combo nella variabile", default: "", optional: true },
    missVar: { type: "variable", label: "Note mancate nella variabile", default: "", optional: true },
    hitSound: { type: "audio", label: "Suono della nota presa", default: "", optional: true },
    missSound: { type: "audio", label: "Suono della nota mancata", default: "", optional: true },
    laneWidth: { type: "number", label: "Larghezza della corsia", unit: "px", default: 26, min: 8, group: "Aspetto" },
    lineY: { type: "number", label: "Altezza della linea", unit: "px", default: 150, min: 10, group: "Aspetto" },
  },
  texts: ["Perfetto!", "Bene!", "Mancata", "Combo", "Pronti…", "Finito!"],
  events: [
    { id: "hit", label: "Ha preso una nota" },
    { id: "miss", label: "Ha mancato una nota" },
    { id: "finished", label: "La canzone è finita" },
  ],
  conditions: {
    isPlaying: { label: "La canzone sta andando", test: (self) => !self.data.over && self.data.time > 0 },
    isFinished: { label: "La canzone è finita", test: (self) => !!self.data.over },
  },
  actions: {
    restart: {
      label: "Ricomincia la canzone",
      run: (self) => {
        reset(self);
      },
    },
  },
  init(self) {
    reset(self);
  },
  update(self, dt) {
    const p = self.props;
    const d = self.data;
    if (d.msgT > 0) d.msgT -= dt;
    if (d.over) return;
    d.time += dt;
    const notes = d.notes as Note[];
    // Note lasciate passare: sono mancate.
    const late = Number(p.goodWindow) / 1000;
    for (const n of notes) if (!n.done && d.time - n.time > late) miss(self, n);
    // Tasti: ogni corsia ha il suo.
    const input = self.game.input;
    const lanes = Math.max(1, Math.min(4, Number(p.lanes)));
    for (let lane = 0; lane < lanes; lane++) {
      const key = String(p[LANE_KEYS[lane]] ?? "");
      if (!key || !input.pressed(key)) continue;
      d.press[lane] = 0.12;
      const note = nearestNote(self, lane);
      if (note) judge(self, note, d.time - note.time);
    }
    for (let i = 0; i < 4; i++) if (d.press[i] > 0) d.press[i] -= dt;
    // Fine della canzone: due secondi dopo l'ultima nota.
    const last = notes.length ? notes[notes.length - 1].time : 0;
    if (d.time > last + 2) {
      d.over = true;
      const total = Math.max(1, notes.length);
      const accuracy = Math.round((d.hits / total) * 100);
      flash(self, self.game.t("Finito!"), "#ffe9a8");
      self.emit("finished", { score: d.score, best: d.best, hits: d.hits, misses: d.misses, accuracy });
    }
  },
  renderScreen(self, r) {
    const p = self.props;
    const d = self.data;
    const W = r.width;
    const lanes = Math.max(1, Math.min(4, Number(p.lanes)));
    const lw = Number(p.laneWidth);
    const total = lanes * lw;
    const x0 = (W - total) / 2;
    const lineY = Number(p.lineY);
    const t = Math.max(0.5, 1 / r.pixelScale);
    // Corsie e linea del tempo.
    for (let i = 0; i < lanes; i++) {
      const x = x0 + i * lw;
      r.rect(x, 0, lw - 2, r.height, hexColor("#0c1016", 0.55));
      const on = d.press[i] > 0;
      r.rect(x, lineY - 4, lw - 2, 9, hexColor(LANE_COLORS[i], on ? 0.75 : 0.25));
    }
    r.rect(x0 - 2, lineY - 1, total + 2, 2, hexColor("#ffffff", 0.8));
    // Note che scendono: quelle troppo lontane non si disegnano.
    for (const n of d.notes as Note[]) {
      if (n.done) continue;
      const dy = (n.time - d.time) * Number(p.speed);
      const y = lineY - dy;
      if (y < -12 || y > r.height + 12) continue;
      const x = x0 + n.lane * lw;
      r.rect(x + 1, y - 4, lw - 4, 8, hexColor(LANE_COLORS[n.lane]));
      r.strokeRect(x + 1, y - 4, lw - 4, 8, t, hexColor("#ffffff", 0.5));
    }
    // Punteggio, combo e giudizio.
    r.text(String(d.score), 8, 6, { size: 10, outline: true });
    if (d.combo > 1) r.text(`${self.game.t("Combo")} ${d.combo}`, 8, 18, { size: 8, outline: true, color: "#ffe9a8" });
    if (d.time < 0.1 && !d.over) r.text(self.game.t("Pronti…"), W / 2, lineY - 40, { size: 10, align: "center", outline: true });
    if (d.msgT > 0 && d.msg) {
      r.text(String(d.msg), W / 2, lineY - 30, { size: d.over ? 14 : 10, align: "center", outline: true, color: String(d.msgColor) });
    }
  },
});

/** Prepara (o ricomincia) la canzone. */
function reset(self: BlockInstance): void {
  const d = self.data;
  d.notes = buildNotes(self);
  d.time = -Math.max(0, Number(self.props.delay));
  d.score = 0;
  d.combo = 0;
  d.best = 0;
  d.hits = 0;
  d.perfects = 0;
  d.misses = 0;
  d.over = false;
  d.msg = "";
  d.msgT = 0;
  d.msgColor = "#ffffff";
  d.press = [0, 0, 0, 0];
  if (!(d.notes as Note[]).length) self.game.log("Note a tempo: non c'è nessuna nota da suonare", "warn");
  writeVars(self);
}


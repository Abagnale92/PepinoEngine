import { defineBlock, listRows, type BlockInstance, type ListRow } from "../core/block";
import { clamp, hexColor } from "../math";
import type { Renderer } from "../render/renderer";

/**
 * Duello a carte a turni: si pesca una mano, si spende energia per giocare le carte
 * (colpisci, cura, scudo, pesca, energia) e poi tocca all'avversario, che sceglie una mossa
 * dal suo mazzo. Le carte guadagnate possono restare in una variabile, come l'inventario.
 */

interface Card {
  name: string;
  cost: number;
  effect: string;
  value: number;
  color: string;
}

export const CARD_EFFECTS = [
  { value: "attack", label: "Colpisce" },
  { value: "heal", label: "Cura" },
  { value: "shield", label: "Scudo" },
  { value: "draw", label: "Pesca carte" },
  { value: "energy", label: "Dà energia" },
];

const CARD_W = 44;
const CARD_H = 60;

/** Una carta per riga dell'elenco, con quante copie ne vanno nel mazzo all'inizio. */
function cardRows(self: BlockInstance, key: "deck" | "enemyDeck"): { card: Card; copies: number }[] {
  const out: { card: Card; copies: number }[] = [];
  for (const row of listRows(self.def.props[key], self.props[key]) as ListRow[]) {
    const card: Card = {
      name: String(row.name ?? ""),
      cost: Math.max(0, Number(row.cost ?? 0)),
      effect: String(row.effect ?? "attack"),
      value: Number(row.value ?? 1),
      color: String(row.color ?? "#4a8fd6"),
    };
    if (card.name) out.push({ card, copies: Math.max(0, Number(row.copies ?? 1)) });
  }
  return out;
}

/** Le carte scritte in un elenco del blocco, ripetute secondo le copie. */
function cardsOf(self: BlockInstance, key: "deck" | "enemyDeck"): Card[] {
  const out: Card[] = [];
  for (const { card, copies } of cardRows(self, key)) for (let i = 0; i < copies; i++) out.push({ ...card });
  return out;
}

/** Le carte guadagnate, scritte in una variabile come «Peperoncino|Scudo». */
function extraCards(self: BlockInstance): Card[] {
  const v = String(self.props.deckVar ?? "");
  if (!v) return [];
  const names = String(self.game.vars[v] ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  // Anche le carte con 0 copie: sono quelle che si imparano durante il gioco.
  const all = cardRows(self, "deck").map((r) => r.card);
  const out: Card[] = [];
  for (const n of names) {
    const found = all.find((c) => c.name === n);
    if (found) out.push({ ...found });
  }
  return out;
}

function shuffle(list: Card[], rnd: () => number): Card[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Pesca una carta: quando il mazzo finisce, gli scarti tornano dentro mischiati. */
function draw(self: BlockInstance, n = 1): void {
  const d = self.data;
  for (let i = 0; i < n; i++) {
    if (d.hand.length >= 8) return;
    if (!d.draw.length) {
      if (!d.discard.length) return;
      d.draw = shuffle(d.discard, Math.random);
      d.discard = [];
    }
    d.hand.push(d.draw.pop());
  }
}

function say(self: BlockInstance, text: string, seconds = 1.4): void {
  self.data.msg = text;
  self.data.msgT = seconds;
}

/** Danno a chi difende, tenendo conto dello scudo che si consuma. */
function hit(self: BlockInstance, who: "player" | "enemy", amount: number): void {
  const d = self.data;
  const shieldKey = who === "player" ? "shield" : "enemyShield";
  const hpKey = who === "player" ? "hp" : "enemyHp";
  const left = Math.max(0, amount - d[shieldKey]);
  d[shieldKey] = Math.max(0, d[shieldKey] - amount);
  d[hpKey] = Math.max(0, d[hpKey] - left);
  syncVars(self);
}

function syncVars(self: BlockInstance): void {
  const p = self.props;
  const d = self.data;
  if (p.hpVar) self.game.vars[p.hpVar] = d.hp;
  if (p.enemyHpVar) self.game.vars[p.enemyHpVar] = d.enemyHp;
}

/** Applica l'effetto di una carta giocata da chi la gioca. */
function apply(self: BlockInstance, card: Card, by: "player" | "enemy"): void {
  const d = self.data;
  switch (card.effect) {
    case "attack":
      hit(self, by === "player" ? "enemy" : "player", card.value);
      break;
    case "heal":
      if (by === "player") d.hp = Math.min(self.props.hp, d.hp + card.value);
      else d.enemyHp = Math.min(self.props.enemyHp, d.enemyHp + card.value);
      syncVars(self);
      break;
    case "shield":
      if (by === "player") d.shield += card.value;
      else d.enemyShield += card.value;
      break;
    case "draw":
      if (by === "player") draw(self, card.value);
      break;
    case "energy":
      if (by === "player") d.energy += card.value;
      break;
  }
}

/** Finita la partita: si annuncia e si avvisano le Regole. */
function finish(self: BlockInstance, won: boolean): void {
  const d = self.data;
  d.phase = "over";
  d.result = won ? "win" : "lose";
  say(self, self.game.t(won ? "Hai vinto!" : "Hai perso!"), 99);
  if (self.props.wonVar) self.game.vars[self.props.wonVar] = won ? 1 : 0;
  self.emit(won ? "won" : "lost");
}

function checkEnd(self: BlockInstance): boolean {
  const d = self.data;
  if (d.phase === "over") return true;
  if (d.enemyHp <= 0) {
    finish(self, true);
    return true;
  }
  if (d.hp <= 0) {
    finish(self, false);
    return true;
  }
  return false;
}

/** Gioca la carta numero `i` della mano, se l'energia basta. */
function playCard(self: BlockInstance, i: number): void {
  const d = self.data;
  if (d.phase !== "player") return;
  const card = d.hand[i] as Card | undefined;
  if (!card) return;
  if (card.cost > d.energy) {
    say(self, self.game.t("Non hai abbastanza energia"));
    return;
  }
  d.energy -= card.cost;
  d.hand.splice(i, 1);
  d.discard.push(card);
  d.sel = clamp(d.sel, 0, Math.max(0, d.hand.length - 1));
  apply(self, card, "player");
  if (self.props.playSound) self.game.audio.play(self.props.playSound);
  self.emit("cardPlayed", { card: card.name });
  checkEnd(self);
}

/** Inizio del turno del giocatore: mano nuova, energia piena e la mossa che prepara l'avversario. */
function startPlayerTurn(self: BlockInstance): void {
  const d = self.data;
  const p = self.props;
  d.phase = "player";
  d.energy = Number(p.energy);
  d.shield = 0;
  d.discard.push(...d.hand);
  d.hand = [];
  draw(self, Number(p.handSize));
  d.sel = 0;
  const moves = cardsOf(self, "enemyDeck");
  d.plan = moves.length ? moves[Math.floor(Math.random() * moves.length)] : null;
  d.turnNo++;
  self.emit("turnStart", { turn: d.turnNo });
}

function endTurn(self: BlockInstance): void {
  const d = self.data;
  if (d.phase !== "player") return;
  d.phase = "enemy";
  d.wait = 0.9;
  d.enemyShield = 0;
  self.emit("turnEnd", { turn: d.turnNo });
}

/** Che cosa sta per fare l'avversario, in parole. */
function planText(self: BlockInstance, card: Card | null): string {
  if (!card) return "";
  const t = (s: string) => self.game.t(s);
  switch (card.effect) {
    case "attack":
      return `${t("Attacca")} ${card.value}`;
    case "heal":
      return `${t("Si cura")} ${card.value}`;
    case "shield":
      return `${t("Si difende")} ${card.value}`;
    default:
      return card.name;
  }
}

/** Una carta disegnata sullo schermo. */
function drawCard(self: BlockInstance, r: Renderer, card: Card, x: number, y: number, selected: boolean, affordable: boolean): void {
  const t = Math.max(0.5, 1 / r.pixelScale);
  r.rect(x, y, CARD_W, CARD_H, hexColor("#11151a", affordable ? 0.95 : 0.6));
  r.rect(x + 2, y + 2, CARD_W - 4, 14, hexColor(card.color, affordable ? 1 : 0.5));
  r.strokeRect(x, y, CARD_W, CARD_H, t, hexColor(selected ? "#ffe9a8" : "#5b6a5b", affordable ? 1 : 0.5));
  r.text(self.game.t(card.name), x + CARD_W / 2, y + 20, { size: 6, align: "center", color: affordable ? "#ffffff" : "#9aa79a" });
  const label = CARD_EFFECTS.find((e) => e.value === card.effect)?.label ?? "";
  r.text(self.game.t(label), x + CARD_W / 2, y + 32, { size: 6, align: "center", color: "#a9bcd0" });
  r.text(String(card.value), x + CARD_W / 2, y + 40, { size: 12, align: "center", color: affordable ? "#ffffff" : "#9aa79a" });
  // Costo in alto a sinistra.
  r.rect(x + 2, y + 2, 10, 10, hexColor("#101318", 0.85));
  r.text(String(card.cost), x + 7, y + 3, { size: 8, align: "center", color: "#ffe9a8" });
}

defineBlock({
  name: "CardBattle",
  label: "Duello a carte",
  category: "Gameplay",
  description:
    "Uno scontro a turni con le carte: peschi una mano, spendi l'energia per giocarle (colpisci, cura, scudo, pesca, energia) e poi l'avversario risponde con una mossa del suo mazzo. Le carte si scrivono qui sotto una per riga; quelle guadagnate durante il gioco possono restare in una variabile.",
  priority: 70,
  props: {
    hp: { type: "integer", label: "Vita del giocatore", default: 30, min: 1 },
    enemyName: { type: "string", label: "Nome dell'avversario", default: "Avversario", translatable: true },
    enemyHp: { type: "integer", label: "Vita dell'avversario", default: 24, min: 1 },
    energy: { type: "integer", label: "Energia per turno", default: 3, min: 1 },
    handSize: { type: "integer", label: "Carte in mano", default: 4, min: 1, max: 8 },
    deck: {
      type: "list",
      label: "Mazzo del giocatore",
      rowLabel: "name",
      addLabel: "Aggiungi carta",
      default: [
        { name: "Colpo", cost: 1, effect: "attack", value: 4, copies: 4, color: "#c2504a" },
        { name: "Foglia", cost: 1, effect: "shield", value: 4, copies: 3, color: "#4a8fd6" },
        { name: "Pozione", cost: 1, effect: "heal", value: 3, copies: 2, color: "#6cc24a" },
        { name: "Idea", cost: 0, effect: "draw", value: 2, copies: 1, color: "#b452e0" },
      ],
      fields: {
        name: { type: "string", label: "Nome", default: "Carta", translatable: true },
        cost: { type: "integer", label: "Costo", default: 1, min: 0 },
        effect: { type: "select", label: "Cosa fa", default: "attack", options: CARD_EFFECTS },
        value: { type: "integer", label: "Quanto", default: 4, min: 0 },
        copies: { type: "integer", label: "Copie nel mazzo", default: 2, min: 0, help: "0 = non c'è all'inizio, ma si può imparare con la Regola «Impara una carta»." },
        color: { type: "color", label: "Colore", default: "#4a8fd6" },
      },
    },
    enemyDeck: {
      type: "list",
      label: "Mosse dell'avversario",
      rowLabel: "name",
      addLabel: "Aggiungi mossa",
      default: [
        { name: "Zampata", cost: 0, effect: "attack", value: 5, copies: 3, color: "#c2504a" },
        { name: "Corazza", cost: 0, effect: "shield", value: 4, copies: 1, color: "#4a8fd6" },
        { name: "Morso", cost: 0, effect: "attack", value: 8, copies: 1, color: "#8e2b35" },
      ],
      fields: {
        name: { type: "string", label: "Nome", default: "Mossa", translatable: true },
        cost: { type: "integer", label: "Costo", default: 0, min: 0 },
        effect: { type: "select", label: "Cosa fa", default: "attack", options: CARD_EFFECTS },
        value: { type: "integer", label: "Quanto", default: 5, min: 0 },
        copies: { type: "integer", label: "Quanto spesso", default: 1, min: 1 },
        color: { type: "color", label: "Colore", default: "#c2504a" },
      },
    },
    deckVar: {
      type: "variable",
      label: "Carte guadagnate nella variabile",
      default: "",
      optional: true,
      help: "Come l'inventario: i nomi delle carte in più, separati da |. Si aggiungono al mazzo all'inizio del duello.",
    },
    hpVar: { type: "variable", label: "Vita nella variabile", default: "", optional: true },
    enemyHpVar: { type: "variable", label: "Vita dell'avversario nella variabile", default: "", optional: true },
    wonVar: { type: "variable", label: "Esito nella variabile", default: "", optional: true, help: "1 = hai vinto, 0 = hai perso." },
    playCommand: { type: "input", label: "Gioca la carta con", default: "action", group: "Comandi" },
    endCommand: { type: "input", label: "Fine turno con", default: "dash", group: "Comandi" },
    playSound: { type: "audio", label: "Suono della carta", default: "", optional: true, group: "Comandi" },
  },
  texts: [
    "Fine turno",
    "Il tuo turno",
    "Hai vinto!",
    "Hai perso!",
    "Non hai abbastanza energia",
    "Attacca",
    "Si cura",
    "Si difende",
    "Energia",
    "Mazzo",
    "Scarti",
    "Scudo",
    ...CARD_EFFECTS.map((e) => e.label),
  ],
  events: [
    { id: "turnStart", label: "Inizia il tuo turno" },
    { id: "turnEnd", label: "Finisce il tuo turno" },
    { id: "cardPlayed", label: "Hai giocato una carta" },
    { id: "won", label: "Hai vinto il duello" },
    { id: "lost", label: "Hai perso il duello" },
  ],
  conditions: {
    isWon: { label: "Il duello è vinto", test: (self) => self.data.result === "win" },
    isLost: { label: "Il duello è perso", test: (self) => self.data.result === "lose" },
    isMyTurn: { label: "È il turno del giocatore", test: (self) => self.data.phase === "player" },
  },
  actions: {
    endTurn: { label: "Chiudi il turno", run: (self) => endTurn(self) },
    addCard: {
      label: "Impara una carta",
      params: { card: { type: "string", label: "Nome della carta", default: "" } },
      run: (self, card: string) => {
        const v = String(self.props.deckVar ?? "");
        const name = String(card ?? "").trim();
        if (!v || !name) return;
        const now = String(self.game.vars[v] ?? "");
        self.game.vars[v] = now ? `${now}|${name}` : name;
      },
    },
    restart: {
      label: "Ricomincia il duello",
      run: (self) => {
        setup(self);
      },
    },
  },
  init(self) {
    setup(self);
  },
  update(self, dt) {
    const d = self.data;
    const p = self.props;
    if (d.msgT > 0) d.msgT -= dt;
    if (d.phase === "over") return;

    if (d.phase === "enemy") {
      d.wait -= dt;
      if (d.wait > 0) return;
      const card = (d.plan as Card | null) ?? null;
      if (card) {
        apply(self, card, "enemy");
        say(self, `${self.game.t(p.enemyName)}: ${planText(self, card)}`);
      }
      if (!checkEnd(self)) startPlayerTurn(self);
      return;
    }

    // Turno del giocatore: clic sulle carte o frecce e comando.
    const input = self.game.input;
    const ptr = input.pointer;
    const hand = d.hand as Card[];
    if (hand.length) {
      if (input.pressed("left")) d.sel = (d.sel - 1 + hand.length) % hand.length;
      if (input.pressed("right")) d.sel = (d.sel + 1) % hand.length;
      if (input.pressed(p.playCommand)) return playCard(self, d.sel);
    }
    if (input.pressed(p.endCommand)) return endTurn(self);
    if (ptr.pressed) {
      const v = self.game.renderer.toVirtual(ptr.x, ptr.y);
      const end = d.endRect as { x: number; y: number; w: number; h: number } | undefined;
      if (end && v.x >= end.x && v.x <= end.x + end.w && v.y >= end.y && v.y <= end.y + end.h) return endTurn(self);
      const rects = (d.rects ?? []) as { x: number; y: number }[];
      for (let i = rects.length - 1; i >= 0; i--) {
        const c = rects[i];
        if (v.x >= c.x && v.x <= c.x + CARD_W && v.y >= c.y && v.y <= c.y + CARD_H) {
          d.sel = i;
          return playCard(self, i);
        }
      }
    }
  },
  renderScreen(self, r) {
    const p = self.props;
    const d = self.data;
    const W = r.width;
    const H = r.height;
    const t = Math.max(0.5, 1 / r.pixelScale);
    // Vita del giocatore e dell'avversario.
    const bar = (x: number, w: number, k: number, color: string) => {
      r.rect(x, 8, w, 7, hexColor("#000000", 0.55));
      r.rect(x, 8, w * clamp(k, 0, 1), 7, hexColor(color));
      r.strokeRect(x, 8, w, 7, t, hexColor("#ffffff", 0.3));
    };
    bar(8, 90, d.hp / Math.max(1, p.hp), "#6cc24a");
    r.text(`${d.hp}/${p.hp}`, 10, 16, { size: 7, outline: true });
    bar(W - 98, 90, d.enemyHp / Math.max(1, p.enemyHp), "#c2504a");
    r.text(self.game.t(p.enemyName), W - 8, 16, { size: 7, align: "right", outline: true });
    r.text(`${d.enemyHp}/${p.enemyHp}`, W - 8, 25, { size: 7, align: "right", outline: true });
    if (d.shield > 0) r.text(`${self.game.t("Scudo")} ${d.shield}`, 10, 25, { size: 7, outline: true, color: "#8fd3ff" });
    if (d.enemyShield > 0) r.text(`${self.game.t("Scudo")} ${d.enemyShield}`, W - 8, 34, { size: 7, align: "right", outline: true, color: "#8fd3ff" });
    // Cosa sta per fare l'avversario.
    if (d.phase === "player" && d.plan) {
      r.text(planText(self, d.plan as Card), W / 2, 30, { size: 8, align: "center", outline: true, color: "#ffd0c8" });
    }
    // Energia, mazzo e scarti.
    r.text(`${self.game.t("Energia")} ${d.energy}/${p.energy}`, 8, H - 76, { size: 7, outline: true, color: "#ffe9a8" });
    r.text(`${self.game.t("Mazzo")} ${d.draw.length}`, 8, H - 12, { size: 7, outline: true });
    r.text(`${self.game.t("Scarti")} ${d.discard.length}`, W - 8, H - 12, { size: 7, align: "right", outline: true });
    // La mano, con la carta scelta un po' più in alto.
    const hand = d.hand as Card[];
    const gap = 4;
    const total = hand.length * CARD_W + Math.max(0, hand.length - 1) * gap;
    const x0 = (W - total) / 2;
    const rects: { x: number; y: number }[] = [];
    hand.forEach((card, i) => {
      const x = x0 + i * (CARD_W + gap);
      const y = H - CARD_H - 8 - (i === d.sel ? 5 : 0);
      rects.push({ x, y });
      drawCard(self, r, card, x, y, i === d.sel && d.phase === "player", card.cost <= d.energy && d.phase === "player");
    });
    d.rects = rects;
    // Pulsante «Fine turno».
    const bw = 52;
    const bh = 13;
    const end = { x: W - bw - 8, y: H - CARD_H - 24, w: bw, h: bh };
    d.endRect = end;
    const on = d.phase === "player";
    r.rect(end.x, end.y, bw, bh, hexColor(on ? "#2c4a2c" : "#1b2420", 0.9));
    r.strokeRect(end.x, end.y, bw, bh, t, hexColor("#8cc480", on ? 0.9 : 0.3));
    r.text(self.game.t("Fine turno"), end.x + bw / 2, end.y + 3, { size: 7, align: "center", color: on ? "#ffffff" : "#77877a" });
    // Annuncio al centro.
    if (d.msgT > 0 && d.msg) {
      r.text(String(d.msg), W / 2, H / 2 - 10, { size: d.phase === "over" ? 16 : 9, align: "center", outline: true, color: "#fff3a6" });
    }
  },
});

/** Prepara (o ricomincia) il duello: mazzo mischiato, vita piena, prima mano. */
function setup(self: BlockInstance): void {
  const p = self.props;
  const d = self.data;
  d.hp = Number(p.hp);
  d.enemyHp = Number(p.enemyHp);
  d.shield = 0;
  d.enemyShield = 0;
  d.hand = [];
  d.discard = [];
  d.turnNo = 0;
  d.msg = "";
  d.msgT = 0;
  d.result = "";
  d.sel = 0;
  d.rects = [];
  d.draw = shuffle([...cardsOf(self, "deck"), ...extraCards(self)], Math.random);
  if (!d.draw.length) self.game.log("Duello a carte: il mazzo è vuoto, aggiungi almeno una carta", "warn");
  syncVars(self);
  startPlayerTurn(self);
  say(self, self.game.t("Il tuo turno"));
}

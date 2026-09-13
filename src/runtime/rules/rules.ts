import type { PropSchema } from "../core/block";
import { Entity } from "../core/entity";
import type { Scene } from "../core/scene";
import { overlaps } from "../math";
import type { RuleData, RuleItem, VariableValue } from "../project/format";
import { interpolate } from "../blocks/text";

/**
 * Regole "Quando → Allora": la logica del gioco senza codice.
 * Ogni regola ha un evento (Quando), delle condizioni (e se) e delle azioni (Allora).
 */

export interface RuleCtx {
  /** L'oggetto che ha fatto scattare l'evento ("questo oggetto"). */
  self?: Entity;
  /** L'altro oggetto coinvolto (contatto, schiacciata…). */
  other?: Entity;
}

export type RuleKind = "trigger" | "condition" | "action";
type Params = Record<string, any>;

export interface RuleItemDef {
  type: string;
  kind: RuleKind;
  category: string;
  label: string;
  /** Frase mostrata nell'editor: {nome} diventa il valore del parametro. */
  sentence: string;
  params: Record<string, PropSchema>;
  /** Solo eventi: parametro che indica "questo oggetto" e quello che indica "l'altro". */
  subject?: string;
  other?: string;
  test?: (ctx: RuleCtx, p: Params, rs: RuleSystem) => boolean;
  run?: (ctx: RuleCtx, p: Params, rs: RuleSystem) => void;
}

export const COMPARE_OPTIONS = [
  { value: "==", label: "=" },
  { value: "!=", label: "≠" },
  { value: "<", label: "<" },
  { value: ">", label: ">" },
  { value: "<=", label: "≤" },
  { value: ">=", label: "≥" },
];

export function parseValue(v: unknown): VariableValue {
  if (typeof v === "number" || typeof v === "boolean") return v;
  const s = String(v ?? "");
  if (s === "true" || s === "false") return s === "true";
  const n = Number(s);
  return s.trim() !== "" && !Number.isNaN(n) ? n : s;
}

export function compareValues(a: unknown, op: string, b: unknown): boolean {
  const na = Number(a);
  const nb = Number(b);
  const numeric = a !== "" && b !== "" && !Number.isNaN(na) && !Number.isNaN(nb);
  const x = numeric ? na : String(a ?? "");
  const y = numeric ? nb : String(b ?? "");
  switch (op) {
    case "==":
      return x === y;
    case "!=":
      return x !== y;
    case "<":
      return x < y;
    case ">":
      return x > y;
    case "<=":
      return x <= y;
    case ">=":
      return x >= y;
  }
  return false;
}

/** "Tipo.nome" → ["Tipo", "nome"] (condizioni e azioni dei blocchi). */
export function splitRuleKey(key: unknown): [string, string] {
  const s = String(key ?? "");
  const i = s.indexOf(".");
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
}

/** L'oggetto corrisponde al riferimento? (per gli eventi) */
export function matchRef(ref: string, e: Entity, emptyMeansAny = false): boolean {
  if (!ref) return emptyMeansAny;
  if (ref === "*") return true;
  if (ref.startsWith("#")) return e.hasTag(ref.slice(1));
  if (ref.startsWith("@")) return e.id === ref.slice(1);
  return false;
}

/** Oggetti indicati da un riferimento (per condizioni e azioni). */
export function resolveRef(ref: unknown, ctx: RuleCtx, scene: Scene): Entity[] {
  const r = String(ref ?? "");
  if (r === "self") return ctx.self ? [ctx.self] : [];
  if (r === "other") return ctx.other ? [ctx.other] : [];
  if (r === "*") return scene.entities.filter((e) => !e.destroyed);
  if (r.startsWith("#")) return scene.findAll(r.slice(1));
  if (r.startsWith("@")) {
    const e = scene.entities.find((x) => !x.destroyed && x.id === r.slice(1));
    return e ? [e] : [];
  }
  return [];
}

const touching = (a: Entity, b: Entity) =>
  a !== b && !!a.body && !!b.body && !a.destroyed && !b.destroyed && overlaps(a.body.rect(), b.body.rect());

const argValues = (params: Record<string, PropSchema> | undefined, args: Params | undefined) =>
  Object.entries(params ?? {}).map(([k, s]) => (args?.[k] !== undefined ? args[k] : s.default));

export function callBlockAction(e: Entity, key: unknown, args?: Params): void {
  const [type, name] = splitRuleKey(key);
  const b = e.get(type);
  const a = b?.def.actions[name];
  if (b && a && b.enabled) a.run(b, ...argValues(a.params, args));
}

export function testBlockCondition(e: Entity, key: unknown, args?: Params): boolean {
  const [type, name] = splitRuleKey(key);
  const b = e.get(type);
  const c = b?.def.conditions[name];
  return !!b && !!c && b.enabled && c.test(b, ...argValues(c.params, args));
}

const obj = (label: string, def = "self"): PropSchema => ({ type: "object", label, default: def });
const seconds = (label: string, def: number): PropSchema => ({ type: "number", label, unit: "s", default: def, min: 0, step: 0.1 });
const each = (p: Params, key: string, ctx: RuleCtx, rs: RuleSystem, fn: (e: Entity) => void) => resolveRef(p[key], ctx, rs.scene).forEach(fn);

const DEFS: RuleItemDef[] = [
  // ------------------------------------------------------------ Eventi (Quando)
  { type: "scene.start", kind: "trigger", category: "Scena e tempo", label: "La scena inizia", sentence: "la scena inizia", params: {} },
  { type: "always", kind: "trigger", category: "Scena e tempo", label: "In ogni momento", sentence: "in ogni momento", params: {} },
  {
    type: "every",
    kind: "trigger",
    category: "Scena e tempo",
    label: "Ogni tot secondi",
    sentence: "ogni {seconds} secondi",
    params: { seconds: { type: "number", label: "Ogni", unit: "s", default: 1, min: 0.05, step: 0.1 } },
  },
  {
    type: "after",
    kind: "trigger",
    category: "Scena e tempo",
    label: "Dopo tot secondi",
    sentence: "passano {seconds} secondi dall'inizio della scena",
    params: { seconds: seconds("Secondi", 2) },
  },
  {
    type: "input.pressed",
    kind: "trigger",
    category: "Comandi",
    label: "Il giocatore preme un comando",
    sentence: "il giocatore preme {action}",
    params: { action: { type: "input", label: "Comando", default: "action" } },
  },
  {
    type: "contact",
    kind: "trigger",
    category: "Oggetti",
    label: "Un oggetto ne tocca un altro",
    sentence: "{target} tocca {other}",
    params: { target: obj("Oggetto", "#giocatore"), other: obj("Tocca", "*") },
    subject: "target",
    other: "other",
  },
  {
    type: "contact.end",
    kind: "trigger",
    category: "Oggetti",
    label: "Un oggetto smette di toccarne un altro",
    sentence: "{target} smette di toccare {other}",
    params: { target: obj("Oggetto", "#giocatore"), other: obj("Smette di toccare", "*") },
    subject: "target",
    other: "other",
  },
  {
    type: "event",
    kind: "trigger",
    category: "Oggetti",
    label: "Succede qualcosa a un oggetto",
    sentence: "{target}: {event}",
    params: { target: obj("Oggetto", "#giocatore"), event: { type: "event", label: "Cosa succede", default: "" } },
    subject: "target",
  },

  // ------------------------------------------------------------ Condizioni (e se)
  {
    type: "var.compare",
    kind: "condition",
    category: "Variabili",
    label: "Confronta una variabile",
    sentence: "{variable} {op} {value}",
    params: {
      variable: { type: "variable", label: "Variabile", default: "" },
      op: { type: "compare", label: "Confronto", default: ">=" },
      value: { type: "value", label: "Valore", default: "0" },
    },
    test: (ctx, p, rs) => compareValues(rs.game.vars[p.variable], p.op, parseValue(p.value)),
  },
  {
    type: "object.state",
    kind: "condition",
    category: "Oggetti",
    label: "Un oggetto è in uno stato",
    sentence: "{target} è nello stato {state}",
    params: { target: obj("Oggetto"), state: { type: "state", label: "Stato", default: "idle" } },
    test: (ctx, p, rs) => resolveRef(p.target, ctx, rs.scene).some((e) => e.state === p.state),
  },
  {
    type: "object.touching",
    kind: "condition",
    category: "Oggetti",
    label: "Un oggetto sta toccando un altro",
    sentence: "{target} sta toccando {other}",
    params: { target: obj("Oggetto"), other: obj("Altro oggetto", "*") },
    test: (ctx, p, rs) => {
      const others = resolveRef(p.other, ctx, rs.scene);
      return resolveRef(p.target, ctx, rs.scene).some((a) => others.some((b) => touching(a, b)));
    },
  },
  {
    type: "block.condition",
    kind: "condition",
    category: "Oggetti",
    label: "Condizione di un blocco",
    sentence: "{target}: {condition}",
    params: { target: obj("Oggetto"), condition: { type: "condition", label: "Condizione", default: "" } },
    test: (ctx, p, rs) => resolveRef(p.target, ctx, rs.scene).some((e) => testBlockCondition(e, p.condition, p.args)),
  },
  {
    type: "count",
    kind: "condition",
    category: "Oggetti",
    label: "Conta gli oggetti in scena",
    sentence: "gli oggetti {target} sono {op} {value}",
    params: {
      target: obj("Oggetti", "#nemico"),
      op: { type: "compare", label: "Confronto", default: "==" },
      value: { type: "value", label: "Numero", default: "0" },
    },
    test: (ctx, p, rs) => compareValues(resolveRef(p.target, ctx, rs.scene).filter((e) => !e.destroyed).length, p.op, parseValue(p.value)),
  },
  {
    type: "distance",
    kind: "condition",
    category: "Oggetti",
    label: "Un oggetto è vicino a un altro",
    sentence: "{target} è a meno di {tiles} tile da {other}",
    params: {
      target: obj("Oggetto"),
      tiles: { type: "number", label: "Distanza", unit: "tile", default: 3, min: 0, step: 0.5 },
      other: obj("Da", "#giocatore"),
    },
    test: (ctx, p, rs) => {
      const max = p.tiles * rs.scene.tileSize;
      const others = resolveRef(p.other, ctx, rs.scene);
      return resolveRef(p.target, ctx, rs.scene).some((a) =>
        others.some((b) => a !== b && Math.hypot(a.worldX - b.worldX, a.worldY - b.worldY) < max),
      );
    },
  },
  {
    type: "input.down",
    kind: "condition",
    category: "Comandi",
    label: "Il giocatore tiene premuto un comando",
    sentence: "il giocatore tiene premuto {action}",
    params: { action: { type: "input", label: "Comando", default: "action" } },
    test: (ctx, p, rs) => rs.game.input.isDown(p.action),
  },
  {
    type: "random",
    kind: "condition",
    category: "Varie",
    label: "Con una certa probabilità",
    sentence: "con probabilità del {percent}%",
    params: { percent: { type: "number", label: "Probabilità", unit: "%", default: 50, min: 0, max: 100 } },
    test: (ctx, p) => Math.random() * 100 < p.percent,
  },
  {
    type: "save.exists",
    kind: "condition",
    category: "Partita",
    label: "Esiste una partita salvata",
    sentence: "esiste una partita salvata",
    params: {},
    test: (ctx, p, rs) => rs.game.hasSave(),
  },

  // ------------------------------------------------------------ Azioni (Allora)
  {
    type: "var.set",
    kind: "action",
    category: "Variabili",
    label: "Imposta una variabile",
    sentence: "imposta {variable} a {value}",
    params: { variable: { type: "variable", label: "Variabile", default: "" }, value: { type: "value", label: "Valore", default: "0" } },
    run: (ctx, p, rs) => {
      if (p.variable) rs.game.vars[p.variable] = parseValue(interpolate(String(p.value ?? ""), rs.game.vars));
    },
  },
  {
    type: "var.add",
    kind: "action",
    category: "Variabili",
    label: "Aggiungi a una variabile",
    sentence: "aggiungi {amount} a {variable}",
    params: {
      amount: { type: "number", label: "Quantità", default: 1, step: 1, help: "Usa un numero negativo per togliere." },
      variable: { type: "variable", label: "Variabile", default: "" },
    },
    run: (ctx, p, rs) => {
      if (p.variable) rs.game.vars[p.variable] = Number(rs.game.vars[p.variable] ?? 0) + Number(p.amount ?? 0);
    },
  },
  {
    type: "scene.goto",
    kind: "action",
    category: "Scena e tempo",
    label: "Vai a un'altra scena",
    sentence: "vai alla scena {scene}",
    params: { scene: { type: "scene", label: "Scena", default: "" }, fade: seconds("Dissolvenza", 0.4) },
    run: (ctx, p, rs) => {
      if (p.scene) rs.game.goToScene(p.scene, p.fade);
    },
  },
  {
    type: "scene.restart",
    kind: "action",
    category: "Scena e tempo",
    label: "Riavvia la scena",
    sentence: "riavvia la scena",
    params: {},
    run: (ctx, p, rs) => rs.game.restartScene(),
  },
  {
    type: "wait",
    kind: "action",
    category: "Scena e tempo",
    label: "Attendi",
    sentence: "attendi {seconds} secondi",
    params: { seconds: seconds("Secondi", 1) },
  },
  {
    type: "object.destroy",
    kind: "action",
    category: "Oggetti",
    label: "Distruggi un oggetto",
    sentence: "distruggi {target}",
    params: { target: obj("Oggetto") },
    run: (ctx, p, rs) => each(p, "target", ctx, rs, (e) => e.destroy()),
  },
  {
    type: "object.spawn",
    kind: "action",
    category: "Oggetti",
    label: "Crea un oggetto da un modello",
    sentence: "crea {prefab} dove si trova {target}",
    params: {
      prefab: { type: "prefab", label: "Modello", default: "" },
      target: obj("Nella posizione di"),
      offsetX: { type: "number", label: "Spostamento X", unit: "tile", default: 0, step: 0.5 },
      offsetY: { type: "number", label: "Spostamento Y", unit: "tile", default: 0, step: 0.5 },
    },
    run: (ctx, p, rs) => {
      if (!p.prefab) return;
      const ts = rs.scene.tileSize;
      each(p, "target", ctx, rs, (e) => rs.scene.spawn(p.prefab, e.worldX + p.offsetX * ts, e.worldY + p.offsetY * ts));
    },
  },
  {
    type: "object.teleport",
    kind: "action",
    category: "Oggetti",
    label: "Sposta un oggetto su un altro",
    sentence: "sposta {target} dove si trova {dest}",
    params: { target: obj("Oggetto"), dest: obj("Destinazione", "") },
    run: (ctx, p, rs) => {
      const d = resolveRef(p.dest, ctx, rs.scene)[0];
      if (!d) return;
      each(p, "target", ctx, rs, (e) => {
        e.x = d.worldX - (e.parent?.worldX ?? 0);
        e.y = d.worldY - (e.parent?.worldY ?? 0);
        if (e.body) e.body.vx = e.body.vy = 0;
      });
    },
  },
  {
    type: "object.visible",
    kind: "action",
    category: "Oggetti",
    label: "Mostra o nascondi un oggetto",
    sentence: "{visible} {target}",
    params: {
      visible: {
        type: "select",
        label: "Azione",
        default: "hide",
        options: [
          { value: "show", label: "mostra" },
          { value: "hide", label: "nascondi" },
        ],
      },
      target: obj("Oggetto"),
    },
    run: (ctx, p, rs) => each(p, "target", ctx, rs, (e) => (e.visible = p.visible === "show")),
  },
  {
    type: "block.action",
    kind: "action",
    category: "Oggetti",
    label: "Azione di un blocco",
    sentence: "{target}: {action}",
    params: { target: obj("Oggetto"), action: { type: "blockAction", label: "Azione", default: "" } },
    run: (ctx, p, rs) => each(p, "target", ctx, rs, (e) => callBlockAction(e, p.action, p.args)),
  },
  {
    type: "block.enable",
    kind: "action",
    category: "Oggetti",
    label: "Attiva o disattiva un blocco",
    sentence: "{enabled} il blocco {block} di {target}",
    params: {
      enabled: {
        type: "select",
        label: "Azione",
        default: "off",
        options: [
          { value: "on", label: "attiva" },
          { value: "off", label: "disattiva" },
        ],
      },
      block: { type: "block", label: "Blocco", default: "" },
      target: obj("Oggetto"),
    },
    run: (ctx, p, rs) =>
      each(p, "target", ctx, rs, (e) => {
        const b = e.get(String(p.block));
        if (b) b.enabled = p.enabled === "on";
      }),
  },
  {
    type: "audio.play",
    kind: "action",
    category: "Audio",
    label: "Suona un effetto",
    sentence: "suona {sound}",
    params: { sound: { type: "audio", label: "Suono", default: "" } },
    run: (ctx, p, rs) => rs.game.audio.play(p.sound),
  },
  {
    type: "audio.music",
    kind: "action",
    category: "Audio",
    label: "Cambia la musica",
    sentence: "metti la musica {music}",
    params: { music: { type: "audio", label: "Musica", default: "", help: "Vuoto = silenzio." } },
    run: (ctx, p, rs) => (p.music ? rs.game.audio.playMusic(p.music) : rs.game.audio.stopMusic()),
  },
  {
    type: "camera.shake",
    kind: "action",
    category: "Camera",
    label: "Scuoti lo schermo",
    sentence: "scuoti lo schermo ({intensity} px per {duration} s)",
    params: {
      intensity: { type: "number", label: "Intensità", unit: "px", default: 3, min: 0 },
      duration: seconds("Durata", 0.25),
    },
    run: (ctx, p, rs) => rs.scene.camera.shake(p.intensity, p.duration),
  },
  {
    type: "message.show",
    kind: "action",
    category: "Interfaccia",
    label: "Mostra un messaggio",
    sentence: "mostra il messaggio «{text}»",
    params: {
      text: { type: "text", label: "Testo", default: "Ciao!", help: "Puoi usare {variabile}." },
      duration: seconds("Durata", 3),
      pause: { type: "boolean", label: "Ferma il gioco", default: false, help: "Il gioco riparte quando il messaggio sparisce." },
    },
    run: (ctx, p, rs) => rs.game.showMessage(interpolate(String(p.text ?? ""), rs.game.vars), Number(p.duration ?? 0), !!p.pause),
  },
  {
    type: "game.save",
    kind: "action",
    category: "Partita",
    label: "Salva la partita",
    sentence: "salva la partita",
    params: {},
    run: (ctx, p, rs) => rs.game.saveGame(),
  },
  {
    type: "game.load",
    kind: "action",
    category: "Partita",
    label: "Carica la partita",
    sentence: "carica la partita salvata",
    params: {},
    run: (ctx, p, rs) => rs.game.loadGame(),
  },
  {
    type: "log",
    kind: "action",
    category: "Varie",
    label: "Scrivi in console",
    sentence: "scrivi in console «{text}»",
    params: { text: { type: "text", label: "Testo", default: "", help: "Utile per capire se una regola scatta." } },
    run: (ctx, p, rs) => rs.game.log(`Regola: ${interpolate(String(p.text ?? ""), rs.game.vars)}`),
  },
];

const BY_TYPE = new Map(DEFS.map((d) => [d.type, d]));

/** Tolleranza sui tempi: 30 passi da 1/60 s sommati danno 0,4999…, non 0,5. */
const TIME_EPS = 1e-6;

export const RULE_ITEMS: readonly RuleItemDef[] = DEFS;
export const RULE_CATEGORIES = ["Scena e tempo", "Comandi", "Oggetti", "Variabili", "Audio", "Camera", "Interfaccia", "Partita", "Varie"];
export const getRuleItemDef = (type: string) => BY_TYPE.get(type);

interface Entry {
  data: RuleData;
  timer: number;
  fired: boolean;
  afterDone: boolean;
  contacts: Map<string, [Entity, Entity]>;
}

interface Wait {
  time: number;
  entry: Entry;
  index: number;
  ctx: RuleCtx;
}

export class RuleSystem {
  private entries: Entry[];
  private queue: { entry: Entry; ctx: RuleCtx }[] = [];
  private waits: Wait[] = [];
  private started = false;
  private warned = new Set<string>();
  time = 0;

  constructor(
    readonly scene: Scene,
    rules: RuleData[],
  ) {
    this.entries = rules
      .filter((r) => r.enabled !== false && r.when)
      .map((data) => ({ data, timer: 0, fired: false, afterDone: false, contacts: new Map() }));
    const events = new Set<string>();
    for (const e of this.entries) {
      if (e.data.when.type === "event" && e.data.when.params.event) events.add(String(e.data.when.params.event));
    }
    for (const name of events) {
      scene.events.on(name, (payload: { entity: Entity; data: unknown }) => this.onEvent(name, payload.entity, payload.data));
    }
  }

  get game() {
    return this.scene.game;
  }

  private onEvent(name: string, entity: Entity, data: unknown) {
    for (const entry of this.entries) {
      const w = entry.data.when;
      if (w.type !== "event" || w.params.event !== name || !matchRef(String(w.params.target ?? ""), entity)) continue;
      const other =
        data instanceof Entity
          ? data
          : data && typeof data === "object" && (data as { other?: unknown }).other instanceof Entity
            ? ((data as { other: Entity }).other)
            : undefined;
      this.queue.push({ entry, ctx: { self: entity, other } });
    }
  }

  /** Da chiamare una volta per passo di gioco, dopo l'aggiornamento degli oggetti. */
  process(dt: number): void {
    if (!this.started) {
      this.started = true;
      for (const entry of this.entries) if (entry.data.when.type === "scene.start") this.fire(entry, {});
    }
    this.time += dt;
    const input = this.game.input;
    for (const entry of this.entries) {
      const w = entry.data.when;
      const p = w.params;
      switch (w.type) {
        case "always":
          this.fire(entry, {});
          break;
        case "every": {
          const s = Math.max(0.05, Number(p.seconds) || 1);
          entry.timer += dt;
          while (entry.timer >= s - TIME_EPS) {
            entry.timer -= s;
            this.fire(entry, {});
          }
          break;
        }
        case "after":
          if (!entry.afterDone && this.time >= Number(p.seconds ?? 0) - TIME_EPS) {
            entry.afterDone = true;
            this.fire(entry, {});
          }
          break;
        case "input.pressed":
          if (input.pressed(String(p.action))) this.fire(entry, {});
          break;
        case "contact":
        case "contact.end":
          this.checkContacts(entry, w);
          break;
        default:
          if (!getRuleItemDef(w.type) && !this.warned.has(w.type)) {
            this.warned.add(w.type);
            this.game.log(`Regola con evento sconosciuto "${w.type}"`, "warn");
          }
      }
    }
    const queued = this.queue;
    this.queue = [];
    for (const q of queued) this.fire(q.entry, q.ctx);

    if (this.waits.length) {
      const ready: Wait[] = [];
      for (const w of this.waits) {
        w.time -= dt;
        if (w.time <= TIME_EPS) ready.push(w);
      }
      this.waits = this.waits.filter((w) => w.time > TIME_EPS);
      for (const w of ready) this.runActions(w.entry, w.index, w.ctx);
    }
  }

  /** Il contatto è calcolato qui, così funziona anche senza impostare i gruppi di collisione. */
  private checkContacts(entry: Entry, w: RuleItem) {
    const target = String(w.params.target ?? "");
    const other = String(w.params.other ?? "*");
    if (!target) return;
    const list = this.scene.entities.filter((e) => !e.destroyed && e.body);
    const as = list.filter((e) => matchRef(target, e));
    const bs = list.filter((e) => matchRef(other, e, true));
    const now = new Map<string, [Entity, Entity]>();
    for (const a of as) {
      for (const b of bs) {
        if (!touching(a, b)) continue;
        const key = `${a.uid}:${b.uid}`;
        now.set(key, [a, b]);
        if (w.type === "contact" && !entry.contacts.has(key)) this.fire(entry, { self: a, other: b });
      }
    }
    if (w.type === "contact.end") {
      for (const [key, [a, b]] of entry.contacts) if (!now.has(key)) this.fire(entry, { self: a, other: b });
    }
    entry.contacts = now;
  }

  private fire(entry: Entry, ctx: RuleCtx) {
    if (entry.data.once && entry.fired) return;
    for (const c of entry.data.conditions) {
      const def = getRuleItemDef(c.type);
      let ok = true;
      try {
        ok = def?.test ? def.test(ctx, c.params, this) : true;
      } catch (err) {
        this.game.log(`Errore in una condizione (${c.type}): ${(err as Error).message}`, "error");
        ok = false;
      }
      if (c.not) ok = !ok;
      if (!ok) return;
    }
    entry.fired = true;
    this.runActions(entry, 0, ctx);
  }

  private runActions(entry: Entry, from: number, ctx: RuleCtx) {
    const actions = entry.data.actions;
    for (let i = from; i < actions.length; i++) {
      const a = actions[i];
      if (a.type === "wait") {
        this.waits.push({ time: Math.max(0, Number(a.params.seconds) || 0), entry, index: i + 1, ctx });
        return;
      }
      const def = getRuleItemDef(a.type);
      if (!def?.run) continue;
      try {
        def.run(ctx, a.params, this);
      } catch (err) {
        this.game.log(`Errore in un'azione (${def.label}): ${(err as Error).message}`, "error");
      }
    }
  }
}

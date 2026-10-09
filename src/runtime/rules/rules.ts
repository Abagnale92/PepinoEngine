import type { PropSchema } from "../core/block";
import { Entity } from "../core/entity";
import type { Scene } from "../core/scene";
import { clamp, overlaps } from "../math";
import type { CutsceneData, RuleData, RuleItem, VariableValue } from "../project/format";
import { interpolate } from "../blocks/text";
import { POWERUP_OPTIONS, addItem, hasItem, itemDef, removeItem, useItem } from "../items/items";
import { describeScriptError } from "../scripting/errors";
import { SCREEN_EFFECTS } from "../render/effects";

const errorText = (err: unknown) => {
  const d = describeScriptError(err);
  return d.where ? `${d.message} (${d.where})` : d.message;
};

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
  /** Se restituisce un Hold, l'azione successiva aspetta (spostamenti, dialoghi, dissolvenze…). */
  run?: (ctx: RuleCtx, p: Params, rs: RuleSystem) => unknown;
}

/** Un'azione che deve finire prima della successiva. */
export interface Hold {
  seconds?: number;
  /** Vero quando si può andare avanti. */
  until?: () => boolean;
}

const isHold = (v: unknown): v is Hold => !!v && typeof v === "object" && ("until" in v || "seconds" in v);

/** Salendo e scendendo piano: gli spostamenti dei filmati non partono né si fermano di colpo. */
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Azioni saltate quando il giocatore salta un filmato: quello che si vede o si sente e basta. */
const SKIPPED_WHEN_FAST = new Set(["dialogue.start", "cutscene.dialogue", "message.show", "cutscene.message", "camera.shake"]);

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
    type: "light.ambient",
    kind: "action",
    category: "Effetti",
    label: "Cambia la luce ambiente",
    sentence: "luce ambiente {color}",
    params: {
      color: {
        type: "color",
        label: "Colore",
        default: "#20243a",
        optional: true,
        help: "Scuro = notte, i blocchi Luce illuminano. Vuoto = niente illuminazione, si vede tutto.",
      },
    },
    run: (ctx, p, rs) => (rs.scene.ambient = p.color ? String(p.color) : undefined),
  },
  {
    type: "screen.effect",
    kind: "action",
    category: "Effetti",
    label: "Effetto a tutto schermo",
    sentence: "effetto schermo {effect} (intensità {strength})",
    params: {
      effect: { type: "select", label: "Effetto", default: "crt", options: SCREEN_EFFECTS },
      strength: { type: "number", label: "Intensità", default: 1, min: 0, max: 1, step: 0.1 },
    },
    run: (ctx, p, rs) => (rs.game.screenEffect = { id: String(p.effect), strength: Number(p.strength ?? 1) }),
  },
  {
    type: "message.show",
    kind: "action",
    category: "Interfaccia",
    label: "Mostra un messaggio",
    sentence: "mostra il messaggio «{text}»",
    params: {
      text: { type: "text", label: "Testo", default: "Ciao!", help: "Puoi usare {variabile}.", translatable: true },
      duration: seconds("Durata", 3),
      pause: { type: "boolean", label: "Ferma il gioco", default: false, help: "Il gioco riparte quando il messaggio sparisce." },
    },
    run: (ctx, p, rs) => rs.game.showMessage(interpolate(rs.game.t(String(p.text ?? "")), rs.game.vars), Number(p.duration ?? 0), !!p.pause),
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

DEFS.push(
  {
    type: "dialogue.end",
    kind: "trigger",
    category: "Interfaccia",
    label: "Un dialogo finisce",
    sentence: "finisce il dialogo {dialogue}",
    params: { dialogue: { type: "dialogue", label: "Dialogo", default: "", optional: true, help: "Vuoto = qualsiasi dialogo." } },
  },
  {
    type: "dialogue.active",
    kind: "condition",
    category: "Interfaccia",
    label: "È in corso un dialogo",
    sentence: "è in corso un dialogo",
    params: {},
    test: (ctx, p, rs) => !!rs.game.dialogue?.active,
  },
  {
    type: "dialogue.start",
    kind: "action",
    category: "Interfaccia",
    label: "Avvia un dialogo",
    sentence: "avvia il dialogo {dialogue}",
    params: {
      dialogue: { type: "dialogue", label: "Dialogo", default: "" },
      speaker: { type: "object", label: "Chi parla", default: "", optional: true, help: "Facoltativo: diventa «questo oggetto» per la regola «Un dialogo finisce»." },
    },
    run: (ctx, p, rs) => {
      if (p.dialogue) rs.game.startDialogue(p.dialogue, resolveRef(p.speaker, ctx, rs.scene)[0]);
    },
  },
  {
    type: "lang.set",
    kind: "action",
    category: "Interfaccia",
    label: "Cambia lingua",
    sentence: "passa alla lingua {language}",
    params: { language: { type: "language", label: "Lingua", default: "" } },
    run: (ctx, p, rs) => void rs.game.setLanguage(String(p.language)),
  },
  {
    type: "lang.next",
    kind: "action",
    category: "Interfaccia",
    label: "Passa alla lingua successiva",
    sentence: "passa alla lingua successiva",
    params: {},
    run: (ctx, p, rs) => rs.game.nextLanguage(),
  },
  {
    type: "lang.is",
    kind: "condition",
    category: "Interfaccia",
    label: "La lingua è",
    sentence: "la lingua è {language}",
    params: { language: { type: "language", label: "Lingua", default: "" } },
    test: (ctx, p, rs) => rs.game.language === p.language,
  },
);

// ------------------------------------------------------------------ filmati

const waitParam = (label: string): PropSchema => ({ type: "boolean", label, default: true });

DEFS.push(
  {
    type: "cutscene.play",
    kind: "action",
    category: "Filmati",
    label: "Avvia un filmato",
    sentence: "avvia il filmato {cutscene}",
    params: { cutscene: { type: "cutscene", label: "Filmato", default: "" } },
    run: (ctx, p, rs) => void (p.cutscene && rs.playCutscene(String(p.cutscene), ctx)),
  },
  {
    type: "cutscene.skip",
    kind: "action",
    category: "Filmati",
    label: "Interrompi il filmato",
    sentence: "interrompi il filmato in corso",
    params: {},
    run: (ctx, p, rs) => rs.skipCutscene(),
  },
  {
    type: "cutscene.end",
    kind: "trigger",
    category: "Filmati",
    label: "Un filmato finisce",
    sentence: "finisce il filmato {cutscene}",
    params: { cutscene: { type: "cutscene", label: "Filmato", default: "", optional: true, help: "Vuoto = qualsiasi filmato." } },
  },
  {
    type: "cutscene.playing",
    kind: "condition",
    category: "Filmati",
    label: "È in corso un filmato",
    sentence: "è in corso un filmato",
    params: {},
    test: (ctx, p, rs) => !!rs.cutscene,
  },
  {
    type: "cutscene.move",
    kind: "action",
    category: "Filmati",
    label: "Porta un oggetto in un punto",
    sentence: "{target} va dove si trova {dest} in {seconds} s",
    params: { target: obj("Oggetto", ""), dest: obj("Destinazione", ""), seconds: seconds("Durata", 1), wait: waitParam("Aspetta che arrivi") },
    run: (ctx, p, rs) => {
      const dest = resolveRef(p.dest, ctx, rs.scene)[0];
      if (!dest) return;
      return rs.moveEntities(resolveRef(p.target, ctx, rs.scene), () => ({ x: dest.worldX, y: dest.worldY }), Number(p.seconds) || 0, p.wait !== false);
    },
  },
  {
    type: "cutscene.moveBy",
    kind: "action",
    category: "Filmati",
    label: "Sposta un oggetto di qualche tile",
    sentence: "{target} si sposta di {dx}, {dy} tile in {seconds} s",
    params: {
      target: obj("Oggetto", ""),
      dx: { type: "number", label: "Tile in orizzontale", default: 3, step: 0.5, help: "Negativo = verso sinistra." },
      dy: { type: "number", label: "Tile in verticale", default: 0, step: 0.5, help: "Negativo = verso l'alto." },
      seconds: seconds("Durata", 1),
      wait: waitParam("Aspetta che arrivi"),
    },
    run: (ctx, p, rs) => {
      const ts = rs.scene.tileSize;
      const dx = (Number(p.dx) || 0) * ts;
      const dy = (Number(p.dy) || 0) * ts;
      return rs.moveEntities(resolveRef(p.target, ctx, rs.scene), (e) => ({ x: e.worldX + dx, y: e.worldY + dy }), Number(p.seconds) || 0, p.wait !== false);
    },
  },
  {
    type: "cutscene.camera",
    kind: "action",
    category: "Filmati",
    label: "Sposta la camera su un oggetto",
    sentence: "la camera va su {target} in {seconds} s",
    params: { target: obj("Oggetto", ""), seconds: seconds("Durata", 1), wait: waitParam("Aspetta che arrivi") },
    run: (ctx, p, rs) => {
      const e = resolveRef(p.target, ctx, rs.scene)[0];
      return e ? rs.moveCamera(e.worldX, e.worldY, Number(p.seconds) || 0, p.wait !== false) : undefined;
    },
  },
  {
    type: "cutscene.cameraFree",
    kind: "action",
    category: "Filmati",
    label: "La camera torna a seguire",
    sentence: "la camera torna a seguire il giocatore",
    params: {},
    run: (ctx, p, rs) => rs.releaseCamera(),
  },
  {
    type: "cutscene.dialogue",
    kind: "action",
    category: "Filmati",
    label: "Dialogo e aspetta la fine",
    sentence: "dialogo {dialogue} e aspetta la fine",
    params: {
      dialogue: { type: "dialogue", label: "Dialogo", default: "" },
      speaker: { type: "object", label: "Chi parla", default: "", optional: true, help: "Facoltativo: diventa «questo oggetto» per la regola «Un dialogo finisce»." },
    },
    run: (ctx, p, rs) => {
      if (!p.dialogue || !rs.game.startDialogue(p.dialogue, resolveRef(p.speaker, ctx, rs.scene)[0])) return;
      return { until: () => !rs.game.dialogue.active };
    },
  },
  {
    type: "cutscene.message",
    kind: "action",
    category: "Filmati",
    label: "Messaggio e aspetta",
    sentence: "messaggio «{text}» e aspetta",
    params: {
      text: { type: "text", label: "Testo", default: "…", help: "Puoi usare {variabile}.", translatable: true },
      duration: { ...seconds("Durata", 0), help: "0 = finché il giocatore preme Azione." },
    },
    run: (ctx, p, rs) => {
      rs.game.showMessage(interpolate(rs.game.t(String(p.text ?? "")), rs.game.vars), Number(p.duration ?? 0), false);
      return { until: () => !rs.game.hasMessage };
    },
  },
  {
    type: "cutscene.fadeOut",
    kind: "action",
    category: "Filmati",
    label: "Dissolvenza al nero",
    sentence: "dissolvenza al nero in {seconds} s",
    params: { seconds: seconds("Durata", 0.6) },
    run: (ctx, p, rs) => {
      rs.game.fadeTo(1, Number(p.seconds) || 0);
      return { until: () => rs.game.fadeAlpha >= 1 };
    },
  },
  {
    type: "cutscene.fadeIn",
    kind: "action",
    category: "Filmati",
    label: "Torna dal nero",
    sentence: "torna dal nero in {seconds} s",
    params: { seconds: seconds("Durata", 0.6) },
    run: (ctx, p, rs) => {
      rs.game.fadeTo(0, Number(p.seconds) || 0);
      return { until: () => rs.game.fadeAlpha <= 0 };
    },
  },
  {
    type: "cutscene.bars",
    kind: "action",
    category: "Filmati",
    label: "Barre del cinema",
    sentence: "{mode} le barre del cinema",
    params: {
      mode: {
        type: "select",
        label: "Barre",
        default: "show",
        options: [
          { value: "show", label: "mostra" },
          { value: "hide", label: "nascondi" },
        ],
      },
    },
    run: (ctx, p, rs) => rs.game.setBars(p.mode !== "hide"),
  },
  {
    type: "controls.lock",
    kind: "action",
    category: "Filmati",
    label: "Blocca i comandi del giocatore",
    sentence: "{mode} i comandi del giocatore",
    params: {
      mode: {
        type: "select",
        label: "Comandi",
        default: "lock",
        options: [
          { value: "lock", label: "blocca" },
          { value: "unlock", label: "sblocca" },
        ],
      },
    },
    run: (ctx, p, rs) => void (rs.game.lockControls = p.mode !== "unlock"),
  },
  // ---- Inventario, oggetti dell'archivio e potenziamenti
  {
    type: "inventory.add",
    kind: "action",
    category: "Inventario",
    label: "Metti nell'inventario",
    sentence: "metti {qty} × {item} nell'inventario",
    params: {
      item: { type: "item", label: "Oggetto", default: "" },
      qty: { type: "integer", label: "Quantità", default: 1, min: 1 },
    },
    run: (ctx, p, rs) => void addItem(rs.game.vars, p.item, Number(p.qty ?? 1), itemDef(rs.game.project, p.item)?.max ?? 0),
  },
  {
    type: "inventory.remove",
    kind: "action",
    category: "Inventario",
    label: "Togli dall'inventario",
    sentence: "togli {qty} × {item} dall'inventario",
    params: {
      item: { type: "item", label: "Oggetto", default: "" },
      qty: { type: "integer", label: "Quantità", default: 1, min: 1 },
    },
    run: (ctx, p, rs) => void removeItem(rs.game.vars, p.item, Number(p.qty ?? 1)),
  },
  {
    type: "inventory.has",
    kind: "condition",
    category: "Inventario",
    label: "Nell'inventario c'è un oggetto",
    sentence: "nell'inventario ci sono almeno {qty} × {item}",
    params: {
      item: { type: "item", label: "Oggetto", default: "" },
      qty: { type: "integer", label: "Quantità", default: 1, min: 1 },
    },
    test: (ctx, p, rs) => hasItem(rs.game.vars, p.item, Number(p.qty ?? 1)),
  },
  {
    type: "item.use",
    kind: "action",
    category: "Inventario",
    label: "Usa un oggetto dell'inventario",
    sentence: "{target} usa {item}",
    params: { target: obj("Chi lo usa", "#giocatore"), item: { type: "item", label: "Oggetto", default: "" } },
    run: (ctx, p, rs) => {
      const who = resolveRef(p.target, ctx, rs.scene)[0];
      useItem(rs.scene, who, String(p.item ?? ""));
    },
  },
  {
    type: "item.used",
    kind: "trigger",
    category: "Inventario",
    label: "Un oggetto viene usato",
    sentence: "si usa {item}",
    params: { item: { type: "item", label: "Oggetto", default: "", optional: true, help: "Vuoto = qualsiasi oggetto." } },
  },
  {
    type: "powerup.give",
    kind: "action",
    category: "Inventario",
    label: "Dai un potenziamento",
    sentence: "dai {kind} a {target} per {seconds} s",
    params: {
      target: obj("A chi", "#giocatore"),
      kind: { type: "select", label: "Potenziamento", default: "speed", options: POWERUP_OPTIONS },
      seconds: seconds("Durata", 8),
      strength: { type: "number", label: "Intensità", default: 0, min: 0, step: 0.1, help: "0 = quella normale." },
    },
    run: (ctx, p, rs) =>
      each(p, "target", ctx, rs, (e) => {
        const pu = e.get("PowerUps");
        if (pu) pu.actions.give(p.kind, p.seconds, p.strength);
        else rs.game.log(`"${e.name}" non ha il blocco Potenziamenti`, "warn");
      }),
  },
  {
    type: "powerup.has",
    kind: "condition",
    category: "Inventario",
    label: "Ha un potenziamento",
    sentence: "{target} ha {kind}",
    params: {
      target: obj("Oggetto", "#giocatore"),
      kind: { type: "select", label: "Potenziamento", default: "speed", options: POWERUP_OPTIONS },
    },
    test: (ctx, p, rs) => resolveRef(p.target, ctx, rs.scene).some((e) => e.hasBoost(String(p.kind))),
  },
);

const BY_TYPE = new Map(DEFS.map((d) => [d.type, d]));

/** Tolleranza sui tempi: 30 passi da 1/60 s sommati danno 0,4999…, non 0,5. */
const TIME_EPS = 1e-6;

export const RULE_ITEMS: readonly RuleItemDef[] = DEFS;
export const RULE_CATEGORIES = ["Scena e tempo", "Comandi", "Oggetti", "Variabili", "Audio", "Camera", "Effetti", "Interfaccia", "Inventario", "Filmati", "Partita", "Varie"];
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
  /** Oltre al tempo, aspetta che questo diventi vero (fine di uno spostamento, di un dialogo…). */
  until?: () => boolean;
  entry: Entry;
  index: number;
  ctx: RuleCtx;
}

export class RuleSystem {
  private entries: Entry[];
  private queue: { entry: Entry; ctx: RuleCtx }[] = [];
  private waits: Wait[] = [];
  private tweens: Tween[] = [];
  /** Regola o filmato di cui si stanno eseguendo le azioni (a chi appartiene uno spostamento). */
  private active?: Entry;
  /** Vero mentre si salta un filmato: le azioni finiscono subito. */
  private skipping = false;
  /** La camera è stata spostata da un filmato (la camera che segue è ferma). */
  private cameraHeld = false;
  /** Filmato in corso: uno alla volta. */
  cutscene: { data: CutsceneData; entry: Entry; ctx: RuleCtx } | null = null;
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
    if (this.entries.some((e) => e.data.when.type === "dialogue.end")) {
      scene.events.on("dialogueEnd", (payload: { entity?: Entity; data?: { dialogue?: string } }) => {
        for (const entry of this.entries) {
          const w = entry.data.when;
          if (w.type !== "dialogue.end") continue;
          const want = String(w.params.dialogue ?? "");
          if (want && want !== payload.data?.dialogue) continue;
          this.queue.push({ entry, ctx: { self: payload.entity } });
        }
      });
    }
    if (this.entries.some((e) => e.data.when.type === "cutscene.end")) {
      scene.events.on("cutsceneEnd", (payload: { entity?: Entity; data?: { cutscene?: string } }) => {
        for (const entry of this.entries) {
          const w = entry.data.when;
          if (w.type !== "cutscene.end") continue;
          const want = String(w.params.cutscene ?? "");
          if (want && want !== payload.data?.cutscene) continue;
          this.queue.push({ entry, ctx: { self: payload.entity } });
        }
      });
    }
    if (this.entries.some((e) => e.data.when.type === "item.used")) {
      scene.events.on("itemUse", (payload: { entity?: Entity; data?: { item?: string } }) => {
        for (const entry of this.entries) {
          const w = entry.data.when;
          if (w.type !== "item.used") continue;
          const want = String(w.params.item ?? "");
          if (want && want !== payload.data?.item) continue;
          this.queue.push({ entry, ctx: { self: payload.entity } });
        }
      });
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
    if (this.tweens.length) this.tweens = this.tweens.filter((t) => !t.step(dt));
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
        case "event":
        case "scene.start":
        case "dialogue.end":
        case "cutscene.end":
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
        if (w.time <= TIME_EPS && (!w.until || w.until())) ready.push(w);
      }
      this.waits = this.waits.filter((w) => !ready.includes(w));
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
        this.game.log(`Errore in una condizione (${def?.label ?? c.type}): ${errorText(err)}`, "error");
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
        if (this.skipping) continue;
        this.waits.push({ time: Math.max(0, Number(a.params.seconds) || 0), entry, index: i + 1, ctx });
        return;
      }
      const def = getRuleItemDef(a.type);
      if (!def?.run || (this.skipping && SKIPPED_WHEN_FAST.has(a.type))) continue;
      let hold: unknown;
      const prev = this.active;
      this.active = entry;
      try {
        hold = def.run(ctx, a.params, this);
      } catch (err) {
        this.game.log(`Errore in un'azione (${def.label}): ${errorText(err)}`, "error");
      } finally {
        this.active = prev;
      }
      if (isHold(hold) && !this.skipping) {
        this.waits.push({ time: Math.max(0, Number(hold.seconds) || 0), until: hold.until, entry, index: i + 1, ctx });
        return;
      }
    }
    if (this.cutscene?.entry === entry && !this.skipping) this.endCutscene();
  }

  // ---------- filmati ----------

  /** Avvia un filmato del progetto; `ctx` = oggetti della regola che lo fa partire («questo oggetto»…). */
  playCutscene(id: string, ctx: RuleCtx = {}): boolean {
    if (this.cutscene) {
      this.game.log(`Il filmato "${id}" non parte: ce n'è già uno in corso`, "warn");
      return false;
    }
    const data = this.game.project.cutscenes?.find((c) => c.id === id);
    if (!data) {
      this.game.log(`Il filmato "${id}" non esiste`, "warn");
      return false;
    }
    const entry: Entry = {
      data: { id: `filmato:${id}`, when: { type: "cutscene.play", params: {} }, conditions: [], actions: data.steps ?? [] },
      timer: 0,
      fired: true,
      afterDone: true,
      contacts: new Map(),
    };
    this.cutscene = { data, entry, ctx };
    if (data.bars !== false) this.game.setBars(true);
    this.runActions(entry, 0, ctx);
    return true;
  }

  /** Salta il filmato: gli spostamenti arrivano subito, i passi rimasti si eseguono senza dialoghi e messaggi. */
  skipCutscene(): void {
    const cs = this.cutscene;
    if (!cs || this.skipping) return;
    const wait = this.waits.find((w) => w.entry === cs.entry);
    this.waits = this.waits.filter((w) => w.entry !== cs.entry);
    for (const t of this.tweens) if (t.owner === cs.entry) t.finish();
    this.tweens = this.tweens.filter((t) => t.owner !== cs.entry);
    if (this.game.dialogue.active) this.game.dialogue.cancel();
    this.game.clearMessages();
    this.skipping = true;
    try {
      this.runActions(cs.entry, wait ? wait.index : cs.entry.data.actions.length, wait?.ctx ?? cs.ctx);
    } finally {
      this.skipping = false;
    }
    if (this.cutscene === cs) this.endCutscene();
  }

  private endCutscene(): void {
    const cs = this.cutscene;
    if (!cs) return;
    this.cutscene = null;
    this.waits = this.waits.filter((w) => w.entry !== cs.entry);
    if (this.cameraHeld) this.releaseCamera();
    this.game.setBars(false);
    this.scene.events.emit("cutsceneEnd", { entity: cs.ctx.self, data: { cutscene: cs.data.id } });
  }

  /** Un cambiamento graduale che dura `duration` secondi; `apply(k)` riceve 0…1. */
  private tween(duration: number, apply: (k: number) => void): Tween {
    let t = 0;
    const tw: Tween = {
      owner: this.active,
      done: false,
      step: (dt) => {
        t = Math.min(duration, t + dt);
        apply(smooth(t / duration));
        tw.done = t >= duration;
        return tw.done;
      },
      finish: () => {
        apply(1);
        tw.done = true;
      },
    };
    if (duration <= 0 || this.skipping) tw.finish();
    else this.tweens.push(tw);
    return tw;
  }

  /** Porta gli oggetti a destinazione in `seconds` secondi; con `wait` l'azione dopo aspetta l'arrivo. */
  moveEntities(list: Entity[], to: (e: Entity) => { x: number; y: number }, seconds: number, wait: boolean): Hold | undefined {
    const tweens = list.map((e) => {
      // Si muove la posizione propria: quella del genitore resta com'è.
      const fx = e.x;
      const fy = e.y;
      const dest = to(e);
      const tx = fx + (dest.x - e.worldX);
      const ty = fy + (dest.y - e.worldY);
      if (tx !== fx) e.facingX = tx > fx ? 1 : -1;
      return this.tween(seconds, (k) => {
        e.x = fx + (tx - fx) * k;
        e.y = fy + (ty - fy) * k;
        if (e.body) {
          e.body.vx = 0;
          e.body.vy = 0;
        }
      });
    });
    return wait && tweens.some((t) => !t.done) ? { until: () => tweens.every((t) => t.done) } : undefined;
  }

  /** Sposta la camera (ferma quella che segue il giocatore finché non torna a seguirlo). */
  moveCamera(x: number, y: number, seconds: number, wait: boolean): Hold | undefined {
    this.holdCamera();
    const cam = this.scene.camera;
    const W = this.scene.widthPx;
    const H = this.scene.heightPx;
    const tx = W <= cam.halfW * 2 ? W / 2 : clamp(x, cam.halfW, W - cam.halfW);
    const ty = H <= cam.halfH * 2 ? H / 2 : clamp(y, cam.halfH, H - cam.halfH);
    const fx = cam.x;
    const fy = cam.y;
    const tw = this.tween(seconds, (k) => {
      cam.x = fx + (tx - fx) * k;
      cam.y = fy + (ty - fy) * k;
    });
    return wait && !tw.done ? { until: () => tw.done } : undefined;
  }

  private cameraBlocks() {
    return this.scene.entities.flatMap((e) => {
      const b = e.get("CameraFollow");
      return b ? [b] : [];
    });
  }

  private holdCamera(): void {
    this.cameraHeld = true;
    for (const b of this.cameraBlocks()) b.data.locked = true;
  }

  /** La camera torna a seguire il giocatore. */
  releaseCamera(): void {
    this.cameraHeld = false;
    for (const b of this.cameraBlocks()) b.data.locked = false;
  }
}

interface Tween {
  owner?: Entry;
  done: boolean;
  /** Avanza di `dt` secondi; true = finito. */
  step(dt: number): boolean;
  finish(): void;
}

/**
 * Pepino Language dentro l'engine: descrive a Pepino gli oggetti del gioco (Oggetto, Corpo, Scena, Gioco)
 * e trasforma ogni `blocco` di uno script in un blocco vero, come quelli in JavaScript e in Python.
 */
import { compile, describeError, drive, makeRuntime, T, type CompileResult, type HostSpec, type HostTypeInfo, type Lang, type PepinoModule, type Runtime } from "../../lang";
import { getBlockDef, type BlockSpec, type BlockInstance, type PropSchema } from "../core/block";
import type { Entity } from "../core/entity";
import { bodyCenter, nearestTagged } from "../blocks/targets";
import { safeScriptId } from "./errors";

type Type = T.Type;

const px = T.num({ px: 1 });
const pxs = T.num({ px: 1, s: -1 });
const secs = T.num({ s: 1 });
const host = (h: HostTypeInfo): Type => ({ k: "host", host: h });

const ENTITY: HostTypeInfo = { id: "Oggetto", it: "Oggetto", en: "Object", members: [], methods: [] };
const BODY: HostTypeInfo = { id: "Corpo", it: "Corpo", en: "Body", members: [], methods: [] };
const SCENE: HostTypeInfo = { id: "Scena", it: "Scena", en: "Scene", members: [], methods: [] };
const GAME: HostTypeInfo = { id: "Gioco", it: "Gioco", en: "Game", members: [], methods: [] };

const rw = (it: string, en: string, type: () => Type, prop: string) => ({
  it,
  en,
  type,
  get: (r: string) => `${r}.${prop}`,
  set: (r: string, v: string) => `${r}.${prop} = ${v}`,
});
const ro = (it: string, en: string, type: () => Type, get: (r: string) => string) => ({ it, en, type, get });
const p = (name: string, type: () => Type, optional = false) => ({ name, type, optional });
const fn = (it: string, en: string, params: ReturnType<typeof p>[], ret: () => Type, js: (r: string, a: string[]) => string) => ({ it, en, params, ret, js });
const text = () => T.TEXT;
const bool = () => T.BOOL;
const voidT = () => T.VOID;

ENTITY.members = [
  rw("x", "x", () => px, "x"),
  rw("y", "y", () => px, "y"),
  rw("z", "z", () => T.NUM, "z"),
  ro("nome", "name", text, (r) => `${r}.name`),
  ro("id", "id", text, (r) => `${r}.id`),
  rw("visibile", "visible", bool, "visible"),
  rw("stato", "state", text, "state"),
  { ...rw("direzione", "facing", () => T.NUM, "facingX"), set: (r: string, v: string) => `${r}.facingX = (${v} < 0 ? -1 : 1)` },
  rw("scala_x", "scale_x", () => T.NUM, "scaleX"),
  rw("scala_y", "scale_y", () => T.NUM, "scaleY"),
  ro("distrutto", "destroyed", bool, (r) => `${r}.destroyed`),
  ro("corpo", "body", () => T.opt(host(BODY)), (r) => `$.nn(${r}.body)`),
  ro("centro_x", "center_x", () => px, (r) => `$host.center(${r}).x`),
  ro("centro_y", "center_y", () => px, (r) => `$host.center(${r}).y`),
  ro("etichette", "tags", () => T.list(T.TEXT), (r) => `[...${r}.tags]`),
];
ENTITY.methods = [
  fn("ha_etichetta", "has_tag", [p("etichetta", text)], bool, (r, a) => `${r}.hasTag(${a[0]})`),
  fn("aggiungi_etichetta", "add_tag", [p("etichetta", text)], voidT, (r, a) => `void ${r}.tags.add(${a[0]})`),
  fn("togli_etichetta", "remove_tag", [p("etichetta", text)], voidT, (r, a) => `void ${r}.tags.delete(${a[0]})`),
  fn("distruggi", "destroy", [], voidT, (r) => `${r}.destroy()`),
  fn("emetti", "emit", [p("evento", text)], voidT, (r, a) => `${r}.emit(${a[0]})`),
  fn("ha_blocco", "has_block", [p("blocco", text)], bool, (r, a) => `${r}.has(${a[0]})`),
  fn("distanza_da", "distance_to", [p("altro", () => host(ENTITY))], () => px, (r, a) => `$host.distance(${r}, ${a[0]})`),
  fn("più_vicino", "nearest", [p("etichetta", text)], () => T.opt(host(ENTITY)), (r, a) => `$.nn($host.nearest(${r}, ${a[0]}))`),
];

BODY.members = [
  rw("vx", "vx", () => pxs, "vx"),
  rw("vy", "vy", () => pxs, "vy"),
  ro("a_terra", "on_ground", bool, (r) => `${r}.onGround`),
  ro("sul_soffitto", "on_ceiling", bool, (r) => `${r}.onCeiling`),
  ro("muro_sinistra", "wall_left", bool, (r) => `${r}.onWallLeft`),
  ro("muro_destra", "wall_right", bool, (r) => `${r}.onWallRight`),
  ro("su_scala", "on_ladder", bool, (r) => `${r}.onLadder`),
  ro("larghezza", "width", () => px, (r) => `${r}.w`),
  ro("altezza", "height", () => px, (r) => `${r}.h`),
];
BODY.methods = [
  fn("tocca", "touches", [p("etichetta", text)], bool, (r, a) => `${r}.touched(${a[0]})`),
  fn("toccati", "touching", [p("etichetta", text)], () => T.list(host(ENTITY)), (r, a) => `${r}.touching(${a[0]})`),
];

SCENE.members = [
  ro("tile", "tile", () => px, (r) => `${r}.tileSize`),
  ro("tempo", "time", () => secs, (r) => `${r}.time`),
  ro("larghezza", "width", () => px, (r) => `${r}.widthPx`),
  ro("altezza", "height", () => px, (r) => `${r}.heightPx`),
  ro("nome", "name", text, (r) => `${r}.data.name`),
];
SCENE.methods = [
  fn("trova", "find", [p("nome", text)], () => T.opt(host(ENTITY)), (r, a) => `$.nn(${r}.find(${a[0]}))`),
  fn("trova_tutti", "find_all", [p("etichetta", text)], () => T.list(host(ENTITY)), (r, a) => `${r}.findAll(${a[0]})`),
  fn("crea", "spawn", [p("modello", text), p("x", () => px), p("y", () => px)], () => T.opt(host(ENTITY)), (r, a) => `$.nn(${r}.spawn(${a.join(", ")}))`),
];

GAME.members = [ro("in_pausa", "paused", bool, (r) => `${r}.paused`)];
GAME.methods = [
  fn("variabile", "variable", [p("nome", text)], () => T.ANY, (r, a) => `$host.getVar(${r}, ${a[0]})`),
  fn("imposta", "set", [p("nome", text), p("valore", () => T.ANY)], voidT, (r, a) => `$host.setVar(${r}, ${a[0]}, ${a[1]})`),
  fn("premuto", "is_down", [p("tasto", text)], bool, (r, a) => `${r}.input.isDown(${a[0]})`),
  fn("appena_premuto", "pressed", [p("tasto", text)], bool, (r, a) => `${r}.input.pressed(${a[0]})`),
  fn("suona", "play", [p("suono", text)], voidT, (r, a) => `${r}.audio.play(${a[0]})`),
  fn("musica", "music", [p("musica", text)], voidT, (r, a) => `${r}.audio.playMusic(${a[0]})`),
  fn("ferma_musica", "stop_music", [], voidT, (r) => `${r}.audio.stopMusic()`),
  fn("vai_a_scena", "go_to_scene", [p("scena", text)], voidT, (r, a) => `${r}.goToScene(${a[0]})`),
  fn("ricomincia", "restart", [], voidT, (r) => `${r}.restartScene()`),
  fn("messaggio", "message", [p("testo", text), p("durata", () => secs, true)], voidT, (r, a) => `${r}.showMessage(${a[0]}, ${a[1] === "undefined" ? 3 : a[1]})`),
];

/** L'engine visto da Pepino Language. */
export const ENGINE_HOST: HostSpec = {
  capabilities: [],
  types: [ENTITY, BODY, SCENE, GAME],
  block: {
    names: [
      { it: "oggetto", en: "object", type: () => host(ENTITY), js: "this.$b.entity" },
      { it: "corpo", en: "body", type: (req) => (req.includes("Body") ? host(BODY) : T.opt(host(BODY))), js: "$.nn(this.$b.entity.body)" },
      { it: "scena", en: "scene", type: () => host(SCENE), js: "this.$b.scene" },
      { it: "gioco", en: "game", type: () => host(GAME), js: "this.$b.game" },
    ],
    entity: () => host(ENTITY),
    propTypes: [
      { it: "Suono", en: "Sound", kind: "audio", base: "text" },
      { it: "Immagine", en: "Image", kind: "image", base: "text" },
      { it: "Modello", en: "Prefab", kind: "prefab", base: "text" },
      { it: "Etichetta", en: "Tag", kind: "tag", base: "text" },
      { it: "Gruppo", en: "Group", kind: "group", base: "text" },
      { it: "Colore", en: "Color", kind: "color", base: "text" },
      { it: "NomeScena", en: "SceneName", kind: "scene", base: "text" },
      { it: "Variabile", en: "Variable", kind: "variable", base: "text" },
      { it: "Dialogo", en: "Dialogue", kind: "dialogue", base: "text" },
      { it: "Tasto", en: "Key", kind: "input", base: "text" },
      { it: "TestoLungo", en: "LongText", kind: "text", base: "text" },
      { it: "Intero", en: "Integer", kind: "integer", base: "num" },
    ],
    blockExists: (name) => !!getBlockDef(name),
  },
};

export function compilePepino(code: string, lang?: Lang): CompileResult {
  return compile(code, { host: ENGINE_HOST, lang });
}

// ------------------------------------------------------------------ dal modulo generato ai blocchi

interface PepHandler {
  hook: "start" | "update" | "physics" | "late" | "end" | "touch" | "event";
  event?: string;
  method: string;
  routine: boolean;
}

interface PepEntry {
  label: string;
  params: Record<string, PropSchema>;
  method: string;
  routine: boolean;
}

interface PepBlockSpec {
  name: string;
  label?: string;
  description?: string;
  category?: string;
  priority?: number;
  requires: string[];
  props: Record<string, PropSchema>;
  events: { id: string; label: string }[];
  states: { id: string; label: string }[];
  actions: Record<string, PepEntry>;
  conditions: Record<string, PepEntry>;
  handlers: PepHandler[];
}

type Instance = Record<string, any> & { $dt: number; $drop?: () => void };

interface Coroutine {
  gen: Generator<unknown, unknown, unknown>;
  wait: number;
  until?: () => boolean;
}

interface PepData {
  inst?: Instance;
  co: Coroutine[];
}

const dataOf = (self: BlockInstance): PepData => (self.data.$pep ??= { co: [] }) as PepData;

/** L'oggetto che sta eseguendo codice Pepino: i cappuccini ordinati adesso diventano sue sequenze. */
let owner: PepData | undefined;

function withOwner<T>(d: PepData, fn: () => T): T {
  const prev = owner;
  owner = d;
  try {
    return fn();
  } finally {
    owner = prev;
  }
}

/** I cappuccini ordinati da un oggetto appartengono a lui (finiscono con lui); gli altri li fa andare `drive`. */
function ownSpawn($: Runtime): void {
  const base = $.spawn;
  $.spawn = (gen, delay) => {
    if (owner) owner.co.push({ gen, wait: delay });
    else base(gen, delay);
  };
}

/** Fa un passo di una sequenza che aspetta: restituisce falso quando è finita. */
function step($: Runtime, co: Coroutine): boolean {
  $.resetLoop();
  const r = co.gen.next();
  if (r.done) return false;
  const v = r.value;
  if (typeof v === "function") {
    co.until = v as () => boolean;
    co.wait = 0;
  } else {
    co.until = undefined;
    co.wait = typeof v === "number" ? v : 0;
  }
  return true;
}

/** Chiama una funzione del blocco; se aspetta, parte come sequenza che continua nei fotogrammi seguenti. */
function call($: Runtime, self: BlockInstance, method: string, routine: boolean, args: unknown[]): unknown {
  const d = dataOf(self);
  const inst = d.inst;
  if (!inst) return undefined;
  $.resetLoop();
  return withOwner(d, () => {
    const res = inst[method](...args);
    if (!routine) return res;
    const co: Coroutine = { gen: res as Generator<unknown, unknown, unknown>, wait: 0 };
    if (step($, co)) d.co.push(co);
    return undefined;
  });
}

export function blockSpecFromPepino(spec: PepBlockSpec, make: (b: BlockInstance) => Instance, $: Runtime): BlockSpec {
  const handlers = (hook: PepHandler["hook"]) => spec.handlers.filter((h) => h.hook === hook);
  const one = (hook: PepHandler["hook"]) => handlers(hook)[0];
  const physics = one("physics");
  const late = one("late");
  const out: BlockSpec = {
    name: spec.name,
    label: spec.label,
    description: spec.description,
    category: spec.category,
    priority: spec.priority,
    requires: spec.requires,
    props: spec.props,
    events: spec.events,
    states: spec.states,
    init(self) {
      $.tile = self.scene.tileSize;
      const d = dataOf(self);
      d.inst = withOwner(d, () => make(self));
      for (const h of handlers("touch")) self.listen<{ other: Entity }>("contact", (e) => call($, self, h.method, h.routine, [e.other]));
      for (const h of handlers("event")) if (h.event) self.listen(h.event, () => call($, self, h.method, h.routine, []));
      const start = one("start");
      if (start) call($, self, start.method, start.routine, []);
    },
    update(self, dt) {
      const d = dataOf(self);
      const inst = d.inst;
      if (!inst) return;
      inst.$dt = dt;
      withOwner(d, () => {
        // I cappuccini ordinati da «quando aggiorna» cominciano a contare dal fotogramma dopo.
        const waiting = [...d.co];
        const up = one("update");
        if (up) {
          $.resetLoop();
          inst[up.method]();
        }
        // Le sequenze che aspettano (e i cappuccini): ripartono quando il tempo è passato (o la condizione è vera).
        if (waiting.length) {
          for (const co of waiting) {
            if (!d.co.includes(co)) continue;
            if (co.wait > 0) {
              co.wait -= dt;
              if (co.wait > 1e-9) continue;
            }
            if (co.until && !co.until()) continue;
            if (!step($, co)) d.co.splice(d.co.indexOf(co), 1);
          }
        }
      });
    },
    physics: physics
      ? (self, dt) => {
          const d = dataOf(self);
          const inst = d.inst;
          if (!inst) return;
          inst.$dt = dt;
          withOwner(d, () => inst[physics.method]());
        }
      : undefined,
    late: late
      ? (self, dt) => {
          const d = dataOf(self);
          const inst = d.inst;
          if (!inst) return;
          inst.$dt = dt;
          withOwner(d, () => inst[late.method]());
        }
      : undefined,
    destroy(self) {
      const d = dataOf(self);
      const inst = d.inst;
      if (!inst) return;
      try {
        const end = one("end");
        if (end) withOwner(d, () => inst[end.method]());
      } finally {
        // Le sequenze interrotte chiudono i loro valori (i «quando finisce» dentro di loro).
        for (const co of d.co.splice(0)) co.gen.return(undefined);
        inst.$drop?.();
        d.inst = undefined;
      }
    },
    actions: Object.fromEntries(
      Object.entries(spec.actions).map(([k, a]) => [k, { label: a.label, params: a.params, run: (self: BlockInstance, ...args: unknown[]) => void call($, self, a.method, a.routine, args) }]),
    ),
    conditions: Object.fromEntries(
      Object.entries(spec.conditions).map(([k, c]) => [k, { label: c.label, params: c.params, test: (self: BlockInstance, ...args: unknown[]) => !!call($, self, c.method, false, args) }]),
    ),
  };
  return out;
}

/** Le funzioni dell'engine che il codice generato chiama con `$host.…`. */
function engineHelpers() {
  return {
    center: (e: Entity) => bodyCenter(e),
    distance: (a: Entity, b: Entity) => {
      const p = bodyCenter(a);
      const q = bodyCenter(b);
      return Math.hypot(q.x - p.x, q.y - p.y);
    },
    nearest: (e: Entity, tag: string) => nearestTagged(e.scene, e, tag),
    getVar: (g: { vars: Record<string, unknown> }, name: string) => g.vars[name] ?? null,
    setVar: (g: { vars: Record<string, unknown> }, name: string, value: unknown) => {
      g.vars[name] = value;
    },
  };
}

export interface PepinoTestResult {
  name: string;
  ok: boolean;
  message?: string;
  line?: number;
}

/**
 * Esegue le prove («prova "…":») di uno script, senza registrare i suoi blocchi.
 * Restituisce undefined se lo script ha errori di scrittura.
 */
export function runPepinoTests(code: string, lang?: Lang, print: (t: string) => void = () => undefined): PepinoTestResult[] | undefined {
  const compiled = compilePepino(code, lang);
  if (!compiled.ok || !compiled.code) return undefined;
  const $ = makeRuntime({ lang: compiled.lang, print, maxLoopSeconds: 2 });
  const hostObj = { ...engineHelpers(), block: () => undefined };
  const fn = new Function("$", "$host", `${compiled.code}\n//# sourceURL=pepino-prove/script`);
  const out: PepinoTestResult[] = [];
  const lineOf = (e: unknown) => {
    const m = /pepino-prove\/script:(\d+):\d+/.exec(e instanceof Error ? (e.stack ?? "") : "");
    return m ? compiled.lineMap?.[Number(m[1]) - 3] : undefined;
  };
  let mod: PepinoModule;
  try {
    mod = fn($, hostObj) as PepinoModule;
    drive(mod.main(), $, () => undefined);
  } catch (e) {
    return [{ name: "", ok: false, message: describeError(e, compiled.lang), line: lineOf(e) }];
  }
  for (const t of mod.tests) {
    try {
      drive(t.fn(), $, () => undefined);
      out.push({ name: t.name, ok: true });
    } catch (e) {
      out.push({ name: t.name, ok: false, message: describeError(e, compiled.lang), line: lineOf(e) });
    }
  }
  return out;
}

/**
 * Esegue lo script compilato: registra i suoi blocchi con `define`.
 * `print` = dove va «scrivi» (la Console del gioco). Il nome del file generato è quello degli altri script,
 * così gli errori a gioco avviato dicono script e riga (vedi errors.ts).
 */
export function runPepinoScript(compiled: CompileResult, scriptId: string, define: (spec: BlockSpec) => void, print: (t: string) => void, tileSize?: number): PepinoModule {
  const $ = makeRuntime({ lang: compiled.lang, print, maxLoopSeconds: 2, tile: tileSize });
  ownSpawn($);
  const hostObj = {
    ...engineHelpers(),
    block: (spec: PepBlockSpec, make: (b: BlockInstance) => Instance) => define(blockSpecFromPepino(spec, make, $)),
  };
  const fn = new Function("$", "$host", `${compiled.code}\n//# sourceURL=pepino-script/${safeScriptId(scriptId)}`);
  const mod = fn($, hostObj) as PepinoModule;
  drive(mod.main(), $, () => undefined);
  return mod;
}

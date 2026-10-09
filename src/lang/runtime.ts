/**
 * Le funzioni che il JavaScript generato usa (`$`): stampa, copie e distruzione dei valori,
 * posizioni che partono da 1, divisioni controllate, trigonometria in gradi…
 */
import { formatMessage, type MsgArg } from "./messages";
import type { Lang } from "./words";

/** Un errore del programma Pepino (non del motore): ha già il messaggio nella lingua giusta. */
export class PepinoRuntimeError extends Error {
  constructor(
    message: string,
    readonly key?: string,
  ) {
    super(message);
    this.name = "PepinoError";
  }
}

/** Un errore scritto dal programma con «fallisci». */
export class PepinoFail extends PepinoRuntimeError {}

/** «mamma mia!»: un errore grave, che nessun «tenta» può fermare. */
export class PepinoPanic extends PepinoRuntimeError {}

/** Una sequenza che aspetta, gestita da `drive` (un cappuccino, o il programma stesso). */
export interface PepinoTask {
  gen: Generator<unknown, unknown, unknown>;
  /** Quando ripartire (secondi del tempo di `drive`). */
  wake: number;
  until?: () => boolean;
  /** Ordine di arrivo: a parità di tempo parte prima chi è arrivato prima. */
  seq: number;
  main?: boolean;
}

export interface RuntimeOptions {
  lang: Lang;
  /** Dove finisce `scrivi`. */
  print?: (text: string) => void;
  /** `chiedi`: legge una riga (niente = non si può chiedere). */
  ask?: (question: string) => string | null;
  files?: {
    read(name: string): string;
    write(name: string, text: string): void;
    append(name: string, text: string): void;
    exists(name: string): boolean;
  };
  args?: string[];
  /** Quanti px è un tile (nell'engine: la dimensione dei tile del progetto). */
  tile?: number;
  /** Secondi dall'avvio (nell'engine: il tempo della scena). */
  now?: () => number;
  /** Dopo quanti secondi senza fermarsi un ciclo viene interrotto (0 = mai). */
  maxLoopSeconds?: number;
  random?: () => number;
}

type Pep = {
  $type?: string;
  $copy?: () => unknown;
  $eq?: (o: unknown) => boolean;
  $str?: () => string;
  $drop?: () => void;
};

const isPep = (v: unknown): v is Pep => !!v && typeof v === "object" && typeof (v as Pep).$copy === "function";

export function makeRuntime(opts: RuntimeOptions) {
  const lang = opts.lang;
  const msg = (key: string, ...args: MsgArg[]) => formatMessage(key, args, lang);
  const err = (key: string, ...args: MsgArg[]): never => {
    throw new PepinoRuntimeError(msg(key, ...args), key);
  };
  const rnd = opts.random ?? Math.random;
  const start = Date.now();
  const now = opts.now ?? (() => (Date.now() - start) / 1000);
  const DEG = Math.PI / 180;
  let loopStart = Date.now();
  const kept: unknown[] = [];

  const num = (x: number): string => {
    if (Object.is(x, -0)) return "0";
    if (Number.isInteger(x) || !Number.isFinite(x)) {
      if (x === Infinity) return lang === "it" ? "infinito" : "infinity";
      if (x === -Infinity) return lang === "it" ? "-infinito" : "-infinity";
      return String(x);
    }
    return String(Number(x.toPrecision(12)));
  };

  function str(v: unknown): string {
    if (v === null || v === undefined) return lang === "it" ? "niente" : "nothing";
    if (typeof v === "string") return v;
    if (typeof v === "number") return num(v);
    if (typeof v === "boolean") return lang === "it" ? (v ? "vero" : "falso") : v ? "true" : "false";
    if (Array.isArray(v)) return `[${v.map(repr).join(", ")}]`;
    if (v instanceof Map) return `{${[...v].map(([k, x]) => `${repr(k)}: ${repr(x)}`).join(", ")}}`;
    if (typeof v === "function") return lang === "it" ? "<funzione>" : "<function>";
    if (isPep(v) && v.$str) return v.$str();
    const named = v as { name?: unknown };
    if (typeof named.name === "string") return named.name;
    return String(v);
  }

  function repr(v: unknown): string {
    return typeof v === "string" ? JSON.stringify(v) : str(v);
  }

  function copy<T>(v: T): T {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(copy) as T;
    if (v instanceof Map) return new Map([...v].map(([k, x]) => [k, copy(x)])) as T;
    if (isPep(v)) return v.$copy!() as T;
    return v;
  }

  function eq(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null || a === undefined || b === undefined) return false;
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => eq(x, b[i]));
    if (a instanceof Map && b instanceof Map) {
      if (a.size !== b.size) return false;
      for (const [k, v] of a) if (!b.has(k) || !eq(v, b.get(k))) return false;
      return true;
    }
    if (isPep(a) && isPep(b) && a.$type === b.$type) return !!a.$eq?.(b);
    return false;
  }

  /** Distrugge un valore: i «quando finisce» dei suoi pezzi, dall'ultimo al primo. */
  function drop(v: unknown): void {
    if (v === null || v === undefined || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) drop(v[i]);
      return;
    }
    if (v instanceof Map) {
      const vals = [...v.values()];
      for (let i = vals.length - 1; i >= 0; i--) drop(vals[i]);
      return;
    }
    if (isPep(v) && v.$drop) v.$drop();
  }

  const index = (len: number, i: number, what: string): number => {
    if (!Number.isInteger(i)) err("run.indexInt", num(i));
    const k = i < 0 ? len + i : i - 1;
    if (k < 0 || k >= len) err("run.index", num(i), what, len);
    return k;
  };
  const listName = () => (lang === "it" ? "la lista" : "the list");
  const textName = () => (lang === "it" ? "il testo" : "the text");

  const cmp = (a: any, b: any) => (a < b ? -1 : a > b ? 1 : 0);

  const $ = {
    lang,
    tile: opts.tile ?? 16,
    io: [] as unknown[],
    n: 0,
    PepinoRuntimeError,
    str,
    repr,
    copy,
    eq,
    drop,
    print: (...vals: unknown[]) => (opts.print ?? ((t: string) => console.log(t)))(vals.map(str).join(" ")),
    // ---------------------------------------------------------- conversioni e numeri
    num: (x: unknown): number => {
      if (typeof x === "number") return x;
      const t = String(x).trim().replace(",", ".");
      const n = t === "" ? NaN : Number(t);
      if (Number.isNaN(n)) err("run.number", String(x));
      return n;
    },
    int: (x: unknown): number => Math.trunc(typeof x === "number" ? x : $.num(x)),
    round: (x: number, d = 0) => {
      const k = 10 ** d;
      return Math.round(x * k) / k;
    },
    floor: Math.floor,
    ceil: Math.ceil,
    abs: Math.abs,
    sqrt: Math.sqrt,
    min: (...xs: any[]) => (xs.length === 1 && Array.isArray(xs[0]) ? (xs[0].length ? Math.min(...xs[0]) : err("run.emptyList")) : Math.min(...xs)),
    max: (...xs: any[]) => (xs.length === 1 && Array.isArray(xs[0]) ? (xs[0].length ? Math.max(...xs[0]) : err("run.emptyList")) : Math.max(...xs)),
    clamp: (x: number, a: number, b: number) => Math.min(Math.max(x, Math.min(a, b)), Math.max(a, b)),
    lerp: (a: number, b: number, t: number) => a + (b - a) * t,
    approach: (x: number, target: number, step: number) => (x < target ? Math.min(x + Math.abs(step), target) : Math.max(x - Math.abs(step), target)),
    sign: Math.sign,
    sin: (d: number) => $.fix(Math.sin(d * DEG)),
    cos: (d: number) => $.fix(Math.cos(d * DEG)),
    tan: (d: number) => $.fix(Math.tan(d * DEG)),
    asin: (x: number) => Math.asin(x) / DEG,
    acos: (x: number) => Math.acos(x) / DEG,
    atan2: (y: number, x: number) => Math.atan2(y, x) / DEG,
    /** Toglie gli errori minuscoli dei decimali (0.1 + 0.2). */
    fix: (x: number) => (Math.abs(x - Math.round(x)) < 1e-12 ? Math.round(x) : Number(x.toPrecision(15))),
    random: (a?: number, b?: number): number => {
      if (a === undefined || b === undefined) return rnd();
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      if (Number.isInteger(lo) && Number.isInteger(hi)) return lo + Math.floor(rnd() * (hi - lo + 1));
      return lo + rnd() * (hi - lo);
    },
    distance: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    div: (a: number, b: number) => (b === 0 ? err("run.divZero") : a / b),
    mod: (a: number, b: number) => (b === 0 ? err("run.divZero") : ((a % b) + b) % b),
    neg: (a: any) => -a,
    time: now,
    len: (x: any): number => (x instanceof Map ? x.size : x == null ? 0 : x.length),
    range: (a: number, b: number, s?: number) => {
      const [x, y, st] = $.rng(a, b, s);
      const out: number[] = [];
      for (let i = x; st > 0 ? i <= y + 1e-9 : i >= y - 1e-9; i = $.fix(i + st)) out.push(i);
      return out;
    },
    /** da … a … [passo …]: se da > a e il passo non c'è, conta all'indietro. */
    rng: (a: number, b: number, s?: number): [number, number, number] => {
      const st = s ?? (a <= b ? 1 : -1);
      if (st === 0) err("run.step");
      return [a, st > 0 ? b + 1e-9 : b - 1e-9, st];
    },
    times: (n: number) => {
      if (!Number.isFinite(n)) err("run.number", String(n));
      return Math.max(0, Math.floor(n));
    },
    // ---------------------------------------------------------- testi
    split: (t: string, sep?: string) => (sep === undefined ? t.trim().split(/\s+/).filter(Boolean) : t.split(sep)),
    textIndex: (t: string, s: string) => {
      const k = t.indexOf(s);
      return k < 0 ? null : k + 1;
    },
    repeatText: (t: string, n: number) => t.repeat(Math.max(0, Math.floor(n))),
    charAt: (t: string, i: number) => t[index(t.length, i, textName())],
    slice: (x: any, from: number, to?: number) => {
      const len = x.length;
      const a = from < 0 ? len + from : from - 1;
      const b = to === undefined ? len : to < 0 ? len + to + 1 : to;
      const part = x.slice(Math.max(0, a), Math.max(0, b));
      return typeof x === "string" ? part : copy(part);
    },
    // ---------------------------------------------------------- liste
    at: (a: unknown[], i: number) => a[index(a.length, i, listName())],
    setAt: (a: unknown[], i: number, v: unknown, d: boolean) => {
      const k = index(a.length, i, listName());
      const old = a[k];
      a[k] = v;
      if (d) drop(old);
    },
    insert: (a: unknown[], i: number, x: unknown) => {
      const k = i === a.length + 1 ? a.length : index(a.length, i, listName());
      a.splice(k, 0, x);
    },
    removeAt: (a: unknown[], i: number) => a.splice(index(a.length, i, listName()), 1)[0],
    pop: (a: unknown[]) => (a.length ? a.pop() : err("run.emptyList")),
    shift: (a: unknown[]) => (a.length ? a.shift() : err("run.emptyList")),
    removeValue: (a: unknown[], x: unknown, d: boolean) => {
      const k = a.findIndex((y) => eq(y, x));
      if (k < 0) return false;
      const [old] = a.splice(k, 1);
      if (d) drop(old);
      return true;
    },
    removeIf: (a: unknown[], f: (x: unknown) => boolean, d: boolean) => {
      let n = 0;
      for (let i = 0; i < a.length; ) {
        if (f(a[i])) {
          const [old] = a.splice(i, 1);
          if (d) drop(old);
          n++;
        } else i++;
      }
      return n;
    },
    contains: (a: unknown[], x: unknown) => a.some((y) => eq(y, x)),
    indexOf: (a: unknown[], x: unknown) => {
      const k = a.findIndex((y) => eq(y, x));
      return k < 0 ? null : k + 1;
    },
    clear: (c: unknown[] | Map<unknown, unknown>, d: boolean) => {
      if (d) drop(c);
      if (c instanceof Map) c.clear();
      else c.length = 0;
    },
    sort: (a: any[]) => void a.sort(cmp),
    sortBy: (a: any[], f: (x: any) => any) => {
      const keyed = a.map((x) => [f(x), x] as const);
      keyed.sort((p, q) => cmp(p[0], q[0]));
      for (let i = 0; i < a.length; i++) a[i] = keyed[i][1];
    },
    shuffle: (a: unknown[]) => {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
    },
    filter: (a: unknown[], f: (x: unknown) => boolean) => a.filter((x) => f(x)).map(copy),
    mapList: (a: unknown[], f: (x: unknown) => unknown) => a.map((x) => f(x)),
    find: (a: unknown[], f: (x: unknown) => boolean) => {
      const x = a.find((y) => f(y));
      return x === undefined ? null : copy(x);
    },
    count: (a: unknown[], x: unknown) => a.filter((y) => eq(y, x)).length,
    sum: (a: number[]) => a.reduce((s, x) => s + x, 0),
    minOf: (a: any[]) => (a.length ? copy(a.reduce((m, x) => (cmp(x, m) < 0 ? x : m))) : null),
    maxOf: (a: any[]) => (a.length ? copy(a.reduce((m, x) => (cmp(x, m) > 0 ? x : m))) : null),
    first: (a: unknown[]) => (a.length ? copy(a[0]) : null),
    last: (a: unknown[]) => (a.length ? copy(a[a.length - 1]) : null),
    pick: (a: unknown[]) => (a.length ? copy(a[Math.floor(rnd() * a.length)]) : null),
    join: (a: unknown[], sep = ", ") => a.map(str).join(sep),
    concat: (a: unknown[], b: unknown[]) => copy([...a, ...b]),
    // ---------------------------------------------------------- mappe
    map: (entries: [unknown, unknown][]) => new Map(entries),
    get: (m: Map<unknown, unknown>, k: unknown) => (m.has(k) ? m.get(k) : err("run.mapKey", repr(k))),
    mapSet: (m: Map<unknown, unknown>, k: unknown, v: unknown, d: boolean) => {
      const old = m.get(k);
      m.set(k, v);
      if (d && old !== v) drop(old);
    },
    mapGet: (m: Map<unknown, unknown>, k: unknown, def?: unknown) => (m.has(k) ? copy(m.get(k)) : def === undefined ? null : def),
    mapRemove: (m: Map<unknown, unknown>, k: unknown) => {
      if (!m.has(k)) return null;
      const v = m.get(k);
      m.delete(k);
      return v;
    },
    // ---------------------------------------------------------- valori «Qualsiasi» (dall'engine)
    index: (o: any, k: any) => {
      if (Array.isArray(o) && typeof k === "number") return $.at(o, k);
      if (o instanceof Map) return $.get(o, k);
      if (typeof o === "string" && typeof k === "number") return $.charAt(o, k);
      return o?.[k] ?? null;
    },
    setIndex: (o: any, k: any, v: unknown) => {
      if (Array.isArray(o) && typeof k === "number") $.setAt(o, k, v, false);
      else if (o instanceof Map) o.set(k, v);
      else o[k] = v;
    },
    iterAny: (o: any): Iterable<unknown> => (o instanceof Map ? o.keys() : o == null ? [] : typeof o[Symbol.iterator] === "function" ? o : Object.keys(o)),
    pairs: (o: any): Iterable<[unknown, unknown]> => (o instanceof Map ? o : Array.isArray(o) ? o.map((x, i) => [i + 1, x] as [unknown, unknown]) : Object.entries(o ?? {})),
    dyn: (op: string, a: any, b: any): unknown => {
      switch (op) {
        case "+":
          return typeof a === "string" || typeof b === "string" ? str(a) + str(b) : Array.isArray(a) && Array.isArray(b) ? $.concat(a, b) : a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return $.div(a, b);
        case "%":
          return $.mod(a, b);
        case "^":
          return a ** b;
        case "==":
          return eq(a, b);
        case "!=":
          return !eq(a, b);
        case "<":
          return a < b;
        case ">":
          return a > b;
        case "<=":
          return a <= b;
        case ">=":
          return a >= b;
        case "in":
          return a instanceof Map ? false : b instanceof Map ? b.has(a) : typeof b === "string" ? b.includes(a) : Array.isArray(b) ? $.contains(b, a) : false;
        case "notin":
          return !$.dyn("in", a, b);
        default:
          return undefined;
      }
    },
    nn: <T>(v: T | undefined | null): T | null => (v === undefined ? null : v),
    // ---------------------------------------------------------- controlli ed errori
    check: (c: boolean, message: string | undefined, line: number) => {
      if (!c) throw new PepinoRuntimeError(message === undefined ? msg("run.checkPlain", line) : msg("run.check", message), "run.check");
    },
    fail: (message: string) => new PepinoFail(message),
    panic: (message: string | undefined, line: number) => new PepinoPanic(message === undefined ? msg("run.panicPlain", line) : msg("run.panic", message), "run.panic"),
    errMsg: (e: unknown): string => (e instanceof Error ? e.message : String(e)),
    /** Errori che «tenta» non deve nascondere (il programma bloccato, «mamma mia!»). */
    rethrowFatal: (e: unknown) => {
      if (e instanceof PepinoPanic) throw e;
      if (e instanceof PepinoRuntimeError && e.key === "run.tooLong") throw e;
      if (e instanceof RangeError && /call stack/i.test(e.message)) throw new PepinoRuntimeError(msg("run.tooDeep"), "run.tooDeep");
    },
    /** Un ciclo che non si ferma: dopo un po' si interrompe con un messaggio (così il gioco non si blocca). */
    guard: () => {
      $.n = 0;
      const max = opts.maxLoopSeconds ?? 0;
      if (max > 0 && Date.now() - loopStart > max * 1000) {
        loopStart = Date.now();
        err("run.tooLong");
      }
    },
    /** Da chiamare quando il programma fa una pausa (un fotogramma, un'attesa): il conteggio del ciclo riparte. */
    resetLoop: () => {
      $.n = 0;
      loopStart = Date.now();
    },
    // ---------------------------------------------------------- valori temporanei con «quando finisce»
    keep: <T>(v: T): T => {
      kept.push(v);
      return v;
    },
    mark: () => kept.length,
    release: (m: number) => {
      while (kept.length > m) drop(kept.pop());
    },
    // ---------------------------------------------------------- cappuccini (il codice che parte dopo)
    /** Le sequenze in attesa: le fa andare avanti `drive` (nell'engine le sostituisce `spawn`). */
    tasks: [] as PepinoTask[],
    /** Il tempo di `drive`, in secondi. */
    clock: 0,
    taskSeq: 0,
    /** Dove va un cappuccino ordinato: l'engine lo sostituisce (le sequenze appartengono all'oggetto). */
    spawn: (gen: Generator<unknown, unknown, unknown>, delay: number): void => {
      $.tasks.push({ gen, wake: $.clock + Math.max(0, delay), seq: $.taskSeq++ });
    },
    /** «cappuccino [durata]:»: il generatore entra subito nel suo try (così, se viene annullato, distrugge le sue copie). */
    later: (delay: number, gen: Generator<unknown, unknown, unknown>): void => {
      if (!Number.isFinite(delay)) err("run.number", String(delay));
      gen.next();
      $.spawn(gen, delay);
    },
    // ---------------------------------------------------------- ambiente
    ask: (q?: string): string => {
      if (!opts.ask) return err("run.noInput");
      const r = opts.ask(q ?? "");
      if (r === null) err("run.inputEnded");
      return r ?? "";
    },
    askNumber: (q?: string): number => {
      for (;;) {
        const t = $.ask(q);
        const n = Number(t.trim().replace(",", "."));
        if (t.trim() && !Number.isNaN(n)) return n;
        $.print(lang === "it" ? "Scrivi un numero, per favore." : "Please write a number.");
      }
    },
    readFile: (n: string) => (opts.files ? opts.files.read(n) : err("run.noFiles")),
    writeFile: (n: string, t: string) => (opts.files ? opts.files.write(n, t) : err("run.noFiles")),
    appendFile: (n: string, t: string) => (opts.files ? opts.files.append(n, t) : err("run.noFiles")),
    fileExists: (n: string) => (opts.files ? opts.files.exists(n) : err("run.noFiles")),
    args: () => [...(opts.args ?? [])],
  };
  return $;
}

export type Runtime = ReturnType<typeof makeRuntime>;

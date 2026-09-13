/** Funzioni di supporto usate dal codice generato dai blocchi in Python (Pepino.py). */

let logger: (message: string) => void = (m) => console.log("[Pepino]", m);

/** Dove finiscono i print() degli script (il gioco lo collega alla sua Console). */
export function setScriptLogger(fn: (message: string) => void): void {
  logger = fn;
}

const isPlain = (o: unknown): o is Record<string, any> => !!o && typeof o === "object" && Object.getPrototypeOf(o) === Object.prototype;

function iter(x: any): Iterable<any> {
  if (x == null) return [];
  if (typeof x === "string" || typeof x[Symbol.iterator] === "function") return x;
  if (isPlain(x)) return Object.keys(x);
  throw new TypeError(`${typeName(x)} non si può scorrere con for`);
}

function typeName(x: unknown): string {
  if (x === null || x === undefined) return "None";
  if (Array.isArray(x)) return "una lista";
  if (typeof x === "string") return "un testo";
  if (typeof x === "number") return "un numero";
  if (isPlain(x)) return "un dizionario";
  return `un oggetto ${(x as object).constructor?.name ?? ""}`.trim();
}

function repr(x: unknown): string {
  return typeof x === "string" ? `'${x}'` : str(x);
}

function str(x: unknown): string {
  if (x === null || x === undefined) return "None";
  if (x === true) return "True";
  if (x === false) return "False";
  if (typeof x === "string") return x;
  if (Array.isArray(x)) return `[${x.map(repr).join(", ")}]`;
  if (isPlain(x)) return `{${Object.entries(x).map(([k, v]) => `${repr(k)}: ${repr(v)}`).join(", ")}}`;
  return String(x);
}

function truthy(x: unknown): boolean {
  if (Array.isArray(x)) return x.length > 0;
  if (x instanceof Map || x instanceof Set) return x.size > 0;
  if (isPlain(x)) return Object.keys(x).length > 0;
  return !!x;
}

const notInList = (x: unknown) => new Error(`${repr(x)} non è nella lista`);

const METHODS: Record<string, (o: any, ...a: any[]) => any> = {
  append: (o, x) => void o.push(x),
  extend: (o, xs) => void o.push(...iter(xs)),
  insert: (o, i, x) => void o.splice(i, 0, x),
  pop: (o, i) => {
    if (Array.isArray(o)) return i === undefined ? o.pop() : o.splice(i < 0 ? o.length + i : i, 1)[0];
    const v = o[i];
    delete o[i];
    return v;
  },
  remove: (o, x) => {
    const k = o.indexOf(x);
    if (k < 0) throw notInList(x);
    o.splice(k, 1);
  },
  index: (o, x) => {
    const k = o.indexOf(x);
    if (k < 0) throw notInList(x);
    return k;
  },
  count: (o, x) => (typeof o === "string" ? o.split(x).length - 1 : o.filter((y: unknown) => y === x).length),
  keys: (o) => Object.keys(o),
  values: (o) => Object.values(o),
  items: (o) => Object.entries(o),
  get: (o, k, d = null) => (isPlain(o) ? (k in o ? o[k] : d) : typeof o?.get === "function" ? (o.get(k) ?? d) : d),
  upper: (o) => o.toUpperCase(),
  lower: (o) => o.toLowerCase(),
  strip: (o) => o.trim(),
  lstrip: (o) => o.trimStart(),
  rstrip: (o) => o.trimEnd(),
  startswith: (o, x) => o.startsWith(x),
  endswith: (o, x) => o.endsWith(x),
  replace: (o, a, b) => o.split(a).join(b),
  split: (o, sep) => (sep == null ? o.trim().split(/\s+/).filter(Boolean) : o.split(sep)),
  join: (o, xs) => Array.from(iter(xs), (x) => String(x)).join(o),
  find: (o, x) => o.indexOf(x),
  copy: (o) => (Array.isArray(o) ? [...o] : { ...o }),
  clear: (o) => {
    if (Array.isArray(o)) o.length = 0;
    else for (const k of Object.keys(o)) delete o[k];
  },
  update: (o, other) => void Object.assign(o, other),
};

function num(xs: unknown[]): number[] {
  return (xs.length === 1 && typeof xs[0] === "object" ? Array.from(iter(xs[0])) : xs) as number[];
}

export const PY = Object.freeze({
  print: (...a: unknown[]) => logger(a.map(str).join(" ")),
  str,
  repr,
  truthy,
  iter,
  /** `a or b` / `a and b` con la verità di Python; b si calcola solo se serve. */
  or: (a: unknown, b: () => unknown) => (truthy(a) ? a : b()),
  and: (a: unknown, b: () => unknown) => (truthy(a) ? b() : a),
  len: (x: any): number => {
    if (x == null) return 0;
    if (typeof x === "string" || Array.isArray(x)) return x.length;
    if (x instanceof Map || x instanceof Set) return x.size;
    if (isPlain(x)) return Object.keys(x).length;
    throw new TypeError(`len() non funziona con ${typeName(x)}`);
  },
  *range(a: number, b?: number, c?: number): Generator<number> {
    let start = 0;
    let stop = a;
    let step = 1;
    if (b !== undefined) {
      start = a;
      stop = b;
    }
    if (c !== undefined) step = c;
    if (step === 0) throw new Error("range(): il passo non può essere 0");
    if (step > 0) for (let i = start; i < stop; i += step) yield i;
    else for (let i = start; i > stop; i += step) yield i;
  },
  contains: (c: any, x: any): boolean => {
    if (typeof c === "string") return c.includes(x);
    if (Array.isArray(c)) return c.includes(x);
    if (c instanceof Map || c instanceof Set) return c.has(x);
    return c != null && Object.prototype.hasOwnProperty.call(c, x);
  },
  mod: (a: number, b: number) => ((a % b) + b) % b,
  at: (o: any, i: number) => o.at(i),
  slice: (o: any, lo?: number, hi?: number) => o.slice(lo ?? 0, hi),
  int: (x: any): number => {
    if (typeof x === "string") {
      const n = parseInt(x, 10);
      if (Number.isNaN(n)) throw new Error(`int(): «${x}» non è un numero`);
      return n;
    }
    return Math.trunc(Number(x));
  },
  float: (x: any): number => {
    const n = Number(x);
    if (Number.isNaN(n)) throw new Error(`float(): «${x}» non è un numero`);
    return n;
  },
  round: (x: number, n = 0) => {
    const k = 10 ** n;
    return Math.round(x * k) / k;
  },
  min: (...xs: unknown[]) => Math.min(...num(xs)),
  max: (...xs: unknown[]) => Math.max(...num(xs)),
  sum: (xs: unknown, start = 0) => Array.from(iter(xs)).reduce((a: number, b: number) => a + b, start),
  sorted: (xs: unknown) => Array.from(iter(xs)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  reversed: (xs: unknown) => Array.from(iter(xs)).reverse(),
  enumerate: (xs: unknown, start = 0) => Array.from(iter(xs), (x, i) => [i + start, x]),
  zip: (...xs: unknown[]) => {
    const lists = xs.map((x) => Array.from(iter(x)));
    const n = Math.min(...lists.map((l) => l.length));
    return Array.from({ length: n }, (_, i) => lists.map((l) => l[i]));
  },
  list: (xs: unknown) => Array.from(iter(xs)),
  format: (v: unknown, spec: string) => {
    const f = /^\.(\d+)f$/.exec(spec);
    if (f) return Number(v).toFixed(Number(f[1]));
    if (spec === "d") return String(Math.trunc(Number(v)));
    return str(v);
  },
  degrees: (r: number) => (r * 180) / Math.PI,
  radians: (d: number) => (d * Math.PI) / 180,
  random: Object.freeze({
    random: () => Math.random(),
    randint: (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1)),
    uniform: (a: number, b: number) => a + Math.random() * (b - a),
    choice: (xs: any[]) => xs[Math.floor(Math.random() * xs.length)],
  }),
  /** Metodi "alla Python" (append, get, split…); sugli oggetti di Pepino usa i loro metodi. */
  method(o: any, name: string, ...a: any[]): any {
    // Un oggetto semplice con una sua funzione con quel nome (es. un'API passata allo script) la usa.
    if (isPlain(o) && typeof o[name] === "function") return o[name](...a);
    const py = METHODS[name];
    if (py && (typeof o === "string" || Array.isArray(o) || isPlain(o))) return py(o, ...a);
    if (o != null && typeof o[name] === "function") return o[name](...a);
    if (py) return py(o, ...a);
    throw new TypeError(`${typeName(o)} non ha il metodo ${name}()`);
  },
});

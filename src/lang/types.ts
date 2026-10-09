import type * as A from "./ast";
import type { Span } from "./messages";
import type { Dim, Lang } from "./words";

// ------------------------------------------------------------------ unità

/** Esponenti delle grandezze: {px: 1, s: -1} = una velocità. Senza grandezze = numero puro. */
export type Dims = Partial<Record<Dim, number>>;

export function dimsKey(d?: Dims): string {
  if (!d) return "";
  return (["px", "s", "deg"] as Dim[])
    .filter((k) => d[k])
    .map((k) => `${k}${d[k]}`)
    .join(",");
}

export function dimsEqual(a?: Dims, b?: Dims): boolean {
  return dimsKey(a) === dimsKey(b);
}

export function dimsCombine(a: Dims | undefined, b: Dims | undefined, sign: 1 | -1): Dims | undefined {
  if (!a && !b) return undefined;
  const out: Dims = {};
  for (const k of ["px", "s", "deg"] as Dim[]) {
    const v = (a?.[k] ?? 0) + sign * (b?.[k] ?? 0);
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export function dimsScale(a: Dims | undefined, n: number): Dims | undefined {
  if (!a || !Number.isInteger(n)) return undefined;
  const out: Dims = {};
  for (const k of ["px", "s", "deg"] as Dim[]) if (a[k]) out[k] = (a[k] ?? 0) * n;
  return Object.keys(out).length ? out : undefined;
}

const DIM_SYMBOL: Record<Dim, string> = { px: "px", s: "s", deg: "°" };

export function dimsText(d?: Dims): string {
  if (!d) return "";
  const up: string[] = [];
  const down: string[] = [];
  for (const k of ["px", "deg", "s"] as Dim[]) {
    const v = d[k];
    if (!v) continue;
    const s = DIM_SYMBOL[k] + (Math.abs(v) > 1 ? `^${Math.abs(v)}` : "");
    (v > 0 ? up : down).push(s);
  }
  return (up.join("·") || "1") + (down.length ? `/${down.join("/")}` : "");
}

/** Il nome della grandezza: «un tempo», «una velocità»… */
export function dimsName(d: Dims | undefined, lang: Lang): string {
  const key = dimsKey(d);
  const names: Record<string, [string, string]> = {
    s1: ["un tempo", "a time"],
    px1: ["una lunghezza", "a length"],
    deg1: ["un angolo", "an angle"],
    "px1,s-1": ["una velocità", "a speed"],
    "px1,s-2": ["un'accelerazione", "an acceleration"],
    "s-1,deg1": ["una velocità di rotazione", "a rotation speed"],
    "px2": ["un'area", "an area"],
  };
  const n = names[key];
  const base = n ? (lang === "it" ? n[0] : n[1]) : lang === "it" ? "un numero" : "a number";
  return `${base} (${dimsText(d)})`;
}

// ------------------------------------------------------------------ tipi

export interface HostMember {
  it: string;
  en: string;
  type: () => Type;
  /** JavaScript che legge il valore; `r` è l'oggetto. */
  get: (r: string) => string;
  /** JavaScript che scrive il valore (manca = sola lettura). */
  set?: (r: string, v: string) => string;
}

export interface HostParam {
  name: string;
  type: () => Type;
  optional?: boolean;
}

export interface HostMethod {
  it: string;
  en: string;
  params: HostParam[];
  ret: () => Type;
  js: (r: string, args: string[]) => string;
}

export interface HostTypeInfo {
  id: string;
  it: string;
  en: string;
  members: HostMember[];
  methods: HostMethod[];
}

export interface FieldInfo {
  name: string;
  jsName: string;
  type: Type;
  decl: A.FieldDecl;
}

export interface RecordInfo {
  name: string;
  jsName: string;
  decl?: A.TypeDecl;
  fields: FieldInfo[];
  methods: Map<string, FnInfo>;
  /** Ha un «quando finisce» (anche dentro un campo): i suoi valori vanno distrutti con cura. */
  needsDrop?: boolean;
  /** È la classe di un blocco dell'engine. */
  isBlock?: boolean;
  /** «quando crea» e «quando finisce». */
  onCreate?: FnInfo;
  onEnd?: FnInfo;
  /** I campi sono già stati controllati. */
  state?: "todo" | "checking" | "done";
}

export interface EnumInfo {
  name: string;
  members: string[];
  decl: A.EnumDecl;
}

export interface ParamInfo {
  name: string;
  mode: A.ParamMode;
  type?: Type;
  def?: A.Expr;
  decl?: A.Param;
}

export interface FnInfo {
  name: string;
  jsName: string;
  decl?: A.FuncDecl;
  params: ParamInfo[];
  /** Tipo scritto dopo -> (se c'è). */
  declaredRet?: Type;
  /** Tipo restituito (dedotto, per le funzioni non-modello). */
  ret?: Type;
  /** Ha parametri senza tipo: è un modello, controllato a ogni chiamata con i tipi veri. */
  generic: boolean;
  instances: Map<string, FnInfo>;
  state: "todo" | "checking" | "done";
  /** Aspetta (direttamente o chiamando funzioni che aspettano). */
  routine: boolean;
  /** Funzioni chiamate: servono a propagare `routine`. */
  calls: Set<FnInfo>;
  /** Metodo di un tipo (o di un blocco). */
  owner?: RecordInfo;
  /** Il metodo cambia i campi di `questo`. */
  mutating: boolean;
  /** Il codice che la chiama deve riscrivere i parametri «cambia». */
  hasChange: boolean;
  /** Dove non può aspettare (condizioni, aggiorna…): il motivo per il messaggio. */
  noWait?: string;
  kind: "fn" | "method" | "handler" | "action" | "condition" | "main" | "test" | "lambda" | "ctor" | "dtor" | "later";
  /** Le istruzioni (per un'istanza di un modello: una copia della funzione originale). */
  body?: A.Stmt[];
  /** Le variabili dei parametri, nell'ordine. */
  paramRefs?: Binding[];
  /** Per le istanze: la funzione-modello da cui vengono. */
  template?: FnInfo;
  /** Dove aspetta per la prima volta (per i messaggi). */
  waitSpan?: Span;
  /** Dove chiama le altre funzioni (per i messaggi sulle attese). */
  callSpans: Map<FnInfo, Span>;
  /** I tipi dei parametri sono già stati calcolati. */
  signed?: boolean;
}

export type Type =
  | { k: "num"; dims?: Dims }
  | { k: "text" }
  | { k: "bool" }
  | { k: "none" }
  | { k: "void" }
  | { k: "any" }
  | { k: "err" }
  | { k: "list"; el: Type }
  | { k: "map"; key: Type; val: Type }
  | { k: "opt"; t: Type }
  | { k: "rec"; rec: RecordInfo }
  | { k: "enum"; en: EnumInfo }
  | { k: "fn"; params: Type[]; ret: Type }
  | { k: "host"; host: HostTypeInfo }
  | { k: "var"; id: number; ref?: Type };

export const NUM: Type = { k: "num" };
export const TEXT: Type = { k: "text" };
export const BOOL: Type = { k: "bool" };
export const NONE: Type = { k: "none" };
export const VOID: Type = { k: "void" };
export const ANY: Type = { k: "any" };
export const ERR: Type = { k: "err" };
export const num = (dims?: Dims): Type => (dims ? { k: "num", dims } : NUM);
export const list = (el: Type): Type => ({ k: "list", el });
export const map = (key: Type, val: Type): Type => ({ k: "map", key, val });
export const opt = (t: Type): Type => {
  const r = resolve(t);
  return r.k === "opt" || r.k === "any" || r.k === "err" ? r : { k: "opt", t };
};

let nextVar = 1;
export const fresh = (): Type => ({ k: "var", id: nextVar++ });

export function resolve(t: Type): Type {
  while (t.k === "var" && t.ref) t = t.ref;
  return t;
}

export const isErr = (t: Type) => {
  const r = resolve(t);
  return r.k === "err";
};

/** Valori piccoli, che si copiano senza fatica (numeri, testi, sì/no, scelte, oggetti dell'engine). */
export function isPrimitive(t: Type): boolean {
  const r = resolve(t);
  switch (r.k) {
    case "num":
    case "text":
    case "bool":
    case "none":
    case "void":
    case "enum":
    case "host":
    case "fn":
    case "err":
      return true;
    case "opt":
      return isPrimitive(r.t);
    default:
      return false;
  }
}

/** Il valore ha un «quando finisce» da chiamare quando sparisce (anche dentro una lista o un campo). */
export function needsDrop(t: Type, seen = new Set<RecordInfo>()): boolean {
  const r = resolve(t);
  switch (r.k) {
    case "rec":
      if (seen.has(r.rec)) return false;
      seen.add(r.rec);
      return !!r.rec.needsDrop;
    case "list":
      return needsDrop(r.el, seen);
    case "map":
      return needsDrop(r.val, seen);
    case "opt":
      return needsDrop(r.t, seen);
    default:
      return false;
  }
}

/** Contiene variabili di tipo non ancora risolte. */
export function hasVars(t: Type): boolean {
  const r = resolve(t);
  switch (r.k) {
    case "var":
      return true;
    case "list":
      return hasVars(r.el);
    case "map":
      return hasVars(r.key) || hasVars(r.val);
    case "opt":
      return hasVars(r.t);
    case "fn":
      return r.params.some(hasVars) || hasVars(r.ret);
    default:
      return false;
  }
}

/** Chiave per riconoscere lo stesso tipo (serve alle istanze dei modelli). */
export function typeKey(t: Type): string {
  const r = resolve(t);
  switch (r.k) {
    case "num":
      return r.dims ? `num<${dimsKey(r.dims)}>` : "num";
    case "list":
      return `[${typeKey(r.el)}]`;
    case "map":
      return `{${typeKey(r.key)}:${typeKey(r.val)}}`;
    case "opt":
      return `${typeKey(r.t)}?`;
    case "rec":
      return `rec:${r.rec.name}`;
    case "enum":
      return `enum:${r.en.name}`;
    case "host":
      return `host:${r.host.id}`;
    case "fn":
      return `fn(${r.params.map(typeKey).join(",")})->${typeKey(r.ret)}`;
    case "var":
      return `?${r.id}`;
    default:
      return r.k;
  }
}

/** Il tipo come si scrive nel codice: Lista di Numero, Punto, Testo?… */
export function typeText(t: Type, lang: Lang): string {
  const r = resolve(t);
  const it = lang === "it";
  switch (r.k) {
    case "num":
      return (it ? "Numero" : "Number") + (r.dims ? ` (${dimsText(r.dims)})` : "");
    case "text":
      return it ? "Testo" : "Text";
    case "bool":
      return it ? "SiNo" : "YesNo";
    case "none":
      return it ? "niente" : "nothing";
    case "void":
      return it ? "niente" : "nothing";
    case "any":
      return it ? "Qualsiasi" : "Any";
    case "err":
      return "?";
    case "list":
      return `${it ? "Lista di" : "List of"} ${typeText(r.el, lang)}`;
    case "map":
      return `${it ? "Mappa di" : "Map of"} ${typeText(r.key, lang)} ${it ? "a" : "to"} ${typeText(r.val, lang)}`;
    case "opt":
      return `${typeText(r.t, lang)}?`;
    case "rec":
      return r.rec.name;
    case "enum":
      return r.en.name;
    case "host":
      return it ? r.host.it : r.host.en;
    case "fn":
      return `${it ? "funzione" : "function"}(${r.params.map((p) => typeText(p, lang)).join(", ")}) -> ${typeText(r.ret, lang)}`;
    case "var":
      return it ? "qualcosa" : "something";
  }
}

/** Il tipo in una frase, con l'articolo: «un numero», «una lista di testi», ««Punto»». */
export function typePhrase(t: Type, lang: Lang): string {
  const r = resolve(t);
  const it = lang === "it";
  switch (r.k) {
    case "num":
      return r.dims ? dimsName(r.dims, lang) : it ? "un numero" : "a number";
    case "text":
      return it ? "un testo" : "a text";
    case "bool":
      return it ? "un sì/no (vero o falso)" : "a yes/no (true or false)";
    case "none":
    case "void":
      return it ? "niente" : "nothing";
    case "any":
      return it ? "un valore qualsiasi" : "any value";
    case "list":
      return it ? `una lista (${typeText(r, lang)})` : `a list (${typeText(r, lang)})`;
    case "map":
      return it ? `una mappa (${typeText(r, lang)})` : `a map (${typeText(r, lang)})`;
    case "opt":
      return it ? `${typePhrase(r.t, lang)} o niente` : `${typePhrase(r.t, lang)} or nothing`;
    case "fn":
      return it ? `una funzione (${typeText(r, lang)})` : `a function (${typeText(r, lang)})`;
    case "var":
      return it ? "qualcosa" : "something";
    default:
      return `«${typeText(r, lang)}»`;
  }
}

export const phrase = (t: Type) => (lang: Lang) => typePhrase(t, lang);
export const tname = (t: Type) => (lang: Lang) => typeText(t, lang);

/**
 * Rende uguali due tipi (le variabili di tipo prendono un valore). Le unità non contano qui:
 * le controlla il controllo dei tipi dove servono (somme, confronti, assegnazioni).
 */
export function unify(a: Type, b: Type): boolean {
  const x = resolve(a);
  const y = resolve(b);
  if (x === y) return true;
  if (x.k === "var") {
    if (occurs(x, y)) return false;
    x.ref = y;
    return true;
  }
  if (y.k === "var") {
    if (occurs(y, x)) return false;
    y.ref = x;
    return true;
  }
  if (x.k === "any" || y.k === "any" || x.k === "err" || y.k === "err") return true;
  if (x.k !== y.k) return false;
  switch (x.k) {
    case "list":
      return unify(x.el, (y as typeof x).el);
    case "map":
      return unify(x.key, (y as typeof x).key) && unify(x.val, (y as typeof x).val);
    case "opt":
      return unify(x.t, (y as typeof x).t);
    case "rec":
      return x.rec === (y as typeof x).rec;
    case "enum":
      return x.en === (y as typeof x).en;
    case "host":
      return x.host.id === (y as typeof x).host.id;
    case "fn": {
      const f = y as typeof x;
      if (x.params.length !== f.params.length) return false;
      return x.params.every((p, i) => unify(p, f.params[i])) && unify(x.ret, f.ret);
    }
    default:
      return true;
  }
}

function occurs(v: Type & { k: "var" }, t: Type): boolean {
  const r = resolve(t);
  if (r === v) return true;
  switch (r.k) {
    case "list":
      return occurs(v, r.el);
    case "map":
      return occurs(v, r.key) || occurs(v, r.val);
    case "opt":
      return occurs(v, r.t);
    case "fn":
      return r.params.some((p) => occurs(v, p)) || occurs(v, r.ret);
    default:
      return false;
  }
}

/**
 * Si può mettere un valore di tipo `src` dove serve `dst`?
 * "ok", oppure il motivo per cui no ("nothing" = è niente, "maybe" = potrebbe essere niente, "type").
 */
export function assignable(dst: Type, src: Type): "ok" | "nothing" | "maybe" | "type" {
  const d = resolve(dst);
  const s = resolve(src);
  if (d.k === "any" || s.k === "any" || d.k === "err" || s.k === "err") return "ok";
  if (d.k === "opt") {
    if (s.k === "none") return "ok";
    if (s.k === "opt") return unify(d.t, s.t) ? "ok" : "type";
    return unify(d.t, s) ? "ok" : "type";
  }
  if (d.k === "var") {
    if (s.k === "none") {
      d.ref = opt(fresh());
      return "ok";
    }
    return unify(d, s) ? "ok" : "type";
  }
  if (s.k === "none") return "nothing";
  if (s.k === "opt") return unify(d, s.t) ? "maybe" : "type";
  return unify(d, s) ? "ok" : "type";
}

/** Toglie il «?»: il tipo del valore quando non è niente. */
export function unopt(t: Type): Type {
  const r = resolve(t);
  return r.k === "opt" ? r.t : r;
}

// ------------------------------------------------------------------ variabili e annotazioni

export type BindingKind = "local" | "global" | "param" | "const" | "field" | "prop" | "blockField" | "loop" | "host" | "catch";

export interface Binding {
  id: number;
  name: string;
  jsName: string;
  kind: BindingKind;
  type: Type;
  mode?: A.ParamMode;
  decl: Span;
  /** La funzione in cui è stata creata (undefined = programma principale). */
  fn?: FnInfo;
  /** Il ciclo «per ogni cambia»: l'elemento si può cambiare. */
  mutable?: boolean;
  /** Variabile creata in tutti i rami di un se: il generatore usa questa al posto dell'originale. */
  alias?: Binding;
  /** Proprietà di un blocco: fattore di conversione dall'unità dell'Inspector. */
  unitFactor?: { factor: number; tile: number };
  /** Nome dell'engine (oggetto, corpo…): JavaScript pronto. */
  hostJs?: string;
  hostNames?: { it: string; en: string };
  /** È dichiarata a livello del programma (anche se `kind` è "const"). */
  global?: boolean;
  /** Quanti cicli la contengono (serve a capire gli spostamenti dentro i cicli). */
  loopDepth?: number;
  /** Campo di un tipo (o di un blocco). */
  field?: FieldInfo;
}

export const real = (b: Binding): Binding => {
  let x = b;
  while (x.alias) x = x.alias;
  return x;
};

export type MemberInfo =
  | { k: "field"; rec: RecordInfo; field: FieldInfo }
  | { k: "enum"; en: EnumInfo; member: string }
  | { k: "builtin"; id: string }
  | { k: "host"; m: HostMember }
  | { k: "fnValue"; fn: FnInfo }
  | { k: "const"; js: string }
  | { k: "any" };

export type CallInfo =
  | { k: "fn"; fn: FnInfo; args: (A.Expr | undefined)[]; recv?: A.Expr }
  | { k: "ctor"; rec: RecordInfo; args: (A.Expr | undefined)[] }
  | { k: "builtin"; id: string; args: A.Expr[]; recv?: A.Expr; recvType?: Type; extra?: unknown }
  | { k: "host"; m: HostMethod; recv: A.Expr; args: (A.Expr | undefined)[] }
  | { k: "value"; args: A.Expr[] }
  | { k: "any"; args: A.Expr[] };

export type OpInfo =
  | "num"
  | "concat"
  | "listConcat"
  | "eqPrim"
  | "eqDeep"
  | "cmpNum"
  | "cmpText"
  | "bool"
  | "inList"
  | "inMap"
  | "inText"
  | "dyn";

/**
 * La libreria di base: funzioni (scrivi, casuale…) e metodi di testi, liste e mappe,
 * con i loro nomi in italiano e in inglese, il controllo dei tipi e il JavaScript da generare.
 */
import type { Expr } from "./ast";
import type { MsgArg } from "./messages";
import { ANY, BOOL, fresh, list, NUM, num, opt, resolve, TEXT, VOID, type Dims, type Type, dimsScale, unify } from "./types";
import type { Lang } from "./words";

export interface BCtx {
  lang: Lang;
  recv?: Type;
  args: Type[];
  nodes: Expr[];
  /** Controlla che l'argomento i vada bene come `t` (e segnala l'errore se no). */
  arg(i: number, t: Type): boolean;
  /** L'argomento i deve essere un numero; restituisce le sue unità. */
  numArg(i: number): Dims | undefined;
  /** Due argomenti numerici devono avere la stessa grandezza. */
  sameUnits(i: number, j: number, verb: MsgArg): void;
  error(key: string, args: MsgArg[], i?: number): void;
}

export interface BGen {
  recv: string;
  args: string[];
  /** Gli elementi del contenitore hanno un «quando finisce». */
  dropEl: boolean;
  lang: Lang;
}

export interface Builtin {
  id: string;
  it: string[];
  en: string[];
  min: number;
  max: number;
  /** Si scrive senza parentesi: lista.lunghezza */
  prop?: boolean;
  /** Cambia il contenitore su cui si chiama. */
  mutates?: boolean;
  /** Argomenti che la funzione tiene per sé (vanno copiati se letti da un posto). */
  takes?: number[];
  /** Serve una capacità dell'ambiente (input, file…). */
  needs?: "input" | "files" | "args";
  /** Tipo atteso per un argomento, prima di controllarlo (per le funzioni veloci x => …). */
  expect?: (i: number, recv: Type | undefined) => Type | undefined;
  check: (c: BCtx) => Type;
  js: (g: BGen) => string;
}

const fnT = (params: Type[], ret: Type): Type => ({ k: "fn", params, ret });

const elOf = (t: Type | undefined): Type => {
  const r = t ? resolve(t) : ANY;
  return r.k === "list" ? r.el : r.k === "map" ? r.key : ANY;
};

const numLike = (c: BCtx, i: number) => c.numArg(i);

// ------------------------------------------------------------------ funzioni

const B = (b: Builtin) => b;

export const FUNCTIONS: Builtin[] = [
  B({ id: "print", it: ["scrivi"], en: ["print"], min: 0, max: Infinity, check: () => VOID, js: (g) => `$.print(${g.args.join(", ")})` }),
  B({ id: "text", it: ["testo"], en: ["text"], min: 1, max: 1, check: () => TEXT, js: (g) => `$.str(${g.args[0]})` }),
  B({
    id: "number",
    it: ["numero"],
    en: ["number"],
    min: 1,
    max: 1,
    check: (c) => {
      const r = resolve(c.args[0]);
      if (r.k !== "num") c.arg(0, TEXT);
      return NUM;
    },
    js: (g) => `$.num(${g.args[0]})`,
  }),
  B({
    id: "int",
    it: ["intero"],
    en: ["int"],
    min: 1,
    max: 1,
    check: (c) => {
      const r = resolve(c.args[0]);
      if (r.k === "num") return num(r.dims);
      c.arg(0, TEXT);
      return NUM;
    },
    js: (g) => `$.int(${g.args[0]})`,
  }),
  B({
    id: "round",
    it: ["arrotonda"],
    en: ["round"],
    min: 1,
    max: 2,
    check: (c) => {
      if (c.args.length > 1) c.arg(1, NUM);
      return num(numLike(c, 0));
    },
    js: (g) => `$.round(${g.args.join(", ")})`,
  }),
  B({ id: "floor", it: ["arrotonda_giu", "arrotonda_giù"], en: ["floor"], min: 1, max: 1, check: (c) => num(numLike(c, 0)), js: (g) => `$.floor(${g.args[0]})` }),
  B({ id: "ceil", it: ["arrotonda_su"], en: ["ceil"], min: 1, max: 1, check: (c) => num(numLike(c, 0)), js: (g) => `$.ceil(${g.args[0]})` }),
  B({ id: "abs", it: ["assoluto"], en: ["abs"], min: 1, max: 1, check: (c) => num(numLike(c, 0)), js: (g) => `$.abs(${g.args[0]})` }),
  B({
    id: "sqrt",
    it: ["radice"],
    en: ["sqrt"],
    min: 1,
    max: 1,
    check: (c) => {
      const d = numLike(c, 0);
      const half: Dims = {};
      let ok = !!d;
      for (const [k, v] of Object.entries(d ?? {})) {
        if (v % 2) ok = false;
        else half[k as keyof Dims] = v / 2;
      }
      return num(ok ? half : undefined);
    },
    js: (g) => `$.sqrt(${g.args[0]})`,
  }),
  ...(["min", "max"] as const).map((id) =>
    B({
      id,
      it: [id],
      en: [id],
      min: 1,
      max: Infinity,
      check: (c) => {
        if (c.args.length === 1) {
          const r = resolve(c.args[0]);
          if (r.k === "list") {
            c.arg(0, list(NUM));
            return NUM;
          }
        }
        const d = numLike(c, 0);
        for (let i = 1; i < c.args.length; i++) {
          numLike(c, i);
          c.sameUnits(0, i, (l) => (l === "it" ? "confrontare" : "compare"));
        }
        return num(d);
      },
      js: (g) => `$.${id}(${g.args.join(", ")})`,
    }),
  ),
  B({
    id: "clamp",
    it: ["limita"],
    en: ["clamp"],
    min: 3,
    max: 3,
    check: (c) => {
      const d = numLike(c, 0);
      numLike(c, 1);
      numLike(c, 2);
      c.sameUnits(0, 1, (l) => (l === "it" ? "confrontare" : "compare"));
      c.sameUnits(0, 2, (l) => (l === "it" ? "confrontare" : "compare"));
      return num(d);
    },
    js: (g) => `$.clamp(${g.args.join(", ")})`,
  }),
  B({
    id: "lerp",
    it: ["interpola"],
    en: ["lerp"],
    min: 3,
    max: 3,
    check: (c) => {
      const d = numLike(c, 0);
      numLike(c, 1);
      numLike(c, 2);
      c.sameUnits(0, 1, (l) => (l === "it" ? "mescolare" : "mix"));
      return num(d);
    },
    js: (g) => `$.lerp(${g.args.join(", ")})`,
  }),
  B({
    id: "approach",
    it: ["avvicina"],
    en: ["approach"],
    min: 3,
    max: 3,
    check: (c) => {
      const d = numLike(c, 0);
      numLike(c, 1);
      numLike(c, 2);
      c.sameUnits(0, 1, (l) => (l === "it" ? "avvicinare" : "approach"));
      c.sameUnits(0, 2, (l) => (l === "it" ? "avvicinare" : "approach"));
      return num(d);
    },
    js: (g) => `$.approach(${g.args.join(", ")})`,
  }),
  B({ id: "sign", it: ["segno"], en: ["sign"], min: 1, max: 1, check: (c) => (numLike(c, 0), NUM), js: (g) => `$.sign(${g.args[0]})` }),
  ...(
    [
      ["sin", "sen", "sin"],
      ["cos", "cos", "cos"],
      ["tan", "tan", "tan"],
    ] as const
  ).map(([id, it, en]) => B({ id, it: [it], en: [en], min: 1, max: 1, check: (c) => (numLike(c, 0), NUM), js: (g) => `$.${id}(${g.args[0]})` })),
  ...(
    [
      ["asin", "asen", "asin"],
      ["acos", "acos", "acos"],
    ] as const
  ).map(([id, it, en]) => B({ id, it: [it], en: [en], min: 1, max: 1, check: (c) => (numLike(c, 0), num({ deg: 1 })), js: (g) => `$.${id}(${g.args[0]})` })),
  B({
    id: "atan2",
    it: ["atan2", "angolo"],
    en: ["atan2", "angle"],
    min: 2,
    max: 2,
    check: (c) => {
      numLike(c, 0);
      numLike(c, 1);
      c.sameUnits(0, 1, (l) => (l === "it" ? "confrontare" : "compare"));
      return num({ deg: 1 });
    },
    js: (g) => `$.atan2(${g.args.join(", ")})`,
  }),
  B({
    id: "random",
    it: ["casuale"],
    en: ["random"],
    min: 0,
    max: 2,
    check: (c) => {
      if (c.args.length === 1) c.error("type.argCountRange", [c.lang === "it" ? "casuale" : "random", 0, 2, 1]);
      if (c.args.length === 2) {
        const d = numLike(c, 0);
        numLike(c, 1);
        c.sameUnits(0, 1, (l) => (l === "it" ? "scegliere tra" : "pick between"));
        return num(d);
      }
      return NUM;
    },
    js: (g) => `$.random(${g.args.join(", ")})`,
  }),
  B({
    id: "len",
    it: ["lunghezza"],
    en: ["len"],
    min: 1,
    max: 1,
    check: (c) => {
      const r = resolve(c.args[0]);
      if (r.k !== "list" && r.k !== "text" && r.k !== "map" && r.k !== "any" && r.k !== "err") c.arg(0, list(ANY));
      return NUM;
    },
    js: (g) => `$.len(${g.args[0]})`,
  }),
  B({ id: "time", it: ["tempo"], en: ["time"], min: 0, max: 0, check: () => num({ s: 1 }), js: () => `$.time()` }),
  B({
    id: "range",
    it: ["intervallo"],
    en: ["range"],
    min: 2,
    max: 3,
    check: (c) => {
      const d = numLike(c, 0);
      numLike(c, 1);
      if (c.args.length > 2) numLike(c, 2);
      c.sameUnits(0, 1, (l) => (l === "it" ? "usare insieme" : "use together"));
      return list(num(d));
    },
    js: (g) => `$.range(${g.args.join(", ")})`,
  }),
  B({
    id: "distance",
    it: ["distanza"],
    en: ["distance"],
    min: 4,
    max: 4,
    check: (c) => {
      const d = numLike(c, 0);
      for (let i = 1; i < 4; i++) {
        numLike(c, i);
        c.sameUnits(0, i, (l) => (l === "it" ? "usare insieme" : "use together"));
      }
      return num(d);
    },
    js: (g) => `$.distance(${g.args.join(", ")})`,
  }),
  B({ id: "ask", it: ["chiedi"], en: ["ask"], min: 0, max: 1, needs: "input", check: (c) => (c.args.length && c.arg(0, TEXT), TEXT), js: (g) => `$.ask(${g.args.join(", ")})` }),
  B({ id: "askNumber", it: ["chiedi_numero"], en: ["ask_number"], min: 0, max: 1, needs: "input", check: (c) => (c.args.length && c.arg(0, TEXT), NUM), js: (g) => `$.askNumber(${g.args.join(", ")})` }),
  B({ id: "readFile", it: ["leggi_file"], en: ["read_file"], min: 1, max: 1, needs: "files", check: (c) => (c.arg(0, TEXT), TEXT), js: (g) => `$.readFile(${g.args[0]})` }),
  B({ id: "writeFile", it: ["scrivi_file"], en: ["write_file"], min: 2, max: 2, needs: "files", check: (c) => (c.arg(0, TEXT), c.arg(1, TEXT), VOID), js: (g) => `$.writeFile(${g.args.join(", ")})` }),
  B({ id: "appendFile", it: ["aggiungi_al_file"], en: ["append_file"], min: 2, max: 2, needs: "files", check: (c) => (c.arg(0, TEXT), c.arg(1, TEXT), VOID), js: (g) => `$.appendFile(${g.args.join(", ")})` }),
  B({ id: "fileExists", it: ["esiste_file"], en: ["file_exists"], min: 1, max: 1, needs: "files", check: (c) => (c.arg(0, TEXT), BOOL), js: (g) => `$.fileExists(${g.args[0]})` }),
  B({ id: "args", it: ["argomenti"], en: ["args"], min: 0, max: 0, needs: "args", check: () => list(TEXT), js: () => `$.args()` }),
];

/** Valori già pronti. */
export const CONSTANTS: { it: string[]; en: string[]; type: Type; js: string }[] = [
  { it: ["PI"], en: ["PI"], type: NUM, js: "Math.PI" },
  { it: ["INFINITO"], en: ["INFINITY"], type: NUM, js: "Infinity" },
];

// ------------------------------------------------------------------ metodi

const sortable = (c: BCtx, el: Type) => {
  const r = resolve(el);
  if (r.k !== "num" && r.k !== "text" && r.k !== "any" && r.k !== "err" && r.k !== "var") c.error("type.sortable", []);
};

const textArg = (c: BCtx, i: number) => c.arg(i, TEXT);

export const TEXT_METHODS: Builtin[] = [
  B({ id: "t.length", it: ["lunghezza"], en: ["length"], min: 0, max: 0, prop: true, check: () => NUM, js: (g) => `${g.recv}.length` }),
  B({ id: "t.empty", it: ["vuoto", "vuota"], en: ["empty"], min: 0, max: 0, prop: true, check: () => BOOL, js: (g) => `(${g.recv}.length === 0)` }),
  B({ id: "t.upper", it: ["maiuscolo"], en: ["upper"], min: 0, max: 0, check: () => TEXT, js: (g) => `${g.recv}.toUpperCase()` }),
  B({ id: "t.lower", it: ["minuscolo"], en: ["lower"], min: 0, max: 0, check: () => TEXT, js: (g) => `${g.recv}.toLowerCase()` }),
  B({ id: "t.trim", it: ["pulisci"], en: ["trim"], min: 0, max: 0, check: () => TEXT, js: (g) => `${g.recv}.trim()` }),
  B({ id: "t.contains", it: ["contiene"], en: ["contains"], min: 1, max: 1, check: (c) => (textArg(c, 0), BOOL), js: (g) => `${g.recv}.includes(${g.args[0]})` }),
  B({ id: "t.starts", it: ["inizia_con"], en: ["starts_with"], min: 1, max: 1, check: (c) => (textArg(c, 0), BOOL), js: (g) => `${g.recv}.startsWith(${g.args[0]})` }),
  B({ id: "t.ends", it: ["finisce_con"], en: ["ends_with"], min: 1, max: 1, check: (c) => (textArg(c, 0), BOOL), js: (g) => `${g.recv}.endsWith(${g.args[0]})` }),
  B({ id: "t.split", it: ["dividi"], en: ["split"], min: 0, max: 1, check: (c) => (c.args.length && textArg(c, 0), list(TEXT)), js: (g) => `$.split(${[g.recv, ...g.args].join(", ")})` }),
  B({ id: "t.replace", it: ["sostituisci"], en: ["replace"], min: 2, max: 2, check: (c) => (textArg(c, 0), textArg(c, 1), TEXT), js: (g) => `${g.recv}.split(${g.args[0]}).join(${g.args[1]})` }),
  B({ id: "t.slice", it: ["parte"], en: ["slice"], min: 1, max: 2, check: (c) => (c.arg(0, NUM), c.args.length > 1 && c.arg(1, NUM), TEXT), js: (g) => `$.slice(${[g.recv, ...g.args].join(", ")})` }),
  B({ id: "t.indexOf", it: ["posizione"], en: ["index_of"], min: 1, max: 1, check: (c) => (textArg(c, 0), opt(NUM)), js: (g) => `$.textIndex(${g.recv}, ${g.args[0]})` }),
  B({ id: "t.repeat", it: ["ripeti"], en: ["repeat"], min: 1, max: 1, check: (c) => (c.arg(0, NUM), TEXT), js: (g) => `$.repeatText(${g.recv}, ${g.args[0]})` }),
  B({ id: "t.chars", it: ["lettere"], en: ["chars"], min: 0, max: 0, check: () => list(TEXT), js: (g) => `Array.from(${g.recv})` }),
];

const pred = (el: Type) => fnT([el], BOOL);

export const LIST_METHODS: Builtin[] = [
  B({ id: "l.length", it: ["lunghezza"], en: ["length"], min: 0, max: 0, prop: true, check: () => NUM, js: (g) => `${g.recv}.length` }),
  B({ id: "l.empty", it: ["vuota", "vuoto"], en: ["empty"], min: 0, max: 0, prop: true, check: () => BOOL, js: (g) => `(${g.recv}.length === 0)` }),
  B({
    id: "l.add",
    it: ["aggiungi"],
    en: ["add"],
    min: 1,
    max: 1,
    mutates: true,
    takes: [0],
    expect: (_i, r) => elOf(r),
    check: (c) => (c.arg(0, elOf(c.recv)), VOID),
    js: (g) => `${g.recv}.push(${g.args[0]})`,
  }),
  B({
    id: "l.insert",
    it: ["inserisci"],
    en: ["insert"],
    min: 2,
    max: 2,
    mutates: true,
    takes: [1],
    expect: (i, r) => (i === 1 ? elOf(r) : NUM),
    check: (c) => (c.arg(0, NUM), c.arg(1, elOf(c.recv)), VOID),
    js: (g) => `$.insert(${g.recv}, ${g.args.join(", ")})`,
  }),
  B({ id: "l.removeAt", it: ["togli"], en: ["remove_at"], min: 1, max: 1, mutates: true, check: (c) => (c.arg(0, NUM), elOf(c.recv)), js: (g) => `$.removeAt(${g.recv}, ${g.args[0]})` }),
  B({ id: "l.pop", it: ["togli_ultimo"], en: ["pop"], min: 0, max: 0, mutates: true, check: (c) => elOf(c.recv), js: (g) => `$.pop(${g.recv})` }),
  B({ id: "l.shift", it: ["togli_primo"], en: ["pop_first"], min: 0, max: 0, mutates: true, check: (c) => elOf(c.recv), js: (g) => `$.shift(${g.recv})` }),
  B({
    id: "l.remove",
    it: ["rimuovi"],
    en: ["remove"],
    min: 1,
    max: 1,
    mutates: true,
    expect: (_i, r) => elOf(r),
    check: (c) => (c.arg(0, elOf(c.recv)), BOOL),
    js: (g) => `$.removeValue(${g.recv}, ${g.args[0]}, ${g.dropEl})`,
  }),
  B({
    id: "l.removeIf",
    it: ["togli_se"],
    en: ["remove_if"],
    min: 1,
    max: 1,
    mutates: true,
    expect: (_i, r) => pred(elOf(r)),
    check: (c) => (c.arg(0, pred(elOf(c.recv))), NUM),
    js: (g) => `$.removeIf(${g.recv}, ${g.args[0]}, ${g.dropEl})`,
  }),
  B({ id: "l.contains", it: ["contiene"], en: ["contains"], min: 1, max: 1, expect: (_i, r) => elOf(r), check: (c) => (c.arg(0, elOf(c.recv)), BOOL), js: (g) => `$.contains(${g.recv}, ${g.args[0]})` }),
  B({ id: "l.indexOf", it: ["posizione"], en: ["index_of"], min: 1, max: 1, expect: (_i, r) => elOf(r), check: (c) => (c.arg(0, elOf(c.recv)), opt(NUM)), js: (g) => `$.indexOf(${g.recv}, ${g.args[0]})` }),
  B({ id: "l.clear", it: ["svuota"], en: ["clear"], min: 0, max: 0, mutates: true, check: () => VOID, js: (g) => `$.clear(${g.recv}, ${g.dropEl})` }),
  B({ id: "l.sort", it: ["ordina"], en: ["sort"], min: 0, max: 0, mutates: true, check: (c) => (sortable(c, elOf(c.recv)), VOID), js: (g) => `$.sort(${g.recv})` }),
  B({
    id: "l.sortBy",
    it: ["ordina_per"],
    en: ["sort_by"],
    min: 1,
    max: 1,
    mutates: true,
    expect: (_i, r) => fnT([elOf(r)], fresh()),
    check: (c) => {
      const key = fresh();
      c.arg(0, fnT([elOf(c.recv)], key));
      sortable(c, key);
      return VOID;
    },
    js: (g) => `$.sortBy(${g.recv}, ${g.args[0]})`,
  }),
  B({ id: "l.reverse", it: ["inverti"], en: ["reverse"], min: 0, max: 0, mutates: true, check: () => VOID, js: (g) => `${g.recv}.reverse()` }),
  B({ id: "l.shuffle", it: ["mescola"], en: ["shuffle"], min: 0, max: 0, mutates: true, check: () => VOID, js: (g) => `$.shuffle(${g.recv})` }),
  B({
    id: "l.filter",
    it: ["filtra"],
    en: ["filter"],
    min: 1,
    max: 1,
    expect: (_i, r) => pred(elOf(r)),
    check: (c) => (c.arg(0, pred(elOf(c.recv))), list(elOf(c.recv))),
    js: (g) => `$.filter(${g.recv}, ${g.args[0]})`,
  }),
  B({
    id: "l.map",
    it: ["trasforma"],
    en: ["map"],
    min: 1,
    max: 1,
    expect: (_i, r) => fnT([elOf(r)], fresh()),
    check: (c) => {
      const out = fresh();
      c.arg(0, fnT([elOf(c.recv)], out));
      return list(out);
    },
    js: (g) => `$.mapList(${g.recv}, ${g.args[0]})`,
  }),
  B({ id: "l.find", it: ["trova"], en: ["find"], min: 1, max: 1, expect: (_i, r) => pred(elOf(r)), check: (c) => (c.arg(0, pred(elOf(c.recv))), opt(elOf(c.recv))), js: (g) => `$.find(${g.recv}, ${g.args[0]})` }),
  B({ id: "l.all", it: ["tutti"], en: ["all"], min: 1, max: 1, expect: (_i, r) => pred(elOf(r)), check: (c) => (c.arg(0, pred(elOf(c.recv))), BOOL), js: (g) => `${g.recv}.every((x) => ${g.args[0]}(x))` }),
  B({ id: "l.any", it: ["qualcuno"], en: ["any"], min: 1, max: 1, expect: (_i, r) => pred(elOf(r)), check: (c) => (c.arg(0, pred(elOf(c.recv))), BOOL), js: (g) => `${g.recv}.some((x) => ${g.args[0]}(x))` }),
  B({ id: "l.count", it: ["conta"], en: ["count"], min: 1, max: 1, expect: (_i, r) => elOf(r), check: (c) => (c.arg(0, elOf(c.recv)), NUM), js: (g) => `$.count(${g.recv}, ${g.args[0]})` }),
  B({ id: "l.countIf", it: ["conta_se"], en: ["count_if"], min: 1, max: 1, expect: (_i, r) => pred(elOf(r)), check: (c) => (c.arg(0, pred(elOf(c.recv))), NUM), js: (g) => `${g.recv}.filter((x) => ${g.args[0]}(x)).length` }),
  B({
    id: "l.sum",
    it: ["somma"],
    en: ["sum"],
    min: 0,
    max: 0,
    check: (c) => {
      const el = resolve(elOf(c.recv));
      if (el.k === "var") unify(el, NUM);
      else if (el.k !== "num" && el.k !== "any" && el.k !== "err") c.error("type.numberList", []);
      return el.k === "num" ? num(el.dims) : NUM;
    },
    js: (g) => `$.sum(${g.recv})`,
  }),
  ...(
    [
      ["l.min", "minimo", "min", "$.minOf"],
      ["l.max", "massimo", "max", "$.maxOf"],
    ] as const
  ).map(([id, it, en, fn]) =>
    B({ id, it: [it], en: [en], min: 0, max: 0, check: (c) => (sortable(c, elOf(c.recv)), opt(elOf(c.recv))), js: (g) => `${fn}(${g.recv})` }),
  ),
  B({ id: "l.first", it: ["primo"], en: ["first"], min: 0, max: 0, check: (c) => opt(elOf(c.recv)), js: (g) => `$.first(${g.recv})` }),
  B({ id: "l.last", it: ["ultimo"], en: ["last"], min: 0, max: 0, check: (c) => opt(elOf(c.recv)), js: (g) => `$.last(${g.recv})` }),
  B({ id: "l.pick", it: ["a_caso"], en: ["pick"], min: 0, max: 0, check: (c) => opt(elOf(c.recv)), js: (g) => `$.pick(${g.recv})` }),
  B({ id: "l.join", it: ["unisci"], en: ["join"], min: 0, max: 1, check: (c) => (c.args.length && textArg(c, 0), TEXT), js: (g) => `$.join(${[g.recv, ...g.args].join(", ")})` }),
  B({ id: "l.slice", it: ["parte"], en: ["slice"], min: 1, max: 2, check: (c) => (c.arg(0, NUM), c.args.length > 1 && c.arg(1, NUM), list(elOf(c.recv))), js: (g) => `$.slice(${[g.recv, ...g.args].join(", ")})` }),
  B({ id: "l.copy", it: ["copia"], en: ["copy"], min: 0, max: 0, check: (c) => list(elOf(c.recv)), js: (g) => `$.copy(${g.recv})` }),
];

const valOf = (t: Type | undefined): Type => {
  const r = t ? resolve(t) : ANY;
  return r.k === "map" ? r.val : ANY;
};

export const MAP_METHODS: Builtin[] = [
  B({ id: "m.length", it: ["lunghezza"], en: ["length"], min: 0, max: 0, prop: true, check: () => NUM, js: (g) => `${g.recv}.size` }),
  B({ id: "m.empty", it: ["vuota", "vuoto"], en: ["empty"], min: 0, max: 0, prop: true, check: () => BOOL, js: (g) => `(${g.recv}.size === 0)` }),
  B({ id: "m.has", it: ["contiene"], en: ["has", "contains"], min: 1, max: 1, expect: (_i, r) => elOf(r), check: (c) => (c.arg(0, elOf(c.recv)), BOOL), js: (g) => `${g.recv}.has(${g.args[0]})` }),
  B({
    id: "m.get",
    it: ["prendi"],
    en: ["get"],
    min: 1,
    max: 2,
    expect: (i, r) => (i === 0 ? elOf(r) : valOf(r)),
    check: (c) => {
      c.arg(0, elOf(c.recv));
      if (c.args.length > 1) {
        c.arg(1, valOf(c.recv));
        return valOf(c.recv);
      }
      return opt(valOf(c.recv));
    },
    js: (g) => `$.mapGet(${[g.recv, ...g.args].join(", ")})`,
  }),
  B({ id: "m.remove", it: ["togli"], en: ["remove"], min: 1, max: 1, mutates: true, expect: (_i, r) => elOf(r), check: (c) => (c.arg(0, elOf(c.recv)), opt(valOf(c.recv))), js: (g) => `$.mapRemove(${g.recv}, ${g.args[0]})` }),
  B({ id: "m.keys", it: ["chiavi"], en: ["keys"], min: 0, max: 0, check: (c) => list(elOf(c.recv)), js: (g) => `[...${g.recv}.keys()]` }),
  B({ id: "m.values", it: ["valori"], en: ["values"], min: 0, max: 0, check: (c) => list(valOf(c.recv)), js: (g) => `$.copy([...${g.recv}.values()])` }),
  B({ id: "m.clear", it: ["svuota"], en: ["clear"], min: 0, max: 0, mutates: true, check: () => VOID, js: (g) => `$.clear(${g.recv}, ${g.dropEl})` }),
  B({ id: "m.copy", it: ["copia"], en: ["copy"], min: 0, max: 0, check: (c) => c.recv ?? ANY, js: (g) => `$.copy(${g.recv})` }),
];

const index = (list: Builtin[]) => {
  const m = new Map<string, Builtin>();
  for (const b of list) for (const n of [...b.it, ...b.en]) if (!m.has(n)) m.set(n, b);
  return m;
};

export const FUNCTION_BY_NAME = index(FUNCTIONS);
export const TEXT_BY_NAME = index(TEXT_METHODS);
export const LIST_BY_NAME = index(LIST_METHODS);
export const MAP_BY_NAME = index(MAP_METHODS);
export const BUILTIN_BY_ID = new Map<string, Builtin>([...FUNCTIONS, ...TEXT_METHODS, ...LIST_METHODS, ...MAP_METHODS].map((b) => [b.id, b]));

/** Il nome di una funzione o di un metodo nella lingua scelta. */
export const builtinName = (b: Builtin, lang: Lang) => (lang === "it" ? b.it[0] : b.en[0]);

/** Tutti i nomi (per i suggerimenti «forse volevi dire…» e per i colori dell'editor). */
export const ALL_FUNCTION_NAMES = [...FUNCTION_BY_NAME.keys(), ...CONSTANTS.flatMap((c) => [...c.it, ...c.en])];

export { dimsScale };

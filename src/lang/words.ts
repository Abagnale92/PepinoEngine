/**
 * Le parole di Pepino Language in italiano e in inglese.
 * Un programma può usare l'una o l'altra lingua (anche mescolate): il significato è lo stesso,
 * e `translate` riscrive un programma da una lingua all'altra.
 */

export type Lang = "it" | "en";

export interface WordInfo {
  it: string[];
  en: string[];
  /** Parola riservata: non si può usare come nome. Le altre valgono solo in certi punti. */
  reserved?: boolean;
}

const w = (it: string | string[], en: string | string[], reserved = false): WordInfo => ({
  it: Array.isArray(it) ? it : [it],
  en: Array.isArray(en) ? en : [en],
  reserved,
});

/** Una parola italiana che capiscono tutti: uguale nelle due lingue, in minuscolo, con l'iniziale maiuscola o tutta maiuscola. */
const italian = (x: string): WordInfo => {
  const forms = [x, x.charAt(0).toUpperCase() + x.slice(1), x.toUpperCase()];
  return { it: forms, en: [...forms] };
};

export const WORDS = {
  // ---------------------------------------------------------------- riservate
  if: w("se", "if", true),
  else: w("altrimenti", "else", true),
  while: w("mentre", "while", true),
  repeat: w("ripeti", "repeat", true),
  for: w("per", "for", true),
  each: w("ogni", "each", true),
  in: w("in", "in", true),
  function: w("funzione", "function", true),
  return: w("ritorna", "return", true),
  not: w("non", "not", true),
  and: w([], "and", true),
  or: w([], "or", true),
  true: w("vero", "true", true),
  false: w("falso", "false", true),
  nothing: w("niente", "nothing", true),
  move: w("sposta", "move", true),
  change: w("cambia", "change", true),
  take: w("prendi", "take", true),
  break: w("interrompi", "break", true),
  continue: w("continua", "continue", true),
  pass: w("passa", "pass", true),
  const: w("costante", "const", true),
  check: w("controlla", "check", true),
  try: w("tenta", "try", true),
  fail: w("fallisci", "fail", true),
  wait: w("aspetta", "wait", true),
  match: w("scegli", "match", true),
  case: w("caso", "case", true),
  this: w("questo", "this", true),
  // ---------------------------------------------------------------- valide solo in certi punti
  andIt: w("e", []),
  orIt: w("o", []),
  times: w("volte", "times"),
  from: w("da", "from"),
  to: w("a", "to"),
  step: w("passo", "step"),
  until: w(["finché", "finche"], "until"),
  of: w("di", "of"),
  error: w("errore", "error"),
  type: w("tipo", "type"),
  choice: w("scelta", "choice"),
  test: w("prova", "test"),
  use: w("usa", "use"),
  block: w("blocco", "block"),
  when: w("quando", "on"),
  property: w(["proprietà", "proprieta"], "property"),
  event: w("evento", "event"),
  action: w("azione", "action"),
  condition: w("condizione", "condition"),
  state: w("stato", "state"),
  emit: w("emetti", "emit"),
  requires: w("richiede", "requires"),
  description: w("descrizione", "description"),
  category: w("categoria", "category"),
  priority: w(["priorità", "priorita"], "priority"),
  group: w("gruppo", "group"),
  help: w("aiuto", "help"),
  // gli agganci (quando …)
  hStart: w("inizia", "start"),
  hUpdate: w("aggiorna", "update"),
  hPhysics: w("fisica", "physics"),
  hLate: w("dopo", "late"),
  hEnd: w("finisce", "end"),
  hTouch: w("tocca", "touch"),
  hEvent: w("evento", "event"),
  hCreate: w("crea", "create"),
  // i nomi dei tipi composti (Lista di …, Mappa di … a …)
  tList: w("Lista", "List"),
  tMap: w("Mappa", "Map"),
  // le parole italiane di tutti: uguali in italiano e in inglese
  mamma: italian("mamma"),
  mia: italian("mia"),
  pizza: italian("pizza"),
  spaghetti: italian("spaghetti"),
  bravo: italian("bravo"),
  cappuccino: italian("cappuccino"),
} satisfies Record<string, WordInfo>;

/** Le parole italiane di tutti (mamma mia!, pizza, spaghetti, bravo, cappuccino). */
export const ITALIAN_WORDS: WordId[] = ["mamma", "mia", "pizza", "spaghetti", "bravo", "cappuccino"];

export type WordId = keyof typeof WORDS;

/** Parola scritta → id, solo per le riservate. */
export const RESERVED = new Map<string, { id: WordId; lang: Lang | "both" }>();
for (const [id, info] of Object.entries(WORDS) as [WordId, WordInfo][]) {
  if (!info.reserved) continue;
  for (const x of info.it) RESERVED.set(x, { id, lang: info.en.includes(x) ? "both" : "it" });
  for (const x of info.en) if (!RESERVED.has(x)) RESERVED.set(x, { id, lang: "en" });
}

export const isWordText = (text: string, id: WordId): boolean => {
  const i = WORDS[id] as WordInfo;
  return i.it.includes(text) || i.en.includes(text);
};

/** La parola nella lingua scelta (la prima forma). */
export function word(id: WordId, lang: Lang): string {
  const i = WORDS[id] as WordInfo;
  return (lang === "it" ? i.it[0] : i.en[0]) ?? i.en[0] ?? i.it[0];
}

// ---------------------------------------------------------------- tipi di base

export const TYPE_NAMES = {
  num: w("Numero", "Number"),
  text: w("Testo", "Text"),
  bool: w(["SiNo", "Booleano"], ["YesNo", "Bool"]),
  list: w("Lista", "List"),
  map: w("Mappa", "Map"),
  any: w("Qualsiasi", "Any"),
} satisfies Record<string, WordInfo>;

export type BaseTypeId = keyof typeof TYPE_NAMES;

export function baseTypeOf(name: string): BaseTypeId | undefined {
  for (const [id, info] of Object.entries(TYPE_NAMES) as [BaseTypeId, WordInfo][]) {
    if (info.it.includes(name) || info.en.includes(name)) return id;
  }
  return undefined;
}

// ---------------------------------------------------------------- unità di misura

/** Le tre grandezze: tempo (s), lunghezza (px), angolo (°). */
export type Dim = "s" | "px" | "deg";

export interface UnitAtom {
  dim: Dim;
  /** Moltiplicatore verso l'unità di base (s, px, °). */
  factor: number;
  /** Vale "tile": il fattore vero dipende dal progetto (quanti px è un tile). */
  tile?: boolean;
}

export const UNITS: Record<string, UnitAtom> = {
  s: { dim: "s", factor: 1 },
  secondo: { dim: "s", factor: 1 },
  secondi: { dim: "s", factor: 1 },
  second: { dim: "s", factor: 1 },
  seconds: { dim: "s", factor: 1 },
  ms: { dim: "s", factor: 0.001 },
  min: { dim: "s", factor: 60 },
  minuto: { dim: "s", factor: 60 },
  minuti: { dim: "s", factor: 60 },
  minute: { dim: "s", factor: 60 },
  minutes: { dim: "s", factor: 60 },
  px: { dim: "px", factor: 1 },
  pixel: { dim: "px", factor: 1 },
  tile: { dim: "px", factor: 1, tile: true },
  "°": { dim: "deg", factor: 1 },
  grado: { dim: "deg", factor: 1 },
  gradi: { dim: "deg", factor: 1 },
  deg: { dim: "deg", factor: 1 },
  degrees: { dim: "deg", factor: 1 },
  rad: { dim: "deg", factor: 180 / Math.PI },
};

// ---------------------------------------------------------------- utilità

/** Distanza di Levenshtein, per i «forse volevi dire…». */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) return 0.5;
  const prev = Array.from({ length: bl.length + 1 }, (_, i) => i);
  for (let i = 1; i <= al.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= bl.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (al[i - 1] === bl[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[bl.length];
}

/** Il nome più simile, se è abbastanza simile. */
export function closest(name: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const c of candidates) {
    if (c === name || c.startsWith("$")) continue;
    const d = editDistance(name, c);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  const limit = name.length <= 3 ? 1 : name.length <= 6 ? 2 : 3;
  return bestD <= limit ? best : undefined;
}

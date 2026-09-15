import { EN, EN_PATTERNS } from "./en";

/**
 * Lingua dell'editor. La chiave di ogni traduzione è il testo italiano stesso (come per le traduzioni
 * dei giochi): nel codice si scrive T("Salva") e in inglese diventa "Save". I messaggi con parti variabili
 * ("La scena «Livello 1» non esiste.") si traducono con i modelli di EN_PATTERNS ("La scena {0} non esiste.").
 */

export type EditorLang = "it" | "en";

let lang: EditorLang = "it";

export const getEditorLang = () => lang;

export function setEditorLang(l: EditorLang): void {
  lang = l;
  if (typeof document !== "undefined") document.documentElement.lang = l;
}

interface Pattern {
  re: RegExp;
  en: string;
  /** Numero del segnaposto per ogni gruppo catturato, nell'ordine in cui compaiono nel testo italiano. */
  order: number[];
}

let compiled: Pattern[] | null = null;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function patterns(): Pattern[] {
  compiled ??= EN_PATTERNS.map(([it, en]) => ({
    re: new RegExp(`^${escape(it).replace(/\\\{(\d+)\\\}/g, "([\\s\\S]*?)")}$`),
    en,
    order: [...it.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1])),
  }));
  return compiled;
}

/**
 * Parte variabile di un messaggio: resta com'è (nomi scelti da chi crea il gioco), salvo testi dell'editor noti,
 * anche tra «» o scritti con l'iniziale minuscola («scegli oggetto»).
 */
function translatePart(v: string): string {
  const quoted = /^«([\s\S]*)»$/.exec(v);
  const core = quoted ? quoted[1] : v;
  let out = EN[core];
  if (out === undefined && core) {
    const cap = EN[core[0].toUpperCase() + core.slice(1)];
    if (cap !== undefined) out = core[0] === core[0].toLowerCase() ? cap[0].toLowerCase() + cap.slice(1) : cap;
  }
  if (out === undefined) return v;
  return quoted ? `«${out}»` : out;
}

/** Traduzione inglese di un testo italiano (senza spazi ai bordi), o undefined se non c'è. */
export function lookupEnglish(core: string): string | undefined {
  const exact = EN[core];
  if (exact !== undefined) return exact;
  for (const p of patterns()) {
    const m = p.re.exec(core);
    if (!m) continue;
    const values: string[] = [];
    p.order.forEach((n, i) => (values[n] = m[i + 1]));
    return p.en.replace(/\{(\d+)\}/g, (_, n: string) => translatePart(values[Number(n)] ?? ""));
  }
  return undefined;
}

/**
 * Testo dell'interfaccia nella lingua dell'editor. Gli spazi ai bordi restano (servono tra i pezzi di una frase);
 * `args` riempiono i segnaposto {0}, {1}… dopo la traduzione.
 */
export function T(text: string, ...args: (string | number)[]): string {
  let s = text;
  if (lang !== "it" && text) {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
    const out = m[2] ? lookupEnglish(m[2]) : undefined;
    if (out !== undefined) s = m[1] + out + m[3];
  }
  return args.length ? s.replace(/\{(\d+)\}/g, (all, n: string) => (args[Number(n)] !== undefined ? String(args[Number(n)]) : all)) : s;
}

/** Segna un testo da tradurre più tardi con T (costanti fuori dai componenti): non lo traduce subito. */
export const N = (text: string) => text;

/** «Dove» di un messaggio del controllo del progetto: pezzi separati da › tradotti uno per uno. */
export const Twhere = (where: string) =>
  where
    .split(" › ")
    .map((p) => T(p))
    .join(" › ");

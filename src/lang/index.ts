/**
 * Pepino Language: un linguaggio facile (parole in italiano o in inglese) con la memoria gestita
 * come il C++ (valori, spostamenti, prestiti, distruzione immediata) e unità di misura nei numeri.
 *
 * - `compile(sorgente)` → controlla il programma e lo traduce in JavaScript;
 * - `run(sorgente)` → lo esegue subito (comodo per le prove e per chi usa Pepino fuori dall'engine);
 * - `translate(sorgente, "en")` → lo stesso programma con le parole dell'altra lingua.
 */
import type { Program, Stmt } from "./ast";
import { check, type CheckResult } from "./checker";
import { FILE_BASE, generate } from "./codegen";
import { NO_HOST, type HostSpec } from "./host";
import { tokenize } from "./lexer";
import { makeDiag, renderDiagnostics, type Diagnostic } from "./messages";
import { parse } from "./parser";
import { makeRuntime, PepinoRuntimeError, type Runtime, type RuntimeOptions } from "./runtime";
import { word, WORDS, type Lang, type WordId } from "./words";

export type { Diagnostic } from "./messages";
export type { HostSpec, BlockHost, HostName, HostPropType, Capability } from "./host";
export type { Lang } from "./words";
export type { Runtime, RuntimeOptions } from "./runtime";
export type { HostTypeInfo, HostMember, HostMethod, Type } from "./types";
export { CLI_HOST, NO_HOST } from "./host";
export { makeRuntime, PepinoRuntimeError, PepinoFail } from "./runtime";
export { WORDS, TYPE_NAMES, UNITS, ITALIAN_WORDS } from "./words";
export { FUNCTIONS, TEXT_METHODS, LIST_METHODS, MAP_METHODS, CONSTANTS } from "./stdlib";
export * as T from "./types";

export interface CompileOptions {
  /** L'ambiente: il comando pepino, l'engine… (predefinito: nessuno, solo il linguaggio). */
  host?: HostSpec;
  /** Lingua dei messaggi (predefinito: quella in cui è scritto il programma). */
  lang?: Lang;
  /** Nome del file (per i messaggi). */
  fileName?: string;
  /**
   * Per «usa "altro.pep"»: dato il percorso scritto e il file che lo usa, restituisce nome e testo del file
   * (o niente se non esiste). Senza questa funzione «usa» non è permesso.
   */
  resolveUse?: (path: string, from: string) => { name: string; source: string } | undefined;
}

export interface CompileResult {
  ok: boolean;
  /** Errori e avvisi, dal primo all'ultimo. */
  diagnostics: Diagnostic[];
  /** Lingua in cui è scritto il programma. */
  lang: Lang;
  /** JavaScript generato (se non ci sono errori). */
  code?: string;
  /** Riga del programma Pepino per ogni riga del JavaScript generato (da 1). */
  lineMap?: number[];
  program?: Program;
  check?: CheckResult;
  /** I file del programma: il primo è quello principale, gli altri sono quelli letti con «usa». */
  files: string[];
}

const byPos = (a: Diagnostic, b: Diagnostic) => a.pos - b.pos || (a.severity === "error" ? -1 : 1);

/** Legge i file indicati da «usa» e aggiunge le loro dichiarazioni (funzioni, tipi, scelte, costanti) al programma. */
function includeUses(program: Program, from: string, files: string[], diags: Diagnostic[], resolve: CompileOptions["resolveUse"]): void {
  const extra: Stmt[] = [];
  const visit = (prog: Program, file: string) => {
    prog.body = prog.body.filter((s) => {
      if (s.k !== "use") return true;
      const r = resolve?.(s.path, file);
      if (!r) {
        diags.push(makeDiag("error", resolve ? "flow.useMissing" : "flow.useOutsideCli", [s.path], s));
        return false;
      }
      if (files.includes(r.name)) return false;
      const k = files.push(r.name) - 1;
      const sub = parse(r.source, k * FILE_BASE);
      diags.push(...sub.diagnostics);
      visit(sub.program, r.name);
      extra.push(...sub.program.body.filter((x) => x.k === "func" || x.k === "type" || x.k === "enum" || x.k === "const"));
      return false;
    });
  };
  visit(program, from);
  program.body = [...extra, ...program.body];
}

export function compile(source: string, opts: CompileOptions = {}): CompileResult {
  const parsed = parse(source);
  const files = [opts.fileName ?? "programma"];
  const lang = opts.lang ?? parsed.lang;
  const early = [...parsed.diagnostics];
  if (parsed.program.body.some((s) => s.k === "use")) includeUses(parsed.program, files[0], files, early, opts.resolveUse);
  const withFiles = (list: Diagnostic[]) => {
    for (const d of list) d.file = files[Math.floor(d.pos / FILE_BASE)] ?? files[0];
    return list;
  };
  if (early.some((d) => d.severity === "error")) {
    return { ok: false, diagnostics: withFiles(renderDiagnostics(early.sort(byPos), lang)), lang: parsed.lang, program: parsed.program, files };
  }
  const checked = check(parsed.program, lang, opts.host ?? NO_HOST);
  const diagnostics = withFiles(renderDiagnostics([...early, ...checked.diagnostics].sort(byPos), lang));
  if (diagnostics.some((d) => d.severity === "error")) return { ok: false, diagnostics, lang: parsed.lang, program: parsed.program, check: checked, files };
  const gen = generate(checked, parsed.program, parsed.lang);
  return { ok: true, diagnostics, lang: parsed.lang, code: gen.code, lineMap: gen.lineMap, program: parsed.program, check: checked, files };
}

/** Riga e file di un numero della mappa delle righe (i file letti con «usa» hanno un milione per file). */
export function splitLine(n: number | undefined, files: string[]): { line?: number; file?: string } {
  if (!n) return {};
  return { line: n % 1e6, file: files[Math.floor(n / 1e6)] };
}

/** Il modulo generato: si esegue con `$` (runtime) e `$host` (ambiente). */
export interface PepinoModule {
  main: () => unknown;
  routine: boolean;
  dropGlobals: () => void;
  tests: { name: string; fn: () => unknown; routine: boolean }[];
}

/** Righe che `new Function` aggiunge prima del codice. */
const HEADER_LINES = 2;

export function loadModule(code: string, $: Runtime, host: unknown, name = "programma"): PepinoModule {
  const fn = new Function("$", "$host", `${code}\n//# sourceURL=pepino/${name.replace(/[^\w.-]/g, "_")}`);
  return fn($, host) as PepinoModule;
}

/** La riga Pepino dove è successo un errore a programma avviato. */
export function errorLine(err: unknown, lineMap: number[] | undefined, name = "programma"): number | undefined {
  if (!lineMap || !(err instanceof Error)) return undefined;
  const safe = name.replace(/[^\w.-]/g, "_").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`pepino/${safe}:(\\d+):(\\d+)`).exec(err.stack ?? "");
  if (!m) return undefined;
  return lineMap[Number(m[1]) - HEADER_LINES - 1] || undefined;
}

/**
 * Esegue una funzione che può aspettare (un generatore): `sleep` fa passare il tempo.
 * Nel comando pepino l'attesa è vera; nelle prove automatiche il tempo passa subito.
 */
export function drive(result: unknown, $: Runtime, sleep: (seconds: number) => void): unknown {
  const isGen = !!result && typeof (result as Generator).next === "function" && typeof (result as Generator).throw === "function";
  if (!isGen && !$.tasks.length) return result;
  // Il programma (se aspetta) e i cappuccini ordinati: vanno avanti insieme, in ordine di tempo.
  const tasks = $.tasks;
  let value = isGen ? undefined : result;
  if (isGen) tasks.unshift({ gen: result as Generator<unknown, unknown, unknown>, wake: $.clock, seq: -1, main: true });
  try {
    while (tasks.length) {
      const ready = tasks.filter((t) => (t.until ? t.until() : t.wake <= $.clock + 1e-9)).sort((a, b) => a.wake - b.wake || a.seq - b.seq);
      if (!ready.length) {
        // Nessuno è pronto: passa il tempo fino al primo che si sveglia (a fotogrammi, se qualcuno aspetta una condizione).
        const timed = tasks.filter((t) => !t.until);
        const next = timed.length ? Math.min(...timed.map((t) => t.wake)) : Infinity;
        const dt = tasks.some((t) => t.until) ? Math.min(1 / 60, next - $.clock) : next - $.clock;
        sleep(dt);
        $.clock += dt;
        continue;
      }
      for (const t of ready) {
        $.resetLoop();
        const step = t.gen.next();
        if (step.done) {
          tasks.splice(tasks.indexOf(t), 1);
          if (t.main) value = step.value;
          continue;
        }
        const v = step.value;
        if (typeof v === "function") t.until = v as () => boolean;
        else {
          t.until = undefined;
          t.wake = $.clock + (typeof v === "number" ? Math.max(0, v) : 0);
        }
      }
    }
  } catch (e) {
    // Un errore ferma tutto: le sequenze ancora in attesa chiudono i loro valori.
    for (const t of tasks.splice(0)) {
      try {
        t.gen.return(undefined);
      } catch {
        // già in errore: conta il primo
      }
    }
    throw e;
  }
  return value;
}

export interface RunOptions extends CompileOptions, Omit<RuntimeOptions, "lang"> {
  /** Come passa il tempo di «aspetta» (predefinito: subito). */
  sleep?: (seconds: number) => void;
  /** Esegue anche le prove («prova "…":»). */
  tests?: boolean;
  name?: string;
}

export interface RunResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  /** Quello che il programma ha scritto con `scrivi` (se non c'era un `print` scelto da fuori). */
  output: string[];
  /** L'errore a programma avviato, con la riga. */
  error?: { message: string; line?: number; file?: string };
  tests?: { name: string; ok: boolean; message?: string; line?: number; file?: string }[];
  compiled: CompileResult;
}

/** Compila ed esegue un programma (fuori dall'engine). */
export function run(source: string, opts: RunOptions = {}): RunResult {
  const compiled = compile(source, opts);
  const output: string[] = [];
  const res: RunResult = { ok: compiled.ok, diagnostics: compiled.diagnostics, output, compiled };
  if (!compiled.ok || !compiled.code) return res;
  const $ = makeRuntime({ ...opts, lang: compiled.lang, print: opts.print ?? ((t) => output.push(t)) });
  const sleep = opts.sleep ?? (() => undefined);
  const name = opts.name ?? "programma";
  let mod: PepinoModule;
  let loaded: PepinoModule | undefined;
  try {
    mod = loaded = loadModule(compiled.code, $, {}, name);
    drive(mod.main(), $, sleep);
  } catch (e) {
    // Anche dopo un errore (pure «mamma mia!») i valori del programma si distruggono.
    try {
      loaded?.dropGlobals();
    } catch {
      // conta il primo errore
    }
    res.ok = false;
    res.error = { message: describeError(e, compiled.lang), ...splitLine(errorLine(e, compiled.lineMap, name), compiled.files) };
    return res;
  }
  if (opts.tests) {
    res.tests = [];
    for (const t of mod.tests) {
      try {
        drive(t.fn(), $, sleep);
        res.tests.push({ name: t.name, ok: true });
      } catch (e) {
        res.tests.push({ name: t.name, ok: false, message: describeError(e, compiled.lang), ...splitLine(errorLine(e, compiled.lineMap, name), compiled.files) });
      }
    }
  }
  try {
    mod.dropGlobals();
  } catch (e) {
    res.ok = false;
    res.error = { message: describeError(e, compiled.lang), ...splitLine(errorLine(e, compiled.lineMap, name), compiled.files) };
  }
  return res;
}

export function describeError(e: unknown, lang: Lang): string {
  if (e instanceof PepinoRuntimeError) return e.message;
  if (e instanceof RangeError && /call stack/i.test(e.message)) {
    return lang === "it" ? "La funzione chiama sé stessa troppe volte (forse non si ferma mai)." : "The function calls itself too many times (maybe it never stops).";
  }
  return e instanceof Error ? e.message : String(e);
}

// ------------------------------------------------------------------ traduzione

/** Parole «e»/«o» dell'italiano ↔ «and»/«or» dell'inglese. */
const PAIRS: Partial<Record<WordId, WordId>> = { andIt: "and", orIt: "or", and: "andIt", or: "orIt" };

/**
 * Riscrive il programma con le parole dell'altra lingua (parole chiave, funzioni e tipi predefiniti,
 * nomi dell'engine). I nomi scelti da chi programma, i commenti e i testi restano come sono.
 */
export function translate(source: string, to: Lang, host: HostSpec = NO_HOST): string {
  const edits: { pos: number; end: number; text: string }[] = [];
  const lex = tokenize(source);
  lex.tokens.forEach((t, i) => {
    if (t.t !== "kw" || !t.kw) return;
    // Dopo il punto è il nome di un metodo (lista.prendi): lo traduce il controllo dei nomi.
    const before = lex.tokens[i - 1];
    if (before?.t === "op" && before.v === ".") return;
    const id = (to === "it" && (t.kw === "and" || t.kw === "or") ? PAIRS[t.kw] : t.kw) as WordId;
    const text = word(id, to);
    if (text && text !== t.v) edits.push({ pos: t.pos, end: t.end, text });
  });
  const parsed = parse(source);
  const src = source.replace(/\r\n?/g, "\n");
  for (const w of parsed.words) {
    const id = to === "en" && (w.id === "andIt" || w.id === "orIt") ? PAIRS[w.id]! : w.id;
    // Una parola già giusta nell'altra lingua resta com'è (mamma mia!, pizza… e le forme come «finche»).
    if ((WORDS[id] as { it: string[]; en: string[] })[to].includes(src.slice(w.pos, w.end))) continue;
    const text = word(id, to);
    if (text) edits.push({ pos: w.pos, end: w.end, text });
  }
  if (!parsed.diagnostics.some((d) => d.severity === "error")) {
    const checked = check(parsed.program, to, host);
    for (const n of checked.names ?? []) edits.push({ pos: n.pos, end: n.end, text: to === "it" ? n.it : n.en });
  }
  // Nello stesso punto vince l'ultima: i nomi riconosciuti dal controllo (un passo di spaghetti come «prendi» è un metodo, non la parola chiave).
  const byPos = new Map<number, { pos: number; end: number; text: string }>();
  for (const e of edits) byPos.set(e.pos, e);
  const sorted = [...byPos.values()].sort((a, b) => a.pos - b.pos);
  let out = "";
  let at = 0;
  for (const e of sorted) {
    if (e.pos < at) continue;
    out += src.slice(at, e.pos) + e.text;
    at = e.end;
  }
  return out + src.slice(at);
}

/** In che lingua è scritto un programma. */
export function detectLang(source: string): Lang {
  return parse(source).lang;
}

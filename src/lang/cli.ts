/**
 * Il comando `pepino`: usa Pepino Language fuori dall'engine.
 *
 *   pepino esegui gioco.pep        (run)       esegue il programma
 *   pepino controlla gioco.pep     (check)     cerca gli errori senza eseguire
 *   pepino prova gioco.pep         (test)      esegue le prove («prova "…":»)
 *   pepino traduci gioco.pep en    (translate) riscrive il programma in inglese (o «it»)
 *   pepino js gioco.pep                        mostra il JavaScript generato
 *   pepino nuovo ciao.pep          (new)       crea un primo programma
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { CLI_HOST, compile, describeError, detectLang, drive, errorLine, loadModule, makeRuntime, splitLine, translate, type CompileResult, type Diagnostic, type Lang } from "./index";

export interface CliIO {
  out(text: string): void;
  /** Scrive senza andare a capo (le domande di «chiedi»). */
  prompt(text: string): void;
  err(text: string): void;
  readFile(file: string): string;
  writeFile(file: string, text: string): void;
  appendFile(file: string, text: string): void;
  exists(file: string): boolean;
  /** Legge una riga dalla tastiera (null = fine dell'input). */
  readLine(): string | null;
  sleep(seconds: number): void;
  cwd: string;
}

const VERSION = "0.1.0";

const COMMANDS: Record<string, string> = {
  esegui: "run",
  run: "run",
  controlla: "check",
  check: "check",
  prova: "test",
  prove: "test",
  test: "test",
  traduci: "translate",
  translate: "translate",
  js: "js",
  nuovo: "new",
  new: "new",
  versione: "version",
  version: "version",
  "--version": "version",
  aiuto: "help",
  help: "help",
  "--help": "help",
};

function systemLang(): Lang {
  const env = process.env.LANG || process.env.LC_ALL || Intl.DateTimeFormat().resolvedOptions().locale || "it";
  return env.toLowerCase().startsWith("it") ? "it" : "en";
}

function help(lang: Lang): string {
  return lang === "it"
    ? `Pepino Language ${VERSION}

Come si usa:
  pepino esegui programma.pep     esegue il programma
  pepino controlla programma.pep  cerca gli errori senza eseguire
  pepino prova programma.pep      esegue le prove («prova "…":»)
  pepino traduci programma.pep en riscrive il programma con le parole inglesi (o «it»)
  pepino js programma.pep         mostra il JavaScript generato
  pepino nuovo ciao.pep           crea un primo programma da provare

Si può scrivere anche in inglese: run, check, test, translate, new.`
    : `Pepino Language ${VERSION}

Usage:
  pepino run program.pep          runs the program
  pepino check program.pep        looks for errors without running
  pepino test program.pep         runs the tests ("test "…":")
  pepino translate program.pep it rewrites the program with Italian words (or "en")
  pepino js program.pep           shows the generated JavaScript
  pepino new hello.pep            creates a first program to try

Italian works too: esegui, controlla, prova, traduci, nuovo.`;
}

const FIRST: Record<Lang, string> = {
  it: `# Il mio primo programma in Pepino
nome = chiedi("Come ti chiami? ")
scrivi("Ciao, {nome}!")

ripeti 3 volte:
    scrivi("Pepino!")

per ogni frutto in ["mela", "pera", "kiwi"]:
    scrivi("Mi piace la {frutto}")

funzione doppio(n):
    ritorna n * 2

scrivi(doppio(21))

prova "il doppio":
    controlla doppio(2) = 4
`,
  en: `# My first Pepino program
name = ask("What's your name? ")
print("Hi, {name}!")

repeat 3 times:
    print("Pepino!")

for each fruit in ["apple", "pear", "kiwi"]:
    print("I like the {fruit}")

function double(n):
    return n * 2

print(double(21))

test "double":
    check double(2) = 4
`,
};

/** Un errore con la riga del programma sotto, e le frecce ^^^ dove c'è il problema. */
export function formatDiagnostic(d: Diagnostic, sources: Map<string, string>, lang: Lang): string {
  const file = d.file ?? "";
  const src = sources.get(file) ?? "";
  const lineText = src.replace(/\r\n?/g, "\n").split("\n")[d.line - 1] ?? "";
  const kind = d.severity === "error" ? (lang === "it" ? "Errore" : "Error") : lang === "it" ? "Attenzione" : "Warning";
  const where = lang === "it" ? `alla riga ${d.line} di ${file}` : `on line ${d.line} of ${file}`;
  const num = String(d.line);
  const len = Math.max(1, Math.min(d.end - d.pos, lineText.length - d.col + 1));
  return [
    `${kind} ${where}:`,
    `  ${num} | ${lineText}`,
    `  ${" ".repeat(num.length)} | ${" ".repeat(Math.max(0, d.col - 1))}${"^".repeat(len)}`,
    `  ${d.message}`,
  ].join("\n");
}

function compileFile(file: string, io: CliIO, lang?: Lang): { res: CompileResult; sources: Map<string, string> } {
  const sources = new Map<string, string>();
  const full = path.resolve(io.cwd, file);
  const source = io.readFile(full);
  const name = path.basename(full);
  sources.set(name, source);
  const res = compile(source, {
    host: CLI_HOST,
    lang,
    fileName: name,
    resolveUse: (p, from) => {
      const base = path.dirname(from === name ? full : path.resolve(path.dirname(full), from));
      let target = path.resolve(base, p);
      if (!io.exists(target) && !target.endsWith(".pep")) target += ".pep";
      if (!io.exists(target)) return undefined;
      const text = io.readFile(target);
      const rel = path.relative(path.dirname(full), target) || path.basename(target);
      sources.set(rel, text);
      return { name: rel, source: text };
    },
  });
  return { res, sources };
}

/** Esegue il comando; restituisce il codice di uscita (0 = tutto bene). */
export function main(argv: string[], io: CliIO): number {
  const [cmdWord, file, ...rest] = argv;
  const cmd = cmdWord ? COMMANDS[cmdWord] : "help";
  let lang: Lang = cmdWord && ["run", "check", "test", "translate", "new", "help", "version"].includes(cmdWord) ? "en" : systemLang();
  if (cmdWord && ["esegui", "controlla", "prova", "prove", "traduci", "nuovo", "aiuto", "versione"].includes(cmdWord)) lang = "it";
  if (!cmd) {
    io.err(lang === "it" ? `Non conosco il comando «${cmdWord}».\n\n${help(lang)}` : `Unknown command "${cmdWord}".\n\n${help(lang)}`);
    return 2;
  }
  if (cmd === "help") {
    io.out(help(lang));
    return 0;
  }
  if (cmd === "version") {
    io.out(`Pepino Language ${VERSION}`);
    return 0;
  }
  if (!file) {
    io.err(lang === "it" ? "Manca il nome del file .pep." : "The .pep file name is missing.");
    return 2;
  }
  const full = path.resolve(io.cwd, file);
  if (cmd === "new") {
    if (io.exists(full)) {
      io.err(lang === "it" ? `Il file ${file} esiste già.` : `The file ${file} already exists.`);
      return 1;
    }
    const l: Lang = rest[0] === "en" || rest[0] === "it" ? rest[0] : lang;
    io.writeFile(full, FIRST[l]);
    io.out(l === "it" ? `Creato ${file}. Provalo con: pepino esegui ${file}` : `Created ${file}. Try it with: pepino run ${file}`);
    return 0;
  }
  if (!io.exists(full)) {
    io.err(lang === "it" ? `Non trovo il file ${file}.` : `I can't find the file ${file}.`);
    return 1;
  }
  const source = io.readFile(full);
  // I messaggi nella lingua in cui è scritto il programma.
  lang = detectLang(source);
  if (cmd === "translate") {
    const to = rest[0] === "it" || rest[0] === "en" ? rest[0] : lang === "it" ? "en" : "it";
    const out = translate(source, to, CLI_HOST);
    const dest = rest[1] ? path.resolve(io.cwd, rest[1]) : undefined;
    if (dest) {
      io.writeFile(dest, out);
      io.out(to === "it" ? `Tradotto in italiano: ${rest[1]}` : `Translated to English: ${rest[1]}`);
    } else io.out(out);
    return 0;
  }
  const { res, sources } = compileFile(file, io);
  for (const d of res.diagnostics) (d.severity === "error" ? io.err : io.out)(formatDiagnostic(d, sources, lang) + "\n");
  if (!res.ok || !res.code) {
    const n = res.diagnostics.filter((d) => d.severity === "error").length;
    io.err(lang === "it" ? `${n === 1 ? "C'è un errore" : `Ci sono ${n} errori`}: il programma non parte.` : `${n === 1 ? "There is 1 error" : `There are ${n} errors`}: the program doesn't start.`);
    return 1;
  }
  if (cmd === "check") {
    io.out(lang === "it" ? "Nessun errore. 👍" : "No errors. 👍");
    return 0;
  }
  if (cmd === "js") {
    io.out(res.code);
    return 0;
  }
  const $ = makeRuntime({
    lang,
    print: (t) => io.out(t),
    ask: (q) => {
      if (q) io.prompt(q);
      return io.readLine();
    },
    files: {
      read: (n) => io.readFile(path.resolve(path.dirname(full), n)),
      write: (n, t) => io.writeFile(path.resolve(path.dirname(full), n), t),
      append: (n, t) => io.appendFile(path.resolve(path.dirname(full), n), t),
      exists: (n) => io.exists(path.resolve(path.dirname(full), n)),
    },
    args: rest,
  });
  const name = path.basename(full);
  const fail = (e: unknown): number => {
    const where = splitLine(errorLine(e, res.lineMap, name), res.files);
    const msg = describeError(e, lang);
    if (where.line) {
      const text = (sources.get(where.file ?? name) ?? "").replace(/\r\n?/g, "\n").split("\n")[where.line - 1] ?? "";
      io.err(`${lang === "it" ? `Il programma si è fermato alla riga ${where.line} di ${where.file}` : `The program stopped on line ${where.line} of ${where.file}`}:\n  ${where.line} | ${text.trim()}\n  ${msg}`);
    } else io.err(msg);
    return 1;
  };
  let mod;
  try {
    mod = loadModule(res.code, $, {}, name);
    if (cmd === "run") drive(mod.main(), $, io.sleep);
    else {
      // Le prove: prima il programma (senza scrivere niente), poi ogni prova.
      const print = io.out;
      io.out = () => undefined;
      try {
        drive(mod.main(), $, () => undefined);
      } finally {
        io.out = print;
      }
    }
  } catch (e) {
    // Anche dopo un errore (pure «mamma mia!») i valori del programma si distruggono: i loro «quando finisce» partono.
    try {
      mod?.dropGlobals();
    } catch {
      // conta il primo errore
    }
    return fail(e);
  }
  if (cmd === "test") {
    let failed = 0;
    for (const t of mod.tests) {
      try {
        drive(t.fn(), $, () => undefined);
        io.out(`✔ ${t.name}`);
      } catch (e) {
        failed++;
        const where = splitLine(errorLine(e, res.lineMap, name), res.files);
        io.out(`✘ ${t.name}${where.line ? (lang === "it" ? ` (riga ${where.line})` : ` (line ${where.line})`) : ""}: ${describeError(e, lang)}`);
      }
    }
    const n = mod.tests.length;
    if (!n) io.out(lang === "it" ? "Il programma non ha prove: scrivile con «prova \"nome\":»." : 'The program has no tests: write them with test "name":');
    else io.out(lang === "it" ? `${n - failed} prove riuscite su ${n}.` : `${n - failed} of ${n} tests passed.`);
    try {
      mod.dropGlobals();
    } catch (e) {
      return fail(e);
    }
    return failed ? 1 : 0;
  }
  try {
    mod.dropGlobals();
  } catch (e) {
    return fail(e);
  }
  return 0;
}

// ------------------------------------------------------------------ Node

/** Legge una riga dalla tastiera, anche in modo sincrono (per «chiedi»). */
function readLineSync(): string | null {
  const buf = Buffer.alloc(1);
  const bytes: number[] = [];
  for (;;) {
    let n = 0;
    try {
      n = fs.readSync(0, buf, 0, 1, null);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EAGAIN") continue;
      if ((e as NodeJS.ErrnoException).code === "EOF") n = 0;
      else throw e;
    }
    if (n === 0) return bytes.length ? Buffer.from(bytes).toString("utf8") : null;
    if (buf[0] === 10) break;
    if (buf[0] !== 13) bytes.push(buf[0]);
  }
  return Buffer.from(bytes).toString("utf8");
}

export function nodeIO(): CliIO {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  return {
    out: (t) => process.stdout.write(t + "\n"),
    prompt: (t) => process.stdout.write(t),
    err: (t) => process.stderr.write(t + "\n"),
    readFile: (f) => fs.readFileSync(f, "utf8"),
    writeFile: (f, t) => fs.writeFileSync(f, t, "utf8"),
    appendFile: (f, t) => fs.appendFileSync(f, t, "utf8"),
    exists: (f) => fs.existsSync(f),
    readLine: readLineSync,
    sleep: (s) => {
      if (s > 0) Atomics.wait(shared, 0, 0, Math.round(s * 1000));
    },
    cwd: process.cwd(),
  };
}

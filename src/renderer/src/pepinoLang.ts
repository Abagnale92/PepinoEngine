/**
 * Pepino Language nell'editor di codice: colori, rientro automatico dopo i due punti, suggerimenti
 * mentre si scrive ed errori sottolineati (con i messaggi del compilatore).
 */
import { EditorState, type Extension } from "@codemirror/state";
import { indentService, StreamLanguage, type StringStream } from "@codemirror/language";
import { linter, type Diagnostic } from "@codemirror/lint";
import { compilePepino, ENGINE_HOST } from "@runtime";
import { CONSTANTS, FUNCTIONS, ITALIAN_WORDS, LIST_METHODS, MAP_METHODS, TEXT_METHODS, TYPE_NAMES, UNITS, WORDS } from "../../lang";
import { getEditorLang } from "./i18n";

type Words = { it: string[]; en: string[]; reserved?: boolean };
const all = (w: Words) => [...w.it, ...w.en];

const RESERVED = new Set(Object.values(WORDS as Record<string, Words>).filter((w) => w.reserved).flatMap(all));
/** Parole che contano come parole chiave solo all'inizio della riga (tipo, blocco, quando…). */
const LEADING = new Set(
  ["type", "choice", "test", "use", "block", "when", "property", "event", "action", "condition", "state", "emit", "requires", "description", "category", "priority"].flatMap((k) =>
    all((WORDS as Record<string, Words>)[k]),
  ),
);
const INLINE = new Set(["times", "from", "to", "step", "until", "of", "error", "andIt", "orIt"].flatMap((k) => all((WORDS as Record<string, Words>)[k])));
const ATOMS = new Set(["true", "false", "nothing"].flatMap((k) => all((WORDS as Record<string, Words>)[k])));
const SELF = new Set(all((WORDS as Record<string, Words>).this));
/** Le parole italiane di tutti (mamma mia!, pizza, spaghetti, bravo, cappuccino), in ogni forma. */
const ITALIAN = new Set(ITALIAN_WORDS.flatMap((k) => all((WORDS as Record<string, Words>)[k])));

/** La parola italiana qui è una parola chiave? (`rest` = il resto della riga dopo la parola) */
function italianKeyword(w: string, rest: string, lineStart: boolean): boolean {
  const code = rest.replace(/#.*$/, "").trimEnd();
  switch (w.toLowerCase()) {
    case "mamma":
      return /^\s+mia\s*!/i.test(rest);
    case "mia":
      return /^\s*!/.test(rest);
    case "pizza":
      return /^\s+[\p{L}[]/u.test(rest) && code.endsWith(":");
    case "spaghetti":
      return /^\s+[\p{L}\d"'([{]/u.test(rest) && code.endsWith(":");
    case "bravo":
      return lineStart && /^\s*:\s*(#.*)?$/.test(rest);
    case "cappuccino":
      return lineStart && /^(\s*:|\s+[^=:])/.test(rest) && code.endsWith(":");
    default:
      return false;
  }
}
const BUILTINS = new Set([...FUNCTIONS.flatMap((f) => [...f.it, ...f.en]), ...CONSTANTS.flatMap((c) => [...c.it, ...c.en])]);
const HOST_NAMES = new Set(ENGINE_HOST.block!.names.flatMap((n) => [n.it, n.en]).concat(["dt"]));
const TYPES = new Set([
  ...Object.values(TYPE_NAMES as Record<string, Words>).flatMap(all),
  ...ENGINE_HOST.types.flatMap((t) => [t.it, t.en]),
  ...ENGINE_HOST.block!.propTypes.flatMap((t) => [t.it, t.en]),
]);

interface State {
  afterDot: boolean;
  afterNumber: boolean;
  lineStart: boolean;
  /** Dopo «mamma mia»: il punto esclamativo fa parte della parola. */
  bang: boolean;
}

const pepinoStream = StreamLanguage.define<State>({
  name: "pepino",
  startState: () => ({ afterDot: false, afterNumber: false, lineStart: true, bang: false }),
  token(stream: StringStream, state: State): string | null {
    if (stream.sol()) state.lineStart = true;
    if (stream.eatSpace()) return null;
    const lineStart = state.lineStart;
    state.lineStart = false;
    const afterDot = state.afterDot;
    const afterNumber = state.afterNumber;
    const bang = state.bang;
    state.afterDot = false;
    state.afterNumber = false;
    state.bang = false;
    const ch = stream.peek();
    if (bang && ch === "!") {
      stream.next();
      return "keyword.special";
    }
    if (ch === "#") {
      stream.skipToEnd();
      return "comment";
    }
    if (ch === '"' || ch === "'") {
      stream.next();
      let esc = false;
      for (;;) {
        const c = stream.next();
        if (c === undefined) break;
        if (!esc && c === ch) break;
        esc = !esc && c === "\\";
      }
      return "string";
    }
    if (stream.match(/^\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?/)) {
      state.afterNumber = true;
      return "number";
    }
    if (stream.match("°")) return "unit";
    const word = stream.match(/^[\p{L}_][\p{L}\p{N}_]*/u) as RegExpMatchArray | null;
    if (word) {
      const w = word[0];
      if (afterDot) return stream.peek() === "(" ? "propertyName.function" : "propertyName";
      if (afterNumber && w in UNITS) return "unit";
      if (ITALIAN.has(w) && italianKeyword(w, stream.string.slice(stream.pos), lineStart)) {
        if (w.toLowerCase() === "mia") state.bang = true;
        return "keyword.special";
      }
      if (ATOMS.has(w)) return "atom";
      if (SELF.has(w)) return "self";
      if (RESERVED.has(w)) return "keyword";
      if (lineStart && LEADING.has(w)) return "keyword";
      if (INLINE.has(w) && !/^\s*[=(.]/.test(stream.string.slice(stream.pos))) return "keyword";
      if (TYPES.has(w) || /^\p{Lu}/u.test(w)) return "typeName";
      if (stream.peek() === "(") return BUILTINS.has(w) ? "variableName.function.standard" : "variableName.function";
      if (HOST_NAMES.has(w)) return "variableName.special";
      return "variableName";
    }
    if (stream.match(/^(->|=>|==|!=|<=|>=|\+=|-=|\*=|\/=|%=|\^=|[-+*/%^<>=≠≤≥])/)) return "operator";
    const c = stream.next();
    if (c === ".") state.afterDot = true;
    return "punctuation";
  },
  languageData: { commentTokens: { line: "#" }, closeBrackets: { brackets: ["(", "[", "{", '"', "'"] } },
});

/** Dopo una riga che finisce con i due punti si va a capo più a destra, come in Python. */
const pepinoIndent = indentService.of((cx, pos) => {
  const line = cx.state.doc.lineAt(pos);
  if (line.number === 1) return 0;
  let prev = cx.state.doc.line(line.number - 1);
  while (prev.number > 1 && !prev.text.trim()) prev = cx.state.doc.line(prev.number - 1);
  const base = /^\s*/.exec(prev.text)![0].replace(/\t/g, "    ").length;
  const code = prev.text.replace(/#.*$/, "").trimEnd();
  if (code.endsWith(":")) return base + cx.unit;
  if (/^\s*(ritorna|return|interrompi|break|continua|continue|fallisci|fail|passa|pass)\b/.test(code) || /^\s*mamma\s+mia\s*!/i.test(code)) return Math.max(0, base - cx.unit);
  return base;
});

function lintPepino(view: { state: EditorState }): Diagnostic[] {
  const text = view.state.doc.toString();
  const res = compilePepino(text, getEditorLang());
  const len = view.state.doc.length;
  return res.diagnostics.map((d) => {
    const from = Math.min(Math.max(0, d.pos), len);
    return { from, to: Math.min(Math.max(from, d.end), len), severity: d.severity === "error" ? "error" : "warning", message: d.message };
  });
}

// ------------------------------------------------------------------ suggerimenti

interface Completion {
  label: string;
  type?: string;
  detail?: string;
  boost?: number;
}

interface CompletionCtx {
  state: EditorState;
  pos: number;
  explicit: boolean;
  matchBefore(re: RegExp): { from: number; to: number; text: string } | null;
}

function words(lang: "it" | "en") {
  const pick = (w: Words) => (lang === "it" ? w.it : w.en);
  // Le parole italiane una volta sola, in minuscolo (non in tutte le forme).
  const italian = new Set<string>(ITALIAN_WORDS);
  const keywords = [
    ...Object.entries(WORDS as Record<string, Words>)
      .filter(([k]) => !italian.has(k))
      .flatMap(([, w]) => pick(w)),
    "mamma mia!",
    "pizza",
    "spaghetti",
    "bravo",
    "cappuccino",
  ];
  const fns = FUNCTIONS.map((f) => (lang === "it" ? f.it[0] : f.en[0]));
  const methods = [...TEXT_METHODS, ...LIST_METHODS, ...MAP_METHODS].map((m) => (lang === "it" ? m.it[0] : m.en[0]));
  const host = ENGINE_HOST.block!.names.map((n) => (lang === "it" ? n.it : n.en));
  const members = ENGINE_HOST.types.flatMap((t) => [...t.members, ...t.methods].map((m) => (lang === "it" ? m.it : m.en)));
  const types = [...Object.values(TYPE_NAMES as Record<string, Words>).map((w) => pick(w)[0]), ...ENGINE_HOST.types.map((t) => (lang === "it" ? t.it : t.en)), ...ENGINE_HOST.block!.propTypes.map((t) => (lang === "it" ? t.it : t.en))];
  return { keywords, fns, methods, host, members, types };
}

function complete(ctx: CompletionCtx) {
  const word = ctx.matchBefore(/[\p{L}_][\p{L}\p{N}_]*/u);
  const dot = ctx.matchBefore(/\.[\p{L}_]*$/u);
  if (!word && !ctx.explicit && !dot) return null;
  // La lingua del codice: quella delle parole chiave già scritte.
  const text = ctx.state.doc.toString();
  const en = (text.match(/\b(if|for|function|repeat|return|while|on|block|property)\b/g) ?? []).length;
  const it = (text.match(/\b(se|per|funzione|ripeti|ritorna|mentre|quando|blocco|proprietà)\b/g) ?? []).length;
  const w = words(en > it ? "en" : "it");
  const from = word?.from ?? ctx.pos;
  if (dot) {
    const options: Completion[] = [...new Set([...w.methods, ...w.members])].map((label) => ({ label, type: "method" }));
    return { from: dot.from + 1, options, validFor: /^[\p{L}_][\p{L}\p{N}_]*$/u };
  }
  const options: Completion[] = [
    ...[...new Set(w.keywords)].map((label) => ({ label, type: "keyword", boost: 1 })),
    ...w.fns.map((label) => ({ label, type: "function" })),
    ...w.host.map((label) => ({ label, type: "variable", boost: 2 })),
    ...w.types.map((label) => ({ label, type: "type" })),
  ];
  return { from, options, validFor: /^[\p{L}_][\p{L}\p{N}_]*$/u };
}

/** Tutto quello che serve all'editor per scrivere in Pepino Language. */
export function pepinoLanguage(): Extension[] {
  return [pepinoStream, pepinoIndent, linter(lintPepino, { delay: 300 }), EditorState.languageData.of(() => [{ autocomplete: complete }])];
}

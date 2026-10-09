import type * as A from "./ast";
import { tokenize, type Token } from "./lexer";
import { type Diagnostic, type MsgArg, type Span, makeDiag } from "./messages";
import { FUNCTIONS, LIST_METHODS, MAP_METHODS, TEXT_METHODS } from "./stdlib";
import { isWordText, TYPE_NAMES, UNITS, WORDS, type Lang, type WordId } from "./words";

class ParseError extends Error {}

export interface ParseResult {
  program: A.Program;
  /** Parole di contesto usate come parole chiave. */
  words: { pos: number; end: number; id: WordId }[];
  diagnostics: Diagnostic[];
  /** Lingua in cui sembra scritto il programma (dalle parole chiave). */
  lang: Lang;
}

/** Come si chiama un token nei messaggi d'errore. */
function describe(t: Token): MsgArg {
  switch (t.t) {
    case "nl":
      return (l) => (l === "it" ? "la fine della riga" : "the end of the line");
    case "eof":
      return (l) => (l === "it" ? "la fine del file" : "the end of the file");
    case "indent":
      return (l) => (l === "it" ? "un rientro" : "an indentation");
    case "dedent":
      return (l) => (l === "it" ? "la fine del blocco" : "the end of the block");
    case "str":
      return (l) => (l === "it" ? "un testo tra virgolette" : "a quoted text");
    default:
      return `«${t.v}»`;
  }
}

const spanOf = (t: Token): Span => ({ line: t.line, col: t.col, pos: t.pos, end: t.end });
const join = (a: Span, b: Span): Span => ({ line: a.line, col: a.col, pos: a.pos, end: Math.max(a.end, b.end) });

const ASSIGN_OPS = new Set(["=", "+=", "-=", "*=", "/=", "%=", "^="]);
const CMP_OPS: Record<string, A.BinOp> = { "==": "==", "=": "==", "!=": "!=", "<": "<", ">": ">", "<=": "<=", ">=": ">=" };

const HOOKS: [WordId, A.HookName][] = [
  ["hStart", "start"],
  ["hUpdate", "update"],
  ["hPhysics", "physics"],
  ["hLate", "late"],
  ["hEnd", "end"],
  ["hTouch", "touch"],
  ["hEvent", "event"],
];

export class Parser {
  private i = 0;
  /** `=` dentro un'espressione vuol dire «uguale» (tranne all'inizio di un'istruzione, dove è un'assegnazione). */
  private eqIsCompare = true;
  private depth = 0;
  /** Un valore con il suo blocco rientrato (pizza, spaghetti) è appena finito: la riga è già chiusa. */
  private blockValueEnd = false;
  /** Parole «di contesto» usate come parole chiave (per tradurre il programma in un'altra lingua). */
  readonly words: { pos: number; end: number; id: WordId }[] = [];

  constructor(
    private toks: Token[],
    readonly diags: Diagnostic[],
  ) {}

  // ---------------------------------------------------------------- utilità

  private peek(o = 0): Token {
    return this.toks[Math.min(this.i + o, this.toks.length - 1)];
  }
  private next(): Token {
    const t = this.peek();
    if (t.t !== "eof") this.i++;
    return t;
  }
  private prev(): Token {
    return this.toks[Math.max(0, this.i - 1)];
  }
  private isOp(v: string, o = 0): boolean {
    const t = this.peek(o);
    return t.t === "op" && t.v === v;
  }
  private isKw(id: WordId, o = 0): boolean {
    const t = this.peek(o);
    return t.t === "kw" && t.kw === id;
  }
  private isWord(id: WordId, o = 0): boolean {
    const t = this.peek(o);
    return t.t === "name" && isWordText(t.v, id);
  }
  /** Consuma una parola di contesto usata come parola chiave. */
  private take(id: WordId): Token {
    const t = this.next();
    if (t.t === "name") this.words.push({ pos: t.pos, end: t.end, id });
    return t;
  }
  private eatOp(v: string): Token | undefined {
    return this.isOp(v) ? this.next() : undefined;
  }
  private fail(key: string, args: MsgArg[] = [], t: Token = this.peek()): never {
    this.diags.push(makeDiag("error", key, args, spanOf(t)));
    throw new ParseError(key);
  }
  private expectOp(v: string): Token {
    if (!this.isOp(v)) {
      if (v === ":") this.fail("parse.expectedColon", [], this.peek().t === "nl" ? this.prev() : this.peek());
      this.fail("parse.expected", [`«${v}»`, describe(this.peek())]);
    }
    return this.next();
  }
  private expectKw(id: WordId, shown: string): Token {
    if (!this.isKw(id)) this.fail("parse.expected", [shown, describe(this.peek())]);
    return this.next();
  }
  private expectWord(id: WordId, shown: string): Token {
    if (!this.isWord(id)) this.fail("parse.expected", [shown, describe(this.peek())]);
    return this.take(id);
  }
  private name(): Token {
    const t = this.peek();
    if (t.t !== "name") this.fail("parse.expectedName", [describe(t)]);
    return this.next();
  }
  private string(): string {
    const t = this.peek();
    if (t.t !== "str") this.fail("parse.string");
    this.next();
    return (t.parts ?? []).map((p) => (typeof p === "string" ? p : `{${p.src}}`)).join("");
  }
  private endLine(what: Token): void {
    // Un valore con il suo blocco (pizza, spaghetti) ha già consumato la fine della riga.
    if (this.blockValueEnd) {
      this.blockValueEnd = false;
      return;
    }
    const t = this.peek();
    if (t.t === "nl") {
      this.next();
      return;
    }
    if (t.t === "eof" || t.t === "dedent") return;
    if (t.t === "op" && t.v === "!") this.fail("parse.bang", [], t);
    const p = this.prev();
    if (p.t === "name" && (isWordText(p.v, "pizza") || isWordText(p.v, "spaghetti")) && this.lineEndsWithColon()) this.fail("parse.blockValuePlace", [p.v], p);
    this.fail("parse.extra", [describe(what), describe(t)]);
  }
  /** Il token può cominciare un valore? */
  private startsExpr(o: number): boolean {
    const t = this.peek(o);
    if (t.t === "name" || t.t === "num" || t.t === "str") return true;
    if (t.t === "kw") return t.kw === "true" || t.kw === "false" || t.kw === "nothing" || t.kw === "this" || t.kw === "move" || t.kw === "not";
    return t.t === "op" && (t.v === "(" || t.v === "[" || t.v === "{");
  }
  /** La riga, da qui in avanti, finisce con i due punti (cioè apre un blocco)? */
  private lineEndsWithColon(): boolean {
    let last: Token | undefined;
    for (let j = 0; ; j++) {
      const t = this.peek(j);
      if (t.t === "nl" || t.t === "eof" || t.t === "indent" || t.t === "dedent") break;
      last = t;
    }
    return !!last && last.t === "op" && last.v === ":";
  }
  /** Nella riga, da qui in avanti, ci sono i due punti fuori dalle parentesi? */
  private colonAhead(): boolean {
    let depth = 0;
    for (let j = 0; ; j++) {
      const t = this.peek(j);
      if (t.t === "nl" || t.t === "eof" || t.t === "indent" || t.t === "dedent") return false;
      if (t.t !== "op") continue;
      if (t.v === "(" || t.v === "[" || t.v === "{") depth++;
      else if (t.v === ")" || t.v === "]" || t.v === "}") depth--;
      else if (t.v === ":" && depth === 0) return true;
    }
  }
  /** `nome: Tipo = …` (o `nome: Tipo?`): una dichiarazione con il tipo, a partire dai due punti in posizione o. */
  private looksLikeDecl(o: number): boolean {
    if (!this.isOp(":", o) || this.peek(o + 1).t !== "name") return false;
    const n = this.peek(o + 2);
    return (n.t === "op" && (n.v === "=" || n.v === "?")) || n.t === "nl" || this.isWord("of", o + 2) || this.isWord("from", o + 2);
  }
  private isPizza(): boolean {
    return this.isWord("pizza") && (this.peek(1).t === "name" || this.isOp("[", 1)) && this.lineEndsWithColon();
  }
  private isPipe(): boolean {
    return this.isWord("spaghetti") && this.startsExpr(1) && this.lineEndsWithColon();
  }
  private withEq<T>(eq: boolean, fn: () => T): T {
    const before = this.eqIsCompare;
    this.eqIsCompare = eq;
    try {
      return fn();
    } finally {
      this.eqIsCompare = before;
    }
  }

  /** Salta la riga sbagliata (e il blocco rientrato che la segue) per continuare a cercare errori. */
  private recover(): void {
    this.blockValueEnd = false;
    while (this.peek().t !== "nl" && this.peek().t !== "eof") {
      if (this.peek().t === "dedent" && this.depth > 0) return;
      this.next();
    }
    if (this.peek().t === "nl") this.next();
    if (this.peek().t === "indent") {
      let d = 0;
      do {
        const t = this.next();
        if (t.t === "indent") d++;
        else if (t.t === "dedent") d--;
      } while (d > 0 && this.peek().t !== "eof");
    }
  }

  // ---------------------------------------------------------------- programma e blocchi

  program(): A.Program {
    const body: A.Stmt[] = [];
    while (this.peek().t !== "eof") {
      const t = this.peek();
      if (t.t === "nl" || t.t === "dedent") {
        this.next();
        continue;
      }
      if (t.t === "indent") {
        this.diags.push(makeDiag("error", "parse.unexpectedIndent", [], spanOf(t)));
        this.recover();
        continue;
      }
      const s = this.safeStatement(true);
      if (s) body.push(s);
    }
    return { body };
  }

  private safeStatement(top: boolean): A.Stmt | undefined {
    try {
      return this.statement(top);
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      this.recover();
      return undefined;
    }
  }

  private body(): A.Stmt[] {
    this.expectOp(":");
    if (this.peek().t !== "nl") return [this.simpleStatement()];
    this.next();
    if (this.peek().t !== "indent") this.fail("parse.expectedBlock", [], this.peek().t === "eof" ? this.prev() : this.peek());
    this.next();
    this.depth++;
    const out: A.Stmt[] = [];
    try {
      while (this.peek().t !== "dedent" && this.peek().t !== "eof") {
        if (this.peek().t === "nl") {
          this.next();
          continue;
        }
        if (this.peek().t === "indent") {
          this.diags.push(makeDiag("error", "parse.unexpectedIndent", [], spanOf(this.peek())));
          this.recover();
          continue;
        }
        const s = this.safeStatement(false);
        if (s) out.push(s);
      }
    } finally {
      this.depth--;
    }
    if (this.peek().t === "dedent") this.next();
    return out;
  }

  /** Righe di un corpo «a elenco» (tipo, blocco, scegli): chiama `item` per ognuna. */
  private itemsBlock(item: () => void): void {
    this.expectOp(":");
    if (this.peek().t !== "nl") this.fail("parse.expectedBlock");
    this.next();
    if (this.peek().t !== "indent") this.fail("parse.expectedBlock");
    this.next();
    this.depth++;
    try {
      while (this.peek().t !== "dedent" && this.peek().t !== "eof") {
        if (this.peek().t === "nl") {
          this.next();
          continue;
        }
        try {
          item();
        } catch (e) {
          if (!(e instanceof ParseError)) throw e;
          this.recover();
        }
      }
    } finally {
      this.depth--;
    }
    if (this.peek().t === "dedent") this.next();
  }

  // ---------------------------------------------------------------- istruzioni

  private statement(top: boolean): A.Stmt {
    const t = this.peek();
    if (t.t === "kw") {
      switch (t.kw) {
        case "if":
          return this.ifStmt();
        case "else":
          this.fail("parse.elseAlone");
        // eslint-disable-next-line no-fallthrough
        case "while": {
          this.next();
          const cond = this.expr();
          return { k: "while", cond, body: this.body(), ...join(spanOf(t), cond) };
        }
        case "repeat":
          return this.repeatStmt();
        case "for":
          return this.forStmt();
        case "function":
          if (!top) this.fail("parse.nested", [`«${t.v}»`]);
          return this.funcDecl();
        case "match":
          return this.matchStmt();
        case "case":
          this.fail("parse.caseAlone");
        // eslint-disable-next-line no-fallthrough
        case "try":
          return this.tryStmt();
        default:
          break;
      }
    }
    if (t.t === "name") {
      const n1 = this.peek(1);
      if (this.isWord("type") && n1.t === "name" && this.isOp(":", 2)) {
        if (!top) this.fail("parse.nested", [`«${t.v}»`]);
        return this.typeDecl();
      }
      if (this.isWord("choice") && n1.t === "name" && this.isOp(":", 2)) {
        if (!top) this.fail("parse.nested", [`«${t.v}»`]);
        return this.enumDecl();
      }
      if (this.isWord("test") && n1.t === "str" && this.isOp(":", 2)) {
        if (!top) this.fail("parse.nested", [`«${t.v}»`]);
        this.take("test");
        const name = this.string();
        return { k: "test", name, body: this.body(), ...spanOf(t) };
      }
      if (this.isWord("block") && n1.t === "name" && (this.isOp(":", 2) || this.peek(2).t === "str")) {
        if (!top) this.fail("parse.nested", [`«${t.v}»`]);
        return this.blockDecl();
      }
      // cappuccino:   /   cappuccino 2 s:
      if (this.isWord("cappuccino") && ((this.isOp(":", 1) && this.peek(2).t === "nl") || (this.startsExpr(1) && this.colonAhead()))) return this.laterStmt();
    }
    return this.simpleStatement();
  }

  private laterStmt(): A.Later {
    const start = this.take("cappuccino");
    const delay = this.isOp(":") ? undefined : this.withEq(true, () => this.expr());
    return { k: "later", delay, body: this.body(), ...join(spanOf(start), delay ?? spanOf(start)) };
  }

  private simpleStatement(): A.Stmt {
    const t = this.peek();
    const s = this.simpleInner();
    this.endLine(this.prev().t === "nl" ? t : this.prev());
    return s;
  }

  private simpleInner(): A.Stmt {
    const t = this.peek();
    if (t.t === "kw") {
      switch (t.kw) {
        case "return": {
          this.next();
          const end = this.peek().t;
          const value = end === "nl" || end === "eof" || end === "dedent" ? undefined : this.lineValue();
          return { k: "return", value, ...(value ? join(spanOf(t), value) : spanOf(t)) };
        }
        case "break":
          this.next();
          return { k: "break", ...spanOf(t) };
        case "continue":
          this.next();
          return { k: "continue", ...spanOf(t) };
        case "pass":
          this.next();
          return { k: "pass", ...spanOf(t) };
        case "const": {
          this.next();
          const n = this.name();
          const ann = this.eatOp(":") ? this.typeAnn() : undefined;
          this.expectOp("=");
          const value = this.lineValue();
          return { k: "const", name: n.v, nameSpan: spanOf(n), ann, value, ...join(spanOf(t), value) };
        }
        case "check": {
          this.next();
          const cond = this.expr();
          const message = this.eatOp(",") ? this.expr() : undefined;
          return { k: "check", cond, message, ...join(spanOf(t), cond) };
        }
        case "fail": {
          this.next();
          const message = this.expr();
          return { k: "fail", message, ...join(spanOf(t), message) };
        }
        case "wait": {
          this.next();
          const end = this.peek().t;
          if (end === "nl" || end === "eof" || end === "dedent") return { k: "wait", ...spanOf(t) };
          if (this.isWord("until")) {
            this.take("until");
            const until = this.expr();
            return { k: "wait", until, ...join(spanOf(t), until) };
          }
          const seconds = this.expr();
          return { k: "wait", seconds, ...join(spanOf(t), seconds) };
        }
        default:
          break;
      }
    }
    if (t.t === "name") {
      if (this.isWord("use") && this.peek(1).t === "str") {
        this.take("use");
        return { k: "use", path: this.string(), ...spanOf(t) };
      }
      if (this.isWord("emit") && this.peek(1).t === "name" && ["nl", "eof", "dedent"].includes(this.peek(2).t)) {
        this.take("emit");
        const n = this.next();
        return { k: "emit", event: n.v, eventSpan: spanOf(n), ...join(spanOf(t), spanOf(n)) };
      }
      // mamma mia!   /   mamma mia! "messaggio"
      if (this.isWord("mamma") && this.isWord("mia", 1) && this.isOp("!", 2)) {
        this.take("mamma");
        this.take("mia");
        const bang = this.next();
        const end = this.peek().t;
        const message = end === "nl" || end === "eof" || end === "dedent" ? undefined : this.expr();
        return { k: "panic", message, ...join(spanOf(t), message ?? spanOf(bang)) };
      }
      if (this.isPizza() || this.isPipe()) {
        const e = this.lineValue();
        return { k: "expr", e, ...spanOf(t), end: e.end };
      }
      // Dichiarazione con il tipo: punti: Numero = 0   (o bersaglio: Oggetto? da solo = niente)
      if (this.isOp(":", 1)) {
        this.next();
        this.next();
        const ann = this.typeAnn();
        const target: A.NameRef = { k: "name", name: t.v, ...spanOf(t) };
        if (ann.k === "topt" && ["nl", "eof", "dedent"].includes(this.peek().t)) {
          const value: A.NoneLit = { k: "none", ...spanOf(this.prev()) };
          return { k: "assign", target, op: "=", value, ann, ...join(spanOf(t), ann) };
        }
        this.expectOp("=");
        const value = this.lineValue();
        return { k: "assign", target, op: "=", value, ann, ...join(spanOf(t), value) };
      }
    }
    const e = this.withEq(false, () => this.expr());
    const op = this.peek();
    if (op.t === "op" && ASSIGN_OPS.has(op.v)) {
      if (e.k !== "name" && e.k !== "member" && e.k !== "index") this.fail("parse.badTarget", [], op);
      this.next();
      const value = this.lineValue();
      return { k: "assign", target: e, op: op.v as A.AssignOp, value, ...join(e, value) };
    }
    return { k: "expr", e, ...spanOf(t), end: e.end };
  }

  private ifStmt(): A.If {
    const start = this.next();
    const branches: A.IfBranch[] = [];
    const cond = this.expr();
    branches.push({ cond, body: this.body(), span: spanOf(start) });
    let els: A.Stmt[] | undefined;
    while (this.isKw("else")) {
      const e = this.next();
      if (this.isKw("if")) {
        const s = this.next();
        const c = this.expr();
        branches.push({ cond: c, body: this.body(), span: join(spanOf(e), spanOf(s)) });
        continue;
      }
      els = this.body();
      break;
    }
    return { k: "if", branches, els, ...spanOf(start) };
  }

  private repeatStmt(): A.Repeat {
    const start = this.next();
    if (this.isOp(":")) return { k: "repeat", body: this.body(), ...spanOf(start) };
    const count = this.expr();
    this.expectWord("times", "«volte»");
    return { k: "repeat", count, body: this.body(), ...join(spanOf(start), count) };
  }

  private forStmt(): A.ForEach | A.ForRange {
    const start = this.next();
    if (this.isKw("each")) this.next();
    const change = !!(this.isKw("change") && this.next());
    const first = this.name();
    const vars: A.LoopVar[] = [{ name: first.v, span: spanOf(first) }];
    if (this.eatOp(",")) {
      const second = this.name();
      vars.push({ name: second.v, span: spanOf(second) });
    }
    if (this.isWord("from") && !change && vars.length === 1) {
      this.take("from");
      const from = this.expr();
      this.expectWord("to", "«a»");
      const to = this.expr();
      let step: A.Expr | undefined;
      if (this.isWord("step")) {
        this.take("step");
        step = this.expr();
      }
      return { k: "forrange", v: vars[0], from, to, step, body: this.body(), ...spanOf(start) };
    }
    this.expectKw("in", "«in»");
    const iter = this.expr();
    return { k: "foreach", vars, change, iter, body: this.body(), ...spanOf(start) };
  }

  private matchStmt(): A.Match {
    const start = this.next();
    const subject = this.expr();
    const cases: A.MatchCase[] = [];
    let els: A.Stmt[] | undefined;
    this.itemsBlock(() => {
      const t = this.peek();
      if (this.isKw("case")) {
        this.next();
        const values = [this.expr()];
        while (this.eatOp(",")) values.push(this.expr());
        cases.push({ values, body: this.body(), span: spanOf(t) });
        return;
      }
      if (this.isKw("else")) {
        this.next();
        els = this.body();
        return;
      }
      this.fail("parse.expected", ["«caso»", describe(t)]);
    });
    return { k: "match", subject, cases, els, ...spanOf(start) };
  }

  private tryStmt(): A.Try {
    const start = this.next();
    const body = this.body();
    // se errore [nome]:   /   if error [name]:
    if (!(this.isKw("if") && this.isWord("error", 1))) this.fail("parse.expected", ["«se errore:»", describe(this.peek())]);
    this.next();
    this.take("error");
    let errVar: A.LoopVar | undefined;
    if (this.peek().t === "name") {
      const n = this.next();
      errVar = { name: n.v, span: spanOf(n) };
    }
    const handler = this.body();
    // bravo:   (se è andato tutto bene)
    let success: A.Stmt[] | undefined;
    if (this.isWord("bravo") && this.isOp(":", 1) && !this.looksLikeDecl(1)) {
      this.take("bravo");
      success = this.body();
    }
    return { k: "try", body, errVar, handler, success, ...spanOf(start) };
  }

  // ---------------------------------------------------------------- dichiarazioni

  private params(): A.Param[] {
    const out: A.Param[] = [];
    this.expectOp("(");
    this.withEq(true, () => {
      while (!this.isOp(")")) {
        let mode: A.ParamMode = "borrow";
        if (this.isKw("change")) {
          this.next();
          mode = "change";
        } else if (this.isKw("take")) {
          this.next();
          mode = "take";
        }
        const n = this.name();
        const ann = this.eatOp(":") ? this.typeAnn() : undefined;
        const def = this.eatOp("=") ? this.expr() : undefined;
        out.push({ name: n.v, span: spanOf(n), mode, ann, def });
        if (!this.eatOp(",")) break;
      }
    });
    this.expectOp(")");
    return out;
  }

  private funcDecl(): A.FuncDecl {
    const start = this.next();
    const n = this.name();
    const params = this.params();
    const ret = this.eatOp("->") ? this.typeAnn() : undefined;
    return { k: "func", name: n.v, nameSpan: spanOf(n), params, ret, body: this.body(), ...join(spanOf(start), spanOf(n)) };
  }

  private field(): A.FieldDecl {
    const n = this.name();
    const ann = this.eatOp(":") ? this.typeAnn() : undefined;
    let def: A.Expr | undefined;
    if (this.eatOp("=")) def = this.lineValue();
    else if (!ann) this.fail("parse.expected", ["«=»", describe(this.peek())]);
    this.endLine(n);
    return { name: n.v, span: spanOf(n), ann, def };
  }

  private typeDecl(): A.TypeDecl {
    const start = this.take("type");
    const n = this.name();
    const decl: A.TypeDecl = { k: "type", name: n.v, nameSpan: spanOf(n), fields: [], methods: [], ...join(spanOf(start), spanOf(n)) };
    this.itemsBlock(() => {
      const t = this.peek();
      if (this.isKw("function")) {
        decl.methods.push(this.funcDecl());
        return;
      }
      if (this.isWord("when") && this.peek(1).t === "name" && this.isOp(":", 2)) {
        this.take("when");
        const h = this.peek();
        if (isWordText(h.v, "hCreate")) {
          this.take("hCreate");
          if (decl.onCreate) this.fail("parse.duplicateHook", [h.v], h);
          decl.onCreate = this.body();
        } else if (isWordText(h.v, "hEnd")) {
          this.take("hEnd");
          if (decl.onEnd) this.fail("parse.duplicateHook", [h.v], h);
          decl.onEnd = this.body();
        } else this.fail("parse.badHook", [h.v, (l) => (l === "it" ? "crea, finisce" : "create, end")], h);
        return;
      }
      if (t.t === "name" && (this.isOp(":", 1) || this.isOp("=", 1))) {
        decl.fields.push(this.field());
        return;
      }
      this.fail("parse.typeItem");
    });
    return decl;
  }

  private enumDecl(): A.EnumDecl {
    const start = this.take("choice");
    const n = this.name();
    const members: { name: string; span: Span }[] = [];
    const list = () => {
      do {
        const m = this.name();
        members.push({ name: m.v, span: spanOf(m) });
      } while (this.eatOp(","));
    };
    if (this.isOp(":") && this.peek(1).t !== "nl") {
      this.next();
      list();
      this.endLine(this.prev());
    } else
      this.itemsBlock(() => {
        list();
        this.endLine(this.prev());
      });
    return { k: "enum", name: n.v, nameSpan: spanOf(n), members, ...join(spanOf(start), spanOf(n)) };
  }

  private constNumber(): number {
    const neg = !!this.eatOp("-");
    const t = this.peek();
    if (t.t !== "num") this.fail("parse.number");
    this.next();
    return neg ? -(t.num ?? 0) : (t.num ?? 0);
  }

  private blockDecl(): A.BlockDecl {
    const start = this.take("block");
    const n = this.name();
    const decl: A.BlockDecl = {
      k: "block",
      name: n.v,
      nameSpan: spanOf(n),
      requires: [],
      props: [],
      events: [],
      states: [],
      fields: [],
      funcs: [],
      handlers: [],
      actions: [],
      ...join(spanOf(start), spanOf(n)),
    };
    if (this.peek().t === "str") decl.label = this.string();
    const named = (): A.NamedDecl => {
      const nm = this.name();
      const label = this.peek().t === "str" ? this.string() : undefined;
      this.endLine(this.prev());
      return { name: nm.v, span: spanOf(nm), label };
    };
    this.itemsBlock(() => {
      const t = this.peek();
      const isField = this.isOp(":", 1) || this.isOp("=", 1);
      if (this.isKw("function")) {
        decl.funcs.push(this.funcDecl());
        return;
      }
      if (t.t === "name" && !isField) {
        if (this.isWord("description")) {
          this.take("description");
          decl.description = this.string();
          this.endLine(this.prev());
          return;
        }
        if (this.isWord("category")) {
          this.take("category");
          decl.category = this.string();
          this.endLine(this.prev());
          return;
        }
        if (this.isWord("priority")) {
          this.take("priority");
          decl.priority = this.constNumber();
          this.endLine(this.prev());
          return;
        }
        if (this.isWord("requires")) {
          this.take("requires");
          do {
            const r = this.name();
            decl.requires.push({ name: r.v, span: spanOf(r) });
          } while (this.eatOp(","));
          this.endLine(this.prev());
          return;
        }
        if (this.isWord("property")) {
          this.take("property");
          decl.props.push(this.propDecl());
          return;
        }
        if (this.isWord("event") && this.peek(1).t === "name") {
          this.take("event");
          decl.events.push(named());
          return;
        }
        if (this.isWord("state") && this.peek(1).t === "name") {
          this.take("state");
          decl.states.push(named());
          return;
        }
        if ((this.isWord("action") || this.isWord("condition")) && this.peek(1).t === "name") {
          const kind = this.isWord("action") ? "action" : "condition";
          this.take(kind);
          const nm = this.name();
          const params = this.isOp("(") ? this.params() : [];
          const label = this.peek().t === "str" ? this.string() : undefined;
          decl.actions.push({ kind, name: nm.v, nameSpan: spanOf(nm), params, label, body: this.body(), span: spanOf(t) });
          return;
        }
        if (this.isWord("when") && this.peek(1).t === "name") {
          this.take("when");
          const h = this.peek();
          const hookEntry = HOOKS.find(([id]) => isWordText(h.v, id));
          const hook = hookEntry?.[1];
          if (hookEntry) this.take(hookEntry[0]);
          else this.next();
          if (!hook) this.fail("parse.badHook", [h.v, (l) => (l === "it" ? "inizia, aggiorna, fisica, dopo, finisce, tocca, evento" : "start, update, physics, late, end, touch, event")], h);
          if (hook !== "touch" && hook !== "event" && decl.handlers.some((x) => x.hook === hook)) this.fail("parse.duplicateHook", [h.v], h);
          const handler: A.Handler = { hook, body: [], span: join(spanOf(t), spanOf(h)) };
          if (hook === "touch") {
            const p = this.name();
            handler.param = { name: p.v, span: spanOf(p) };
          } else if (hook === "event") {
            handler.eventName = this.name().v;
          }
          handler.body = this.body();
          decl.handlers.push(handler);
          return;
        }
      }
      if (t.t === "name" && isField) {
        decl.fields.push(this.field());
        return;
      }
      this.fail("parse.blockItem");
    });
    return decl;
  }

  private propDecl(): A.PropDecl {
    const n = this.name();
    const ann = this.eatOp(":") ? this.typeAnn() : undefined;
    this.expectOp("=");
    const def = this.expr();
    const p: A.PropDecl = { name: n.v, span: spanOf(n), ann, def };
    while (this.eatOp(",")) {
      if (this.peek().t === "str") p.label = this.string();
      else if (this.isWord("from")) {
        this.take("from");
        p.min = this.constNumber();
        this.expectWord("to", "«a»");
        p.max = this.constNumber();
      } else if (this.isWord("step")) {
        this.take("step");
        p.step = this.constNumber();
      } else if (this.isWord("group")) {
        this.take("group");
        p.group = this.string();
      } else if (this.isWord("help")) {
        this.take("help");
        p.help = this.string();
      } else this.fail("parse.expected", ["«\"Etichetta\"», «da … a …», «passo …»", describe(this.peek())]);
    }
    this.endLine(this.prev());
    return p;
  }

  // ---------------------------------------------------------------- tipi scritti

  typeAnn(): A.TypeAnn {
    let t = this.typeBase();
    while (this.isOp("?")) {
      const q = this.next();
      t = { k: "topt", t, ...join(t, spanOf(q)) };
    }
    return t;
  }

  private typeBase(): A.TypeAnn {
    const t = this.peek();
    if (this.isOp("[")) {
      this.next();
      const el = this.typeAnn();
      if (this.eatOp(":")) {
        const val = this.typeAnn();
        const end = this.expectOp("]");
        return { k: "tmap", key: el, val, ...join(spanOf(t), spanOf(end)) };
      }
      const end = this.expectOp("]");
      return { k: "tlist", el, ...join(spanOf(t), spanOf(end)) };
    }
    if (this.isKw("function")) {
      this.next();
      this.expectOp("(");
      const params: A.TypeAnn[] = [];
      while (!this.isOp(")")) {
        params.push(this.typeAnn());
        if (!this.eatOp(",")) break;
      }
      const end = this.expectOp(")");
      const ret = this.eatOp("->") ? this.typeAnn() : undefined;
      return { k: "tfn", params, ret, ...join(spanOf(t), ret ?? spanOf(end)) };
    }
    const n = this.name();
    const nm = n.v;
    if ((nm === "Lista" || nm === "List") && this.isWord("of")) {
      this.words.push({ pos: n.pos, end: n.end, id: "tList" });
      this.take("of");
      const el = this.typeAnn();
      return { k: "tlist", el, ...join(spanOf(n), el) };
    }
    if ((nm === "Mappa" || nm === "Map") && (this.isWord("of") || this.isWord("from"))) {
      this.words.push({ pos: n.pos, end: n.end, id: "tMap" });
      this.words.push({ pos: n.pos, end: n.end, id: "tMap" });
      this.take(this.isWord("of") ? "of" : "from");
      const key = this.typeBase();
      this.expectWord("to", "«a»");
      const val = this.typeAnn();
      return { k: "tmap", key, val, ...join(spanOf(n), val) };
    }
    return { k: "tname", name: nm, ...spanOf(n) };
  }

  // ---------------------------------------------------------------- valori con un blocco (pizza, spaghetti)

  /** Il valore che chiude un'istruzione: anche «pizza …:» e «spaghetti …:», che continuano nelle righe rientrate. */
  private lineValue(): A.Expr {
    if (this.isPizza()) return this.pizza();
    if (this.isPipe()) return this.pipe();
    return this.expr();
  }

  /** Un ingrediente «nome = valore» (va bene anche «nome: valore»). */
  private ingredientSep(): void {
    if (this.eatOp("=") || this.eatOp(":")) return;
    this.fail("parse.expected", ["«=»", describe(this.peek())]);
  }

  private pizza(): A.PizzaExpr {
    const start = this.take("pizza");
    const ann = this.typeAnn();
    const named = ann.k === "tname" ? ann.name : undefined;
    const kind = ann.k === "tlist" || (named && isWordText(named, "tList")) ? "list" : ann.k === "tmap" || (named && isWordText(named, "tMap")) ? "map" : "rec";
    if (kind === "rec" && ann.k !== "tname") this.fail("parse.pizzaType", [], start);
    const span = join(spanOf(start), ann);
    const items: A.Expr[] = [];
    const entries: A.MapLit["entries"] = [];
    const args: A.Arg[] = [];
    this.withEq(true, () =>
      this.itemsBlock(() => {
        if (kind === "list") {
          items.push(this.lineValue());
        } else if (kind === "map") {
          const key = this.withEq(false, () => this.expr());
          this.ingredientSep();
          entries.push({ key, value: this.lineValue() });
        } else {
          const n = this.name();
          this.ingredientSep();
          args.push({ name: n.v, nameSpan: spanOf(n), value: this.lineValue() });
        }
        this.endLine(this.prev());
      }),
    );
    this.blockValueEnd = true;
    let value: A.PizzaExpr["value"];
    if (kind === "list") value = { k: "list", items, ...span };
    else if (kind === "map") value = { k: "map", entries, ...span };
    else value = { k: "call", callee: { k: "name", name: named!, line: ann.line, col: ann.col, pos: ann.pos, end: ann.end }, args, ...span };
    return { k: "pizza", ann, kind, value, ...span };
  }

  private pipe(): A.PipeExpr {
    const start = this.take("spaghetti");
    const value = this.expr();
    const steps: A.PipeStep[] = [];
    this.itemsBlock(() => {
      const n = this.peek();
      if (n.t !== "name" && n.t !== "kw") this.fail("parse.pipeStep", [describe(n)]);
      this.next();
      let args: A.Arg[] = [];
      let end = n;
      const parens = this.isOp("(");
      if (parens) {
        this.next();
        args = this.withEq(true, () => this.args());
        end = this.expectOp(")");
      }
      steps.push({ name: n.v, nameSpan: spanOf(n), args, parens, span: join(spanOf(n), spanOf(end)) });
      this.endLine(end);
    });
    this.blockValueEnd = true;
    return { k: "pipe", start: value, steps, ...join(spanOf(start), value) };
  }

  // ---------------------------------------------------------------- espressioni

  expr(): A.Expr {
    return this.withEq(this.eqIsCompare, () => this.lambdaOr());
  }

  private lambdaOr(): A.Expr {
    const t = this.peek();
    if (t.t === "name" && this.isOp("=>", 1)) {
      this.next();
      this.next();
      const body = this.withEq(true, () => this.expr());
      return { k: "lambda", params: [{ name: t.v, span: spanOf(t) }], body, ...join(spanOf(t), body) };
    }
    if (this.isOp("(")) {
      // (a, b) => …
      let j = 1;
      let ok = true;
      if (!this.isOp(")", j)) {
        for (;;) {
          if (this.peek(j).t !== "name") {
            ok = false;
            break;
          }
          j++;
          if (this.isOp(",", j)) {
            j++;
            continue;
          }
          break;
        }
      }
      if (ok && this.isOp(")", j) && this.isOp("=>", j + 1)) {
        this.next();
        const params: A.Lambda["params"] = [];
        while (!this.isOp(")")) {
          const n = this.name();
          params.push({ name: n.v, span: spanOf(n) });
          if (!this.eatOp(",")) break;
        }
        this.expectOp(")");
        this.expectOp("=>");
        const body = this.withEq(true, () => this.expr());
        return { k: "lambda", params, body, ...join(spanOf(t), body) };
      }
    }
    return this.or();
  }

  private or(): A.Expr {
    let l = this.and();
    while (this.isKw("or") || this.isWord("orIt")) {
      this.take("orIt");
      const r = this.and();
      l = { k: "binary", op: "or", l, r, ...join(l, r) };
    }
    return l;
  }

  private and(): A.Expr {
    let l = this.not();
    while (this.isKw("and") || this.isWord("andIt")) {
      this.take("andIt");
      const r = this.not();
      l = { k: "binary", op: "and", l, r, ...join(l, r) };
    }
    return l;
  }

  private not(): A.Expr {
    if (this.isKw("not") && !this.isKw("in", 1)) {
      const t = this.next();
      const e = this.not();
      return { k: "unary", op: "not", e, ...join(spanOf(t), e) };
    }
    return this.comparison();
  }

  private comparison(): A.Expr {
    const l = this.additive();
    const t = this.peek();
    let op: A.BinOp | undefined;
    if (t.t === "op" && t.v in CMP_OPS && (t.v !== "=" || this.eqIsCompare)) {
      this.next();
      op = CMP_OPS[t.v];
    } else if (this.isKw("in")) {
      this.next();
      op = "in";
    } else if (this.isKw("not") && this.isKw("in", 1)) {
      this.next();
      this.next();
      op = "notin";
    }
    if (!op) return l;
    const r = this.additive();
    return { k: "binary", op, l, r, ...join(l, r) };
  }

  private additive(): A.Expr {
    let l = this.multiplicative();
    for (;;) {
      const t = this.peek();
      if (t.t !== "op" || (t.v !== "+" && t.v !== "-")) return l;
      this.next();
      const r = this.multiplicative();
      l = { k: "binary", op: t.v, l, r, ...join(l, r) };
    }
  }

  private multiplicative(): A.Expr {
    let l = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.t !== "op" || (t.v !== "*" && t.v !== "/" && t.v !== "%")) return l;
      this.next();
      const r = this.unary();
      l = { k: "binary", op: t.v, l, r, ...join(l, r) };
    }
  }

  private unary(): A.Expr {
    if (this.isOp("-")) {
      const t = this.next();
      const e = this.unary();
      return { k: "unary", op: "-", e, ...join(spanOf(t), e) };
    }
    if (this.isOp("+")) {
      this.next();
      return this.unary();
    }
    return this.power();
  }

  private power(): A.Expr {
    const l = this.postfix();
    if (this.isOp("^")) {
      this.next();
      const r = this.unary();
      return { k: "binary", op: "^", l, r, ...join(l, r) };
    }
    return l;
  }

  private postfix(): A.Expr {
    let e = this.primary();
    for (;;) {
      if (this.isOp("(")) {
        this.next();
        const args = this.withEq(true, () => this.args());
        const end = this.expectOp(")");
        e = { k: "call", callee: e, args, ...join(e, spanOf(end)) };
        continue;
      }
      if (this.isOp(".")) {
        this.next();
        const n = this.peek();
        if (n.t !== "name" && n.t !== "kw") this.fail("parse.expectedName", [describe(n)]);
        this.next();
        e = { k: "member", obj: e, name: n.v, nameSpan: spanOf(n), ...join(e, spanOf(n)) };
        continue;
      }
      if (this.isOp("[")) {
        this.next();
        const index = this.withEq(true, () => this.expr());
        const end = this.expectOp("]");
        e = { k: "index", obj: e, index, ...join(e, spanOf(end)) };
        continue;
      }
      return e;
    }
  }

  private args(): A.Arg[] {
    const out: A.Arg[] = [];
    let named = false;
    while (!this.isOp(")")) {
      const t = this.peek();
      if (t.t === "name" && this.isOp(":", 1)) {
        this.next();
        this.next();
        named = true;
        const change = !!(this.isKw("change") && this.next());
        const value = change ? this.postfix() : this.expr();
        out.push({ name: t.v, nameSpan: spanOf(t), change, value });
      } else {
        if (named) this.fail("parse.namedAfter");
        const change = !!(this.isKw("change") && this.next());
        if (change && this.peek().t !== "name" && !this.isKw("this")) this.fail("parse.changeArg");
        const value = change ? this.postfix() : this.expr();
        out.push({ change, value });
      }
      if (!this.eatOp(",")) break;
    }
    return out;
  }

  private unit(): A.UnitSpec | undefined {
    const t = this.peek();
    const atomAt = (o: number): Token | undefined => {
      const x = this.peek(o);
      if (x.t === "op" && x.v === "°") return x;
      if (x.t === "name" && x.v in UNITS) return x;
      return undefined;
    };
    const first = atomAt(0);
    if (!first) return undefined;
    // «2 s»: l'unità segue il numero (anche staccata); «tile/s»: il resto dev'essere attaccato.
    this.next();
    const atoms: A.UnitSpec["atoms"] = [{ name: first.v, power: 1 }];
    let text = first.v;
    let last = first;
    while (this.isOp("/") && this.peek().pos === last.end) {
      const slash = this.peek();
      const a = atomAt(1);
      if (!a || a.pos !== slash.end) break;
      this.next();
      this.next();
      atoms.push({ name: a.v, power: -1 });
      text += `/${a.v}`;
      last = a;
    }
    void t;
    return { text, atoms };
  }

  private primary(): A.Expr {
    const t = this.peek();
    switch (t.t) {
      case "num": {
        this.next();
        const unit = this.unit();
        const end = unit ? this.prev() : t;
        return { k: "num", value: t.num ?? 0, unit, ...join(spanOf(t), spanOf(end)) };
      }
      case "str": {
        this.next();
        const parts: (string | A.Expr)[] = [];
        for (const p of t.parts ?? []) {
          if (typeof p === "string") parts.push(p);
          else parts.push(this.hole(p));
        }
        return { k: "str", parts, ...spanOf(t) };
      }
      case "name":
        this.next();
        return { k: "name", name: t.v, ...spanOf(t) };
      case "kw":
        switch (t.kw) {
          case "true":
          case "false":
            this.next();
            return { k: "bool", value: t.kw === "true", ...spanOf(t) };
          case "nothing":
            this.next();
            return { k: "none", ...spanOf(t) };
          case "this":
            this.next();
            return { k: "this", ...spanOf(t) };
          case "move": {
            this.next();
            const e = this.postfix();
            return { k: "move", e, ...join(spanOf(t), e) };
          }
          default:
            break;
        }
        break;
      case "op":
        if (t.v === "!") this.fail("parse.bang");
        if (t.v === "(") {
          this.next();
          const e = this.withEq(true, () => this.expr());
          this.expectOp(")");
          return e;
        }
        if (t.v === "[") {
          this.next();
          const items: A.Expr[] = [];
          this.withEq(true, () => {
            while (!this.isOp("]")) {
              items.push(this.expr());
              if (!this.eatOp(",")) break;
            }
          });
          const end = this.expectOp("]");
          return { k: "list", items, ...join(spanOf(t), spanOf(end)) };
        }
        if (t.v === "{") {
          this.next();
          const entries: A.MapLit["entries"] = [];
          this.withEq(true, () => {
            while (!this.isOp("}")) {
              const key = this.expr();
              this.expectOp(":");
              const value = this.expr();
              entries.push({ key, value });
              if (!this.eatOp(",")) break;
            }
          });
          const end = this.expectOp("}");
          return { k: "map", entries, ...join(spanOf(t), spanOf(end)) };
        }
        break;
      default:
        break;
    }
    this.fail("parse.expectedExpr", [describe(t)]);
  }

  /** Il codice dentro le graffe di una stringa. */
  private hole(h: { src: string; pos: number; line: number; col: number }): A.Expr {
    const lex = tokenize(h.src, { pos: h.pos, line: h.line, col: h.col }, true);
    this.diags.push(...lex.diagnostics);
    const p = new Parser(lex.tokens, this.diags);
    const e = p.expr();
    this.words.push(...p.words);
    if (p.peek().t !== "eof") p.fail("parse.extra", [describe(p.prev()), describe(p.peek())]);
    return e;
  }
}

let hintCache: Map<string, Lang> | undefined;

/** Nomi che appartengono a una lingua sola (le parole brevi come «e», «a», «di» non contano: possono essere variabili). */
function langHints(): Map<string, Lang> {
  if (hintCache) return hintCache;
  const it = new Set<string>();
  const en = new Set<string>();
  const add = (w: { it: string[]; en: string[] }) => {
    for (const x of w.it) it.add(x);
    for (const x of w.en) en.add(x);
  };
  for (const w of Object.values(WORDS)) add(w);
  for (const w of Object.values(TYPE_NAMES)) add(w);
  for (const b of [...FUNCTIONS, ...TEXT_METHODS, ...LIST_METHODS, ...MAP_METHODS]) add(b);
  hintCache = new Map();
  for (const x of it) if (!en.has(x) && x.length > 2) hintCache.set(x, "it");
  for (const x of en) if (!it.has(x) && x.length > 2) hintCache.set(x, "en");
  return hintCache;
}

/** `base`: da dove partono le posizioni (i file letti con «usa» ne hanno una diversa, per riconoscerli). */
export function parse(source: string, base = 0): ParseResult {
  const lex = tokenize(source, { pos: base, line: 1, col: 1 });
  const diagnostics = [...lex.diagnostics];
  const p = new Parser(lex.tokens, diagnostics);
  let program: A.Program;
  try {
    program = p.program();
  } catch (e) {
    if (!(e instanceof ParseError)) throw e;
    program = { body: [] };
  }
  // La lingua: parole chiave, e anche nomi che esistono in una lingua sola (scrivi / print, Testo / Text…).
  const counts = { ...lex.counts };
  const hints = langHints();
  for (const t of lex.tokens) if (t.t === "name") {
    const l = hints.get(t.v);
    if (l) counts[l]++;
  }
  const lang: Lang = counts.en > counts.it ? "en" : "it";
  return { program, diagnostics, lang, words: p.words };
}

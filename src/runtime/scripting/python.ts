/**
 * Traduttore da un sottoinsieme di Python a JavaScript, per scrivere blocchi Pepino in Python
 * senza portarsi dietro un interprete: il gioco esportato resta leggero.
 *
 * Supportati: variabili, if/elif/else, while, for (anche su range), def con valori predefiniti e
 * argomenti con nome, return, break, continue, pass, liste, dizionari, tuple, f-string, slice [a:b],
 * operatori con le priorità di Python (anche //, %, **, confronti a catena, in, is), import math/random.
 * Non supportati: classi, try/except, with, lambda, comprehension, global, decoratori, *args.
 */

export class PythonError extends Error {
  constructor(
    readonly reason: string,
    readonly line: number,
    readonly col: number,
  ) {
    super(`Riga ${line}: ${reason}`);
    this.name = "PythonError";
  }
}

// ---------------------------------------------------------------- Tokenizer

type TokType = "name" | "keyword" | "number" | "string" | "fstring" | "op" | "newline" | "indent" | "dedent" | "eof";

interface Tok {
  type: TokType;
  value: string;
  line: number;
  col: number;
}

const KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif",
  "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or",
  "pass", "raise", "return", "try", "while", "with", "yield",
]);

const UNSUPPORTED: Record<string, string> = {
  class: "le classi non sono supportate: scrivi funzioni come def update(self, dt).",
  try: "try/except non è supportato.",
  except: "try/except non è supportato.",
  finally: "try/except non è supportato.",
  with: "with non è supportato.",
  lambda: "lambda non è supportata: usa def.",
  global: "global non è supportato: tieni i valori in self.data.",
  nonlocal: "nonlocal non è supportato.",
  del: "del non è supportato.",
  assert: "assert non è supportato.",
  raise: "raise non è supportato.",
  yield: "yield non è supportato.",
  async: "async non è supportato.",
  await: "await non è supportato.",
  as: "as non è supportato.",
};

const COMPREHENSION = "le comprehension non sono supportate: usa un ciclo for.";

const OPS = [
  "**=", "//=", ">>=", "<<=", ":=", "**", "//", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
  "->", "<<", ">>", "+", "-", "*", "/", "%", "<", ">", "=", "(", ")", "[", "]", "{", "}", ",", ":", ".", ";", "@", "~",
  "&", "|", "^",
];

const RE_NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
const RE_NUM = /0[xX][0-9a-fA-F_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?|\.\d[\d_]*(?:[eE][+-]?\d+)?/y;
const RE_STR = /([fFrR]{0,2})("""|'''|"|')/y;

export function tokenize(source: string): Tok[] {
  const s = source.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
  const out: Tok[] = [];
  const indents = [0];
  let i = 0;
  let line = 1;
  let col = 1;
  let depth = 0;
  let lineStart = true;

  function fail(msg: string, l = line, c = col): never {
    throw new PythonError(msg, l, c);
  }
  const push = (type: TokType, value: string, l = line, c = col) => out.push({ type, value, line: l, col: c });
  const adv = (n: number) => {
    i += n;
    col += n;
  };

  while (i < s.length) {
    if (lineStart && depth === 0) {
      let n = 0;
      while (s[i] === " ") {
        n++;
        i++;
      }
      col = n + 1;
      if (i >= s.length) break;
      if (s[i] === "\n" || s[i] === "#") {
        while (i < s.length && s[i] !== "\n") i++;
        if (s[i] === "\n") {
          i++;
          line++;
          col = 1;
        }
        continue;
      }
      const top = indents[indents.length - 1];
      if (n > top) {
        indents.push(n);
        push("indent", "", line, 1);
      } else if (n < top) {
        while (n < indents[indents.length - 1]) {
          indents.pop();
          push("dedent", "", line, 1);
        }
        if (n !== indents[indents.length - 1]) fail("il rientro non corrisponde a nessun blocco sopra", line, 1);
      }
      lineStart = false;
    }

    const ch = s[i];
    if (ch === "\n") {
      if (depth === 0) {
        push("newline", "");
        lineStart = true;
      }
      i++;
      line++;
      col = 1;
      continue;
    }
    if (ch === " ") {
      adv(1);
      continue;
    }
    if (ch === "#") {
      while (i < s.length && s[i] !== "\n") adv(1);
      continue;
    }
    if (ch === "\\" && s[i + 1] === "\n") {
      i += 2;
      line++;
      col = 1;
      continue;
    }

    RE_STR.lastIndex = i;
    const sm = RE_STR.exec(s);
    if (sm) {
      const prefix = sm[1].toLowerCase();
      const quote = sm[2];
      const l0 = line;
      const c0 = col;
      adv(sm[0].length);
      let val = "";
      for (;;) {
        if (i >= s.length) fail("stringa non chiusa", l0, c0);
        if (s.startsWith(quote, i)) {
          adv(quote.length);
          break;
        }
        const c = s[i];
        if (c === "\n") {
          if (quote.length === 1) fail("stringa non chiusa: manca la virgoletta finale", l0, c0);
          val += "\n";
          i++;
          line++;
          col = 1;
          continue;
        }
        if (c === "\\" && !prefix.includes("r")) {
          const n = s[i + 1];
          if (n === "\n") {
            i += 2;
            line++;
            col = 1;
            continue;
          }
          const esc: Record<string, string> = { n: "\n", t: "\t", r: "\r", "0": "\0", "\\": "\\", "'": "'", '"': '"' };
          val += esc[n] ?? `\\${n}`;
          adv(2);
          continue;
        }
        val += c;
        adv(1);
      }
      push(prefix.includes("f") ? "fstring" : "string", val, l0, c0);
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(s[i + 1] ?? ""))) {
      RE_NUM.lastIndex = i;
      const v = RE_NUM.exec(s)![0];
      push("number", v.replace(/_/g, ""));
      adv(v.length);
      if (/[A-Za-z_]/.test(s[i] ?? "")) fail(`numero non valido «${v}${s[i]}»`);
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      RE_NAME.lastIndex = i;
      const w = RE_NAME.exec(s)![0];
      push(KEYWORDS.has(w) ? "keyword" : "name", w);
      adv(w.length);
      continue;
    }
    const op = OPS.find((o) => s.startsWith(o, i));
    if (!op) fail(`carattere non valido «${ch}»`);
    if (op === ":=") fail("l'operatore := non è supportato");
    if (op === "(" || op === "[" || op === "{") depth++;
    else if (op === ")" || op === "]" || op === "}") {
      depth--;
      if (depth < 0) fail(`«${op}» chiusa senza essere aperta`);
    }
    push("op", op);
    adv(op.length);
  }
  if (depth > 0) fail("una parentesi aperta non è stata chiusa");
  if (out.length && out[out.length - 1].type !== "newline") push("newline", "");
  while (indents.length > 1) {
    indents.pop();
    push("dedent", "");
  }
  push("eof", "");
  return out;
}

// ---------------------------------------------------------------- AST

type Expr =
  | { k: "name"; id: string }
  | { k: "num"; v: string }
  | { k: "str"; v: string }
  | { k: "fstr"; parts: (string | Expr)[] }
  | { k: "const"; v: "true" | "false" | "null" }
  | { k: "list"; items: Expr[] }
  | { k: "tuple"; items: Expr[] }
  | { k: "dict"; entries: [Expr, Expr][] }
  | { k: "attr"; obj: Expr; name: string }
  | { k: "index"; obj: Expr; index: Expr }
  | { k: "slice"; obj: Expr; lo?: Expr; hi?: Expr }
  | { k: "call"; fn: Expr; args: Expr[]; kwargs: [string, Expr][]; line: number }
  | { k: "unary"; op: string; e: Expr }
  | { k: "not"; e: Expr }
  | { k: "bin"; op: string; l: Expr; r: Expr }
  | { k: "bool"; op: "and" | "or"; l: Expr; r: Expr }
  | { k: "cmp"; ops: string[]; items: Expr[] }
  | { k: "ifexp"; test: Expr; a: Expr; b: Expr };

interface Param {
  name: string;
  def?: Expr;
}

type Stmt =
  | { k: "expr"; e: Expr; line: number }
  | { k: "assign"; targets: Expr[]; value: Expr; line: number }
  | { k: "aug"; target: Expr; op: string; value: Expr; line: number }
  | { k: "if"; test: Expr; body: Stmt[]; orelse: Stmt[]; line: number }
  | { k: "while"; test: Expr; body: Stmt[]; line: number }
  | { k: "for"; target: Expr; iter: Expr; body: Stmt[]; line: number }
  | { k: "def"; name: string; params: Param[]; body: Stmt[]; line: number }
  | { k: "return"; e?: Expr; line: number }
  | { k: "pass" | "break" | "continue"; line: number };

// ---------------------------------------------------------------- Parser

class Parser {
  private p = 0;
  constructor(private t: Tok[]) {}

  private get cur(): Tok {
    return this.t[this.p];
  }
  private is(type: TokType, value?: string): boolean {
    const c = this.cur;
    return c.type === type && (value === undefined || c.value === value);
  }
  private op(v: string) {
    return this.is("op", v);
  }
  private kw(v: string) {
    return this.is("keyword", v);
  }
  private next(): Tok {
    return this.t[this.p++];
  }
  private eat(type: TokType, value?: string): Tok | undefined {
    return this.is(type, value) ? this.next() : undefined;
  }
  private fail(msg: string, tok: Tok = this.cur): never {
    throw new PythonError(msg, tok.line, tok.col);
  }
  private found(): string {
    const c = this.cur;
    if (c.type === "newline") return " prima della fine della riga";
    if (c.type === "eof") return " prima della fine del file";
    if (c.type === "indent") return ", ma la riga è rientrata troppo";
    if (c.type === "dedent") return ", ma il blocco è finito";
    return ` e invece c'è «${c.value}»`;
  }
  private expect(type: TokType, value: string | undefined, what: string): Tok {
    return this.eat(type, value) ?? this.fail(`mi aspettavo ${what}${this.found()}`);
  }

  file(): Stmt[] {
    const out: Stmt[] = [];
    while (!this.is("eof")) {
      if (this.eat("newline")) continue;
      if (this.is("indent")) this.fail("questa riga è rientrata, ma sopra non c'è un blocco (if, for, def…)");
      if (this.is("dedent")) {
        this.next();
        continue;
      }
      out.push(...this.statement());
    }
    return out;
  }

  private statement(): Stmt[] {
    const c = this.cur;
    if (c.type === "keyword") {
      if (UNSUPPORTED[c.value]) this.fail(UNSUPPORTED[c.value]);
      switch (c.value) {
        case "if":
          return [this.ifStmt()];
        case "while":
          return [this.whileStmt()];
        case "for":
          return [this.forStmt()];
        case "def":
          return [this.defStmt()];
        case "import":
          return this.importStmt();
        case "from":
          this.fail("usa «import math» e poi math.sqrt(…): «from … import» non è supportato");
      }
    }
    if (this.op("@")) this.fail("i decoratori (@) non sono supportati");
    return this.simpleLine();
  }

  private importStmt(): Stmt[] {
    this.next();
    for (;;) {
      const mod = this.expect("name", undefined, "il nome di un modulo");
      if (mod.value !== "math" && mod.value !== "random") {
        this.fail(`il modulo «${mod.value}» non è disponibile: si possono importare solo math e random`, mod);
      }
      if (!this.eat("op", ",")) break;
    }
    this.expect("newline", undefined, "la fine della riga");
    return [];
  }

  private simpleLine(): Stmt[] {
    const out = [this.small()];
    while (this.eat("op", ";")) {
      if (this.is("newline")) break;
      out.push(this.small());
    }
    this.expect("newline", undefined, "la fine della riga");
    return out;
  }

  private small(): Stmt {
    const c = this.cur;
    const line = c.line;
    if (c.type === "keyword") {
      if (UNSUPPORTED[c.value]) this.fail(UNSUPPORTED[c.value]);
      if (c.value === "pass" || c.value === "break" || c.value === "continue") {
        this.next();
        return { k: c.value, line };
      }
      if (c.value === "return") {
        this.next();
        const e = this.is("newline") || this.op(";") ? undefined : this.testlist();
        return { k: "return", e, line };
      }
    }
    const first = this.testlist();
    if (this.op("=")) {
      const targets = [first];
      while (this.eat("op", "=")) targets.push(this.testlist());
      const value = targets.pop()!;
      for (const tg of targets) this.checkTarget(tg, c);
      return { k: "assign", targets, value, line };
    }
    const aug = ["+=", "-=", "*=", "/=", "//=", "%=", "**=", "&=", "|=", "^=", "<<=", ">>="].find((o) => this.op(o));
    if (aug) {
      this.next();
      this.checkTarget(first, c, false);
      return { k: "aug", target: first, op: aug, value: this.testlist(), line };
    }
    if (this.op(":")) this.fail("le annotazioni di tipo (x: int = …) non sono supportate");
    return { k: "expr", e: first, line };
  }

  private checkTarget(e: Expr, at: Tok, allowTuple = true): void {
    if (e.k === "name" || e.k === "attr" || e.k === "index") return;
    if (allowTuple && (e.k === "tuple" || e.k === "list")) {
      for (const x of e.items) this.checkTarget(x, at, false);
      return;
    }
    this.fail("non si può assegnare un valore a questa espressione", at);
  }

  private block(): Stmt[] {
    this.expect("op", ":", "«:»");
    if (!this.eat("newline")) return this.simpleLine();
    this.expect("indent", undefined, "una riga rientrata");
    const body: Stmt[] = [];
    while (!this.eat("dedent")) {
      if (this.is("eof")) break;
      if (this.eat("newline")) continue;
      body.push(...this.statement());
    }
    return body;
  }

  private ifStmt(): Stmt {
    const line = this.next().line;
    const test = this.test();
    const body = this.block();
    let orelse: Stmt[] = [];
    if (this.kw("elif")) orelse = [this.ifStmt()];
    else if (this.eat("keyword", "else")) orelse = this.block();
    return { k: "if", test, body, orelse, line };
  }

  private whileStmt(): Stmt {
    const line = this.next().line;
    const test = this.test();
    const body = this.block();
    if (this.kw("else")) this.fail("while … else non è supportato");
    return { k: "while", test, body, line };
  }

  private forStmt(): Stmt {
    const tok = this.next();
    const items = [this.expr()];
    while (this.eat("op", ",")) {
      if (this.kw("in")) break;
      items.push(this.expr());
    }
    const target: Expr = items.length === 1 ? items[0] : { k: "tuple", items };
    this.checkTarget(target, tok);
    this.expect("keyword", "in", "«in»");
    const iter = this.testlist();
    const body = this.block();
    if (this.kw("else")) this.fail("for … else non è supportato");
    return { k: "for", target, iter, body, line: tok.line };
  }

  private defStmt(): Stmt {
    const line = this.next().line;
    const name = this.expect("name", undefined, "il nome della funzione").value;
    this.expect("op", "(", "«(»");
    const params: Param[] = [];
    while (!this.op(")")) {
      if (this.op("*") || this.op("**")) this.fail("*args e **kwargs non sono supportati");
      const pn = this.expect("name", undefined, "il nome di un parametro").value;
      if (this.eat("op", ":")) this.test();
      const def = this.eat("op", "=") ? this.test() : undefined;
      if (!def && params.some((q) => q.def)) this.fail("i parametri senza valore predefinito vanno prima degli altri");
      params.push({ name: pn, def });
      if (!this.eat("op", ",")) break;
    }
    this.expect("op", ")", "«)»");
    if (this.eat("op", "->")) this.test();
    return { k: "def", name, params, body: this.block(), line };
  }

  // ---------------------------------------------------------- espressioni

  testlist(): Expr {
    const first = this.test();
    if (!this.op(",")) return first;
    const items = [first];
    while (this.eat("op", ",")) {
      if (this.is("newline") || this.op("=") || this.op(")") || this.op("]") || this.op("}") || this.op(":") || this.is("eof")) break;
      items.push(this.test());
    }
    return { k: "tuple", items };
  }

  test(): Expr {
    if (this.kw("lambda")) this.fail(UNSUPPORTED.lambda);
    const a = this.orTest();
    if (this.eat("keyword", "if")) {
      const test = this.orTest();
      this.expect("keyword", "else", "«else»");
      return { k: "ifexp", test, a, b: this.test() };
    }
    return a;
  }

  private orTest(): Expr {
    let l = this.andTest();
    while (this.eat("keyword", "or")) l = { k: "bool", op: "or", l, r: this.andTest() };
    return l;
  }

  private andTest(): Expr {
    let l = this.notTest();
    while (this.eat("keyword", "and")) l = { k: "bool", op: "and", l, r: this.notTest() };
    return l;
  }

  private notTest(): Expr {
    if (this.eat("keyword", "not")) return { k: "not", e: this.notTest() };
    return this.comparison();
  }

  private comparison(): Expr {
    const first = this.expr();
    const ops: string[] = [];
    const items = [first];
    for (;;) {
      const c = this.cur;
      let op: string | undefined;
      if (c.type === "op" && ["<", ">", "==", ">=", "<=", "!="].includes(c.value)) {
        this.next();
        op = c.value;
      } else if (this.kw("in")) {
        this.next();
        op = "in";
      } else if (this.kw("not") && this.t[this.p + 1]?.type === "keyword" && this.t[this.p + 1].value === "in") {
        this.p += 2;
        op = "not in";
      } else if (this.kw("is")) {
        this.next();
        op = this.eat("keyword", "not") ? "is not" : "is";
      } else break;
      ops.push(op);
      items.push(this.expr());
    }
    return ops.length ? { k: "cmp", ops, items } : first;
  }

  private binLevel(ops: string[], nextLevel: () => Expr): Expr {
    let l = nextLevel();
    for (;;) {
      const c = this.cur;
      if (c.type !== "op" || !ops.includes(c.value)) return l;
      this.next();
      l = { k: "bin", op: c.value, l, r: nextLevel() };
    }
  }

  private expr(): Expr {
    return this.binLevel(["|"], () => this.binLevel(["^"], () => this.binLevel(["&"], () => this.binLevel(["<<", ">>"], () => this.arith()))));
  }

  private arith(): Expr {
    return this.binLevel(["+", "-"], () => this.term());
  }

  private term(): Expr {
    if (this.op("@")) this.fail("l'operatore @ non è supportato");
    return this.binLevel(["*", "/", "//", "%"], () => this.factor());
  }

  private factor(): Expr {
    const c = this.cur;
    if (c.type === "op" && (c.value === "-" || c.value === "+" || c.value === "~")) {
      this.next();
      return { k: "unary", op: c.value, e: this.factor() };
    }
    const base = this.primary();
    if (this.eat("op", "**")) return { k: "bin", op: "**", l: base, r: this.factor() };
    return base;
  }

  private primary(): Expr {
    let e = this.atom();
    for (;;) {
      if (this.eat("op", ".")) {
        const n = this.cur;
        if (n.type !== "name" && n.type !== "keyword") this.fail(`mi aspettavo un nome dopo il punto${this.found()}`);
        this.next();
        e = { k: "attr", obj: e, name: n.value };
      } else if (this.op("(")) {
        const line = this.next().line;
        e = { k: "call", fn: e, ...this.callArgs(), line };
      } else if (this.eat("op", "[")) {
        e = this.subscript(e);
      } else return e;
    }
  }

  private callArgs(): { args: Expr[]; kwargs: [string, Expr][] } {
    const args: Expr[] = [];
    const kwargs: [string, Expr][] = [];
    while (!this.op(")")) {
      if (this.op("*") || this.op("**")) this.fail("*args e **kwargs non sono supportati");
      const nextTok = this.t[this.p + 1];
      if (this.is("name") && nextTok?.type === "op" && nextTok.value === "=") {
        const n = this.next().value;
        this.next();
        kwargs.push([n, this.test()]);
      } else {
        if (kwargs.length) this.fail("gli argomenti senza nome vanno prima di quelli con nome");
        args.push(this.test());
        if (this.kw("for")) this.fail(COMPREHENSION);
      }
      if (!this.eat("op", ",")) break;
    }
    this.expect("op", ")", "«)»");
    return { args, kwargs };
  }

  private subscript(obj: Expr): Expr {
    const lo = this.op(":") ? undefined : this.test();
    if (this.eat("op", ":")) {
      const hi = this.op("]") || this.op(":") ? undefined : this.test();
      if (this.op(":")) this.fail("le slice con il passo [a:b:c] non sono supportate");
      this.expect("op", "]", "«]»");
      return { k: "slice", obj, lo, hi };
    }
    this.expect("op", "]", "«]»");
    return { k: "index", obj, index: lo! };
  }

  private atom(): Expr {
    const c = this.cur;
    if (c.type === "name") {
      this.next();
      return { k: "name", id: c.value };
    }
    if (c.type === "number") {
      this.next();
      return { k: "num", v: c.value };
    }
    if (c.type === "string" || c.type === "fstring") {
      const parts: (string | Expr)[] = [];
      let isF = false;
      while (this.is("string") || this.is("fstring")) {
        const tk = this.next();
        if (tk.type === "fstring") {
          isF = true;
          parts.push(...fstringParts(tk));
        } else parts.push(tk.value);
      }
      return isF ? { k: "fstr", parts } : { k: "str", v: parts.join("") };
    }
    if (c.type === "keyword") {
      if (c.value === "True" || c.value === "False" || c.value === "None") {
        this.next();
        return { k: "const", v: c.value === "True" ? "true" : c.value === "False" ? "false" : "null" };
      }
      if (UNSUPPORTED[c.value]) this.fail(UNSUPPORTED[c.value]);
    }
    if (this.eat("op", "(")) {
      if (this.eat("op", ")")) return { k: "tuple", items: [] };
      const e = this.testlist();
      if (this.kw("for")) this.fail(COMPREHENSION);
      this.expect("op", ")", "«)»");
      return e;
    }
    if (this.eat("op", "[")) {
      const items: Expr[] = [];
      while (!this.op("]")) {
        items.push(this.test());
        if (this.kw("for")) this.fail(COMPREHENSION);
        if (!this.eat("op", ",")) break;
      }
      this.expect("op", "]", "«]»");
      return { k: "list", items };
    }
    if (this.eat("op", "{")) {
      const entries: [Expr, Expr][] = [];
      while (!this.op("}")) {
        const key = this.test();
        if (!this.eat("op", ":")) this.fail(this.kw("for") ? COMPREHENSION : "gli insiemi {a, b} non sono supportati: usa una lista [a, b]");
        const val = this.test();
        if (this.kw("for")) this.fail(COMPREHENSION);
        entries.push([key, val]);
        if (!this.eat("op", ",")) break;
      }
      this.expect("op", "}", "«}»");
      return { k: "dict", entries };
    }
    if (c.type === "newline" || c.type === "eof") this.fail("l'espressione è incompleta");
    this.fail(`«${c.value || c.type}» non va bene qui`);
  }
}

/** Divide una f-string in testo e {espressioni}. */
function fstringParts(tok: Tok): (string | Expr)[] {
  const src = tok.value;
  const parts: (string | Expr)[] = [];
  let text = "";
  let i = 0;
  const fail = (msg: string): never => {
    throw new PythonError(msg, tok.line, tok.col);
  };
  while (i < src.length) {
    const c = src[i];
    if (c === "{" && src[i + 1] === "{") {
      text += "{";
      i += 2;
      continue;
    }
    if (c === "}" && src[i + 1] === "}") {
      text += "}";
      i += 2;
      continue;
    }
    if (c === "}") fail("nella f-string c'è una «}» senza «{»");
    if (c !== "{") {
      text += c;
      i++;
      continue;
    }
    // {espressione[:formato]}
    let depthB = 0;
    let j = i + 1;
    let spec: string | undefined;
    let quote = "";
    for (; j < src.length; j++) {
      const d = src[j];
      if (quote) {
        if (d === quote) quote = "";
        continue;
      }
      if (d === "'" || d === '"') quote = d;
      else if ("([{".includes(d)) depthB++;
      else if (")]".includes(d)) depthB--;
      else if (d === "}" && depthB === 0) break;
      else if (d === "}") depthB--;
      else if (d === ":" && depthB === 0 && spec === undefined) spec = "";
      else if (d === "!" && depthB === 0 && src[j + 1] !== "=") fail("le conversioni !r/!s nelle f-string non sono supportate");
      if (spec !== undefined && d !== ":") spec += d;
    }
    if (j >= src.length) fail("nella f-string manca una «}»");
    const inner = src.slice(i + 1, j);
    const exprText = spec !== undefined ? inner.slice(0, inner.indexOf(":")) : inner;
    if (!exprText.trim()) fail("nella f-string c'è {} vuota");
    if (text) parts.push(text);
    text = "";
    const sub = new Parser(tokenize(exprText).map((t) => ({ ...t, line: tok.line, col: tok.col })));
    let e = sub.testlist();
    if (spec) e = { k: "call", fn: { k: "name", id: "__format" }, args: [e, { k: "str", v: spec }], kwargs: [], line: tok.line };
    parts.push(e);
    i = j + 1;
  }
  if (text) parts.push(text);
  return parts;
}

// ---------------------------------------------------------------- Generatore di JavaScript

const BUILTINS: Record<string, string> = {
  print: "__py.print",
  len: "__py.len",
  range: "__py.range",
  abs: "Math.abs",
  min: "__py.min",
  max: "__py.max",
  round: "__py.round",
  int: "__py.int",
  float: "__py.float",
  str: "__py.str",
  bool: "__py.truthy",
  list: "__py.list",
  sum: "__py.sum",
  sorted: "__py.sorted",
  reversed: "__py.reversed",
  enumerate: "__py.enumerate",
  zip: "__py.zip",
  math: "Math",
  random: "__py.random",
  __format: "__py.format",
};

const MATH_ATTR: Record<string, string> = {
  pi: "Math.PI",
  e: "Math.E",
  tau: "(2 * Math.PI)",
  inf: "Infinity",
  fabs: "Math.abs",
  degrees: "__py.degrees",
  radians: "__py.radians",
};

/** Metodi che in Python hanno un significato diverso da JavaScript: passano per __py.method. */
export const PY_METHOD_NAMES = new Set([
  "append", "extend", "insert", "pop", "remove", "index", "count", "keys", "values", "items", "get", "upper", "lower",
  "strip", "lstrip", "rstrip", "startswith", "endswith", "replace", "split", "join", "find", "copy", "clear", "update",
]);

const JS_RESERVED = new Set([
  "arguments", "case", "catch", "const", "debugger", "default", "delete", "do", "enum", "eval", "export", "extends",
  "function", "implements", "instanceof", "interface", "let", "new", "package", "private", "protected", "public",
  "static", "super", "switch", "this", "throw", "typeof", "var", "void", "__py", "__v",
]);

/** Variabili che diventano la definizione del blocco. */
const META = ["name", "label", "category", "description", "props", "states", "events", "requires", "priority", "conditions", "actions"];

function collectAssigned(list: Stmt[], out: Set<string>): void {
  const addTarget = (e: Expr) => {
    if (e.k === "name") out.add(e.id);
    else if (e.k === "tuple" || e.k === "list") e.items.forEach(addTarget);
  };
  for (const s of list) {
    if (s.k === "assign") s.targets.forEach(addTarget);
    else if (s.k === "aug") addTarget(s.target);
    else if (s.k === "for") {
      addTarget(s.target);
      collectAssigned(s.body, out);
    } else if (s.k === "if") {
      collectAssigned(s.body, out);
      collectAssigned(s.orelse, out);
    } else if (s.k === "while") collectAssigned(s.body, out);
    else if (s.k === "def") out.add(s.name);
  }
}

function collectAllNames(list: Stmt[], out: Set<string>): void {
  collectAssigned(list, out);
  for (const s of list) {
    if (s.k === "def") {
      s.params.forEach((p) => out.add(p.name));
      collectAllNames(s.body, out);
    } else if (s.k === "if") {
      collectAllNames(s.body, out);
      collectAllNames(s.orelse, out);
    } else if (s.k === "while" || s.k === "for") collectAllNames(s.body, out);
  }
}

const isBoolish = (e: Expr): boolean =>
  e.k === "cmp" || e.k === "not" || (e.k === "const" && e.v !== "null") || (e.k === "bool" && isBoolish(e.l) && isBoolish(e.r));

class Gen {
  lines: string[] = [];
  map: number[] = [];
  private ind = 0;
  private line = 0;
  private funcs = new Map<string, string[]>();
  private shadowed = new Set<string>();

  private emit(code: string) {
    this.lines.push("  ".repeat(this.ind) + code);
    this.map.push(this.line);
  }

  private id(name: string) {
    return JS_RESERVED.has(name) ? `${name}_` : name;
  }

  module(stmts: Stmt[]) {
    collectAllNames(stmts, this.shadowed);
    const assigned = new Set<string>();
    collectAssigned(stmts, assigned);
    for (const s of stmts) if (s.k === "def") this.funcs.set(s.name, s.params.map((p) => p.name));
    const vars = [...assigned].filter((n) => !this.funcs.has(n));
    if (vars.length) this.emit(`let ${vars.map((n) => this.id(n)).join(", ")};`);
    this.stmts(stmts);
    this.line = 0;
    const meta = META.filter((n) => assigned.has(n) && !this.funcs.has(n)).map((n) => `${n}: ${this.id(n)}`);
    const fns = [...this.funcs.keys()].map((n) => `${JSON.stringify(n)}: ${this.id(n)}`);
    this.emit(`Pepino.definePythonBlock({ ${meta.join(", ")} }, { ${fns.join(", ")} });`);
  }

  private stmts(list: Stmt[]) {
    for (const s of list) this.stmt(s);
  }

  private block(body: Stmt[]) {
    this.ind++;
    this.stmts(body);
    this.ind--;
  }

  private stmt(s: Stmt) {
    this.line = s.line;
    switch (s.k) {
      case "expr": {
        if (s.e.k === "str") return; // docstring
        const code = this.expr(s.e);
        this.emit(`${code.startsWith("{") ? `(${code})` : code};`);
        return;
      }
      case "assign": {
        const value = this.expr(s.value);
        if (s.targets.length === 1) this.emit(`${this.target(s.targets[0])} = ${value};`);
        else this.emit(`{ const __v = ${value}; ${s.targets.map((t) => `${this.target(t)} = __v;`).join(" ")} }`);
        return;
      }
      case "aug": {
        const t = this.target(s.target);
        const v = this.expr(s.value);
        if (s.op === "//=") this.emit(`${t} = Math.floor(${t} / ${v});`);
        else if (s.op === "%=") this.emit(`${t} = __py.mod(${t}, ${v});`);
        else this.emit(`${t} ${s.op} ${v};`);
        return;
      }
      case "if": {
        this.emit(`if (${this.cond(s.test)}) {`);
        this.block(s.body);
        let orelse = s.orelse;
        while (orelse.length === 1 && orelse[0].k === "if") {
          const e = orelse[0];
          this.line = e.line;
          this.emit(`} else if (${this.cond(e.test)}) {`);
          this.block(e.body);
          orelse = e.orelse;
        }
        if (orelse.length) {
          this.emit("} else {");
          this.block(orelse);
        }
        this.emit("}");
        return;
      }
      case "while":
        this.emit(`while (${this.cond(s.test)}) {`);
        this.block(s.body);
        this.emit("}");
        return;
      case "for":
        this.emit(`for (${this.target(s.target)} of __py.iter(${this.expr(s.iter)})) {`);
        this.block(s.body);
        this.emit("}");
        return;
      case "def": {
        const params = s.params.map((p) => (p.def ? `${this.id(p.name)} = ${this.expr(p.def)}` : this.id(p.name))).join(", ");
        this.emit(`function ${this.id(s.name)}(${params}) {`);
        this.ind++;
        const locals = new Set<string>();
        collectAssigned(s.body, locals);
        for (const p of s.params) locals.delete(p.name);
        for (const b of s.body) if (b.k === "def") locals.delete(b.name);
        if (locals.size) this.emit(`let ${[...locals].map((n) => this.id(n)).join(", ")};`);
        this.stmts(s.body);
        this.ind--;
        this.line = s.line;
        this.emit("}");
        return;
      }
      case "return":
        this.emit(s.e ? `return ${this.expr(s.e)};` : "return;");
        return;
      case "pass":
        return;
      case "break":
      case "continue":
        this.emit(`${s.k};`);
        return;
    }
  }

  private target(e: Expr): string {
    if (e.k === "tuple" || e.k === "list") return `[${e.items.map((x) => this.target(x)).join(", ")}]`;
    return this.expr(e);
  }

  /** Espressione usata come condizione (if, while, not): vale la "verità" di Python. */
  private cond(e: Expr): string {
    if (e.k === "bool") return `(${this.cond(e.l)} ${e.op === "and" ? "&&" : "||"} ${this.cond(e.r)})`;
    return isBoolish(e) ? this.expr(e) : `__py.truthy(${this.expr(e)})`;
  }

  private name(id: string): string {
    if (!this.shadowed.has(id) && BUILTINS[id]) return BUILTINS[id];
    return this.id(id);
  }

  private expr(e: Expr): string {
    switch (e.k) {
      case "name":
        return this.name(e.id);
      case "num":
        return e.v;
      case "str":
        return JSON.stringify(e.v);
      case "fstr":
        return `\`${e.parts
          .map((p) => (typeof p === "string" ? p.replace(/[`\\$]/g, (m) => `\\${m}`) : `\${__py.str(${this.expr(p)})}`))
          .join("")}\``;
      case "const":
        return e.v;
      case "list":
      case "tuple":
        return `[${e.items.map((x) => this.expr(x)).join(", ")}]`;
      case "dict":
        return `{ ${e.entries.map(([k, v]) => `${k.k === "str" ? JSON.stringify(k.v) : `[${this.expr(k)}]`}: ${this.expr(v)}`).join(", ")} }`;
      case "attr": {
        if (e.obj.k === "name" && e.obj.id === "math" && !this.shadowed.has("math")) return MATH_ATTR[e.name] ?? `Math.${e.name}`;
        if (e.obj.k === "name" && e.obj.id === "random" && !this.shadowed.has("random")) return `__py.random.${e.name}`;
        return `${this.expr(e.obj)}.${e.name}`;
      }
      case "index":
        if (e.index.k === "unary" && e.index.op === "-" && e.index.e.k === "num") return `__py.at(${this.expr(e.obj)}, -${e.index.e.v})`;
        return `${this.expr(e.obj)}[${this.expr(e.index)}]`;
      case "slice":
        return `__py.slice(${this.expr(e.obj)}, ${e.lo ? this.expr(e.lo) : "undefined"}, ${e.hi ? this.expr(e.hi) : "undefined"})`;
      case "call":
        return this.call(e);
      case "unary":
        return `(${e.op}${this.expr(e.e)})`;
      case "not":
        return `(!${this.cond(e.e)})`;
      case "bin": {
        const l = this.expr(e.l);
        const r = this.expr(e.r);
        if (e.op === "//") return `Math.floor(${l} / ${r})`;
        if (e.op === "%") return `__py.mod(${l}, ${r})`;
        return `(${l} ${e.op} ${r})`;
      }
      case "bool": {
        // `[] or x` in Python dà x: le liste vuote sono false, in JavaScript no.
        if (isBoolish(e.l) && isBoolish(e.r)) return `(${this.expr(e.l)} ${e.op === "and" ? "&&" : "||"} ${this.expr(e.r)})`;
        return `__py.${e.op}(${this.expr(e.l)}, () => ${this.expr(e.r)})`;
      }
      case "cmp": {
        const parts: string[] = [];
        for (let k = 0; k < e.ops.length; k++) parts.push(this.compare(e.ops[k], e.items[k], e.items[k + 1]));
        return parts.length === 1 ? parts[0] : `(${parts.join(" && ")})`;
      }
      case "ifexp":
        return `(${this.cond(e.test)} ? ${this.expr(e.a)} : ${this.expr(e.b)})`;
    }
  }

  private compare(op: string, ae: Expr, be: Expr): string {
    const a = this.expr(ae);
    const b = this.expr(be);
    // Con None si confronta in modo "largo": così anche un valore mancante (undefined) conta come None.
    const loose = a === "null" || b === "null";
    switch (op) {
      case "==":
      case "is":
        return `(${a} ${loose ? "==" : "==="} ${b})`;
      case "!=":
      case "is not":
        return `(${a} ${loose ? "!=" : "!=="} ${b})`;
      case "in":
        return `__py.contains(${b}, ${a})`;
      case "not in":
        return `(!__py.contains(${b}, ${a}))`;
      default:
        return `(${a} ${op} ${b})`;
    }
  }

  private call(e: Extract<Expr, { k: "call" }>): string {
    const fn = e.fn;
    const kwObject = () => `{ ${e.kwargs.map(([k, v]) => `${JSON.stringify(k)}: ${this.expr(v)}`).join(", ")} }`;
    if (fn.k === "attr" && PY_METHOD_NAMES.has(fn.name) && !(fn.obj.k === "name" && (fn.obj.id === "math" || fn.obj.id === "random"))) {
      const args = [this.expr(fn.obj), JSON.stringify(fn.name), ...e.args.map((a) => this.expr(a))];
      if (e.kwargs.length) args.push(kwObject());
      return `__py.method(${args.join(", ")})`;
    }
    if (fn.k === "name" && this.funcs.has(fn.id) && e.kwargs.length) {
      const params = this.funcs.get(fn.id)!;
      const slots = e.args.map((a) => this.expr(a));
      for (const [k, v] of e.kwargs) {
        const idx = params.indexOf(k);
        if (idx < 0) throw new PythonError(`${fn.id}() non ha un parametro «${k}»`, e.line, 1);
        while (slots.length < idx) slots.push("undefined");
        slots[idx] = this.expr(v);
      }
      return `${this.id(fn.id)}(${slots.join(", ")})`;
    }
    const args = e.args.map((a) => this.expr(a));
    if (e.kwargs.length) args.push(kwObject());
    return `${this.expr(fn)}(${args.join(", ")})`;
  }
}

export interface CompiledPython {
  code: string;
  /** Per ogni riga del JavaScript generato, la riga Python da cui viene (0 = nessuna). */
  lineMap: number[];
}

export function compilePython(source: string): CompiledPython {
  const stmts = new Parser(tokenize(source)).file();
  const g = new Gen();
  g.module(stmts);
  return { code: ['"use strict";', "const __py = Pepino.py;", ...g.lines].join("\n"), lineMap: [0, 0, ...g.map] };
}

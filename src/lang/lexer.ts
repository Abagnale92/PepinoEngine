import { RESERVED, type Lang, type WordId } from "./words";
import { type Diagnostic, type MsgArg, makeDiag } from "./messages";

export type TokType = "name" | "kw" | "num" | "str" | "op" | "nl" | "indent" | "dedent" | "eof";

/** Un pezzo di codice dentro una stringa: "Ciao {nome}". */
export interface StrHole {
  src: string;
  pos: number;
  line: number;
  col: number;
}

export interface Token {
  t: TokType;
  /** Il testo così com'è scritto (per gli operatori: l'operatore). */
  v: string;
  kw?: WordId;
  num?: number;
  parts?: (string | StrHole)[];
  line: number;
  col: number;
  pos: number;
  end: number;
}

export interface LexResult {
  tokens: Token[];
  diagnostics: Diagnostic[];
  /** Quante parole chiave per lingua: serve a capire in che lingua è scritto il programma. */
  counts: Record<Lang, number>;
}

const OPS = ["->", "=>", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "^=", "≠", "≤", "≥", "+", "-", "*", "/", "%", "^", "<", ">", "=", "(", ")", "[", "]", "{", "}", ",", ":", ".", "?", "°", "!"];
const RE_NAME = /[\p{L}_][\p{L}\p{N}_]*/uy;
const RE_NUM = /\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?/y;

export function tokenize(source: string, base: { pos: number; line: number; col: number } = { pos: 0, line: 1, col: 1 }, inner = false): LexResult {
  const s = source.replace(/\r\n?/g, "\n");
  const out: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  const counts: Record<Lang, number> = { it: 0, en: 0 };
  const indents = [0];
  let i = 0;
  let line = base.line;
  let col = base.col;
  let depth = 0;
  let lineStart = !inner;

  const fail = (key: string, args: MsgArg[] = [], l = line, c = col, p = i, e = i + 1) =>
    diagnostics.push(makeDiag("error", key, args, { line: l, col: c, pos: base.pos + p, end: base.pos + e }));
  const push = (t: TokType, v: string, start: number, l: number, c: number, extra: Partial<Token> = {}) =>
    out.push({ t, v, line: l, col: c, pos: base.pos + start, end: base.pos + i, ...extra });

  while (i < s.length) {
    if (lineStart && depth === 0) {
      // Rientro: spazi (un tab vale 4).
      let n = 0;
      const start = i;
      while (s[i] === " " || s[i] === "\t") {
        n += s[i] === "\t" ? 4 - (n % 4) : 1;
        i++;
      }
      col = base.col + (i - start);
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
        push("indent", "", i, line, col);
      } else if (n < top) {
        while (n < indents[indents.length - 1]) {
          indents.pop();
          push("dedent", "", i, line, col);
        }
        if (n !== indents[indents.length - 1]) fail("lex.badIndent", [], line, 1, start, i);
      }
      lineStart = false;
    }

    const ch = s[i];
    const startCol = col;
    const start = i;
    if (ch === "\n") {
      if (depth === 0 && !inner) {
        push("nl", "", i, line, col);
        lineStart = true;
      }
      i++;
      line++;
      col = 1;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r") {
      i++;
      col++;
      continue;
    }
    if (ch === "#") {
      while (i < s.length && s[i] !== "\n") {
        i++;
        col++;
      }
      continue;
    }
    if (ch === "\\" && s[i + 1] === "\n") {
      i += 2;
      line++;
      col = 1;
      continue;
    }

    RE_NUM.lastIndex = i;
    const num = RE_NUM.exec(s);
    if (num) {
      i += num[0].length;
      col += num[0].length;
      push("num", num[0], start, line, startCol, { num: Number(num[0].replace(/_/g, "")) });
      continue;
    }

    RE_NAME.lastIndex = i;
    const name = RE_NAME.exec(s);
    if (name) {
      const text = name[0];
      i += text.length;
      col += text.length;
      const r = RESERVED.get(text);
      if (r) {
        push("kw", text, start, line, startCol, { kw: r.id });
        if (r.lang !== "both") counts[r.lang]++;
      } else push("name", text, start, line, startCol);
      continue;
    }

    if (ch === '"' || ch === "'") {
      const parts: (string | StrHole)[] = [];
      let buf = "";
      i++;
      col++;
      let closed = false;
      while (i < s.length) {
        const c = s[i];
        if (c === "\n") break;
        if (c === ch) {
          i++;
          col++;
          closed = true;
          break;
        }
        if (c === "\\") {
          const n = s[i + 1];
          const esc: Record<string, string> = { n: "\n", t: "\t", "\\": "\\", '"': '"', "'": "'", "{": "{", "}": "}", "0": "\0" };
          if (n !== undefined && n in esc) {
            buf += esc[n];
            i += 2;
            col += 2;
            continue;
          }
          fail("lex.badEscape", [n ?? ""], line, col, i, i + 2);
          i++;
          col++;
          continue;
        }
        if (c === "{" && s[i + 1] === "{") {
          buf += "{";
          i += 2;
          col += 2;
          continue;
        }
        if (c === "}" && s[i + 1] === "}") {
          buf += "}";
          i += 2;
          col += 2;
          continue;
        }
        if (c === "{") {
          // Codice dentro la stringa: fino alla graffa che chiude (tenendo conto di stringhe e graffe annidate).
          const holeLine = line;
          const holeCol = col + 1;
          let j = i + 1;
          let d = 1;
          while (j < s.length && s[j] !== "\n") {
            const cj = s[j];
            if (cj === '"' || cj === "'") {
              const q = cj;
              j++;
              while (j < s.length && s[j] !== q && s[j] !== "\n") j += s[j] === "\\" ? 2 : 1;
              j++;
              continue;
            }
            if (cj === "{") d++;
            else if (cj === "}" && --d === 0) break;
            j++;
          }
          if (s[j] !== "}") {
            fail("lex.openHole", [], line, col, i, j);
            i = j;
            col += j - start;
            break;
          }
          if (buf) parts.push(buf);
          buf = "";
          const src = s.slice(i + 1, j);
          if (!src.trim()) fail("lex.emptyHole", [], line, col, i, j + 1);
          parts.push({ src, pos: base.pos + i + 1, line: holeLine, col: holeCol });
          col += j + 1 - i;
          i = j + 1;
          continue;
        }
        buf += c;
        i++;
        col++;
      }
      if (!closed) fail("lex.openString", [], line, startCol, start, i);
      if (buf || !parts.length) parts.push(buf);
      push("str", s.slice(start, i), start, line, startCol, { parts });
      continue;
    }

    const op = OPS.find((o) => s.startsWith(o, i));
    if (op) {
      i += op.length;
      col += op.length;
      if (op === "(" || op === "[" || op === "{") depth++;
      else if ((op === ")" || op === "]" || op === "}") && depth > 0) depth--;
      const v = op === "≠" ? "!=" : op === "≤" ? "<=" : op === "≥" ? ">=" : op;
      push("op", v, start, line, startCol);
      continue;
    }

    fail("lex.badChar", [ch], line, col, i, i + 1);
    i++;
    col++;
  }

  if (!inner) {
    if (out.length && out[out.length - 1].t !== "nl") push("nl", "", i, line, col);
    while (indents.length > 1) {
      indents.pop();
      push("dedent", "", i, line, col);
    }
  }
  push("eof", "", i, line, col);
  return { tokens: out, diagnostics, counts };
}

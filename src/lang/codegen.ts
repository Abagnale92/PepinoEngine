/**
 * Da Pepino a JavaScript. Il codice generato riceve `$` (le funzioni di supporto, runtime.ts) e
 * `$host` (l'ambiente: l'engine registra i blocchi), e restituisce { main, tests }.
 *
 * La memoria segue le regole di Pepino anche in JavaScript: i valori letti da un posto vengono copiati,
 * `sposta` svuota la variabile, e quando una variabile finisce il suo valore viene distrutto subito
 * (try/finally), chiamando i «quando finisce» nell'ordine inverso, come i distruttori del C++.
 */
import type * as A from "./ast";
import type { BlockInfo, CheckResult } from "./checker";
import { BUILTIN_BY_ID } from "./stdlib";
import { isPrimitive, needsDrop, real, resolve, type Binding, type FnInfo, type RecordInfo, type Type } from "./types";
import { UNITS, type Lang } from "./words";

interface Line {
  text: string;
  pep: number;
}

class Out {
  lines: Line[] = [];
  depth = 0;
  line(text: string, pep: number): void {
    this.lines.push({ text: "  ".repeat(this.depth) + text, pep });
  }
  push(lines: Line[]): void {
    for (const l of lines) this.lines.push({ text: "  ".repeat(this.depth) + l.text, pep: l.pep });
  }
}

export interface Generated {
  code: string;
  /** Per ogni riga del codice generato (da 1), la riga del programma Pepino. */
  lineMap: number[];
}

const str = (s: string) => JSON.stringify(s);

/** Posizioni dei file letti con «usa»: ogni file parte da un multiplo di FILE_BASE. */
export const FILE_BASE = 1e8;

/** La riga per la mappa delle righe: nei file letti con «usa» si aggiunge (numero del file) × 1 000 000. */
const lineOf = (s: { line: number; pos: number }) => s.line + Math.floor(s.pos / FILE_BASE) * 1e6;

/** Il contesto della funzione che si sta scrivendo. */
interface FnGen {
  fn: FnInfo;
  temps: number;
  /** Variabili già dichiarate in cima al blocco (servono al finally che le distrugge). */
  predeclared: Set<Binding>;
}

export class Codegen {
  private out = new Out();
  private f: FnGen;
  private pep = 1;

  constructor(
    private r: CheckResult,
    private lang: Lang,
  ) {
    this.f = { fn: r.main, temps: 0, predeclared: new Set() };
  }

  // ---------------------------------------------------------------- utilità

  private temp(): string {
    return `$t${++this.f.temps}`;
  }

  private emit(text: string): void {
    this.out.line(text, this.pep);
  }

  /** Scrive una funzione in un Out a parte (con le sue variabili temporanee dichiarate in cima). */
  private fnBody(fn: FnInfo, header: string, write: () => void): Line[] {
    const savedOut = this.out;
    const savedF = this.f;
    const savedPep = this.pep;
    this.out = new Out();
    this.out.depth = 1;
    this.f = { fn, temps: 0, predeclared: new Set() };
    write();
    const temps = this.f.temps;
    const body = this.out.lines;
    this.out = savedOut;
    this.f = savedF;
    this.pep = savedPep;
    const head: Line[] = [{ text: header, pep: body[0]?.pep ?? this.pep }];
    if (temps) head.push({ text: `  let ${Array.from({ length: temps }, (_, i) => `$t${i + 1}`).join(", ")};`, pep: head[0].pep });
    return [...head, ...body, { text: "}", pep: body[body.length - 1]?.pep ?? this.pep }];
  }

  /** I parametri, con i valori predefiniti (JavaScript li calcola a ogni chiamata, come Pepino). */
  private params(fn: FnInfo): string {
    return (fn.paramRefs ?? [])
      .map((b, i) => {
        const def = fn.params[i]?.def;
        return def ? `${real(b).jsName} = ${this.value(def)}` : real(b).jsName;
      })
      .join(", ");
  }

  // ---------------------------------------------------------------- programma

  generate(): Generated {
    const r = this.r;
    this.emit(`"use strict";`);
    // Variabili del programma: visibili dalle funzioni.
    if (r.globals.length) this.emit(`let ${r.globals.map((b) => b.jsName).join(", ")};`);
    for (const rec of r.records) this.record(rec);
    for (const fn of r.fns) if (!fn.owner) this.out.push(this.fnDecl(fn));
    for (const b of r.blocks) this.block(b);
    // Programma principale.
    const main = r.main;
    this.out.push(
      this.fnBody(main, `function${main.routine ? "*" : ""} $main() {`, () => {
        this.stmts(this.mainList ?? []);
      }),
    );
    // Le variabili del programma si distruggono alla fine (dopo le prove), non alla fine di $main.
    const dropped = r.globals.filter((b) => needsDrop(b.type)).reverse();
    this.emit(`function $dropGlobals() { ${dropped.map((b) => `$.drop(${b.jsName}); ${b.jsName} = undefined;`).join(" ")} }`);
    const tests = r.tests.map((t, i) => {
      this.out.push(this.fnBody(t.fn, `function${t.fn.routine ? "*" : ""} $test${i}() {`, () => this.stmtsScoped(t.fn.body ?? [])));
      return `{ name: ${str(t.name)}, fn: $test${i}, routine: ${t.fn.routine} }`;
    });
    this.emit(`return { main: $main, routine: ${main.routine}, dropGlobals: $dropGlobals, tests: [${tests.join(", ")}] };`);
    return { code: this.out.lines.map((l) => l.text).join("\n"), lineMap: this.out.lines.map((l) => l.pep) };
  }

  mainList?: A.Stmt[];

  private fnDecl(fn: FnInfo, method = false): Line[] {
    const star = fn.routine ? "*" : "";
    const header = method ? `${star}${fn.jsName}(${this.params(fn)}) {` : `function${star} ${fn.jsName}(${this.params(fn)}) {`;
    this.pep = fn.decl ? lineOf(fn.decl) : this.pep;
    return this.fnBody(fn, header, () => this.fnInner(fn));
  }

  /** Il corpo di una funzione: parametri «cambia» riscritti all'uscita, variabili distrutte. */
  private fnInner(fn: FnInfo): void {
    const changes = (fn.paramRefs ?? []).filter((b) => b.mode === "change");
    if (changes.length) {
      this.emit("try {");
      this.out.depth++;
    }
    this.stmtsScoped(fn.body ?? [], false, fn);
    if (changes.length) {
      this.out.depth--;
      this.emit(`} finally {`);
      this.emit(`  ${changes.map((b, i) => `$.io[${i}] = ${real(b).jsName};`).join(" ")}`);
      this.emit("}");
    }
  }

  // ---------------------------------------------------------------- tipi (classi)

  private recordCommon(rec: RecordInfo, className: string): void {
    const fields = rec.fields;
    // Copia (senza «quando crea», come il costruttore di copia del C++).
    this.emit(`$copy() {`);
    this.emit(`  const o = Object.create(${className}.prototype);`);
    for (const f of fields) this.emit(`  o.${f.jsName} = ${isPrimitive(f.type) ? `this.${f.jsName}` : `$.copy(this.${f.jsName})`};`);
    this.emit(`  return o;`);
    this.emit(`}`);
    this.emit(`$eq(o) {`);
    this.emit(`  return ${fields.length ? fields.map((f) => (isPrimitive(f.type) ? `this.${f.jsName} === o.${f.jsName}` : `$.eq(this.${f.jsName}, o.${f.jsName})`)).join(" && ") : "true"};`);
    this.emit(`}`);
    this.emit(`$str() {`);
    this.emit(`  return ${str(rec.name + "(")} + ${fields.length ? fields.map((f, i) => `${str((i ? ", " : "") + f.name + ": ")} + $.repr(this.${f.jsName})`).join(" + ") : '""'} + ")";`);
    this.emit(`}`);
  }

  private record(rec: RecordInfo): void {
    const cls = rec.jsName;
    this.pep = rec.decl ? lineOf(rec.decl) : 1;
    this.emit(`class ${cls} {`);
    this.out.depth++;
    const args = rec.fields.map((_, i) => `$a${i}`);
    this.out.push(
      this.fnBody(this.r.main, `constructor(${args.join(", ")}) {`, () => {
        rec.fields.forEach((f, i) => {
          this.pep = lineOf(f.decl.span);
          const def = f.decl.def ? this.value(f.decl.def) : "null";
          this.emit(`this.${f.jsName} = $a${i} === undefined ? ${def} : $a${i};`);
        });
        if (rec.onCreate) this.emit(`this.$create();`);
      }),
    );
    this.recordCommon(rec, cls);
    if (rec.onCreate) this.out.push(this.fnBody(rec.onCreate, `$create() {`, () => this.stmtsScoped(rec.onCreate!.body ?? [])));
    if (rec.needsDrop) {
      const lines = this.fnBody(rec.onEnd ?? this.r.main, `$drop() {`, () => {
        this.emit(`if (this.$dead) return;`);
        this.emit(`this.$dead = true;`);
        if (rec.onEnd) this.stmtsScoped(rec.onEnd.body ?? []);
        for (const f of [...rec.fields].reverse()) if (needsDrop(f.type)) this.emit(`$.drop(this.${f.jsName});`);
      });
      this.out.push(lines);
    }
    for (const fn of this.r.fns) if (fn.owner === rec) this.out.push(this.fnDecl(fn, true));
    this.out.depth--;
    this.emit(`}`);
    this.emit(`${cls}.prototype.$type = ${str(rec.name)};`);
  }

  // ---------------------------------------------------------------- blocchi dell'engine

  private block(b: BlockInfo): void {
    const rec = b.rec;
    const cls = rec.jsName;
    this.pep = lineOf(b.decl);
    this.emit(`class ${cls} {`);
    this.out.depth++;
    this.out.push(
      this.fnBody(b.init, `constructor($b) {`, () => {
        this.emit(`this.$b = $b;`);
        this.emit(`this.$dt = 1 / 60;`);
        for (const f of rec.fields) {
          this.pep = lineOf(f.decl.span);
          this.emit(`this.${f.jsName} = ${f.decl.def ? this.value(f.decl.def) : "null"};`);
        }
      }),
    );
    if (rec.fields.some((f) => needsDrop(f.type))) {
      this.emit(`$drop() {`);
      for (const f of [...rec.fields].reverse()) if (needsDrop(f.type)) this.emit(`  $.drop(this.${f.jsName});`);
      this.emit(`}`);
    }
    for (const h of b.handlers) {
      this.pep = lineOf(h.h.span);
      this.out.push(this.fnBody(h.fn, `${h.fn.routine ? "*" : ""}${h.fn.jsName}(${this.params(h.fn)}) {`, () => this.fnInner(h.fn)));
    }
    for (const a of b.actions) {
      this.pep = lineOf(a.a.span);
      this.out.push(this.fnBody(a.fn, `${a.fn.routine ? "*" : ""}${a.fn.jsName}(${this.params(a.fn)}) {`, () => this.fnInner(a.fn)));
    }
    for (const fn of this.r.fns) if (fn.owner === rec) this.out.push(this.fnDecl(fn, true));
    this.out.depth--;
    this.emit(`}`);
    const d = b.decl;
    const schema = (kind: string, label: string, def: unknown, extra: Record<string, unknown> = {}) => {
      const o: Record<string, unknown> = { type: kind, label, default: def, ...extra };
      for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
      return o;
    };
    const props: Record<string, unknown> = {};
    for (const p of b.props) {
      props[p.name] = schema(p.kind, p.label, p.def, {
        unit: p.unit,
        min: p.decl.min,
        max: p.decl.max,
        step: p.decl.step,
        group: p.decl.group,
        help: p.decl.help,
        options: p.options?.map((o) => ({ value: o, label: o.replace(/_/g, " ") })),
      });
    }
    const actions: Record<string, unknown> = {};
    const conditions: Record<string, unknown> = {};
    for (const a of b.actions) {
      const params: Record<string, unknown> = {};
      for (const p of a.params) params[p.name] = schema(p.kind, p.label, p.def, { options: p.options?.map((o) => ({ value: o, label: o.replace(/_/g, " ") })) });
      const entry = { label: a.a.label ?? a.a.name.replace(/_/g, " "), params, method: a.fn.jsName, routine: a.fn.routine };
      if (a.a.kind === "action") actions[a.a.name] = entry;
      else conditions[a.a.name] = entry;
    }
    const spec = {
      name: d.name,
      label: d.label,
      description: d.description,
      category: d.category,
      priority: d.priority,
      requires: b.requires,
      props,
      events: d.events.map((e) => ({ id: e.name, label: e.label ?? e.name.replace(/_/g, " ") })),
      states: d.states.map((e) => ({ id: e.name, label: e.label ?? e.name.replace(/_/g, " ") })),
      actions,
      conditions,
      handlers: b.handlers.map((h) => ({ hook: h.h.hook, event: h.h.eventName, method: h.fn.jsName, routine: h.fn.routine })),
    };
    this.emit(`$host.block(${JSON.stringify(spec)}, ($b) => new ${cls}($b));`);
  }

  // ---------------------------------------------------------------- istruzioni

  /**
   * Un blocco di istruzioni. Se qualche variabile del blocco va distrutta, le variabili si dichiarano
   * in cima e un finally le distrugge (in ordine inverso) anche se si esce prima o c'è un errore.
   */
  private stmtsScoped(list: A.Stmt[], isMain = false, fn?: FnInfo): void {
    const decls = (this.r.scopeDecls.get(list) ?? []).filter((b) => !b.alias);
    const owned = decls.filter((b) => (b.kind === "local" || b.kind === "global" || (b.kind === "param" && b.mode === "take")) && needsDrop(b.type));
    const params = new Set(fn?.paramRefs ?? []);
    if (owned.length) {
      const pre = decls.filter((b) => !params.has(b) && !b.global && b.kind !== "global" && b.kind !== "loop" && b.kind !== "catch");
      if (pre.length) this.emit(`let ${pre.map((b) => b.jsName).join(", ")};`);
      for (const b of pre) this.f.predeclared.add(b);
      this.emit("try {");
      this.out.depth++;
      this.stmts(list);
      this.out.depth--;
      this.emit("} finally {");
      this.emit(`  ${[...owned].reverse().map((b) => `$.drop(${b.jsName});`).join(" ")}`);
      this.emit("}");
    } else this.stmts(list);
    void isMain;
  }

  private stmts(list: A.Stmt[]): void {
    for (const s of list) this.stmt(s);
  }

  private body(list: A.Stmt[]): void {
    this.out.depth++;
    this.stmtsScoped(list);
    this.out.depth--;
  }

  private declared(b: Binding): boolean {
    return !!b.global || b.kind === "global" || this.f.predeclared.has(b);
  }

  private loopGuard(): string {
    return `if (++$.n > 100000) $.guard();`;
  }

  private keepUsed = false;

  /** Un'istruzione; se ha creato valori temporanei da distruggere, li distrugge alla fine (anche se esce prima). */
  private stmt(s: A.Stmt): void {
    const savedOut = this.out;
    const savedKeep = this.keepUsed;
    this.out = new Out();
    this.out.depth = savedOut.depth;
    this.keepUsed = false;
    try {
      this.stmtInner(s);
    } finally {
      const lines = this.out.lines;
      const used = this.keepUsed;
      this.out = savedOut;
      this.keepUsed = savedKeep;
      if (used) {
        const k = this.temp();
        this.out.line(`${k} = $.mark();`, s.line);
        this.out.line("try {", s.line);
        for (const l of lines) this.out.lines.push({ text: `  ${l.text}`, pep: l.pep });
        this.out.line(`} finally { $.release(${k}); }`, s.line);
      } else this.out.lines.push(...lines);
    }
  }

  private stmtInner(s: A.Stmt): void {
    this.pep = lineOf(s);
    switch (s.k) {
      case "expr": {
        const t = s.e.ty;
        const js = this.expr(s.e, true);
        if (t && needsDrop(t) && !this.isPlaceExpr(s.e)) this.emit(`$.drop(${js});`);
        else if (s.e.k !== "pipe" || js !== "undefined") this.emit(`${js};`);
        return;
      }
      case "assign":
        return this.assign(s);
      case "const": {
        const b = s.declares;
        if (!b) return;
        const v = this.value(s.value);
        this.emit(this.declared(b) ? `${b.jsName} = ${v};` : `const ${b.jsName} = ${v};`);
        return;
      }
      case "if": {
        for (const h of s.hoisted ?? []) if (!this.declared(h)) this.emit(`let ${h.jsName};`);
        s.branches.forEach((br, i) => {
          this.pep = lineOf(br.span);
          this.emit(`${i ? "} else if" : "if"} (${this.expr(br.cond)}) {`);
          this.body(br.body);
        });
        if (s.els) {
          this.emit("} else {");
          this.body(s.els);
        }
        this.emit("}");
        return;
      }
      case "while":
        this.emit(`while (${this.expr(s.cond)}) {`);
        this.emit(`  ${this.loopGuard()}`);
        this.body(s.body);
        this.emit("}");
        return;
      case "repeat": {
        if (!s.count) {
          this.emit("for (;;) {");
          this.emit(`  ${this.loopGuard()}`);
        } else {
          const n = this.temp();
          this.emit(`for (${n} = $.times(${this.expr(s.count)}); ${n} > 0; ${n}--) {`);
          this.emit(`  ${this.loopGuard()}`);
        }
        this.body(s.body);
        this.emit("}");
        return;
      }
      case "foreach":
        return this.forEach(s);
      case "forrange": {
        const v = s.v.ref ? real(s.v.ref).jsName : "$i";
        const r = this.temp();
        this.emit(`for (let ${r} = $.rng(${this.expr(s.from)}, ${this.expr(s.to)}${s.step ? `, ${this.expr(s.step)}` : ""}), ${v} = ${r}[0]; ${r}[2] > 0 ? ${v} <= ${r}[1] : ${v} >= ${r}[1]; ${v} = $.fix(${v} + ${r}[2])) {`);
        this.body(s.body);
        this.emit("}");
        return;
      }
      case "return": {
        if (!s.value) {
          this.emit("return;");
          return;
        }
        if (s.moveLocal && needsDrop(s.moveLocal.type)) {
          const t = this.temp();
          const n = real(s.moveLocal).jsName;
          this.emit(`return (${t} = ${n}, ${n} = undefined, ${t});`);
          return;
        }
        this.emit(`return ${this.value(s.value)};`);
        return;
      }
      case "break":
        this.emit("break;");
        return;
      case "continue":
        this.emit("continue;");
        return;
      case "pass":
        return;
      case "check":
        this.emit(`$.check(${this.expr(s.cond)}, ${s.message ? this.textOf(s.message) : "undefined"}, ${s.line});`);
        return;
      case "wait":
        if (s.until) this.emit(`yield () => ${this.expr(s.until)};`);
        else if (s.seconds) this.emit(`yield ${this.expr(s.seconds)};`);
        else this.emit("yield 0;");
        return;
      case "try": {
        if (s.success) return this.trySuccess(s, s.success);
        const e = this.temp();
        this.emit("try {");
        this.body(s.body);
        this.emit(`} catch (${e}_) {`);
        this.out.depth++;
        this.emit(`$.rethrowFatal(${e}_);`);
        if (s.errVar?.ref) this.emit(`const ${real(s.errVar.ref).jsName} = $.errMsg(${e}_);`);
        this.out.depth--;
        this.body(s.handler);
        this.emit("}");
        return;
      }
      case "fail":
        this.emit(`throw $.fail(${this.textOf(s.message)});`);
        return;
      case "panic":
        this.emit(`throw $.panic(${s.message ? this.textOf(s.message) : "undefined"}, ${s.line});`);
        return;
      case "later":
        return this.later(s);
      case "match": {
        for (const h of s.hoisted ?? []) if (!this.declared(h)) this.emit(`let ${h.jsName};`);
        const t = this.temp();
        const prim = isPrimitive(s.subject.ty ?? { k: "any" });
        this.emit(`${t} = ${this.expr(s.subject)};`);
        s.cases.forEach((c, i) => {
          this.pep = lineOf(c.span);
          const test = c.values.map((v) => (prim ? `${t} === ${this.expr(v)}` : `$.eq(${t}, ${this.expr(v)})`)).join(" || ");
          this.emit(`${i ? "} else if" : "if"} (${test}) {`);
          this.body(c.body);
        });
        if (s.els) {
          this.emit(s.cases.length ? "} else {" : "{");
          this.body(s.els);
        }
        if (s.cases.length || s.els) this.emit("}");
        return;
      }
      case "emit":
        this.emit(`this.$b.emit(${str(s.event)});`);
        return;
      default:
        return;
    }
  }

  /**
   * tenta … se errore … bravo: le variabili del tentativo si dichiarano prima, così le vede anche «bravo»,
   * che sta fuori dal try (un suo errore non finisce nel «se errore»). Si distruggono dopo «bravo».
   */
  private trySuccess(s: A.Try, success: A.Stmt[]): void {
    const decls = (this.r.scopeDecls.get(s.body) ?? []).filter((b) => !b.alias && b.kind !== "loop" && b.kind !== "catch");
    const owned = decls.filter((b) => b.kind === "local" && needsDrop(b.type));
    const fresh = decls.filter((b) => !this.declared(b));
    if (fresh.length) this.emit(`let ${fresh.map((b) => b.jsName).join(", ")};`);
    for (const b of fresh) this.f.predeclared.add(b);
    const e = this.temp();
    const ok = this.temp();
    this.emit(`${ok} = false;`);
    if (owned.length) {
      this.emit("try {");
      this.out.depth++;
    }
    this.emit("try {");
    this.out.depth++;
    this.stmts(s.body);
    this.emit(`${ok} = true;`);
    this.out.depth--;
    this.emit(`} catch (${e}_) {`);
    this.out.depth++;
    this.emit(`$.rethrowFatal(${e}_);`);
    if (s.errVar?.ref) this.emit(`const ${real(s.errVar.ref).jsName} = $.errMsg(${e}_);`);
    this.out.depth--;
    this.body(s.handler);
    this.emit("}");
    this.emit(`if (${ok}) {`);
    this.body(success);
    this.emit("}");
    if (owned.length) {
      this.out.depth--;
      this.emit(`} finally { ${[...owned].reverse().map((b) => `$.drop(${b.jsName});`).join(" ")} }`);
    }
  }

  /**
   * cappuccino [durata]: il corpo è un generatore che parte più tardi. Le variabili di fuori che usa sono copie
   * prese adesso (come nelle funzioni veloci), e si distruggono quando il cappuccino finisce o viene annullato.
   */
  private later(s: A.Later): void {
    const fn = s.fn;
    if (!fn) return;
    const caps = (s.captures ?? []).map((b) => real(b));
    const delay = s.delay ? this.expr(s.delay) : "0";
    const owned = caps.filter((b) => needsDrop(b.type));
    const lines = this.fnBody(fn, "function* () {", () => {
      this.emit("try {");
      this.out.depth++;
      // La prima pausa: il cappuccino è ordinato, parte quando tocca a lui.
      this.emit("yield;");
      this.stmtsScoped(s.body);
      this.out.depth--;
      this.emit(owned.length ? `} finally { ${[...owned].reverse().map((b) => `$.drop(${b.jsName});`).join(" ")} }` : "} finally {}");
    });
    const values = caps.map((b) => (isPrimitive(b.type) ? this.bindingJs(b) : `$.copy(${this.bindingJs(b)})`));
    this.emit(`$.later(${delay}, ((${caps.map((b) => b.jsName).join(", ")}) => (`);
    this.out.depth++;
    this.out.push(lines);
    this.out.depth--;
    this.emit(`))(${values.join(", ")}).call(this));`);
  }

  private forEach(s: A.ForEach): void {
    const it = resolve(s.iter.ty ?? { k: "any" });
    const vars = s.vars.map((v) => (v.ref ? real(v.ref).jsName : "$_"));
    const src = this.temp();
    this.emit(`${src} = ${this.expr(s.iter)};`);
    if (it.k === "map") {
      if (vars.length === 1) this.emit(`for (const ${vars[0]} of [...${src}.keys()]) {`);
      else if (s.change) {
        const v = this.temp();
        this.emit(`for (const [${vars[0]}, ${v}] of [...${src}]) {`);
        this.emit(`  let ${vars[1]} = ${v};`);
        this.emit("  try {");
        this.out.depth++;
        this.body(s.body);
        this.out.depth--;
        this.emit(`  } finally { ${src}.set(${vars[0]}, ${vars[1]}); }`);
        this.emit("}");
        return;
      } else this.emit(`for (const [${vars[0]}, ${vars[1]}] of ${src}) {`);
      this.body(s.body);
      this.emit("}");
      return;
    }
    if (it.k === "list" || it.k === "text") {
      const arr = it.k === "text" ? `Array.from(${src})` : src;
      if (it.k === "text") this.emit(`${src} = ${arr};`);
      if (vars.length === 1 && !s.change) {
        this.emit(`for (const ${vars[0]} of ${src}) {`);
        this.body(s.body);
        this.emit("}");
        return;
      }
      const i = this.temp();
      this.emit(`for (${i} = 0; ${i} < ${src}.length; ${i}++) {`);
      this.out.depth++;
      if (vars.length === 2) this.emit(`const ${vars[0]} = ${i} + 1;`);
      const el = vars[vars.length - 1];
      if (s.change) {
        this.emit(`let ${el} = ${src}[${i}];`);
        this.emit("try {");
        this.body(s.body);
        this.emit(`} finally { ${src}[${i}] = ${el}; }`);
      } else {
        this.emit(`const ${el} = ${src}[${i}];`);
        this.stmtsScoped(s.body);
      }
      this.out.depth--;
      this.emit("}");
      return;
    }
    // Qualsiasi: si scorre come si può.
    if (vars.length === 2) this.emit(`for (const [${vars[0]}, ${vars[1]}] of $.pairs(${src})) {`);
    else this.emit(`for (const ${vars[0]} of $.iterAny(${src})) {`);
    this.body(s.body);
    this.emit("}");
  }

  private assign(s: A.Assign): void {
    const t = s.target;
    if (s.declares) {
      const b = real(s.declares);
      const v = this.value(s.value);
      this.emit(s.declares.alias || this.declared(b) ? `${b.jsName} = ${v};` : `let ${b.jsName} = ${v};`);
      return;
    }
    if (s.op !== "=") return this.compound(s);
    const ty = t.ty ?? { k: "any" as const };
    const drop = needsDrop(ty);
    if (t.k === "name") {
      const name = this.nameJs(t);
      const v = this.value(s.value);
      if (drop) {
        const nv = this.temp();
        const old = this.temp();
        this.emit(`${nv} = ${v}; ${old} = ${name}; ${name} = ${nv}; $.drop(${old});`);
      } else this.emit(`${name} = ${v};`);
      return;
    }
    if (t.k === "member") {
      const info = t.info;
      const obj = this.expr(t.obj);
      const v = this.value(s.value);
      if (info?.k === "host") {
        this.emit(`${info.m.set!(obj, v)};`);
        return;
      }
      const prop = info?.k === "field" ? info.field.jsName : t.name;
      if (drop) {
        const o = this.temp();
        const nv = this.temp();
        const old = this.temp();
        this.emit(`${o} = ${obj}; ${nv} = ${v}; ${old} = ${o}.${prop}; ${o}.${prop} = ${nv}; $.drop(${old});`);
      } else this.emit(`${obj}.${prop} = ${v};`);
      return;
    }
    if (t.k === "index") {
      const ot = resolve(t.obj.ty ?? { k: "any" });
      const obj = this.expr(t.obj);
      const idx = this.expr(t.index);
      const v = this.value(s.value);
      if (ot.k === "list") this.emit(`$.setAt(${obj}, ${idx}, ${v}, ${drop});`);
      else if (ot.k === "map") this.emit(`$.mapSet(${obj}, ${idx}, ${v}, ${drop});`);
      else this.emit(`$.setIndex(${obj}, ${idx}, ${v});`);
    }
  }

  private compound(s: A.Assign): void {
    const t = s.target;
    const op = s.op.slice(0, -1) as A.BinOp;
    const combine = (old: string) => this.opJs(op, s.info ?? "num", old, this.expr(s.value), t, s.value);
    if (t.k === "name") {
      const n = this.nameJs(t);
      this.emit(`${n} = ${combine(n)};`);
      return;
    }
    if (t.k === "member") {
      const o = this.temp();
      this.emit(`${o} = ${this.expr(t.obj)};`);
      const info = t.info;
      if (info?.k === "host") {
        this.emit(`${info.m.set!(o, combine(info.m.get(o)))};`);
        return;
      }
      const prop = info?.k === "field" ? info.field.jsName : t.name;
      this.emit(`${o}.${prop} = ${combine(`${o}.${prop}`)};`);
      return;
    }
    if (t.k === "index") {
      const o = this.temp();
      const k = this.temp();
      const ot = resolve(t.obj.ty ?? { k: "any" });
      this.emit(`${o} = ${this.expr(t.obj)}; ${k} = ${this.expr(t.index)};`);
      if (ot.k === "list") this.emit(`$.setAt(${o}, ${k}, ${combine(`$.at(${o}, ${k})`)}, false);`);
      else if (ot.k === "map") this.emit(`$.mapSet(${o}, ${k}, ${combine(`$.get(${o}, ${k})`)}, false);`);
      else this.emit(`$.setIndex(${o}, ${k}, ${combine(`$.index(${o}, ${k})`)});`);
    }
  }

  // ---------------------------------------------------------------- espressioni

  private isPlaceExpr(e: A.Expr): boolean {
    return e.k === "name" || e.k === "this" || (e.k === "member" && e.info?.k === "field") || e.k === "index";
  }

  /** Un valore che finisce da qualche parte: copiato se letto da un posto. */
  private value(e: A.Expr): string {
    const js = this.expr(e, true);
    if (!e.copy) return js;
    const t = resolve(e.ty ?? { k: "any" });
    if (t.k === "list" && isPrimitive(t.el)) return `${js}.slice()`;
    return `$.copy(${js})`;
  }

  /** Il valore come testo (per le stringhe con {…} e i messaggi). */
  private textOf(e: A.Expr): string {
    const t = resolve(e.ty ?? { k: "any" });
    const js = this.expr(e);
    return t.k === "text" ? js : `$.str(${js})`;
  }

  private nameJs(e: A.NameRef): string {
    if (e.special?.k === "const") return e.special.js;
    if (e.special?.k === "fnValue") {
      const fn = e.special.fn;
      return fn.owner ? `this.${fn.jsName}.bind(this)` : fn.jsName;
    }
    const b = e.ref ? real(e.ref) : undefined;
    if (!b) return "undefined";
    return this.bindingJs(b);
  }

  private bindingJs(b: Binding): string {
    switch (b.kind) {
      case "field":
      case "blockField":
        return `this.${b.field?.jsName ?? b.jsName}`;
      case "prop": {
        const raw = `this.$b.props[${str(b.name)}]`;
        const u = b.unitFactor;
        if (!u || (u.factor === 1 && !u.tile)) return raw;
        let js = `${raw} * ${u.factor}`;
        if (u.tile > 0) js += ` * $.tile`.repeat(u.tile);
        if (u.tile < 0) js += ` / $.tile`.repeat(-u.tile);
        return `(${js})`;
      }
      case "host":
        return b.hostJs ?? b.jsName;
      default:
        return b.jsName;
    }
  }

  private numLit(e: A.NumLit): string {
    let factor = 1;
    let tile = 0;
    for (const a of e.unit?.atoms ?? []) {
      const u = UNITS[a.name];
      if (!u) continue;
      factor *= a.power > 0 ? u.factor : 1 / u.factor;
      if (u.tile) tile += a.power;
    }
    const v = e.value * factor;
    let js = Number.isFinite(v) ? String(Number(v.toPrecision(15))) : String(v);
    if (tile > 0) js = `(${js} * $.tile${" * $.tile".repeat(tile - 1)})`;
    if (tile < 0) js = `(${js} / $.tile${" / $.tile".repeat(-tile - 1)})`;
    return js;
  }

  private strLit(e: A.StrLit): string {
    if (e.parts.every((p) => typeof p === "string")) return str(e.parts.join(""));
    let out = "`";
    for (const p of e.parts) {
      if (typeof p === "string") out += p.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
      else out += "${" + this.textOf(p) + "}";
    }
    return out + "`";
  }

  /**
   * Un'espressione. Se produce un valore nuovo con un «quando finisce» che nessuno tiene (per esempio
   * l'argomento prestato di una chiamata), il valore si distrugge alla fine dell'istruzione ($.keep).
   */
  expr(e: A.Expr, owned = false): string {
    const js = this.exprInner(e);
    if (!owned && (e.k === "call" || e.k === "move") && e.ty && needsDrop(e.ty)) {
      this.keepUsed = true;
      return `$.keep(${js})`;
    }
    return js;
  }

  private exprInner(e: A.Expr): string {
    switch (e.k) {
      case "num":
        return this.numLit(e);
      case "str":
        return this.strLit(e);
      case "bool":
        return String(e.value);
      case "none":
        return "null";
      case "name":
        return this.nameJs(e);
      case "this":
        return "this";
      case "list":
        return `[${e.items.map((x) => this.value(x)).join(", ")}]`;
      case "map":
        return `$.map([${e.entries.map((x) => `[${this.expr(x.key)}, ${this.value(x.value)}]`).join(", ")}])`;
      case "unary":
        if (e.op === "not") return `!(${this.expr(e.e)})`;
        return resolve(e.ty ?? { k: "any" }).k === "any" ? `$.neg(${this.expr(e.e)})` : `(-${this.expr(e.e)})`;
      case "binary":
        return this.binary(e);
      case "call":
        return this.call(e);
      case "member":
        return this.member(e);
      case "index": {
        const ot = resolve(e.obj.ty ?? { k: "any" });
        const o = this.expr(e.obj);
        const i = this.expr(e.index);
        if (ot.k === "list") return `$.at(${o}, ${i})`;
        if (ot.k === "text") return `$.charAt(${o}, ${i})`;
        if (ot.k === "map") return `$.get(${o}, ${i})`;
        return `$.index(${o}, ${i})`;
      }
      case "move": {
        const inner = e.e;
        if (inner.k !== "name") return this.expr(inner);
        const n = this.nameJs(inner);
        const t = this.temp();
        return `(${t} = ${n}, ${n} = undefined, ${t})`;
      }
      case "lambda": {
        const params = e.params.map((p) => (p.ref ? real(p.ref).jsName : p.name));
        const body = this.value(e.body);
        const caps = (e.captures ?? []).map((b) => real(b));
        const fn = `(${params.join(", ")}) => ${body.startsWith("{") ? `(${body})` : body}`;
        if (!caps.length) return `(${fn})`;
        return `((${caps.map((b) => b.jsName).join(", ")}) => ${fn})(${caps.map((b) => (isPrimitive(b.type) ? this.bindingJs(b) : `$.copy(${this.bindingJs(b)})`)).join(", ")})`;
      }
      case "pizza":
        return this.exprInner(e.value);
      case "pipe":
        return this.pipe(e);
    }
  }

  /** Il passo cambia la variabile nascosta `b` (un metodo che cambia, o «cambia» in una funzione)? */
  private mutatesTemp(x: A.Expr, b: Binding): boolean {
    if (x.k !== "call" || !x.info) return false;
    const isB = (y?: A.Expr) => !!y && y.k === "name" && y.ref === b;
    const info = x.info;
    if (info.k === "builtin") return isB(info.recv) && !!BUILTIN_BY_ID.get(info.id)?.mutates;
    if (info.k === "fn") return (isB(info.recv) && info.fn.mutating) || info.args.some((a, i) => isB(a) && info.fn.params[i]?.mode === "change");
    return false;
  }

  private copyJs(js: string, ty: Type | undefined): string {
    const t = resolve(ty ?? { k: "any" });
    if (isPrimitive(t)) return js;
    return t.k === "list" && isPrimitive(t.el) ? `${js}.slice()` : `$.copy(${js})`;
  }

  /**
   * spaghetti: i passi si scrivono prima dell'istruzione, ognuno nella sua variabile nascosta; il valore
   * finale va in una variabile temporanea. Un valore letto da un posto (la partenza, un campo) resta prestato,
   * e si copia solo se qualche passo lo cambia: così l'originale non cambia e non nascono copie inutili.
   */
  private pipe(e: A.PipeExpr): string {
    const plan = e.plan;
    if (!plan || !plan.temps.length) return "undefined";
    const [first] = plan.temps;
    const all = [...plan.ops.map((o) => o.e), ...(plan.result ? [plan.result] : [])];
    const fromPlace = new Set<Binding>();
    if (this.isPlaceExpr(e.start)) fromPlace.add(first);
    for (const op of plan.ops) if (op.target && this.isPlaceExpr(op.e)) fromPlace.add(op.target);
    const owned = new Set(plan.temps.filter((b) => !fromPlace.has(b) || all.some((x) => this.mutatesTemp(x, b))));
    this.emit(`let ${plan.temps.map((b) => b.jsName).join(", ")};`);
    const drops = plan.temps.filter((b) => owned.has(b) && needsDrop(b.type));
    if (drops.length) {
      this.emit("try {");
      this.out.depth++;
    }
    const start = this.expr(e.start, true);
    this.emit(`${first.jsName} = ${fromPlace.has(first) && owned.has(first) ? this.copyJs(start, e.start.ty) : start};`);
    for (const op of plan.ops) {
      const t = op.target;
      if (!t) this.emit(`${this.expr(op.e, true)};`);
      else if (fromPlace.has(t)) {
        const js = this.expr(op.e, true);
        this.emit(`${t.jsName} = ${owned.has(t) ? this.copyJs(js, op.e.ty) : js};`);
      } else this.emit(`${t.jsName} = ${this.value(op.e)};`);
    }
    let res = "undefined";
    if (plan.result || plan.resultTemp) {
      res = this.temp();
      if (plan.result) this.emit(`${res} = ${this.value(plan.result)};`);
      else {
        const b = plan.resultTemp!;
        if (!owned.has(b)) this.emit(`${res} = ${this.copyJs(b.jsName, b.type)};`);
        else this.emit(`${res} = ${b.jsName}; ${b.jsName} = undefined;`);
      }
    }
    if (drops.length) {
      this.out.depth--;
      this.emit(`} finally { ${[...drops].reverse().map((b) => `$.drop(${b.jsName});`).join(" ")} }`);
    }
    return res;
  }

  private opJs(op: A.BinOp, info: string, l: string, r: string, le: A.Expr, re: A.Expr): string {
    switch (info) {
      case "num":
        if (op === "/") return `$.div(${l}, ${r})`;
        if (op === "%") return `$.mod(${l}, ${r})`;
        if (op === "^") return `(${l} ** ${r})`;
        return `(${l} ${op} ${r})`;
      case "concat": {
        const lt = resolve(le.ty ?? { k: "any" });
        const rt = resolve(re.ty ?? { k: "any" });
        return `(${lt.k === "text" ? l : `$.str(${l})`} + ${rt.k === "text" ? r : `$.str(${r})`})`;
      }
      case "listConcat":
        return `$.concat(${l}, ${r})`;
      case "eqPrim":
        if (le.k === "none" || re.k === "none") return `(${l} ${op === "==" ? "==" : "!="} ${r})`;
        return `(${l} ${op === "==" ? "===" : "!=="} ${r})`;
      case "eqDeep":
        return op === "==" ? `$.eq(${l}, ${r})` : `!$.eq(${l}, ${r})`;
      case "cmpNum":
      case "cmpText":
        return `(${l} ${op} ${r})`;
      case "bool":
        return `(${l} ${op === "and" ? "&&" : "||"} ${r})`;
      case "inList":
        return `${op === "notin" ? "!" : ""}$.contains(${r}, ${l})`;
      case "inMap":
        return `${op === "notin" ? "!" : ""}${r}.has(${l})`;
      case "inText":
        return `${op === "notin" ? "!" : ""}${r}.includes(${l})`;
      default:
        return `$.dyn(${str(op)}, ${l}, ${r})`;
    }
  }

  private binary(e: A.Binary): string {
    if (e.op === "and" || e.op === "or") return `(${this.expr(e.l)} ${e.op === "and" ? "&&" : "||"} ${this.expr(e.r)})`;
    return this.opJs(e.op, e.info ?? "dyn", this.expr(e.l), this.expr(e.r), e.l, e.r);
  }

  private member(e: A.Member): string {
    const info = e.info;
    if (info?.k === "enum") return str(info.member);
    const obj = this.expr(e.obj);
    switch (info?.k) {
      case "field":
        return `${obj}.${info.field.jsName}`;
      case "builtin": {
        const b = BUILTIN_BY_ID.get(info.id)!;
        return b.js({ recv: obj, args: [], dropEl: false, lang: this.lang });
      }
      case "host":
        return info.m.get(obj);
      default:
        return `${obj}[${str(e.name)}]`;
    }
  }

  /** Un argomento: copiato se il parametro lo tiene, prestato altrimenti. */
  private argJs(e: A.Expr | undefined, take: boolean): string {
    if (!e) return "undefined";
    return take ? this.value(e) : this.expr(e);
  }

  private call(e: A.Call): string {
    const info = e.info;
    if (!info) return "undefined";
    switch (info.k) {
      case "fn": {
        const fn = info.fn;
        const params = fn.params;
        const changes: { e: A.Expr; slot: number }[] = [];
        let slot = 0;
        const pre: string[] = [];
        const args = info.args.map((a, i) => {
          const p = params[i];
          if (p?.mode === "change" && a) {
            const place = this.placeFor(a, pre);
            changes.push({ e: a, slot: slot++ });
            (a as { $place?: typeof place }).$place = place;
            return place.read;
          }
          return this.argJs(a, p?.mode === "take");
        });
        while (args.length && args[args.length - 1] === "undefined") args.pop();
        let callee: string;
        if (fn.owner) {
          const recv = info.recv ? this.expr(info.recv) : "this";
          callee = `${recv}.${fn.jsName}`;
        } else callee = fn.jsName;
        let js = `${callee}(${args.join(", ")})`;
        if (fn.routine) js = `(yield* ${js})`;
        if (!changes.length) return pre.length ? `(${pre.join(", ")}, ${js})` : js;
        const r = this.temp();
        const writes = changes.map((c) => (c.e as { $place?: { write: (v: string) => string } }).$place!.write(`$.io[${c.slot}]`));
        return `(${[...pre, `${r} = ${js}`, ...writes, r].join(", ")})`;
      }
      case "ctor": {
        const args = info.args.map((a) => this.argJs(a, true));
        while (args.length && args[args.length - 1] === "undefined") args.pop();
        return `new ${info.rec.jsName}(${args.join(", ")})`;
      }
      case "builtin": {
        const b = BUILTIN_BY_ID.get(info.id)!;
        const recv = info.recv ? this.expr(info.recv) : "";
        const args = info.args.map((a, i) => this.argJs(a, !!b.takes?.includes(i)));
        const rt = info.recvType ? resolve(info.recvType) : undefined;
        const dropEl = rt ? (rt.k === "list" ? needsDrop(rt.el) : rt.k === "map" ? needsDrop(rt.val) : false) : false;
        return b.js({ recv, args, dropEl, lang: this.lang });
      }
      case "host": {
        const recv = this.expr(info.recv);
        const args = info.args.map((a) => this.argJs(a, false));
        return info.m.js(recv, args);
      }
      case "value": {
        const callee = this.expr(e.callee);
        return `${callee}(${info.args.map((a) => this.expr(a)).join(", ")})`;
      }
      case "any": {
        const callee = this.expr(e.callee);
        return `${callee}(${info.args.map((a) => this.expr(a)).join(", ")})`;
      }
    }
  }

  /** Un posto da leggere prima della chiamata e da riscrivere dopo (parametri «cambia»). */
  private placeFor(e: A.Expr, pre: string[]): { read: string; write: (v: string) => string } {
    if (e.k === "name") {
      const n = this.nameJs(e);
      return { read: n, write: (v) => `${n} = ${v}` };
    }
    if (e.k === "this") return { read: "this", write: () => "undefined" };
    if (e.k === "member") {
      const o = this.temp();
      pre.push(`${o} = ${this.expr(e.obj)}`);
      if (e.info?.k === "host") {
        const m = e.info.m;
        return { read: m.get(o), write: (v) => (m.set ? m.set(o, v) : "undefined") };
      }
      const prop = e.info?.k === "field" ? e.info.field.jsName : e.name;
      return { read: `${o}.${prop}`, write: (v) => `${o}.${prop} = ${v}` };
    }
    if (e.k === "index") {
      const o = this.temp();
      const k = this.temp();
      pre.push(`${o} = ${this.expr(e.obj)}`, `${k} = ${this.expr(e.index)}`);
      const ot = resolve(e.obj.ty ?? { k: "any" });
      if (ot.k === "map") return { read: `$.get(${o}, ${k})`, write: (v) => `${o}.set(${k}, ${v})` };
      return { read: `$.at(${o}, ${k})`, write: (v) => `$.setAt(${o}, ${k}, ${v}, false)` };
    }
    const js = this.expr(e);
    return { read: js, write: () => "undefined" };
  }
}

export function generate(r: CheckResult, program: A.Program, lang: Lang): Generated {
  const g = new Codegen(r, lang);
  g.mainList = program.body;
  return g.generate();
}

export type { Type };

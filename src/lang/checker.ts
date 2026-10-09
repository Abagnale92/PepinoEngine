/**
 * Il controllo di un programma Pepino: nomi, tipi (dedotti), memoria (copie, spostamenti, prestiti),
 * unità di misura e attese. Annota l'albero per il generatore di JavaScript.
 */
import type * as A from "./ast";
import type { HostSpec, HostPropType } from "./host";
import { type Diagnostic, type MsgArg, type Span, makeDiag } from "./messages";
import { CONSTANTS, FUNCTION_BY_NAME, LIST_BY_NAME, MAP_BY_NAME, TEXT_BY_NAME, builtinName, type BCtx, type Builtin } from "./stdlib";
import {
  ANY,
  BOOL,
  ERR,
  NONE,
  NUM,
  TEXT,
  VOID,
  assignable,
  dimsCombine,
  dimsEqual,
  dimsKey,
  dimsName,
  dimsScale,
  fresh,
  isPrimitive,
  list,
  map,
  needsDrop,
  num,
  opt,
  phrase,
  resolve,
  typeKey,
  typeText,
  unify,
  unopt,
  type Binding,
  type BindingKind,
  type Dims,
  type EnumInfo,
  type FieldInfo,
  type FnInfo,
  type HostTypeInfo,
  type OpInfo,
  type ParamInfo,
  type RecordInfo,
  type Type,
} from "./types";
import { baseTypeOf, closest, TYPE_NAMES, UNITS, type Lang } from "./words";

const JS_RESERVED = new Set(
  "break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await arguments eval undefined NaN Infinity constructor prototype __proto__ toString valueOf hasOwnProperty".split(
    " ",
  ),
);

/** Un nome Pepino → un nome JavaScript sicuro (i nomi Pepino non hanno mai il $). */
export const jsSafe = (n: string) => (JS_RESERVED.has(n) ? `$${n}` : n);

// ------------------------------------------------------------------ informazioni per il generatore

export interface PropInfo {
  decl: A.PropDecl;
  name: string;
  binding: Binding;
  kind: string;
  label: string;
  def: unknown;
  unit?: string;
  options?: string[];
}

export interface ActionInfo {
  a: A.ActionDecl;
  fn: FnInfo;
  params: { name: string; kind: string; label: string; def: unknown; options?: string[] }[];
}

export interface BlockInfo {
  decl: A.BlockDecl;
  rec: RecordInfo;
  props: PropInfo[];
  handlers: { h: A.Handler; fn: FnInfo }[];
  actions: ActionInfo[];
  requires: string[];
  /** Controlla i valori iniziali dei campi. */
  init: FnInfo;
}

export interface CheckResult {
  diagnostics: Diagnostic[];
  main: FnInfo;
  globals: Binding[];
  records: RecordInfo[];
  enums: EnumInfo[];
  /** Funzioni da scrivere (non i modelli: le loro istanze), metodi compresi. */
  fns: FnInfo[];
  blocks: BlockInfo[];
  tests: { name: string; fn: FnInfo }[];
  scopeDecls: Map<A.Stmt[], Binding[]>;
  lang: Lang;
  /** Nomi predefiniti usati (per la traduzione). */
  names: { pos: number; end: number; it: string; en: string }[];
}

// ------------------------------------------------------------------ strutture interne

class Scope {
  vars = new Map<string, Binding>();
  /** Nomi che esistevano in un blocco già chiuso (per «esiste solo dentro il blocco…»). */
  expired = new Map<string, number>();
  decls: Binding[] = [];
  constructor(
    readonly parent: Scope | undefined,
    readonly kind: "global" | "member" | "fn" | "block",
  ) {}
  find(name: string): Binding | undefined {
    for (let s: Scope | undefined = this; s; s = s.parent) {
      const b = s.vars.get(name);
      if (b) return b;
    }
    return undefined;
  }
  findExpired(name: string): number | undefined {
    for (let s: Scope | undefined = this; s; s = s.parent) {
      const l = s.expired.get(name);
      if (l !== undefined) return l;
    }
    return undefined;
  }
  names(): string[] {
    const out: string[] = [];
    for (let s: Scope | undefined = this; s; s = s.parent) out.push(...s.vars.keys());
    return out;
  }
}

interface MoveMark {
  span: Span;
  maybe: boolean;
}

interface Flow {
  moved: Map<Binding, MoveMark>;
  narrow: Map<string, Type>;
  /** Perché il codice che segue non verrà mai eseguito ("ritorna"…), altrimenti false. */
  dead: string | false;
}

const cloneFlow = (f: Flow): Flow => ({ moved: new Map([...f.moved].map(([b, m]) => [b, { ...m }])), narrow: new Map(f.narrow), dead: f.dead });

function mergeFlows(flows: Flow[]): Flow {
  const live = flows.filter((f) => !f.dead);
  if (!live.length) return { moved: new Map(), narrow: new Map(), dead: flows[0]?.dead || "ritorna" };
  const moved = new Map<Binding, MoveMark>();
  for (const f of live) for (const [b, m] of f.moved) if (!moved.has(b)) moved.set(b, { ...m });
  for (const [b, m] of moved) if (live.some((f) => !f.moved.has(b) || f.moved.get(b)!.maybe)) m.maybe = true;
  const narrow = new Map<string, Type>();
  for (const [k, t] of live[0].narrow) {
    if (live.every((f) => f.narrow.has(k) && typeKey(f.narrow.get(k)!) === typeKey(t))) narrow.set(k, t);
  }
  return { moved, narrow, dead: false };
}

interface FnCtx {
  fn: FnInfo;
  ret: Type;
  retDeclared: boolean;
  returnsValue: boolean;
  returnsVoid: boolean;
  rec?: RecordInfo;
  block?: BlockInfo;
  loopDepth: number;
  frozen: Map<Binding | "this", number>;
}

type Root = { k: "b"; b: Binding } | { k: "this" } | { k: "host" };

interface MutUse {
  span: Span;
  root?: Root;
  method: FnInfo;
  ctx: FnCtx;
  frozenLine?: number;
  /** Il messaggio, se il valore è una copia presa da una funzione veloce o da un cappuccino. */
  captured?: string;
}

interface Narrowing {
  then: Map<string, Type>;
  else: Map<string, Type>;
}

const emptyNarrowing = (): Narrowing => ({ then: new Map(), else: new Map() });

const isDecl = (s: A.Stmt) => s.k === "func" || s.k === "type" || s.k === "enum" || s.k === "test" || s.k === "block" || s.k === "use";

/** Le parole «uguali» per i messaggi: il verbo dell'operazione. */
const OP_VERB: Record<string, [string, string]> = {
  "+": ["sommare", "add"],
  "-": ["sottrarre", "subtract"],
  "==": ["confrontare", "compare"],
  "!=": ["confrontare", "compare"],
  "<": ["confrontare", "compare"],
  ">": ["confrontare", "compare"],
  "<=": ["confrontare", "compare"],
  ">=": ["confrontare", "compare"],
  "%": ["dividere", "divide"],
};

const OP_SHOWN: Partial<Record<A.BinOp, string>> = { and: "e", or: "o", in: "in", notin: "non in" };

// ------------------------------------------------------------------ il controllo

export class Checker {
  readonly diags: Diagnostic[] = [];
  private seen = new Set<string>();
  private global = new Scope(undefined, "global");
  private records = new Map<string, RecordInfo>();
  private enums = new Map<string, EnumInfo>();
  private fns = new Map<string, FnInfo>();
  private hostTypes = new Map<string, HostTypeInfo>();
  private hostProps = new Map<string, HostPropType>();
  private blocks: BlockInfo[] = [];
  private tests: { name: string; fn: FnInfo; decl: A.TestDecl }[] = [];
  private futureGlobals = new Map<string, number>();
  private emitted: FnInfo[] = [];
  private allFns: FnInfo[] = [];
  private fnValues: { fn: FnInfo; span: Span }[] = [];
  private mutUses: MutUse[] = [];
  private scopeDecls = new Map<A.Stmt[], Binding[]>();
  private memberScopes = new Map<RecordInfo, Scope>();
  private nextId = 1;
  private main: FnInfo;
  private ctx: FnCtx;
  private scope: Scope;
  private flow: Flow = { moved: new Map(), narrow: new Map(), dead: false };
  /** Funzioni veloci e cappuccini aperti (dal più esterno): le variabili di fuori che leggono vengono copiate. */
  private lambdas: { fn: FnInfo; captures: Map<Binding, true>; kind?: "later" }[] = [];

  constructor(
    private program: A.Program,
    readonly lang: Lang,
    private host: HostSpec,
  ) {
    for (const h of host.types) {
      this.hostTypes.set(h.it, h);
      this.hostTypes.set(h.en, h);
    }
    for (const p of host.block?.propTypes ?? []) {
      this.hostProps.set(p.it, p);
      this.hostProps.set(p.en, p);
    }
    this.main = this.newFn("$main", "main");
    this.ctx = this.newCtx(this.main, VOID, true);
    this.scope = this.global;
  }

  // ---------------------------------------------------------------- utilità

  private newFn(name: string, kind: FnInfo["kind"], extra: Partial<FnInfo> = {}): FnInfo {
    const fn: FnInfo = {
      name,
      jsName: jsSafe(name),
      params: [],
      generic: false,
      instances: new Map(),
      state: "todo",
      routine: false,
      calls: new Set(),
      mutating: false,
      hasChange: false,
      kind,
      callSpans: new Map(),
      ...extra,
    };
    this.allFns.push(fn);
    return fn;
  }

  private newCtx(fn: FnInfo, ret: Type, declared: boolean, rec?: RecordInfo, block?: BlockInfo): FnCtx {
    return { fn, ret, retDeclared: declared, returnsValue: false, returnsVoid: false, rec, block, loopDepth: 0, frozen: new Map() };
  }

  private error(span: Span, key: string, args: MsgArg[] = [], severity: Diagnostic["severity"] = "error"): void {
    const id = `${span.pos}:${span.end}:${key}`;
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.diags.push(makeDiag(severity, key, args, span));
  }

  private warn(span: Span, key: string, args: MsgArg[] = []): void {
    this.error(span, key, args, "warning");
  }

  /** Nomi predefiniti usati nel programma, con le due lingue (servono a tradurre il programma). */
  readonly names: { pos: number; end: number; it: string; en: string }[] = [];

  private rename(span: Span, it: string | undefined, en: string | undefined): void {
    if (it && en && it !== en) this.names.push({ pos: span.pos, end: span.end, it, en });
  }

  private bind(scope: Scope, name: string, kind: BindingKind, type: Type, decl: Span, extra: Partial<Binding> = {}): Binding {
    const b: Binding = { id: this.nextId++, name, jsName: jsSafe(name), kind, type, decl, fn: this.ctx.fn, loopDepth: this.ctx.loopDepth, ...extra };
    scope.vars.set(name, b);
    scope.decls.push(b);
    return b;
  }

  /** Esegue `fn` dentro un'altra funzione (salvando e poi rimettendo lo stato di quella corrente). */
  private within<T>(ctx: FnCtx, scope: Scope, fn: () => T): T {
    const saved = { ctx: this.ctx, scope: this.scope, flow: this.flow, lambdas: this.lambdas };
    this.ctx = ctx;
    this.scope = scope;
    this.flow = { moved: new Map(), narrow: new Map(), dead: false };
    this.lambdas = [];
    try {
      return fn();
    } finally {
      this.ctx = saved.ctx;
      this.scope = saved.scope;
      this.flow = saved.flow;
      this.lambdas = saved.lambdas;
    }
  }

  private fnLabel(fn: FnInfo): MsgArg {
    return `«${fn.template?.name ?? fn.name}»`;
  }

  // ---------------------------------------------------------------- tipi scritti

  private resolveAnn(ann: A.TypeAnn): Type {
    switch (ann.k) {
      case "tlist":
        return list(this.resolveAnn(ann.el));
      case "tmap": {
        const key = this.resolveAnn(ann.key);
        this.checkMapKey(key, ann.key);
        return map(key, this.resolveAnn(ann.val));
      }
      case "topt":
        return opt(this.resolveAnn(ann.t));
      case "tfn":
        return { k: "fn", params: ann.params.map((p) => this.resolveAnn(p)), ret: ann.ret ? this.resolveAnn(ann.ret) : VOID };
      case "tname": {
        const base = baseTypeOf(ann.name);
        if (base) {
          const w = TYPE_NAMES[base] as { it: string[]; en: string[] };
          const i = Math.max(w.it.indexOf(ann.name), w.en.indexOf(ann.name), 0);
          this.rename(ann, w.it[i] ?? w.it[0], w.en[i] ?? w.en[0]);
        }
        if (base === "num") return NUM;
        if (base === "text") return TEXT;
        if (base === "bool") return BOOL;
        if (base === "any") return ANY;
        if (base === "list") return list(fresh());
        if (base === "map") return map(fresh(), fresh());
        const rec = this.records.get(ann.name);
        if (rec) return { k: "rec", rec };
        const en = this.enums.get(ann.name);
        if (en) return { k: "enum", en };
        const h = this.hostTypes.get(ann.name);
        if (h) {
          this.rename(ann, h.it, h.en);
          return { k: "host", host: h };
        }
        const hp = this.hostProps.get(ann.name);
        if (hp) {
          this.rename(ann, hp.it, hp.en);
          return hp.base === "num" ? NUM : hp.base === "bool" ? BOOL : TEXT;
        }
        const all = ["Numero", "Number", "Testo", "Text", "SiNo", "YesNo", "Lista", "List", "Mappa", "Map", "Qualsiasi", "Any", ...this.records.keys(), ...this.enums.keys(), ...this.hostTypes.keys(), ...this.hostProps.keys()];
        const did = closest(ann.name, all);
        if (did) this.error(ann, "type.unknownDid", [ann.name, did]);
        else this.error(ann, "type.unknown", [ann.name]);
        return ERR;
      }
    }
  }

  private checkMapKey(t: Type, span: Span): void {
    const r = resolve(t);
    if (r.k !== "num" && r.k !== "text" && r.k !== "enum" && r.k !== "var" && r.k !== "any" && r.k !== "err" && r.k !== "bool") this.error(span, "type.mapKey");
  }

  // ---------------------------------------------------------------- raccolta delle dichiarazioni

  private declName(name: string, span: Span): boolean {
    const taken = this.fns.get(name)?.decl?.nameSpan ?? this.records.get(name)?.decl?.nameSpan ?? this.enums.get(name)?.decl.nameSpan;
    if (taken) {
      this.error(span, "name.duplicate", [name, taken.line]);
      return false;
    }
    if (baseTypeOf(name) || this.hostTypes.has(name)) {
      this.error(span, "name.reservedType", [name]);
      return false;
    }
    return true;
  }

  private collect(): void {
    for (const s of this.program.body) {
      switch (s.k) {
        case "type": {
          if (!this.declName(s.name, s.nameSpan)) break;
          const rec: RecordInfo = { name: s.name, jsName: jsSafe(s.name), decl: s, fields: [], methods: new Map(), state: "todo" };
          this.records.set(s.name, rec);
          for (const m of s.methods) {
            if (rec.methods.has(m.name)) {
              this.error(m.nameSpan, "name.duplicate", [m.name, rec.methods.get(m.name)!.decl!.nameSpan.line]);
              continue;
            }
            rec.methods.set(m.name, this.declareFn(m, "method", rec));
          }
          if (s.onCreate) rec.onCreate = this.newFn("$create", "ctor", { owner: rec, body: s.onCreate, noWait: this.lang === "it" ? "«quando crea» deve finire subito" : "\"on create\" must finish right away" });
          if (s.onEnd) rec.onEnd = this.newFn("$end", "dtor", { owner: rec, body: s.onEnd, noWait: this.lang === "it" ? "«quando finisce» deve finire subito" : "\"on end\" must finish right away" });
          break;
        }
        case "enum": {
          if (!this.declName(s.name, s.nameSpan)) break;
          const seen = new Set<string>();
          for (const m of s.members) {
            if (seen.has(m.name)) this.error(m.span, "type.caseDuplicate", [m.name]);
            seen.add(m.name);
          }
          this.enums.set(s.name, { name: s.name, members: [...seen], decl: s });
          break;
        }
        case "func": {
          if (!this.declName(s.name, s.nameSpan)) break;
          this.fns.set(s.name, this.declareFn(s, "fn"));
          break;
        }
        case "test":
          this.tests.push({ name: s.name, fn: this.newFn("$test", "test", { body: s.body }), decl: s });
          break;
        case "use":
          this.error(s, "flow.useOutsideCli");
          break;
        case "assign":
          if (s.target.k === "name" && !this.futureGlobals.has(s.target.name)) this.futureGlobals.set(s.target.name, s.line);
          break;
        case "const":
          if (!this.futureGlobals.has(s.name)) this.futureGlobals.set(s.name, s.line);
          break;
        default:
          break;
      }
    }
    // I blocchi dopo i tipi: possono usare tipi e scelte scritti più sotto.
    for (const s of this.program.body) if (s.k === "block") this.declareBlock(s);
  }

  private declareFn(d: A.FuncDecl, kind: FnInfo["kind"], owner?: RecordInfo): FnInfo {
    const fn = this.newFn(d.name, kind, { decl: d, owner, body: d.body });
    fn.params = d.params.map((p) => ({ name: p.name, mode: p.mode, def: p.def, decl: p }));
    fn.generic = d.params.some((p) => !p.ann && !p.def);
    fn.hasChange = d.params.some((p) => p.mode === "change");
    const names = new Set<string>();
    for (const p of d.params) {
      if (names.has(p.name)) this.error(p.span, "name.duplicate", [p.name, p.span.line]);
      names.add(p.name);
    }
    if (!fn.generic) this.emitted.push(fn);
    return fn;
  }

  /** Tipi dei parametri e del risultato (i valori predefiniti si controllano su una copia). */
  private ensureSignature(fn: FnInfo): void {
    if (fn.signed) return;
    fn.signed = true;
    for (const p of fn.params) {
      if (p.type) continue;
      if (p.decl?.ann) p.type = this.resolveAnn(p.decl.ann);
      else if (p.def) p.type = this.defaultType(p.def);
    }
    if (fn.decl?.ret && !fn.declaredRet) fn.declaredRet = this.resolveAnn(fn.decl.ret);
  }

  private defaultType(def: A.Expr): Type {
    const copy = structuredClone(def);
    const ctx = this.newCtx(this.newFn("$default", "ctor"), VOID, true);
    const t = this.within(ctx, this.global, () => this.value(copy));
    return resolve(t).k === "none" ? opt(fresh()) : t;
  }

  // ---------------------------------------------------------------- programma

  run(): CheckResult {
    this.collect();
    // Il programma principale, nell'ordine in cui è scritto.
    this.stmts(this.program.body, this.global);
    this.main.state = "done";
    const mainFlowDead = this.flow.dead;
    void mainFlowDead;
    // Tutto il resto: funzioni mai chiamate, tipi, blocchi, prove.
    for (const fn of [...this.fns.values()]) {
      if (fn.generic) {
        if (!fn.instances.size) this.checkUnusedTemplate(fn);
      } else this.ensureChecked(fn);
    }
    for (const rec of this.records.values()) {
      this.ensureRecord(rec);
      for (const m of rec.methods.values()) {
        if (m.generic) {
          if (!m.instances.size) this.checkUnusedTemplate(m);
        } else this.ensureChecked(m);
      }
      if (rec.onCreate) this.ensureChecked(rec.onCreate);
      if (rec.onEnd) this.ensureChecked(rec.onEnd);
    }
    for (const b of this.blocks) this.checkBlock(b);
    for (const t of this.tests) {
      const ctx = this.newCtx(t.fn, VOID, true);
      this.within(ctx, new Scope(this.global, "fn"), () => this.stmts(t.fn.body!, this.scope));
      t.fn.state = "done";
    }
    this.finish();
    return {
      diagnostics: this.diags,
      main: this.main,
      globals: this.global.decls.filter((b) => !b.alias),
      records: [...this.records.values()],
      enums: [...this.enums.values()],
      fns: this.emitted,
      blocks: this.blocks,
      tests: this.tests.map((t) => ({ name: t.name, fn: t.fn })),
      scopeDecls: this.scopeDecls,
      lang: this.lang,
      names: this.names,
    };
  }

  private checkUnusedTemplate(fn: FnInfo): void {
    // Un modello mai usato: lo si controlla comunque (con parametri «qualsiasi») per trovare gli errori di scrittura.
    this.ensureSignature(fn);
    const inst = this.newFn(fn.name, fn.kind, { owner: fn.owner, template: fn });
    const decl = structuredClone(fn.decl!);
    inst.decl = decl;
    inst.body = decl.body;
    inst.params = decl.params.map((p, i) => ({ name: p.name, mode: p.mode, def: p.def, decl: p, type: fn.params[i].type ?? ANY }));
    inst.hasChange = fn.hasChange;
    this.ensureChecked(inst);
  }

  /** Le verifiche che si possono fare solo alla fine (attese, metodi che cambiano i campi…). */
  private finish(): void {
    // Chi chiama una funzione che aspetta, aspetta anche lui.
    let changed = true;
    while (changed) {
      changed = false;
      for (const fn of this.allFns) {
        if (fn.routine) continue;
        for (const c of fn.calls) {
          if (c.routine) {
            fn.routine = true;
            fn.waitSpan ??= fn.callSpans.get(c);
            changed = true;
            break;
          }
        }
      }
    }
    for (const fn of this.allFns) {
      if (!fn.routine) continue;
      const span = fn.waitSpan ?? fn.decl?.nameSpan;
      if (!span) continue;
      if (fn.kind === "lambda") this.error(span, "flow.waitHere", [(l) => (l === "it" ? "una funzione veloce (x => …) deve rispondere subito" : "a quick function (x => …) must answer right away")]);
      else if (fn.noWait) this.error(span, "flow.waitHere", [fn.noWait]);
      else if (fn.hasChange) this.error(span, "mem.changeInRoutine");
    }
    for (const v of this.fnValues) {
      if (v.fn.routine) this.error(v.span, "flow.waitHere", [(l) => (l === "it" ? "una funzione usata come valore deve rispondere subito" : "a function used as a value must answer right away")]);
    }
    // Metodi che cambiano i campi: chi li chiama su «questo» li cambia a sua volta.
    changed = true;
    while (changed) {
      changed = false;
      for (const u of this.mutUses) {
        if (!u.method.mutating) continue;
        const onThis = u.root?.k === "this" || (u.root?.k === "b" && u.root.b.kind === "field");
        if (onThis && !u.ctx.fn.mutating && u.ctx.fn.kind === "method") {
          u.ctx.fn.mutating = true;
          changed = true;
        }
      }
    }
    for (const u of this.mutUses) {
      if (!u.method.mutating || !u.root) continue;
      if (u.captured) {
        this.error(u.span, u.captured, [u.root.k === "b" ? u.root.b.name : "questo"]);
        continue;
      }
      if (u.frozenLine !== undefined) {
        this.error(u.span, "name.frozen", [u.root.k === "b" ? u.root.b.name : "questo", u.frozenLine]);
        continue;
      }
      if (u.root.k === "b") this.immutableError(u.root.b, u.span);
    }
    // Tipi con «quando finisce» (anche dentro i campi).
    changed = true;
    for (const r of this.records.values()) r.needsDrop = !!r.onEnd;
    for (const b of this.blocks) b.rec.needsDrop = false;
    while (changed) {
      changed = false;
      for (const r of this.records.values()) {
        if (r.needsDrop) continue;
        if (r.fields.some((f) => needsDrop(f.type))) {
          r.needsDrop = true;
          changed = true;
        }
      }
    }
  }

  // ---------------------------------------------------------------- funzioni

  private memberScope(rec: RecordInfo): Scope {
    let s = this.memberScopes.get(rec);
    if (!s) {
      s = new Scope(this.global, "member");
      this.memberScopes.set(rec, s);
    }
    return s;
  }

  private ensureChecked(fn: FnInfo): void {
    if (fn.state !== "todo") return;
    fn.state = "checking";
    this.ensureSignature(fn);
    if (fn.owner && !fn.owner.isBlock) this.ensureRecord(fn.owner);
    const block = fn.owner?.isBlock ? this.blocks.find((b) => b.rec === fn.owner) : undefined;
    const declared = fn.declaredRet ?? (fn.kind === "condition" ? BOOL : fn.kind === "fn" || fn.kind === "method" ? undefined : VOID);
    fn.ret = declared ?? fresh();
    const ctx = this.newCtx(fn, fn.ret, !!declared, fn.owner, block);
    const parent = fn.owner ? this.memberScope(fn.owner) : this.global;
    const scope = new Scope(parent, "fn");
    this.within(ctx, scope, () => {
      // Valori predefiniti dei parametri: si calcolano come se fossero fuori dalla funzione.
      for (const p of fn.params) {
        if (p.def) {
          const t = this.within(this.newCtx(this.newFn("$default", "ctor"), VOID, true), parent, () => this.value(p.def!, p.type));
          if (p.type) this.assignCheck(p.type, t, p.def);
        }
      }
      fn.paramRefs = fn.params.map((p) => {
        const type = p.type ?? ANY;
        // «cambia» e «prendi» hanno senso solo nelle funzioni chiamate da altro codice Pepino.
        if (p.mode !== "borrow" && fn.kind !== "fn" && fn.kind !== "method" && fn.kind !== "action") this.error(p.decl?.span ?? fn.decl!.nameSpan, "mem.changeNotParam", [p.name]);
        const b = this.bind(scope, p.name, "param", type, p.decl?.span ?? fn.decl?.nameSpan ?? { line: 0, col: 0, pos: 0, end: 0 }, { mode: p.mode });
        if (p.decl) p.decl.ref = b;
        return b;
      });
      this.stmts(fn.body ?? [], scope);
      if (!this.flow.dead) {
        const r = resolve(fn.ret!);
        if (ctx.retDeclared && r.k !== "void" && r.k !== "err" && r.k !== "any") this.error(fn.decl?.nameSpan ?? fn.body?.[0] ?? { line: 1, col: 1, pos: 0, end: 0 }, fn.kind === "condition" ? "block.conditionReturn" : "type.missingReturn", [fn.name, phrase(fn.ret!)]);
        else if (!ctx.retDeclared && ctx.returnsValue) this.error(fn.decl!.nameSpan, "type.missingReturn", [fn.name, phrase(fn.ret!)]);
      }
      if (!ctx.retDeclared && !ctx.returnsValue) unify(fn.ret!, VOID);
    });
    fn.state = "done";
  }

  /** L'istanza di una funzione-modello per questi tipi dei parametri (come i template del C++). */
  private instantiate(fn: FnInfo, types: Type[]): FnInfo {
    const key = types.map(typeKey).join("|");
    let inst = fn.instances.get(key);
    if (inst) return inst;
    const n = fn.instances.size + 1;
    const decl = structuredClone(fn.decl!);
    inst = this.newFn(fn.name, fn.kind, { owner: fn.owner, template: fn, decl, body: decl.body, hasChange: fn.hasChange });
    inst.jsName = `${fn.jsName}$${n}`;
    inst.params = decl.params.map((p, i) => ({ name: p.name, mode: p.mode, def: p.def, decl: p, type: types[i] }));
    if (fn.decl?.ret) inst.declaredRet = this.resolveAnn(fn.decl.ret);
    inst.signed = true;
    fn.instances.set(key, inst);
    this.emitted.push(inst);
    if (fn.owner) fn.owner.methods.set(`${fn.name}$${n}`, inst);
    this.ensureChecked(inst);
    return inst;
  }

  // ---------------------------------------------------------------- tipi (record)

  private ensureRecord(rec: RecordInfo): void {
    if (rec.state !== "todo" || !rec.decl) return;
    rec.state = "checking";
    const scope = this.memberScope(rec);
    const ctor = this.newFn("$fields", "ctor", { owner: rec });
    const ctx = this.newCtx(ctor, VOID, true, rec);
    this.within(ctx, scope, () => {
      for (const f of rec.decl!.fields) {
        if (rec.fields.some((x) => x.name === f.name)) {
          this.error(f.span, "type.duplicateField", [f.name]);
          continue;
        }
        const clash = rec.methods.get(f.name)?.decl;
        if (clash) this.error(clash.nameSpan, "name.duplicate", [f.name, f.span.line]);
        let type: Type = ERR;
        const ann = f.ann ? this.resolveAnn(f.ann) : undefined;
        if (f.def) {
          const t = this.value(f.def, ann);
          if (ann) this.assignCheck(ann, t, f.def);
          this.sink(f.def);
          type = ann ?? (resolve(t).k === "none" ? opt(fresh()) : t);
        } else if (ann) type = ann;
        else this.error(f.span, "type.fieldDefault", [f.name]);
        const field: FieldInfo = { name: f.name, jsName: jsSafe(f.name), type, decl: f };
        rec.fields.push(field);
        this.bind(scope, f.name, "field", type, f.span, { field, fn: undefined });
      }
    });
    rec.state = "done";
  }

  // ---------------------------------------------------------------- blocchi dell'engine

  private declareBlock(d: A.BlockDecl): void {
    if (!this.host.block) {
      this.error(d.nameSpan, "block.noHost");
      return;
    }
    if (this.blocks.some((b) => b.decl.name === d.name)) {
      this.error(d.nameSpan, "name.duplicate", [d.name, this.blocks.find((b) => b.decl.name === d.name)!.decl.line]);
      return;
    }
    const rec: RecordInfo = { name: d.name, jsName: `$Block_${jsSafe(d.name)}`, fields: [], methods: new Map(), isBlock: true, state: "done" };
    const init = this.newFn("$init", "ctor", { owner: rec });
    const info: BlockInfo = { decl: d, rec, props: [], handlers: [], actions: [], requires: d.requires.map((r) => r.name), init };
    for (const f of d.funcs) {
      if (rec.methods.has(f.name)) this.error(f.nameSpan, "name.duplicate", [f.name, rec.methods.get(f.name)!.decl!.nameSpan.line]);
      else rec.methods.set(f.name, this.declareFn(f, "method", rec));
    }
    const it = this.lang === "it";
    const noWait: Partial<Record<A.HookName, string>> = {
      update: it ? "«quando aggiorna» viene chiamato a ogni fotogramma e deve finire subito (usa «quando inizia» per le sequenze con le attese)" : "\"on update\" runs every frame and must finish right away (use \"on start\" for sequences with waits)",
      physics: it ? "«quando fisica» deve finire subito" : "\"on physics\" must finish right away",
      late: it ? "«quando dopo» deve finire subito" : "\"on late\" must finish right away",
      end: it ? "«quando finisce» deve finire subito" : "\"on end\" must finish right away",
    };
    for (const h of d.handlers) {
      const fn = this.newFn(`$on_${h.hook}${h.eventName ? `_${h.eventName}` : ""}`, "handler", { owner: rec, body: h.body, noWait: noWait[h.hook] });
      fn.jsName = jsSafe(fn.name);
      if (h.param) fn.params = [{ name: h.param.name, mode: "borrow", type: this.host.block.entity() }];
      if (h.hook === "update") fn.params = [];
      info.handlers.push({ h, fn });
    }
    const names = new Set<string>();
    for (const a of d.actions) {
      if (names.has(a.name)) this.error(a.nameSpan, "name.duplicate", [a.name, a.span.line]);
      names.add(a.name);
      const fn = this.newFn(a.name, a.kind, {
        owner: rec,
        body: a.body,
        noWait: a.kind === "condition" ? (it ? "una condizione deve rispondere subito" : "a condition must answer right away") : undefined,
      });
      fn.jsName = `$${a.kind === "action" ? "act" : "cond"}_${jsSafe(a.name)}`;
      fn.params = a.params.map((p) => ({ name: p.name, mode: p.mode, def: p.def, decl: p }));
      info.actions.push({ a, fn, params: [] });
    }
    for (const r of d.requires) if (!this.host.block.blockExists(r.name)) this.error(r.span, "block.unknownRequire", [r.name]);
    this.blocks.push(info);
  }

  private constValue(e: A.Expr): { ok: boolean; value: unknown } {
    switch (e.k) {
      case "num":
        return { ok: true, value: e.value };
      case "unary":
        if (e.op === "-" && e.e.k === "num") return { ok: true, value: -e.e.value };
        return { ok: false, value: undefined };
      case "str":
        return e.parts.every((p) => typeof p === "string") ? { ok: true, value: e.parts.join("") } : { ok: false, value: undefined };
      case "bool":
        return { ok: true, value: e.value };
      case "member":
        if (e.info?.k === "enum") return { ok: true, value: e.info.member };
        return { ok: false, value: undefined };
      default:
        return { ok: false, value: undefined };
    }
  }

  private unitOf(e: A.Expr): A.UnitSpec | undefined {
    if (e.k === "num") return e.unit;
    if (e.k === "unary" && e.e.k === "num") return e.e.unit;
    return undefined;
  }

  private unitFactor(u: A.UnitSpec | undefined): { factor: number; tile: number } {
    let factor = 1;
    let tile = 0;
    for (const a of u?.atoms ?? []) {
      const def = UNITS[a.name];
      if (!def) continue;
      factor *= a.power > 0 ? def.factor : 1 / def.factor;
      if (def.tile) tile += a.power;
    }
    return { factor, tile };
  }

  private checkBlock(info: BlockInfo): void {
    const host = this.host.block!;
    const d = info.decl;
    const scope = this.memberScope(info.rec);
    const it = this.lang === "it";
    const label = (name: string) => {
      const s = name.replace(/_/g, " ");
      return s.charAt(0).toUpperCase() + s.slice(1);
    };
    const ctx = this.newCtx(info.init, VOID, true, info.rec, info);
    this.within(ctx, scope, () => {
      for (const n of host.names) {
        const t = n.type(info.requires);
        for (const nm of new Set([n.it, n.en])) this.bind(scope, nm, "host", t, d.nameSpan, { hostJs: n.js, fn: undefined, hostNames: { it: n.it, en: n.en } });
      }
      this.bind(scope, "dt", "host", num({ s: 1 }), d.nameSpan, { hostJs: "this.$dt", fn: undefined });
      // Proprietà (i campi dell'Inspector).
      for (const p of d.props) {
        if (scope.vars.has(p.name) && scope.vars.get(p.name)!.kind !== "host") {
          this.error(p.span, "name.duplicate", [p.name, scope.vars.get(p.name)!.decl.line]);
          continue;
        }
        let kind = "";
        let type: Type = ERR;
        let options: string[] | undefined;
        const hp = p.ann?.k === "tname" ? this.hostProps.get(p.ann.name) : undefined;
        const ann = p.ann ? this.resolveAnn(p.ann) : undefined;
        const t = this.value(p.def, ann);
        if (ann) this.assignCheck(ann, t, p.def);
        type = ann ?? t;
        const r = resolve(type);
        if (hp) kind = hp.kind;
        else if (r.k === "num") kind = "number";
        else if (r.k === "text") kind = "string";
        else if (r.k === "bool") kind = "boolean";
        else if (r.k === "enum") {
          kind = "select";
          options = r.en.members;
        } else if (r.k !== "err") this.error(p.def, "block.propType", [[...new Set(host.propTypes.map((x) => (it ? x.it : x.en)))].join(", ")]);
        const c = this.constValue(p.def);
        if (!c.ok) this.error(p.def, "block.propConst");
        const unit = this.unitOf(p.def);
        const b = this.bind(scope, p.name, "prop", type, p.span, { unitFactor: this.unitFactor(unit), fn: undefined });
        info.props.push({ decl: p, name: p.name, binding: b, kind, label: p.label ?? label(p.name), def: c.value, unit: unit?.text, options });
      }
      // Campi (la memoria del blocco): nell'ordine, ognuno vede quelli prima.
      for (const f of d.fields) {
        if (scope.vars.has(f.name) && scope.vars.get(f.name)!.kind !== "host") {
          this.error(f.span, "name.duplicate", [f.name, scope.vars.get(f.name)!.decl.line]);
          continue;
        }
        const ann = f.ann ? this.resolveAnn(f.ann) : undefined;
        let type: Type = ann ?? ERR;
        if (f.def) {
          const t = this.value(f.def, ann);
          if (ann) this.assignCheck(ann, t, f.def);
          this.sink(f.def);
          type = ann ?? (resolve(t).k === "none" ? opt(fresh()) : t);
        } else if (!ann) this.error(f.span, "type.fieldDefault", [f.name]);
        const field: FieldInfo = { name: f.name, jsName: jsSafe(f.name), type, decl: f };
        const clash = info.rec.methods.get(f.name)?.decl;
        if (clash) this.error(clash.nameSpan, "name.duplicate", [f.name, f.span.line]);
        info.rec.fields.push(field);
        this.bind(scope, f.name, "blockField", type, f.span, { field, fn: undefined });
      }
    });
    info.init.state = "done";
    for (const ev of d.events) {
      if (d.events.filter((x) => x.name === ev.name).length > 1) this.error(ev.span, "name.duplicate", [ev.name, d.events.find((x) => x.name === ev.name)!.span.line]);
    }
    for (const a of info.actions) {
      this.ensureSignature(a.fn);
      for (const p of a.fn.params) {
        const r = p.type ? resolve(p.type) : undefined;
        const hp = p.decl?.ann?.k === "tname" ? this.hostProps.get(p.decl.ann.name) : undefined;
        let kind = hp?.kind ?? "";
        let options: string[] | undefined;
        if (!hp) {
          if (r?.k === "num") kind = "number";
          else if (r?.k === "text") kind = "string";
          else if (r?.k === "bool") kind = "boolean";
          else if (r?.k === "enum") {
            kind = "select";
            options = r.en.members;
          }
        }
        if (!kind || p.mode !== "borrow") {
          this.error(p.decl?.span ?? a.a.nameSpan, "block.paramType");
          if (!p.type) p.type = ERR;
        }
        const def = p.def ? this.constValue(p.def).value : undefined;
        a.params.push({ name: p.name, kind, label: label(p.name), def, options });
      }
      this.ensureChecked(a.fn);
    }
    for (const h of info.handlers) this.ensureChecked(h.fn);
    for (const m of info.rec.methods.values()) {
      if (m.generic) {
        if (!m.instances.size) this.checkUnusedTemplate(m);
      } else this.ensureChecked(m);
    }
  }

  // ---------------------------------------------------------------- istruzioni

  private stmts(list: A.Stmt[], scope: Scope): void {
    const saved = this.scope;
    this.scope = scope;
    let warned = false;
    for (const s of list) {
      if (isDecl(s)) continue;
      if (this.flow.dead && !warned) {
        this.warn(s, "flow.unreachable", [this.flow.dead]);
        warned = true;
      }
      this.stmt(s);
    }
    this.scopeDecls.set(list, scope.decls);
    this.scope = saved;
  }

  /** Un blocco di istruzioni in una sua zona: le variabili create qui dentro finiscono con il blocco. */
  private block(list: A.Stmt[], line: number, setup?: (s: Scope) => void): Scope {
    const scope = new Scope(this.scope, "block");
    setup?.(scope);
    this.stmts(list, scope);
    for (const [name, b] of scope.vars) if (!b.alias && b.kind !== "loop" && b.kind !== "catch") this.scope.expired.set(name, line);
    return scope;
  }

  private stmt(s: A.Stmt): void {
    switch (s.k) {
      case "expr": {
        if (s.e.k === "name" && (this.fns.has(s.e.name) || this.ctx.rec?.methods.has(s.e.name) || FUNCTION_BY_NAME.has(s.e.name)) && !this.scope.find(s.e.name)) {
          this.error(s.e, "flow.callParens", [s.e.name]);
          return;
        }
        const t = this.expr(s.e);
        if (s.e.k !== "call" && s.e.k !== "move" && resolve(t).k !== "err" && resolve(t).k !== "void") this.warn(s.e, "flow.unused");
        return;
      }
      case "assign":
        return this.assignStmt(s);
      case "const": {
        const existing = this.scope.vars.get(s.name);
        if (existing) {
          this.error(s.nameSpan, "name.duplicate", [s.name, existing.decl.line]);
          return;
        }
        this.checkNewName(s.name, s.nameSpan);
        const ann = s.ann ? this.resolveAnn(s.ann) : undefined;
        const t = this.value(s.value, ann);
        if (ann) this.assignCheck(ann, t, s.value);
        this.sink(s.value);
        const b = this.bind(this.scope, s.name, "const", ann ?? t, s.nameSpan, { global: this.scope === this.global });
        s.declares = b;
        return;
      }
      case "if":
        return this.ifStmt(s);
      case "while": {
        const before = cloneFlow(this.flow);
        this.invalidateAssigned(s.body);
        const n = this.cond(s.cond);
        this.applyNarrow(n.then);
        this.loop(s.body, s.line, before);
        this.applyNarrow(n.else);
        if (s.cond.k === "bool" && s.cond.value && !this.hasExit(s.body)) this.warn(s, "flow.infinite");
        return;
      }
      case "repeat": {
        if (s.count) {
          const t = this.value(s.count, NUM);
          this.expectNum(t, s.count);
        }
        const before = cloneFlow(this.flow);
        this.invalidateAssigned(s.body);
        this.loop(s.body, s.line, before);
        if (!s.count) {
          if (!this.hasExit(s.body)) this.warn(s, "flow.infinite");
          else if (!this.hasBreak(s.body)) this.flow.dead = this.lang === "it" ? "ripeti" : "repeat";
        }
        return;
      }
      case "foreach":
        return this.forEach(s);
      case "forrange": {
        const ft = this.value(s.from, NUM);
        const tt = this.value(s.to, NUM);
        this.expectNum(ft, s.from);
        this.expectNum(tt, s.to);
        this.sameUnits(ft, tt, s.to, OP_VERB["<"]);
        if (s.step) {
          const st = this.value(s.step, NUM);
          this.expectNum(st, s.step);
          this.sameUnits(ft, st, s.step, OP_VERB["+"]);
        }
        const rf = resolve(ft);
        const type = num(rf.k === "num" ? (rf.dims ?? (resolve(tt) as { dims?: Dims }).dims) : undefined);
        const before = cloneFlow(this.flow);
        this.invalidateAssigned(s.body);
        this.loop(s.body, s.line, before, (scope) => {
          s.v.ref = this.bind(scope, s.v.name, "loop", type, s.v.span);
        });
        return;
      }
      case "return":
        return this.returnStmt(s);
      case "break":
      case "continue":
        if (this.ctx.loopDepth === 0) this.error(s, "parse.breakOutside", [this.lang === "it" ? (s.k === "break" ? "interrompi" : "continua") : s.k]);
        this.flow.dead = this.lang === "it" ? (s.k === "break" ? "interrompi" : "continua") : s.k;
        return;
      case "pass":
        return;
      case "check": {
        this.cond(s.cond);
        if (s.message) this.value(s.message);
        return;
      }
      case "wait":
        return this.waitStmt(s);
      case "try": {
        const before = cloneFlow(this.flow);
        // Con «bravo» le variabili del tentativo vivono anche nel ramo del successo.
        const bodyScope = s.success ? new Scope(this.scope, "block") : undefined;
        if (bodyScope) this.stmts(s.body, bodyScope);
        else this.block(s.body, s.line);
        const afterBody = this.flow;
        this.flow = mergeFlows([before, cloneFlow(afterBody)]);
        this.flow.dead = false;
        this.block(s.handler, s.line, (scope) => {
          if (s.errVar) s.errVar.ref = this.bind(scope, s.errVar.name, "catch", TEXT, s.errVar.span);
        });
        const afterHandler = this.flow;
        if (!s.success || !bodyScope) {
          this.flow = mergeFlows([afterBody, afterHandler]);
          return;
        }
        this.flow = afterBody;
        const outer = this.scope;
        this.scope = bodyScope;
        try {
          this.block(s.success, s.line);
        } finally {
          this.scope = outer;
        }
        for (const [name, b] of bodyScope.vars) if (!b.alias && b.kind !== "loop" && b.kind !== "catch") outer.expired.set(name, s.line);
        for (const [name, l] of bodyScope.expired) if (!outer.expired.has(name)) outer.expired.set(name, l);
        this.flow = mergeFlows([this.flow, afterHandler]);
        return;
      }
      case "fail":
        this.value(s.message);
        this.flow.dead = this.lang === "it" ? "fallisci" : "fail";
        return;
      case "panic":
        if (s.message) this.value(s.message);
        this.flow.dead = "mamma mia!";
        return;
      case "later":
        return this.laterStmt(s);
      case "match":
        return this.matchStmt(s);
      case "emit": {
        const blk = this.ctx.block;
        if (!blk) {
          this.error(s, "block.emitOutside");
          return;
        }
        if (!blk.decl.events.some((e) => e.name === s.event)) {
          const did = closest(
            s.event,
            blk.decl.events.map((e) => e.name),
          );
          this.error(s.eventSpan, did ? "name.unknownDid" : "block.unknownEvent", did ? [s.event, did] : [s.event]);
        }
        return;
      }
      default:
        return;
    }
  }

  /** C'è un modo di uscire dal ciclo (interrompi, ritorna, aspetta, fallisci)? */
  private hasExit(body: A.Stmt[]): boolean {
    let found = false;
    const visit = (list: A.Stmt[]) => {
      for (const s of list) {
        if (found) return;
        if (s.k === "break" || s.k === "return" || s.k === "wait" || s.k === "fail" || s.k === "panic") found = true;
        for (const sub of this.children(s)) visit(sub);
      }
    };
    visit(body);
    return found;
  }

  private hasBreak(body: A.Stmt[]): boolean {
    let found = false;
    const visit = (list: A.Stmt[]) => {
      for (const s of list) {
        if (s.k === "break") found = true;
        if (s.k === "while" || s.k === "repeat" || s.k === "foreach" || s.k === "forrange") continue;
        for (const sub of this.children(s)) visit(sub);
      }
    };
    visit(body);
    return found;
  }

  private children(s: A.Stmt): A.Stmt[][] {
    switch (s.k) {
      case "if":
        return [...s.branches.map((b) => b.body), ...(s.els ? [s.els] : [])];
      case "while":
      case "repeat":
      case "foreach":
      case "forrange":
        return [s.body];
      case "try":
        return [s.body, s.handler, ...(s.success ? [s.success] : [])];
      case "match":
        return [...s.cases.map((c) => c.body), ...(s.els ? [s.els] : [])];
      // Un cappuccino è un'altra sequenza: le sue attese e le sue uscite non contano per il codice che lo ordina.
      default:
        return [];
    }
  }

  private exprsOf(s: A.Stmt): A.Expr[] {
    switch (s.k) {
      case "expr":
        return [s.e];
      case "assign":
        return [s.target, s.value];
      case "return":
        return s.value ? [s.value] : [];
      default:
        return [];
    }
  }

  private walkExpr(e: A.Expr, fn: (e: A.Expr) => void): void {
    fn(e);
    switch (e.k) {
      case "unary":
      case "move":
        return this.walkExpr(e.e, fn);
      case "binary":
        this.walkExpr(e.l, fn);
        return this.walkExpr(e.r, fn);
      case "call":
        this.walkExpr(e.callee, fn);
        for (const a of e.args) this.walkExpr(a.value, fn);
        return;
      case "member":
        return this.walkExpr(e.obj, fn);
      case "index":
        this.walkExpr(e.obj, fn);
        return this.walkExpr(e.index, fn);
      case "list":
        for (const x of e.items) this.walkExpr(x, fn);
        return;
      case "map":
        for (const x of e.entries) {
          this.walkExpr(x.key, fn);
          this.walkExpr(x.value, fn);
        }
        return;
      case "str":
        for (const p of e.parts) if (typeof p !== "string") this.walkExpr(p, fn);
        return;
      case "lambda":
        return this.walkExpr(e.body, fn);
      case "pizza":
        return this.walkExpr(e.value, fn);
      case "pipe":
        this.walkExpr(e.start, fn);
        for (const st of e.steps) for (const a of st.args) this.walkExpr(a.value, fn);
        return;
      default:
        return;
    }
  }

  /** Prima di un ciclo: le variabili cambiate dentro il ciclo non sono più «sicuramente non niente». */
  private invalidateAssigned(body: A.Stmt[]): void {
    const visit = (list: A.Stmt[]) => {
      for (const s of list) {
        if (s.k === "assign") {
          const key = this.syntacticPath(s.target);
          if (key) this.invalidate(key);
        }
        for (const sub of this.children(s)) visit(sub);
      }
    };
    visit(body);
  }

  /** Il percorso di un'assegnazione senza controllarla (solo per le variabili già note). */
  private syntacticPath(e: A.Expr): string | undefined {
    if (e.k === "name") {
      const b = this.scope.find(e.name);
      return b ? `b${b.id}` : undefined;
    }
    if (e.k === "this") return "this";
    if (e.k === "member") {
      const p = this.syntacticPath(e.obj);
      return p ? `${p}.${e.name}` : undefined;
    }
    if (e.k === "index") return this.syntacticPath(e.obj);
    return undefined;
  }

  private loop(body: A.Stmt[], line: number, before: Flow, setup?: (s: Scope) => void): void {
    const depth = this.ctx.loopDepth;
    this.ctx.loopDepth++;
    try {
      this.block(body, line, setup);
    } finally {
      this.ctx.loopDepth = depth;
    }
    for (const [b, m] of this.flow.moved) {
      if (before.moved.has(b)) continue;
      if ((b.loopDepth ?? 0) <= depth) this.error(m.span, "mem.moveInLoop", [b.name]);
    }
    const after = mergeFlows([before, { ...this.flow, dead: false }]);
    this.flow = after;
  }

  private ifStmt(s: A.If): void {
    const branches: { scope: Scope; flow: Flow }[] = [];
    let elseNarrow = new Map<string, Type>();
    const start = cloneFlow(this.flow);
    let current = start;
    for (const br of s.branches) {
      this.flow = cloneFlow(current);
      const n = this.cond(br.cond);
      const afterCond = cloneFlow(this.flow);
      this.applyNarrow(n.then);
      const scope = this.block(br.body, br.span.line);
      branches.push({ scope, flow: this.flow });
      current = afterCond;
      this.flow = current;
      this.applyNarrow(n.else);
      current = cloneFlow(this.flow);
      elseNarrow = n.else;
    }
    void elseNarrow;
    let elseScope: Scope | undefined;
    this.flow = cloneFlow(current);
    if (s.els) {
      elseScope = this.block(s.els, s.line);
      branches.push({ scope: elseScope, flow: this.flow });
    } else branches.push({ scope: new Scope(this.scope, "block"), flow: this.flow });
    this.flow = mergeFlows(branches.map((b) => b.flow));
    if (s.els) this.hoist(s, branches);
  }

  /** Variabili create in tutti i casi di un se/scegli (con un altrimenti): esistono anche dopo. */
  private hoist(s: A.If | A.Match, branches: { scope: Scope; flow: Flow }[]): void {
    const live = branches.filter((b) => !b.flow.dead);
    if (!live.length) return;
    for (const [name, first] of live[0].scope.vars) {
      if (first.kind !== "local") continue;
      const all = branches.map((b) => b.scope.vars.get(name)).filter((b): b is Binding => !!b && b.kind === "local");
      if (!live.every((b) => b.scope.vars.get(name)?.kind === "local")) continue;
      const type = first.type;
      if (!all.every((b) => unify(b.type, type))) continue;
      const global = this.scope === this.global;
      const outer = this.bind(this.scope, name, global ? "global" : "local", type, first.decl, { global });
      for (const b of all) b.alias = outer;
      (s.hoisted ??= []).push(outer);
      this.scope.expired.delete(name);
    }
  }

  private forEach(s: A.ForEach): void {
    const it = this.value(s.iter);
    const r = resolve(it);
    let types: Type[] = [];
    const two = s.vars.length === 2;
    switch (r.k) {
      case "list":
        types = two ? [NUM, r.el] : [r.el];
        break;
      case "text":
        types = two ? [NUM, TEXT] : [TEXT];
        if (s.change) this.error(s.iter, "type.textImmutable");
        break;
      case "map":
        types = two ? [r.key, r.val] : [r.key];
        break;
      case "any":
      case "err":
        types = [ANY, ANY];
        break;
      case "opt":
        this.maybeNothing(s.iter);
        types = [ERR, ERR];
        break;
      case "var":
        this.error(s.iter, "type.cantInferExpr");
        types = [ERR, ERR];
        break;
      default:
        this.error(s.iter, "type.notIterable", [phrase(it)]);
        types = [ERR, ERR];
    }
    if (s.change) this.checkMutable(s.iter);
    const root = this.rootOf(s.iter);
    const frozenKey = root?.k === "b" ? root.b : root?.k === "this" ? "this" : undefined;
    const hadFrozen = frozenKey ? this.ctx.frozen.get(frozenKey) : undefined;
    if (frozenKey && hadFrozen === undefined) this.ctx.frozen.set(frozenKey, s.line);
    const before = cloneFlow(this.flow);
    this.invalidateAssigned(s.body);
    try {
      this.loop(s.body, s.line, before, (scope) => {
        s.vars.forEach((v, i) => {
          // Con due nomi: (posizione, elemento) nelle liste, (chiave, valore) nelle mappe. Solo l'elemento si può cambiare.
          const isElement = i === s.vars.length - 1 && !(r.k === "map" && !two);
          v.ref = this.bind(scope, v.name, "loop", types[i] ?? ERR, v.span, { mutable: s.change && isElement });
        });
      });
    } finally {
      if (frozenKey && hadFrozen === undefined) this.ctx.frozen.delete(frozenKey);
    }
  }

  private matchStmt(s: A.Match): void {
    const st = this.value(s.subject);
    const seen = new Map<string, true>();
    const branches: { scope: Scope; flow: Flow }[] = [];
    const start = cloneFlow(this.flow);
    for (const c of s.cases) {
      for (const v of c.values) {
        const vt = this.value(v, st);
        const k = this.constKey(v);
        if (k === undefined) this.error(v, "type.caseValue");
        else if (seen.has(k)) this.error(v, "type.caseDuplicate", [k]);
        else seen.set(k, true);
        if (!unify(unopt(st), unopt(vt)) && resolve(vt).k !== "none") this.error(v, "type.equal", [phrase(st), phrase(vt)]);
        this.sameUnits(st, vt, v, OP_VERB["=="]);
      }
      this.flow = cloneFlow(start);
      const scope = this.block(c.body, c.span.line);
      branches.push({ scope, flow: this.flow });
    }
    this.flow = cloneFlow(start);
    if (s.els) {
      const scope = this.block(s.els, s.line);
      branches.push({ scope, flow: this.flow });
    } else branches.push({ scope: new Scope(this.scope, "block"), flow: this.flow });
    this.flow = mergeFlows(branches.map((b) => b.flow));
    if (s.els) this.hoist(s, branches);
  }

  private constKey(e: A.Expr): string | undefined {
    switch (e.k) {
      case "num":
        return String(e.value);
      case "unary":
        return e.op === "-" && e.e.k === "num" ? String(-e.e.value) : undefined;
      case "str":
        return e.parts.every((p) => typeof p === "string") ? JSON.stringify(e.parts.join("")) : undefined;
      case "bool":
        return String(e.value);
      case "none":
        return "niente";
      case "member":
        return e.info?.k === "enum" ? `${e.info.en.name}.${e.info.member}` : undefined;
      default:
        return undefined;
    }
  }

  private returnStmt(s: A.Return): void {
    const ctx = this.ctx;
    if (ctx.fn.kind === "main") this.error(s, "parse.returnOutside");
    if (s.value) {
      const r = resolve(ctx.ret);
      if (ctx.retDeclared && r.k === "void") {
        this.error(s.value, "type.returnNothing");
        this.value(s.value);
      } else {
        const t = this.value(s.value, ctx.retDeclared ? ctx.ret : undefined);
        if (ctx.returnsVoid && !ctx.retDeclared) this.error(s, "type.returnNothing");
        this.assignCheck(ctx.ret, t, s.value);
        const v = s.value;
        if (v.k === "name" && v.ref && !v.ref.global && (v.ref.kind === "local" || (v.ref.kind === "param" && v.ref.mode === "take")) && v.ref.fn === ctx.fn) {
          s.moveLocal = v.ref;
        } else this.sink(v);
      }
      ctx.returnsValue = true;
    } else {
      const r = resolve(ctx.ret);
      if ((ctx.retDeclared && r.k !== "void" && r.k !== "any" && r.k !== "err") || ctx.returnsValue) this.error(s, "type.returnValue", [phrase(ctx.ret)]);
      ctx.returnsVoid = true;
    }
    this.flow.dead = this.lang === "it" ? "ritorna" : "return";
  }

  /** «cappuccino [durata]:»: il blocco diventa una sequenza a parte, con le variabili di fuori copiate. */
  private laterStmt(s: A.Later): void {
    const fn = this.ctx.fn;
    const it = this.lang === "it";
    let why: string | undefined;
    if (fn.kind === "condition") why = it ? "una condizione deve rispondere subito" : "a condition must answer right away";
    else if (fn.kind === "dtor" || (fn.kind === "handler" && fn.name === "$on_end"))
      why = it ? "«quando finisce» chiude tutto, e il cappuccino non arriverebbe mai" : "\"on end\" closes everything, and the cappuccino would never arrive";
    else if (fn.kind === "ctor") why = it ? "qui il valore si sta ancora creando" : "the value is still being created here";
    else if (fn.kind === "method" && fn.owner && !fn.owner.isBlock)
      why = it ? "nelle funzioni di un tipo il valore potrebbe non esserci più quando il cappuccino arriva" : "in a type's functions the value might be gone when the cappuccino arrives";
    if (why) this.error(s, "later.here", [why]);
    if (s.delay) {
      const t = this.value(s.delay, num({ s: 1 }));
      this.expectNum(t, s.delay);
      const r = resolve(t);
      if (r.k === "num" && r.dims && dimsKey(r.dims) !== "s1") this.error(s.delay, "later.delay", [phrase(t)]);
    }
    // Il corpo è un'altra funzione (che può aspettare): chi ordina non aspetta.
    const later = this.newFn("$later", "later", { owner: fn.owner });
    later.routine = true;
    const frame = { fn: later, captures: new Map<Binding, true>(), kind: "later" as const };
    const saved = { ctx: this.ctx, flow: this.flow };
    this.ctx = this.newCtx(later, VOID, true, saved.ctx.rec, saved.ctx.block);
    this.flow = cloneFlow(saved.flow);
    this.flow.dead = false;
    this.lambdas.push(frame);
    try {
      this.block(s.body, s.line);
    } finally {
      this.lambdas.pop();
      this.ctx = saved.ctx;
      this.flow = saved.flow;
    }
    s.fn = later;
    s.captures = [...frame.captures.keys()];
  }

  private waitStmt(s: A.Wait): void {
    const fn = this.ctx.fn;
    if (this.lambdas.length && this.lambdas[this.lambdas.length - 1].kind !== "later")
      this.error(s, "flow.waitHere", [(l) => (l === "it" ? "una funzione veloce (x => …) deve rispondere subito" : "a quick function (x => …) must answer right away")]);
    fn.routine = true;
    fn.waitSpan ??= s;
    if (s.seconds) {
      const t = this.value(s.seconds, num({ s: 1 }));
      this.expectNum(t, s.seconds);
      const r = resolve(t);
      if (r.k === "num" && r.dims && dimsKey(r.dims) !== "s1") this.error(s.seconds, "type.mismatch", [dimsName({ s: 1 }, this.lang), phrase(t)]);
    }
    if (s.until) this.cond(s.until);
  }

  // ---------------------------------------------------------------- assegnazioni

  private checkNewName(name: string, span: Span): void {
    if (this.fns.has(name) || this.records.has(name) || this.enums.has(name)) {
      const other = this.fns.get(name)?.decl?.nameSpan ?? this.records.get(name)?.decl?.nameSpan ?? this.enums.get(name)?.decl.nameSpan;
      this.error(span, "name.duplicate", [name, other?.line ?? 0]);
    }
  }

  private assignStmt(s: A.Assign): void {
    const t = s.target;
    if (s.op === "=" && t.k === "name") return this.assignName(s, t);
    if (s.op !== "=") return this.compoundAssign(s);
    let tt: Type;
    if (t.k === "member") tt = this.memberTarget(t);
    else if (t.k === "index") tt = this.indexTarget(t);
    else tt = ERR;
    const vt = this.value(s.value, tt);
    this.assignCheck(tt, vt, s.value);
    this.unitAssign(t, tt, vt, s.value);
    this.sink(s.value);
    const key = this.pathKey(t);
    if (key) {
      this.invalidate(key);
      if (resolve(tt).k === "opt" && !this.maybeNone(vt)) this.flow.narrow.set(key, unopt(tt));
    }
  }

  private assignName(s: A.Assign, t: A.NameRef): void {
    let b = this.scope.find(t.name);
    if (s.ann && b && this.scope.vars.get(t.name) === b) {
      this.error(t, "name.duplicate", [t.name, b.decl.line]);
      return;
    }
    if (s.ann) b = undefined;
    if (b) {
      t.ref = b;
      t.ty = b.type;
      this.checkMutable(t);
      const vt = this.value(s.value, b.type);
      if (resolve(vt).k === "void") this.error(s.value, "type.assignVoid", [this.describeCall(s.value), t.name]);
      else this.assignCheck(b.type, vt, s.value, t.name);
      this.unitAssign(t, b.type, vt, s.value);
      this.sink(s.value);
      this.flow.moved.delete(b);
      const key = `b${b.id}`;
      this.invalidate(key);
      if (resolve(b.type).k === "opt" && !this.maybeNone(vt)) this.flow.narrow.set(key, unopt(b.type));
      return;
    }
    // Nuova variabile.
    if (this.fns.has(t.name) || this.records.has(t.name) || this.enums.has(t.name)) {
      this.checkNewName(t.name, t);
      this.value(s.value);
      return;
    }
    const ann = s.ann ? this.resolveAnn(s.ann) : undefined;
    const vt = this.value(s.value, ann);
    let type: Type;
    if (resolve(vt).k === "void") {
      this.error(s.value, "type.assignVoid", [this.describeCall(s.value), t.name]);
      type = ann ?? ERR;
    } else {
      if (ann) this.assignCheck(ann, vt, s.value, t.name);
      type = ann ?? (resolve(vt).k === "none" ? opt(fresh()) : vt);
    }
    const global = this.scope === this.global;
    b = this.bind(this.scope, t.name, global ? "global" : "local", type, t, { global });
    s.declares = b;
    t.ref = b;
    t.ty = type;
    this.sink(s.value);
    if (resolve(type).k === "opt" && !this.maybeNone(vt)) this.flow.narrow.set(`b${b.id}`, unopt(type));
  }

  private describeCall(e: A.Expr): MsgArg {
    if (e.k === "call" && e.callee.k === "name") return `«${e.callee.name}»`;
    if (e.k === "call" && e.callee.k === "member") return `«${e.callee.name}»`;
    return this.lang === "it" ? "Questo" : "This";
  }

  private compoundAssign(s: A.Assign): void {
    const tt = this.value(s.target);
    this.checkMutable(s.target);
    if (s.target.k === "index" && resolve(s.target.obj.ty ?? ANY).k === "text") this.error(s.target, "type.textImmutable");
    if (s.target.k === "member" && s.target.info?.k === "host" && !s.target.info.m.set) this.error(s.target.nameSpan, "type.readOnly", [s.target.name]);
    if (s.target.k === "member" && s.target.info?.k === "builtin") this.error(s.target.nameSpan, "type.readOnly", [s.target.name]);
    const vt = this.value(s.value, tt);
    const op = s.op.slice(0, -1) as A.BinOp;
    const res = this.binaryType(op, tt, vt, s, s.target, s.value);
    s.info = res.info;
    this.assignCheck(tt, res.type, s.value);
    this.unitAssign(s.target, tt, res.type, s.value);
    const key = this.pathKey(s.target);
    if (key) this.invalidate(key);
  }

  private memberTarget(t: A.Member): Type {
    const tt = this.memberExpr(t, true);
    t.ty = tt;
    const info = t.info;
    if (!info) return tt;
    switch (info.k) {
      case "field":
        this.checkMutable(t);
        return info.field.type;
      case "host":
        if (!info.m.set) this.error(t.nameSpan, "type.readOnly", [t.name]);
        return tt;
      case "builtin":
      case "enum":
      case "const":
      case "fnValue":
        this.error(t.nameSpan, "type.readOnly", [t.name]);
        return ERR;
      default:
        return tt;
    }
  }

  private indexTarget(t: A.Index): Type {
    const ot = this.value(t.obj);
    const r = resolve(ot);
    let res: Type = ERR;
    switch (r.k) {
      case "list": {
        const it = this.value(t.index, NUM);
        this.expectNum(it, t.index);
        this.checkMutable(t);
        res = r.el;
        break;
      }
      case "map": {
        const kt = this.value(t.index, r.key);
        this.assignCheck(r.key, kt, t.index);
        this.checkMutable(t);
        res = r.val;
        break;
      }
      case "text":
        this.value(t.index);
        this.error(t, "type.textImmutable");
        break;
      case "any":
      case "err":
        this.value(t.index);
        res = r;
        break;
      case "opt":
        this.value(t.index);
        this.maybeNothing(t.obj);
        break;
      default:
        this.value(t.index);
        this.error(t.obj, "type.notIndexable", [phrase(ot)]);
    }
    t.ty = res;
    return res;
  }

  private unitAssign(target: A.Expr | string, dst: Type, src: Type, at: Span): void {
    const d = resolve(dst);
    const s = resolve(src);
    if (d.k !== "num" || s.k !== "num" || !d.dims || !s.dims || dimsEqual(d.dims, s.dims)) return;
    const name = typeof target === "string" ? target : target.k === "name" ? target.name : target.k === "member" ? target.name : "?";
    this.error(at, "unit.assign", [name, (l) => dimsName(d.dims, l), (l) => dimsName(s.dims, l)]);
  }

  // ---------------------------------------------------------------- mutabilità e posti

  /** Da dove viene un valore che si vuole cambiare. */
  private rootOf(e: A.Expr): Root | undefined {
    switch (e.k) {
      case "name":
        if (!e.ref) return undefined;
        if (e.ref.kind === "host") return { k: "host" };
        return { k: "b", b: e.ref };
      case "this":
        return { k: "this" };
      case "member": {
        const ot = e.obj.ty ? resolve(e.obj.ty) : undefined;
        if (ot?.k === "host" || e.info?.k === "host") return { k: "host" };
        if (e.obj.k === "this" && this.ctx.rec) {
          const b = this.memberScope(this.ctx.rec).vars.get(e.name);
          if (b) return { k: "b", b };
        }
        return this.rootOf(e.obj);
      }
      case "index": {
        const ot = e.obj.ty ? resolve(e.obj.ty) : undefined;
        if (ot?.k === "host") return { k: "host" };
        return this.rootOf(e.obj);
      }
      default:
        return undefined;
    }
  }

  /** Il messaggio per una copia catturata: da una funzione veloce o da un cappuccino. */
  private capturedMsg(b: Binding): string {
    return this.lambdas.find((l) => l.captures.has(b))?.kind === "later" ? "name.capturedLater" : "name.captured";
  }

  private capturedBy(b: Binding): boolean {
    if (b.global || b.kind === "global" || b.kind === "field" || b.kind === "blockField" || b.kind === "prop" || b.kind === "host") return false;
    return this.lambdas.some((l) => l.captures.has(b));
  }

  private immutableError(b: Binding, span: Span): boolean {
    switch (b.kind) {
      case "const":
        this.error(span, "name.constant", [b.name]);
        return true;
      case "param":
        if (b.mode === "borrow") {
          this.error(span, "name.borrowed", [b.name]);
          return true;
        }
        return false;
      case "loop":
        if (!b.mutable) {
          this.error(span, "name.loopVar", [b.name]);
          return true;
        }
        return false;
      case "host":
        this.error(span, "type.readOnly", [b.name]);
        return true;
      default:
        return false;
    }
  }

  /** Controlla che `e` si possa cambiare (assegnazione, «cambia», metodo che cambia). */
  private checkMutable(e: A.Expr): void {
    const root = this.rootOf(e);
    if (!root || root.k === "host") return;
    if (root.k === "this") {
      if (this.lambdas.length) {
        this.error(e, "name.captured", ["questo"]);
        return;
      }
      if (this.ctx.frozen.has("this")) {
        this.error(e, "name.frozen", [this.lang === "it" ? "questo" : "this", this.ctx.frozen.get("this")!]);
        return;
      }
      this.markMutating();
      return;
    }
    const b = root.b;
    if (this.immutableError(b, e)) return;
    if (this.capturedBy(b)) {
      this.error(e, this.capturedMsg(b), [b.name]);
      return;
    }
    if (b.kind === "field" && this.lambdas.length) {
      this.error(e, "name.captured", [b.name]);
      return;
    }
    const f = this.ctx.frozen.get(b);
    if (f !== undefined) {
      this.error(e, "name.frozen", [b.name, f]);
      return;
    }
    if (b.kind === "field") this.markMutating();
  }

  private markMutating(): void {
    const fn = this.ctx.fn;
    if (fn.kind === "method") fn.mutating = true;
  }

  /** Un valore letto da un posto che resta al suo proprietario va copiato (se non è un valore piccolo). */
  private sink(e: A.Expr): void {
    if (!this.isPlace(e)) return;
    if (!isPrimitive(e.ty ?? ANY)) e.copy = true;
  }

  private isPlace(e: A.Expr): boolean {
    switch (e.k) {
      case "name":
        return !!e.ref && e.ref.kind !== "host";
      case "this":
        return true;
      case "member":
        return e.info?.k === "field";
      case "index": {
        const r = e.obj.ty ? resolve(e.obj.ty) : undefined;
        return r?.k === "list" || r?.k === "map";
      }
      default:
        return false;
    }
  }

  // ---------------------------------------------------------------- «niente» e narrowing

  private pathKey(e: A.Expr): string | undefined {
    switch (e.k) {
      case "name":
        return e.ref ? `b${e.ref.id}` : undefined;
      case "this":
        return "this";
      case "member": {
        if (e.info?.k !== "field") return undefined;
        const p = this.pathKey(e.obj);
        return p ? `${p}.${e.name}` : undefined;
      }
      default:
        return undefined;
    }
  }

  private invalidate(key: string): void {
    for (const k of [...this.flow.narrow.keys()]) if (k === key || k.startsWith(`${key}.`)) this.flow.narrow.delete(k);
  }

  private applyNarrow(n: Map<string, Type>): void {
    for (const [k, t] of n) this.flow.narrow.set(k, t);
  }

  private maybeNone(t: Type): boolean {
    const r = resolve(t);
    return r.k === "opt" || r.k === "none" || r.k === "any" || r.k === "var";
  }

  private maybeNothing(e: A.Expr): void {
    if (e.k === "name") this.error(e, "type.maybeNothing", [e.name]);
    else if (e.k === "member") this.error(e, "type.maybeNothing", [this.exprText(e)]);
    else this.error(e, "type.maybeNothingExpr");
  }

  private exprText(e: A.Expr): string {
    if (e.k === "name") return e.name;
    if (e.k === "this") return this.lang === "it" ? "questo" : "this";
    if (e.k === "member") return `${this.exprText(e.obj)}.${e.name}`;
    return "…";
  }

  /** Una condizione: deve essere vero/falso; restituisce che cosa si sa nei due rami. */
  private cond(e: A.Expr): Narrowing {
    if (e.k === "unary" && e.op === "not") {
      const r = this.cond(e.e);
      e.ty = BOOL;
      return { then: r.else, else: r.then };
    }
    if (e.k === "binary" && (e.op === "and" || e.op === "or")) {
      const l = this.cond(e.l);
      const saved = new Map(this.flow.narrow);
      this.applyNarrow(e.op === "and" ? l.then : l.else);
      const r = this.cond(e.r);
      this.flow.narrow = saved;
      e.ty = BOOL;
      e.info = "bool";
      if (e.op === "and") return { then: new Map([...l.then, ...r.then]), else: new Map() };
      return { then: new Map(), else: new Map([...l.else, ...r.else]) };
    }
    if (e.k === "binary" && (e.op === "==" || e.op === "!=")) {
      const noneSide = e.r.k === "none" ? e.l : e.l.k === "none" ? e.r : undefined;
      const t = this.expr(e);
      this.expectBool(t, e);
      if (noneSide) {
        const key = this.pathKey(noneSide);
        const nt = noneSide.ty ? resolve(noneSide.ty) : undefined;
        if (key && nt?.k === "opt") {
          const m = new Map([[key, nt.t]]);
          return e.op === "!=" ? { then: m, else: new Map() } : { then: new Map(), else: m };
        }
      }
      return emptyNarrowing();
    }
    const t = this.value(e, BOOL);
    this.expectBool(t, e);
    return emptyNarrowing();
  }

  // ---------------------------------------------------------------- controlli di tipo

  private expectBool(t: Type, at: Span): void {
    const r = resolve(t);
    if (r.k === "var") unify(r, BOOL);
    else if (r.k !== "bool" && r.k !== "any" && r.k !== "err") this.error(at, "type.condition", [phrase(t)]);
  }

  private expectNum(t: Type, at: Span): Dims | undefined {
    const r = resolve(t);
    if (r.k === "var") {
      unify(r, NUM);
      return undefined;
    }
    if (r.k === "num") return r.dims;
    if (r.k === "opt") this.maybeNothing(at as A.Expr);
    else if (r.k !== "any" && r.k !== "err") this.error(at, "type.mismatch", [phrase(NUM), phrase(t)]);
    return undefined;
  }

  private sameUnits(a: Type, b: Type, at: Span, verb: [string, string] | MsgArg): void {
    const x = resolve(a);
    const y = resolve(b);
    if (x.k !== "num" || y.k !== "num" || !x.dims || !y.dims || dimsEqual(x.dims, y.dims)) return;
    const v: MsgArg = Array.isArray(verb) ? (l) => (l === "it" ? verb[0] : verb[1]) : verb;
    this.error(at, "unit.mismatch", [v, (l) => dimsName(x.dims, l), (l) => dimsName(y.dims, l)]);
  }

  /** Il valore `src` va bene dove serve `dst`? Se no, un messaggio chiaro. */
  private assignCheck(dst: Type, src: Type, at: A.Expr | Span, name?: string): boolean {
    const res = assignable(dst, src);
    if (res === "ok") return true;
    const sp = at as Span;
    if (res === "nothing") this.error(sp, "type.notNothing", [name ? `«${name}»` : this.lang === "it" ? "Questo valore" : "This value", (l) => typeText(dst, l)]);
    else if (res === "maybe") {
      if ("k" in at && (at.k === "name" || at.k === "member")) this.maybeNothing(at);
      else this.error(sp, "type.maybeNothingExpr");
    } else if (name) this.error(sp, "type.assign", [name, phrase(dst), phrase(src)]);
    else this.error(sp, "type.mismatch", [phrase(dst), phrase(src)]);
    return false;
  }

  // ---------------------------------------------------------------- espressioni

  /** Un'espressione usata come valore (non può essere «niente di niente», cioè una funzione che non restituisce). */
  private value(e: A.Expr, expected?: Type): Type {
    const t = this.expr(e, expected);
    if (resolve(t).k === "void") {
      this.error(e, "type.void", [this.describeCall(e)]);
      e.ty = ERR;
      return ERR;
    }
    return t;
  }

  private expr(e: A.Expr, expected?: Type): Type {
    const t = this.exprInner(e, expected);
    e.ty = t;
    return t;
  }

  private exprInner(e: A.Expr, expected?: Type): Type {
    switch (e.k) {
      case "num": {
        if (!e.unit) return NUM;
        let dims: Dims | undefined;
        for (const a of e.unit.atoms) {
          const u = UNITS[a.name];
          if (!u) {
            this.error(e, "parse.badUnit", [a.name]);
            return NUM;
          }
          dims = dimsCombine(dims, { [u.dim]: 1 }, a.power);
        }
        return num(dims);
      }
      case "str":
        for (const p of e.parts) if (typeof p !== "string") this.value(p);
        return TEXT;
      case "bool":
        return BOOL;
      case "none":
        return NONE;
      case "name":
        return this.nameExpr(e, expected);
      case "this": {
        const rec = this.ctx.rec;
        if (!rec || rec.isBlock) {
          this.error(e, "type.thisOutside");
          return ERR;
        }
        return { k: "rec", rec };
      }
      case "list":
        return this.listExpr(e, expected);
      case "map":
        return this.mapExpr(e, expected);
      case "unary": {
        if (e.op === "not") {
          const t = this.value(e.e, BOOL);
          this.expectBool(t, e.e);
          return BOOL;
        }
        const t = this.value(e.e, NUM);
        const r = resolve(t);
        if (r.k === "any") return ANY;
        return num(this.expectNum(t, e.e));
      }
      case "binary":
        return this.binaryExpr(e);
      case "call":
        return this.callExpr(e, expected);
      case "member":
        return this.memberExpr(e, false);
      case "index":
        return this.indexExpr(e);
      case "move":
        return this.moveExpr(e);
      case "lambda":
        return this.lambdaExpr(e, expected);
      case "pizza":
        return this.pizzaExpr(e, expected);
      case "pipe":
        return this.pipeExpr(e);
    }
  }

  // ---------------------------------------------------------------- pizza e spaghetti

  private pizzaExpr(e: A.PizzaExpr, expected?: Type): Type {
    if (e.kind === "rec") {
      const call = e.value as A.Call;
      const name = (call.callee as A.NameRef).name;
      if (!this.records.has(name) && (baseTypeOf(name) || this.hostTypes.has(name) || this.hostProps.has(name) || this.enums.has(name))) {
        this.error(e.ann, "pizza.what", [`«${name}»`]);
        this.skipArgs(call);
        return ERR;
      }
      return this.value(call, expected);
    }
    const t = this.resolveAnn(e.ann);
    const vt = this.value(e.value, t);
    this.assignCheck(t, vt, e.value);
    return t;
  }

  /** Il passo si fa con un metodo (o un campo) del valore? */
  private pipeMember(name: string, t: Type): "method" | "prop" | undefined {
    const r = resolve(t);
    switch (r.k) {
      case "rec":
        this.ensureRecord(r.rec);
        if (r.rec.methods.has(name)) return "method";
        return r.rec.fields.some((f) => f.name === name) ? "prop" : undefined;
      case "list":
      case "text":
      case "map": {
        const b = (r.k === "list" ? LIST_BY_NAME : r.k === "text" ? TEXT_BY_NAME : MAP_BY_NAME).get(name);
        return b ? (b.prop ? "prop" : "method") : undefined;
      }
      case "host":
        if (r.host.methods.some((x) => x.it === name || x.en === name)) return "method";
        return r.host.members.some((x) => x.it === name || x.en === name) ? "prop" : undefined;
      case "any":
        return this.pipeFunction(name) ? undefined : "method";
      default:
        return undefined;
    }
  }

  /** Il passo è una funzione (tua, del tipo o del blocco, della libreria, o una variabile che contiene una funzione)? */
  private pipeFunction(name: string): boolean {
    return !!this.scope.find(name) || this.fns.has(name) || !!this.ctx.rec?.methods.has(name) || FUNCTION_BY_NAME.has(name);
  }

  private pipeNames(t: Type): string[] {
    const r = resolve(t);
    const own: string[] = [];
    if (r.k === "rec") own.push(...r.rec.fields.map((f) => f.name), ...r.rec.methods.keys());
    else if (r.k === "list" || r.k === "text" || r.k === "map") own.push(...(r.k === "list" ? LIST_BY_NAME : r.k === "text" ? TEXT_BY_NAME : MAP_BY_NAME).keys());
    else if (r.k === "host") own.push(...r.host.methods.flatMap((x) => [x.it, x.en]), ...r.host.members.flatMap((x) => [x.it, x.en]));
    return [...own, ...this.fns.keys(), ...FUNCTION_BY_NAME.keys(), ...(this.ctx.rec ? this.ctx.rec.methods.keys() : [])];
  }

  /**
   * «spaghetti valore:» con un passo per riga. Ogni passo diventa una chiamata sul valore del passo prima,
   * tenuto in una variabile nascosta ($p…): si controllano come chiamate normali (tipi, copie, «cambia»).
   */
  private pipeExpr(e: A.PipeExpr): Type {
    const scope = new Scope(this.scope, "block");
    const saved = this.scope;
    this.scope = scope;
    const temps: Binding[] = [];
    const ops: { target?: Binding; e: A.Expr }[] = [];
    const temp = (type: Type, at: Span) => {
      const b = this.bind(scope, `$p${this.nextId}`, "local", type, at);
      temps.push(b);
      return b;
    };
    const ref = (b: Binding, at: Span): A.NameRef => ({ k: "name", name: b.name, line: at.line, col: at.col, pos: at.pos, end: at.end });
    const span = (x: Span): Span => ({ line: x.line, col: x.col, pos: x.pos, end: x.end });
    try {
      let curType = this.value(e.start);
      let cur = temp(curType, e.start);
      let result: A.Expr | undefined;
      let resultTemp: Binding | undefined;
      let type: Type = curType;
      for (let i = 0; i < e.steps.length; i++) {
        const st = e.steps[i];
        const last = i === e.steps.length - 1;
        const r = resolve(curType);
        if (r.k === "err") return ERR;
        if (r.k === "opt" || r.k === "none") {
          this.error(st.nameSpan, "pipe.maybeNothing", [st.name]);
          return ERR;
        }
        if (r.k === "var") {
          this.error(st.nameSpan, "type.cantInferExpr");
          return ERR;
        }
        const member = this.pipeMember(st.name, curType);
        let call: A.Expr;
        let isMethod = true;
        if (member === "prop" && !st.parens) call = { k: "member", obj: ref(cur, st.nameSpan), name: st.name, nameSpan: span(st.nameSpan), ...span(st.span) };
        else if (member) call = { k: "call", callee: { k: "member", obj: ref(cur, st.nameSpan), name: st.name, nameSpan: span(st.nameSpan), ...span(st.nameSpan) }, args: st.args, ...span(st.span) };
        else if (this.pipeFunction(st.name)) {
          isMethod = false;
          // Il valore va come primo argomento (con «cambia» se la funzione lo cambia).
          const fn = this.scope.find(st.name) ? undefined : (this.ctx.rec?.methods.get(st.name) ?? this.fns.get(st.name));
          if (fn) this.ensureSignature(fn);
          const change = fn?.params[0]?.mode === "change";
          call = { k: "call", callee: { k: "name", name: st.name, ...span(st.nameSpan) }, args: [{ value: ref(cur, st.nameSpan), change }, ...st.args], ...span(st.span) };
        } else {
          const did = closest(st.name, this.pipeNames(curType));
          if (did) this.error(st.nameSpan, "pipe.unknownStepDid", [st.name, did]);
          else this.error(st.nameSpan, "pipe.unknownStep", [st.name, phrase(curType)]);
          for (const a of st.args) this.expr(a.value);
          return ERR;
        }
        const t = this.expr(call);
        if (resolve(t).k === "err") return ERR;
        if (resolve(t).k === "void") {
          // Niente da restituire: si va avanti con lo stesso valore (magari cambiato).
          if (last && !isMethod) {
            ops.push({ e: call });
            type = VOID;
          } else if (last) {
            ops.push({ e: call });
            resultTemp = cur;
            type = curType;
          } else ops.push({ e: call });
          continue;
        }
        if (last) {
          // Il risultato esce dagli spaghetti: se è un campo, va copiato. (Nei passi in mezzo decide il generatore.)
          this.sink(call);
          result = call;
          type = t;
        } else {
          const b = temp(t, st.span);
          ops.push({ target: b, e: call });
          cur = b;
          curType = t;
        }
      }
      e.plan = { temps, ops, result, resultTemp };
      return type;
    } finally {
      this.scope = saved;
    }
  }

  private nameExpr(e: A.NameRef, expected?: Type): Type {
    const b = this.scope.find(e.name);
    if (b) return this.useBinding(e, b);
    if (this.ctx.rec && !this.ctx.rec.isBlock) {
      if (this.ctx.rec.methods.has(e.name)) {
        this.error(e, "name.isFunction", [e.name]);
        return ERR;
      }
    }
    const fn = this.fns.get(e.name);
    if (fn) return this.fnValue(e, fn, expected);
    if (this.records.has(e.name) || this.enums.has(e.name) || this.hostTypes.has(e.name)) {
      this.error(e, "name.isType", [e.name]);
      return ERR;
    }
    const c = CONSTANTS.find((x) => x.it.includes(e.name) || x.en.includes(e.name));
    if (c) {
      e.special = { k: "const", js: c.js };
      this.rename(e, c.it[0], c.en[0]);
      return c.type;
    }
    if (FUNCTION_BY_NAME.has(e.name) || this.ctx.rec?.methods.has(e.name)) {
      this.error(e, "name.isFunction", [e.name]);
      return ERR;
    }
    this.unknownName(e.name, e);
    return ERR;
  }

  private unknownName(name: string, at: Span): void {
    const expired = this.scope.findExpired(name);
    if (expired !== undefined) {
      this.error(at, "name.onlyIn", [name, expired]);
      return;
    }
    const future = this.futureGlobals.get(name);
    if (future !== undefined && future >= at.line) {
      this.error(at, "name.notYet", [name, future]);
      return;
    }
    const candidates = [...this.scope.names(), ...this.fns.keys(), ...FUNCTION_BY_NAME.keys(), ...(this.ctx.rec ? this.ctx.rec.methods.keys() : [])];
    const did = closest(name, candidates);
    if (did) this.error(at, "name.unknownDid", [name, did]);
    else this.error(at, "name.unknown", [name]);
  }

  private useBinding(e: A.NameRef, b: Binding): Type {
    e.ref = b;
    if (b.hostNames) this.rename(e, b.hostNames.it, b.hostNames.en);
    const m = this.flow.moved.get(b);
    if (m) this.error(e, m.maybe ? "mem.maybeMoved" : "mem.moved", [b.name, m.span.line]);
    // Dentro una funzione veloce: le variabili di fuori vengono copiate.
    if (this.lambdas.length && !b.global && b.kind !== "global" && b.kind !== "field" && b.kind !== "blockField" && b.kind !== "prop" && b.kind !== "host") {
      let k = -1;
      for (let i = this.lambdas.length - 1; i >= 0; i--) if (this.lambdas[i].fn === b.fn) k = i;
      for (let i = k + 1; i < this.lambdas.length; i++) this.lambdas[i].captures.set(b, true);
    }
    const n = this.flow.narrow.get(`b${b.id}`);
    return n ?? b.type;
  }

  private fnValue(e: A.NameRef, fn: FnInfo, expected?: Type): Type {
    this.ensureSignature(fn);
    if (fn.params.some((p) => p.mode !== "borrow")) {
      this.error(e, "mem.fnValueChange");
      return ERR;
    }
    let target = fn;
    if (fn.generic) {
      const exp = expected ? resolve(expected) : undefined;
      if (exp?.k !== "fn" || exp.params.length < fn.params.filter((p) => !p.def).length) {
        this.error(e, "type.genericValue", [fn.name]);
        return ERR;
      }
      target = this.instantiate(
        fn,
        fn.params.map((p, i) => p.type ?? exp.params[i] ?? ANY),
      );
    } else this.ensureChecked(fn);
    e.special = { k: "fnValue", fn: target };
    this.noteCall(target, e);
    this.fnValues.push({ fn: target, span: e });
    return { k: "fn", params: target.params.map((p) => p.type ?? ANY), ret: target.ret ?? fresh() };
  }

  private noteCall(fn: FnInfo, at: Span): void {
    const cur = this.ctx.fn;
    cur.calls.add(fn);
    if (!cur.callSpans.has(fn)) cur.callSpans.set(fn, at);
  }

  private listExpr(e: A.ListLit, expected?: Type): Type {
    const exp = expected ? resolve(expected) : undefined;
    let el: Type = exp?.k === "list" ? exp.el : fresh();
    let first = true;
    for (const item of e.items) {
      const t = this.value(item, el);
      const r = resolve(t);
      if (first && resolve(el).k === "var") {
        unify(el, r.k === "none" ? opt(fresh()) : t);
      } else if (assignable(el, t) !== "ok") {
        // [1, niente] → Lista di Numero?
        if (r.k === "none" && !isPrimitive(el) === false) el = opt(el);
        else this.error(item, "type.mixedList", [phrase(t), phrase(el)]);
      }
      first = false;
      this.sink(item);
    }
    return list(el);
  }

  private mapExpr(e: A.MapLit, expected?: Type): Type {
    const exp = expected ? resolve(expected) : undefined;
    const key: Type = exp?.k === "map" ? exp.key : fresh();
    const val: Type = exp?.k === "map" ? exp.val : fresh();
    for (const en of e.entries) {
      const kt = this.value(en.key, key);
      if (assignable(key, kt) !== "ok") this.error(en.key, "type.mixedList", [phrase(kt), phrase(key)]);
      this.checkMapKey(kt, en.key);
      const vt = this.value(en.value, val);
      if (assignable(val, vt) !== "ok") this.error(en.value, "type.mixedList", [phrase(vt), phrase(val)]);
      this.sink(en.value);
    }
    return map(key, val);
  }

  private moveExpr(e: A.MoveExpr): Type {
    const inner = e.e;
    if (inner.k !== "name") {
      this.error(e, "mem.moveWhat");
      return this.value(inner);
    }
    const t = this.value(inner);
    const b = inner.ref;
    if (!b) return t;
    if (b.kind === "param" && b.mode !== "take") {
      this.error(e, "mem.moveBorrowed", [b.name]);
      return t;
    }
    if (b.kind === "const") {
      this.error(e, "name.constant", [b.name]);
      return t;
    }
    if (b.kind === "loop" || b.kind === "host" || b.kind === "field" || b.kind === "blockField" || b.kind === "prop" || b.kind === "catch") {
      this.error(e, "mem.moveWhat");
      return t;
    }
    if (b.global && this.ctx.fn !== this.main) {
      this.error(e, "mem.moveGlobal", [b.name]);
      return t;
    }
    if (this.capturedBy(b)) {
      this.error(e, this.capturedMsg(b), [b.name]);
      return t;
    }
    const f = this.ctx.frozen.get(b);
    if (f !== undefined) this.error(e, "name.frozen", [b.name, f]);
    this.flow.moved.set(b, { span: e, maybe: false });
    return t;
  }

  private lambdaExpr(e: A.Lambda, expected?: Type): Type {
    const exp = expected ? resolve(expected) : undefined;
    if (exp?.k !== "fn") {
      this.error(e, "type.lambdaNoContext");
      return ERR;
    }
    if (exp.params.length !== e.params.length) {
      this.error(e, "type.argCount", [this.lang === "it" ? "La funzione veloce" : "The quick function", exp.params.length, e.params.length]);
      return ERR;
    }
    const fn = this.newFn("$lambda", "lambda");
    const frame = { fn, captures: new Map<Binding, true>() };
    const scope = new Scope(this.scope, "block");
    const savedFn = this.ctx.fn;
    this.lambdas.push(frame);
    // I parametri appartengono alla funzione veloce.
    this.ctx.fn = fn;
    try {
      e.params.forEach((p, i) => {
        p.ref = this.bind(scope, p.name, "param", exp.params[i], p.span, { mode: "borrow" });
      });
      const saved = this.scope;
      this.scope = scope;
      const bt = this.value(e.body, resolve(exp.ret).k === "var" ? undefined : exp.ret);
      this.scope = saved;
      const rr = resolve(exp.ret);
      if (rr.k === "var") unify(rr, bt);
      else this.assignCheck(exp.ret, bt, e.body);
      this.sink(e.body);
    } finally {
      this.ctx.fn = savedFn;
      this.lambdas.pop();
    }
    savedFn.calls.add(fn);
    e.captures = [...frame.captures.keys()];
    return exp;
  }

  // ---------------------------------------------------------------- operatori

  private binaryExpr(e: A.Binary): Type {
    if (e.op === "and" || e.op === "or") {
      this.cond(e);
      return BOOL;
    }
    const lt = this.value(e.l);
    const rt = this.value(e.r, e.op === "in" || e.op === "notin" ? undefined : lt);
    const res = this.binaryType(e.op, lt, rt, e, e.l, e.r);
    e.info = res.info;
    return res.type;
  }

  private binaryType(op: A.BinOp, lt: Type, rt: Type, at: Span, le: A.Expr, re: A.Expr): { type: Type; info: OpInfo } {
    const l = resolve(lt);
    const r = resolve(rt);
    const shown = OP_SHOWN[op] ?? op;
    const bad = (): { type: Type; info: OpInfo } => {
      if (l.k !== "err" && r.k !== "err") this.error(at, "type.binary", [phrase(lt), shown, phrase(rt)]);
      return { type: ERR, info: "dyn" };
    };
    const optSide = l.k === "opt" ? le : r.k === "opt" ? re : undefined;
    switch (op) {
      case "+":
        if (l.k === "text" || r.k === "text") {
          if (optSide && op === "+" && l.k !== "text" && r.k !== "text") return bad();
          return { type: TEXT, info: "concat" };
        }
        if (l.k === "list" && r.k === "list") {
          if (!unify(l.el, r.el)) return bad();
          return { type: l, info: "listConcat" };
        }
      // eslint-disable-next-line no-fallthrough
      case "-":
      case "*":
      case "/":
      case "%":
      case "^": {
        if (l.k === "any" || r.k === "any") return { type: ANY, info: "dyn" };
        if (l.k === "var") unify(l, NUM);
        if (r.k === "var") unify(r, NUM);
        const L = resolve(lt);
        const R = resolve(rt);
        if (L.k === "opt" || R.k === "opt") {
          this.maybeNothing(L.k === "opt" ? le : re);
          return { type: ERR, info: "num" };
        }
        if (L.k !== "num" || R.k !== "num") return bad();
        let dims: Dims | undefined;
        if (op === "+" || op === "-" || op === "%") {
          if (L.dims && R.dims && !dimsEqual(L.dims, R.dims)) {
            const verb = OP_VERB[op];
            this.error(at, "unit.mismatch", [(lg) => (lg === "it" ? verb[0] : verb[1]), (lg) => dimsName(L.dims, lg), (lg) => dimsName(R.dims, lg)]);
          }
          dims = L.dims ?? (op === "%" ? undefined : R.dims);
        } else if (op === "*") dims = dimsCombine(L.dims, R.dims, 1);
        else if (op === "/") dims = dimsCombine(L.dims, R.dims, -1);
        else {
          const exp = re.k === "num" ? re.value : undefined;
          dims = exp !== undefined ? dimsScale(L.dims, exp) : undefined;
        }
        if (op === "/" && re.k === "num" && re.value === 0) this.error(re, "type.divConst");
        return { type: num(dims), info: "num" };
      }
      case "==":
      case "!=": {
        if (l.k === "none" || r.k === "none") {
          const other = l.k === "none" ? r : l;
          if (other.k !== "opt" && other.k !== "any" && other.k !== "err" && other.k !== "none" && other.k !== "var") this.error(at, "type.equal", [phrase(lt), phrase(rt)]);
          return { type: BOOL, info: "eqPrim" };
        }
        if (!unify(unopt(lt), unopt(rt))) {
          this.error(at, "type.equal", [phrase(lt), phrase(rt)]);
          return { type: BOOL, info: "eqDeep" };
        }
        this.sameUnits(lt, rt, at, OP_VERB[op]);
        return { type: BOOL, info: isPrimitive(lt) && isPrimitive(rt) ? "eqPrim" : "eqDeep" };
      }
      case "<":
      case ">":
      case "<=":
      case ">=": {
        if (l.k === "any" || r.k === "any") return { type: BOOL, info: "dyn" };
        if (l.k === "var") unify(l, r.k === "text" ? TEXT : NUM);
        if (r.k === "var") unify(r, resolve(lt));
        const L = resolve(lt);
        const R = resolve(rt);
        if (L.k === "opt" || R.k === "opt") {
          this.maybeNothing(L.k === "opt" ? le : re);
          return { type: BOOL, info: "cmpNum" };
        }
        if (L.k === "num" && R.k === "num") {
          this.sameUnits(L, R, at, OP_VERB[op]);
          return { type: BOOL, info: "cmpNum" };
        }
        if (L.k === "text" && R.k === "text") return { type: BOOL, info: "cmpText" };
        this.error(at, "type.compare", [phrase(L.k === "num" || L.k === "text" ? rt : lt)]);
        return { type: BOOL, info: "cmpNum" };
      }
      case "in":
      case "notin": {
        if (r.k === "list") {
          if (assignable(r.el, lt) !== "ok") this.error(le, "type.mismatch", [phrase(r.el), phrase(lt)]);
          return { type: BOOL, info: "inList" };
        }
        if (r.k === "map") {
          if (assignable(r.key, lt) !== "ok") this.error(le, "type.mismatch", [phrase(r.key), phrase(lt)]);
          return { type: BOOL, info: "inMap" };
        }
        if (r.k === "text") {
          if (l.k !== "text" && l.k !== "any" && l.k !== "err") this.error(le, "type.mismatch", [phrase(TEXT), phrase(lt)]);
          return { type: BOOL, info: "inText" };
        }
        if (r.k === "any") return { type: BOOL, info: "dyn" };
        if (r.k === "opt") {
          this.maybeNothing(re);
          return { type: BOOL, info: "dyn" };
        }
        if (r.k !== "err") this.error(re, "type.notIterable", [phrase(rt)]);
        return { type: BOOL, info: "dyn" };
      }
      default:
        return bad();
    }
  }

  // ---------------------------------------------------------------- membri e posizioni

  private memberExpr(e: A.Member, asTarget: boolean): Type {
    // Colore.rosso
    if (e.obj.k === "name" && !this.scope.find(e.obj.name) && this.enums.has(e.obj.name)) {
      const en = this.enums.get(e.obj.name)!;
      if (!en.members.includes(e.name)) {
        this.error(e.nameSpan, "type.enumMember", [en.name, e.name, en.members.join(", ")]);
        return ERR;
      }
      e.info = { k: "enum", en, member: e.name };
      e.obj.ty = { k: "enum", en };
      return { k: "enum", en };
    }
    const ot = this.value(e.obj);
    const r = resolve(ot);
    switch (r.k) {
      case "rec": {
        this.ensureRecord(r.rec);
        const field = r.rec.fields.find((f) => f.name === e.name);
        if (field) {
          e.info = { k: "field", rec: r.rec, field };
          const key = this.pathKey(e);
          const n = key && !asTarget ? this.flow.narrow.get(key) : undefined;
          return n ?? field.type;
        }
        if (r.rec.methods.has(e.name)) {
          this.error(e.nameSpan, "name.isFunction", [e.name]);
          return ERR;
        }
        return this.noMember(e, ot, [...r.rec.fields.map((f) => f.name), ...r.rec.methods.keys()]);
      }
      case "list":
      case "text":
      case "map": {
        const table = r.k === "list" ? LIST_BY_NAME : r.k === "text" ? TEXT_BY_NAME : MAP_BY_NAME;
        const b = table.get(e.name);
        if (b?.prop) {
          e.info = { k: "builtin", id: b.id };
          this.rename(e.nameSpan, b.it[0], b.en[0]);
          return this.runBuiltinCheck(b, r, [], [], e);
        }
        if (b) {
          this.error(e.nameSpan, "name.isFunction", [e.name]);
          return ERR;
        }
        return this.noMember(e, ot, [...table.keys()]);
      }
      case "host": {
        const m = r.host.members.find((x) => x.it === e.name || x.en === e.name);
        if (m) {
          e.info = { k: "host", m };
          this.rename(e.nameSpan, m.it, m.en);
          return m.type();
        }
        if (r.host.methods.some((x) => x.it === e.name || x.en === e.name)) {
          this.error(e.nameSpan, "name.isFunction", [e.name]);
          return ERR;
        }
        return this.noMember(e, ot, [...r.host.members.flatMap((x) => [x.it, x.en]), ...r.host.methods.flatMap((x) => [x.it, x.en])]);
      }
      case "opt":
        this.maybeNothing(e.obj);
        return ERR;
      case "any":
        e.info = { k: "any" };
        return ANY;
      case "err":
        return ERR;
      case "var":
        this.error(e.obj, "type.cantInferExpr");
        return ERR;
      default:
        return this.noMember(e, ot, []);
    }
  }

  private noMember(e: A.Member, ot: Type, names: string[]): Type {
    const did = closest(e.name, names);
    if (did) this.error(e.nameSpan, "type.noMemberDid", [phrase(ot), e.name, did]);
    else this.error(e.nameSpan, "type.noMember", [phrase(ot), e.name]);
    return ERR;
  }

  private indexExpr(e: A.Index): Type {
    const ot = this.value(e.obj);
    const r = resolve(ot);
    switch (r.k) {
      case "list": {
        const it = this.value(e.index, NUM);
        this.expectNum(it, e.index);
        return r.el;
      }
      case "text": {
        const it = this.value(e.index, NUM);
        this.expectNum(it, e.index);
        return TEXT;
      }
      case "map": {
        const kt = this.value(e.index, r.key);
        this.assignCheck(r.key, kt, e.index);
        return r.val;
      }
      case "any":
      case "err":
        this.value(e.index);
        return r;
      case "opt":
        this.value(e.index);
        this.maybeNothing(e.obj);
        return ERR;
      default:
        this.value(e.index);
        this.error(e.obj, "type.notIndexable", [phrase(ot)]);
        return ERR;
    }
  }

  // ---------------------------------------------------------------- chiamate

  private callExpr(e: A.Call, expected?: Type): Type {
    const c = e.callee;
    if (c.k === "name") {
      const b = this.scope.find(c.name);
      if (b) {
        c.ty = this.useBinding(c, b);
        return this.valueCall(e, c.ty);
      }
      const own = this.ctx.rec?.methods.get(c.name);
      if (own) return this.methodCall(e, own, undefined);
      const fn = this.fns.get(c.name);
      if (fn) return this.fnCall(e, fn);
      const rec = this.records.get(c.name);
      if (rec) return this.ctorCall(e, rec);
      if (this.enums.has(c.name) || this.hostTypes.has(c.name)) {
        this.error(c, "name.isType", [c.name]);
        this.skipArgs(e);
        return ERR;
      }
      const bi = FUNCTION_BY_NAME.get(c.name);
      if (bi) this.rename(c, bi.it[0], bi.en[0]);
      if (bi) return this.builtinCall(e, bi, undefined, undefined, expected);
      this.unknownName(c.name, c);
      this.skipArgs(e);
      return ERR;
    }
    if (c.k === "member") {
      if (c.obj.k === "name" && !this.scope.find(c.obj.name) && this.enums.has(c.obj.name)) {
        this.memberExpr(c, false);
        this.error(c.nameSpan, "type.notCallable", [`«${c.obj.name}.${c.name}»`]);
        this.skipArgs(e);
        return ERR;
      }
      const ot = this.value(c.obj);
      const r = resolve(ot);
      switch (r.k) {
        case "rec": {
          this.ensureRecord(r.rec);
          const m = r.rec.methods.get(c.name);
          if (m) return this.methodCall(e, m, c.obj);
          const field = r.rec.fields.find((f) => f.name === c.name);
          if (field) {
            c.info = { k: "field", rec: r.rec, field };
            c.ty = field.type;
            return this.valueCall(e, field.type);
          }
          this.noMember(c, ot, [...r.rec.fields.map((f) => f.name), ...r.rec.methods.keys()]);
          this.skipArgs(e);
          return ERR;
        }
        case "list":
        case "text":
        case "map": {
          const table = r.k === "list" ? LIST_BY_NAME : r.k === "text" ? TEXT_BY_NAME : MAP_BY_NAME;
          const b = table.get(c.name);
          if (b) {
            if (b.prop && e.args.length) this.error(c.nameSpan, "type.propCall", [c.name]);
            this.rename(c.nameSpan, b.it[0], b.en[0]);
            return this.builtinCall(e, b, c.obj, r, expected);
          }
          this.noMember(c, ot, [...table.keys()]);
          this.skipArgs(e);
          return ERR;
        }
        case "host": {
          const m = r.host.methods.find((x) => x.it === c.name || x.en === c.name);
          if (m) this.rename(c.nameSpan, m.it, m.en);
          if (m) return this.hostCall(e, m, c.obj);
          this.noMember(c, ot, [...r.host.methods.flatMap((x) => [x.it, x.en])]);
          this.skipArgs(e);
          return ERR;
        }
        case "opt":
          this.maybeNothing(c.obj);
          this.skipArgs(e);
          return ERR;
        case "any":
          c.info = { k: "any" };
          return this.anyCall(e);
        case "var":
          this.error(c.obj, "type.cantInferExpr");
          this.skipArgs(e);
          return ERR;
        case "err":
          this.skipArgs(e);
          return ERR;
        default:
          this.noMember(c, ot, []);
          this.skipArgs(e);
          return ERR;
      }
    }
    const t = this.value(c);
    return this.valueCall(e, t);
  }

  private skipArgs(e: A.Call): void {
    for (const a of e.args) this.expr(a.value);
  }

  private valueCall(e: A.Call, t: Type): Type {
    const r = resolve(t);
    if (r.k === "any") return this.anyCall(e);
    if (r.k === "err") {
      this.skipArgs(e);
      return ERR;
    }
    if (r.k === "opt") {
      this.maybeNothing(e.callee);
      this.skipArgs(e);
      return ERR;
    }
    if (r.k !== "fn") {
      this.error(e.callee, "type.notCallable", [phrase(t)]);
      this.skipArgs(e);
      return ERR;
    }
    if (e.args.length !== r.params.length) this.error(e, "type.argCount", [this.describeCall(e), r.params.length, e.args.length]);
    const values: A.Expr[] = [];
    e.args.forEach((a, i) => {
      if (a.name) this.error(a.nameSpan!, "type.namedBuiltin", [this.describeCall(e)]);
      if (a.change) this.error(a.value, "mem.changeNotParam", [String(i + 1)]);
      const pt = r.params[i];
      const at = this.value(a.value, pt);
      if (pt) this.assignCheck(pt, at, a.value);
      values.push(a.value);
    });
    e.info = { k: "value", args: values };
    return r.ret;
  }

  private anyCall(e: A.Call): Type {
    const values: A.Expr[] = [];
    for (const a of e.args) {
      this.value(a.value);
      values.push(a.value);
    }
    e.info = { k: "any", args: values };
    return ANY;
  }

  /** Mette gli argomenti al posto dei parametri (in ordine o con il nome). */
  private bindArgs(e: A.Call, params: { name: string; def?: A.Expr; optional?: boolean }[], label: MsgArg): (A.Arg | undefined)[] | undefined {
    const out: (A.Arg | undefined)[] = params.map(() => undefined);
    let pos = 0;
    let ok = true;
    for (const a of e.args) {
      if (a.name) {
        const i = params.findIndex((p) => p.name === a.name);
        if (i < 0) {
          const did = closest(
            a.name,
            params.map((p) => p.name),
          );
          this.error(a.nameSpan!, did ? "type.noParamDid" : "type.noParam", did ? [label, a.name, did] : [label, a.name]);
          this.expr(a.value);
          ok = false;
          continue;
        }
        if (out[i]) {
          this.error(a.nameSpan!, "type.twiceArg", [a.name]);
          this.expr(a.value);
          ok = false;
          continue;
        }
        out[i] = a;
      } else {
        if (pos >= params.length) {
          this.error(a.value, "type.argCount", [label, params.length, e.args.length]);
          this.expr(a.value);
          ok = false;
          continue;
        }
        out[pos++] = a;
      }
    }
    params.forEach((p, i) => {
      if (!out[i] && !p.def && !p.optional) {
        this.error(e, "type.missingArg", [p.name, label]);
        ok = false;
      }
    });
    return ok ? out : out;
  }

  /** Controlla un argomento per un parametro (con i modi prestito / cambia / prendi). */
  private argFor(a: A.Arg, p: ParamInfo, fnName: MsgArg, expected?: Type): Type {
    const t = p.mode === "change" ? this.expr(a.value, expected) : this.value(a.value, expected);
    if (p.mode === "change") {
      if (!a.change) this.error(a.value, "mem.changeArg", [p.name, typeof fnName === "string" ? fnName.replace(/[«»]/g, "") : "f"]);
      if (!this.isPlace(a.value)) this.error(a.value, "mem.changePlace");
      else this.checkMutable(a.value);
      const key = this.pathKey(a.value);
      if (key) this.invalidate(key);
    } else if (a.change) this.error(a.value, "mem.changeNotParam", [p.name]);
    if (p.mode === "take") this.sink(a.value);
    return t;
  }

  /** Lo stesso valore non può essere cambiato e insieme letto in un'altra parte della stessa chiamata. */
  private exclusive(args: (A.Arg | undefined)[], params: ParamInfo[], recv?: A.Expr, recvMutates?: boolean): void {
    const rootKey = (r: Root | undefined) => (r?.k === "b" ? `b${r.b.id}` : r?.k === "this" ? "this" : undefined);
    const rootsOf = args.map((a) => (a && this.isPlace(a.value) ? this.rootOf(a.value) : undefined));
    const roots = rootsOf.map(rootKey);
    const recvRoot = recv && this.isPlace(recv) ? rootKey(this.rootOf(recv)) : undefined;
    const nameOf = (r: Root | undefined) => (r?.k === "b" ? r.b.name : this.lang === "it" ? "questo" : "this");
    args.forEach((a, i) => {
      if (!a || !roots[i]) return;
      const changes = params[i]?.mode === "change";
      // Lo stesso posto in due argomenti, se almeno uno dei due lo cambia (si segnala il secondo).
      const clash =
        roots.some((r, j) => j < i && r === roots[i] && (changes || params[j]?.mode === "change")) ||
        (recvRoot === roots[i] && (changes || !!recvMutates));
      if (clash) this.error(a.value, "mem.exclusive", [nameOf(rootsOf[i])]);
    });
  }

  private fnCall(e: A.Call, fn: FnInfo): Type {
    this.ensureSignature(fn);
    const label: MsgArg = `«${fn.name}»`;
    const bound = this.bindArgs(e, fn.params, label) ?? [];
    const types: Type[] = [];
    fn.params.forEach((p, i) => {
      const a = bound[i];
      if (a) {
        const t = this.argFor(a, p, label, p.type);
        types.push(t);
        if (p.type) {
          if (p.mode === "change") {
            if (!unify(p.type, t)) this.error(a.value, "type.mismatch", [phrase(p.type), phrase(t)]);
          } else {
            this.assignCheck(p.type, t, a.value);
            this.sameUnits(p.type, t, a.value, OP_VERB["=="]);
          }
        }
      } else types.push(p.type ?? ANY);
    });
    this.exclusive(bound, fn.params);
    let target = fn;
    if (fn.generic) {
      target = this.instantiate(
        fn,
        fn.params.map((p, i) => {
          if (p.type) return p.type;
          const t = resolve(types[i]);
          return t.k === "none" ? opt(fresh()) : t;
        }),
      );
    } else this.ensureChecked(fn);
    e.info = { k: "fn", fn: target, args: bound.map((a) => a?.value) };
    this.noteCall(target, e);
    return target.ret ?? fresh();
  }

  private methodCall(e: A.Call, m: FnInfo, recv: A.Expr | undefined): Type {
    this.ensureSignature(m);
    const label: MsgArg = `«${m.name}»`;
    const bound = this.bindArgs(e, m.params, label) ?? [];
    const types: Type[] = [];
    m.params.forEach((p, i) => {
      const a = bound[i];
      if (a) {
        const t = this.argFor(a, p, label, p.type);
        types.push(t);
        if (p.type) {
          if (p.mode === "change") {
            if (!unify(p.type, t)) this.error(a.value, "type.mismatch", [phrase(p.type), phrase(t)]);
          } else this.assignCheck(p.type, t, a.value);
        }
      } else types.push(p.type ?? ANY);
    });
    this.exclusive(bound, m.params, recv, false);
    let target = m;
    if (m.generic) target = this.instantiate(m, m.params.map((p, i) => p.type ?? resolve(types[i])));
    else if (m.state === "todo") this.ensureChecked(m);
    e.info = { k: "fn", fn: target, args: bound.map((a) => a?.value), recv };
    this.noteCall(target, e);
    // Se il metodo cambia i campi, chi lo riceve deve potersi cambiare: si verifica alla fine.
    const root = recv ? this.rootOf(recv) : { k: "this" as const };
    if (!recv || this.isPlace(recv) || recv.k === "member") {
      const key = root?.k === "b" ? root.b : root?.k === "this" ? "this" : undefined;
      const frozenLine = key ? this.ctx.frozen.get(key) : undefined;
      const isCaptured = root?.k === "b" ? this.capturedBy(root.b) || (root.b.kind === "field" && this.lambdas.length > 0) : root?.k === "this" && this.lambdas.length > 0;
      const captured = isCaptured ? (root?.k === "b" ? this.capturedMsg(root.b) : "name.captured") : undefined;
      if (root && root.k !== "host") this.mutUses.push({ span: recv ?? e, root, method: target, ctx: this.ctx, frozenLine, captured });
    }
    return target.ret ?? fresh();
  }

  private ctorCall(e: A.Call, rec: RecordInfo): Type {
    this.ensureRecord(rec);
    const params: ParamInfo[] = rec.fields.map((f) => ({ name: f.name, mode: "take", type: f.type, def: f.decl.def }));
    const bound = this.bindArgs(e, params, `«${rec.name}»`) ?? [];
    params.forEach((p, i) => {
      const a = bound[i];
      if (!a) return;
      const t = this.argFor(a, p, `«${rec.name}»`, p.type);
      this.assignCheck(p.type!, t, a.value, p.name);
      this.unitAssign(p.name, p.type!, t, a.value);
    });
    e.info = { k: "ctor", rec, args: bound.map((a) => a?.value) };
    if (rec.onCreate) this.noteCall(rec.onCreate, e);
    return { k: "rec", rec };
  }

  private runBuiltinCheck(b: Builtin, recv: Type | undefined, args: Type[], nodes: A.Expr[], at: Span): Type {
    const ctx: BCtx = {
      lang: this.lang,
      recv,
      args,
      nodes,
      arg: (i, t) => this.assignCheck(t, args[i], nodes[i] ?? at),
      numArg: (i) => this.expectNum(args[i], nodes[i] ?? at),
      sameUnits: (i, j, verb) => this.sameUnits(args[i], args[j], nodes[j] ?? at, verb),
      error: (key, a, i) => this.error(i !== undefined ? (nodes[i] ?? at) : at, key, a),
    };
    return b.check(ctx);
  }

  private builtinCall(e: A.Call, b: Builtin, recv: A.Expr | undefined, recvType: Type | undefined, _expected?: Type): Type {
    const label = `«${builtinName(b, this.lang)}»`;
    if (b.needs && !this.host.capabilities.includes(b.needs)) this.error(e.callee, b.needs === "input" ? "run.noInput" : "run.noFiles");
    if (e.args.length < b.min || e.args.length > b.max) {
      if (b.min === b.max) this.error(e, "type.argCount", [label, b.min, e.args.length]);
      else if (b.max === Infinity) this.error(e, "type.argCount", [label, b.min, e.args.length]);
      else this.error(e, "type.argCountRange", [label, b.min, b.max, e.args.length]);
    }
    const types: Type[] = [];
    const nodes: A.Expr[] = [];
    e.args.forEach((a, i) => {
      if (a.name) this.error(a.nameSpan!, "type.namedBuiltin", [label]);
      if (a.change) this.error(a.value, "mem.changeNotParam", [String(i + 1)]);
      const exp = b.expect?.(i, recvType);
      types.push(this.value(a.value, exp));
      nodes.push(a.value);
      if (b.takes?.includes(i)) this.sink(a.value);
    });
    if (b.mutates && recv) {
      this.checkMutable(recv);
      const key = this.pathKey(recv);
      if (key) this.invalidate(key);
      this.exclusive(
        e.args,
        e.args.map(() => ({ name: "", mode: "borrow" }) as ParamInfo),
        recv,
        true,
      );
    }
    const res = this.runBuiltinCheck(b, recvType, types, nodes, e);
    e.info = { k: "builtin", id: b.id, args: nodes, recv, recvType };
    return res;
  }

  private hostCall(e: A.Call, m: import("./types").HostMethod, recv: A.Expr): Type {
    const label = `«${this.lang === "it" ? m.it : m.en}»`;
    const params = m.params.map((p) => ({ name: p.name, optional: p.optional }));
    const bound = this.bindArgs(e, params, label) ?? [];
    m.params.forEach((p, i) => {
      const a = bound[i];
      if (!a) return;
      if (a.change) this.error(a.value, "mem.changeNotParam", [p.name]);
      const pt = p.type();
      const t = this.value(a.value, pt);
      this.assignCheck(pt, t, a.value);
      this.sameUnits(pt, t, a.value, OP_VERB["=="]);
      // L'engine può tenersi il valore (una variabile del gioco): gli si dà una copia.
      this.sink(a.value);
    });
    e.info = { k: "host", m, recv, args: bound.map((a) => a?.value) };
    return m.ret();
  }
}

export function check(program: A.Program, lang: Lang, host: HostSpec): CheckResult {
  return new Checker(program, lang, host).run();
}

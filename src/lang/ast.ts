/**
 * L'albero del programma (AST). Il controllo dei tipi aggiunge ai nodi le informazioni che servono
 * al generatore di JavaScript (campi facoltativi in fondo a ogni nodo).
 */
import type { Span } from "./messages";
import type { Binding, CallInfo, FnInfo, MemberInfo, OpInfo, Type } from "./types";

export type { Span };

export interface NodeBase extends Span {
  /** Tipo calcolato dal controllo. */
  ty?: Type;
  /** Nelle funzioni-modello il tipo cambia da una chiamata all'altra: il generatore usa le funzioni generiche. */
  varies?: boolean;
  /** Il valore va copiato (è letto da un posto che resta al suo proprietario). */
  copy?: boolean;
}

// ------------------------------------------------------------------ tipi scritti

export type TypeAnn =
  | ({ k: "tname"; name: string } & Span)
  | ({ k: "tlist"; el: TypeAnn } & Span)
  | ({ k: "tmap"; key: TypeAnn; val: TypeAnn } & Span)
  | ({ k: "topt"; t: TypeAnn } & Span)
  | ({ k: "tfn"; params: TypeAnn[]; ret?: TypeAnn } & Span);

// ------------------------------------------------------------------ espressioni

export interface UnitSpec {
  text: string;
  atoms: { name: string; power: 1 | -1 }[];
}

export interface NumLit extends NodeBase {
  k: "num";
  value: number;
  unit?: UnitSpec;
}
export interface StrLit extends NodeBase {
  k: "str";
  parts: (string | Expr)[];
}
export interface BoolLit extends NodeBase {
  k: "bool";
  value: boolean;
}
export interface NoneLit extends NodeBase {
  k: "none";
}
export interface NameRef extends NodeBase {
  k: "name";
  name: string;
  ref?: Binding;
  /** Il nome indica qualcosa che non è una variabile (funzione, costante predefinita…). */
  special?: MemberInfo;
}
export interface ThisRef extends NodeBase {
  k: "this";
}
export interface ListLit extends NodeBase {
  k: "list";
  items: Expr[];
}
export interface MapLit extends NodeBase {
  k: "map";
  entries: { key: Expr; value: Expr }[];
}
export interface Unary extends NodeBase {
  k: "unary";
  op: "-" | "not";
  e: Expr;
}
export type BinOp = "+" | "-" | "*" | "/" | "%" | "^" | "==" | "!=" | "<" | ">" | "<=" | ">=" | "and" | "or" | "in" | "notin";
export interface Binary extends NodeBase {
  k: "binary";
  op: BinOp;
  l: Expr;
  r: Expr;
  info?: OpInfo;
}
export interface Arg {
  name?: string;
  nameSpan?: Span;
  change?: boolean;
  value: Expr;
}
export interface Call extends NodeBase {
  k: "call";
  callee: Expr;
  args: Arg[];
  info?: CallInfo;
}
export interface Member extends NodeBase {
  k: "member";
  obj: Expr;
  name: string;
  nameSpan: Span;
  info?: MemberInfo;
}
export interface Index extends NodeBase {
  k: "index";
  obj: Expr;
  index: Expr;
}
export interface MoveExpr extends NodeBase {
  k: "move";
  e: Expr;
}
export interface Lambda extends NodeBase {
  k: "lambda";
  params: { name: string; span: Span; ref?: Binding }[];
  body: Expr;
  /** Variabili lette da fuori: vengono copiate quando la funzione nasce. */
  captures?: Binding[];
}

/**
 * «pizza Tipo:» con un ingrediente per riga: il parser la riscrive in un valore normale
 * (Tipo(campo: …), […] o {…}) e il tipo scritto controlla il risultato.
 */
export interface PizzaExpr extends NodeBase {
  k: "pizza";
  ann: TypeAnn;
  kind: "rec" | "list" | "map";
  value: Call | ListLit | MapLit;
}

/** Un passo di «spaghetti»: nome(argomenti), oppure solo nome. */
export interface PipeStep {
  name: string;
  nameSpan: Span;
  args: Arg[];
  parens: boolean;
  span: Span;
}

/**
 * «spaghetti valore:» con un passo per riga: ogni passo riceve il risultato del precedente.
 * Il controllo lo traduce in istruzioni su variabili nascoste (`plan`), che il generatore scrive prima dell'istruzione.
 */
export interface PipeExpr extends NodeBase {
  k: "pipe";
  start: Expr;
  steps: PipeStep[];
  plan?: {
    /** Il primo è il valore di partenza. */
    temps: Binding[];
    /** Con `target`: target = e; senza: e si esegue per quello che fa (o che cambia). */
    ops: { target?: Binding; e: Expr }[];
    /** L'ultimo passo, se restituisce un valore. */
    result?: Expr;
    /** Se l'ultimo passo ha solo cambiato il valore: il risultato è il valore stesso. */
    resultTemp?: Binding;
  };
}

export type Expr = NumLit | StrLit | BoolLit | NoneLit | NameRef | ThisRef | ListLit | MapLit | Unary | Binary | Call | Member | Index | MoveExpr | Lambda | PizzaExpr | PipeExpr;

// ------------------------------------------------------------------ istruzioni

export interface StmtBase extends Span {}

export type AssignOp = "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "^=";

export interface ExprStmt extends StmtBase {
  k: "expr";
  e: Expr;
}
export interface Assign extends StmtBase {
  k: "assign";
  target: Expr;
  op: AssignOp;
  value: Expr;
  ann?: TypeAnn;
  /** La variabile creata da questa assegnazione (se la crea). */
  declares?: Binding;
  /** Per += -= …: come si combina il vecchio valore col nuovo. */
  info?: OpInfo;
}
export interface ConstDecl extends StmtBase {
  k: "const";
  name: string;
  nameSpan: Span;
  ann?: TypeAnn;
  value: Expr;
  declares?: Binding;
}
export interface IfBranch {
  cond: Expr;
  body: Stmt[];
  span: Span;
}
export interface If extends StmtBase {
  k: "if";
  branches: IfBranch[];
  els?: Stmt[];
  /** Variabili create in tutti i rami: vivono anche dopo il se. */
  hoisted?: Binding[];
}
export interface While extends StmtBase {
  k: "while";
  cond: Expr;
  body: Stmt[];
}
export interface Repeat extends StmtBase {
  k: "repeat";
  count?: Expr;
  body: Stmt[];
}
export interface LoopVar {
  name: string;
  span: Span;
  ref?: Binding;
}
export interface ForEach extends StmtBase {
  k: "foreach";
  vars: LoopVar[];
  change: boolean;
  iter: Expr;
  body: Stmt[];
}
export interface ForRange extends StmtBase {
  k: "forrange";
  v: LoopVar;
  from: Expr;
  to: Expr;
  step?: Expr;
  body: Stmt[];
}
export interface Return extends StmtBase {
  k: "return";
  value?: Expr;
  /** Restituisce una variabile locale: si sposta invece di copiarla. */
  moveLocal?: Binding;
}
export interface Break extends StmtBase {
  k: "break";
}
export interface Continue extends StmtBase {
  k: "continue";
}
export interface Pass extends StmtBase {
  k: "pass";
}
export interface Check extends StmtBase {
  k: "check";
  cond: Expr;
  message?: Expr;
}
export interface Wait extends StmtBase {
  k: "wait";
  seconds?: Expr;
  until?: Expr;
}
export interface Try extends StmtBase {
  k: "try";
  body: Stmt[];
  errVar?: LoopVar;
  handler: Stmt[];
  /** «bravo:»: parte solo se il tentativo è andato bene, e vede le sue variabili. */
  success?: Stmt[];
}
export interface Fail extends StmtBase {
  k: "fail";
  message: Expr;
}
/** «mamma mia!»: un errore grave, che nessun «tenta» può fermare. */
export interface Panic extends StmtBase {
  k: "panic";
  message?: Expr;
}
/** «cappuccino [durata]:»: il blocco parte dopo (o a parte) e intanto il codice va avanti. */
export interface Later extends StmtBase {
  k: "later";
  delay?: Expr;
  body: Stmt[];
  /** Variabili lette da fuori: vengono copiate quando il cappuccino viene ordinato. */
  captures?: Binding[];
  fn?: FnInfo;
}
export interface MatchCase {
  values: Expr[];
  body: Stmt[];
  span: Span;
}
export interface Match extends StmtBase {
  k: "match";
  subject: Expr;
  cases: MatchCase[];
  els?: Stmt[];
  hoisted?: Binding[];
}
export interface Emit extends StmtBase {
  k: "emit";
  event: string;
  eventSpan: Span;
}

export type ParamMode = "borrow" | "change" | "take";

export interface Param {
  name: string;
  span: Span;
  mode: ParamMode;
  ann?: TypeAnn;
  def?: Expr;
  ref?: Binding;
}
export interface FuncDecl extends StmtBase {
  k: "func";
  name: string;
  nameSpan: Span;
  params: Param[];
  ret?: TypeAnn;
  body: Stmt[];
}
export interface FieldDecl {
  name: string;
  span: Span;
  ann?: TypeAnn;
  def?: Expr;
}
export interface TypeDecl extends StmtBase {
  k: "type";
  name: string;
  nameSpan: Span;
  fields: FieldDecl[];
  methods: FuncDecl[];
  onCreate?: Stmt[];
  onEnd?: Stmt[];
}
export interface EnumDecl extends StmtBase {
  k: "enum";
  name: string;
  nameSpan: Span;
  members: { name: string; span: Span }[];
}
export interface TestDecl extends StmtBase {
  k: "test";
  name: string;
  body: Stmt[];
}
export interface UseDecl extends StmtBase {
  k: "use";
  path: string;
}

// ------------------------------------------------------------------ blocchi dell'engine

export interface PropDecl {
  name: string;
  span: Span;
  ann?: TypeAnn;
  def: Expr;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  group?: string;
  help?: string;
}
export interface NamedDecl {
  name: string;
  span: Span;
  label?: string;
}
export type HookName = "start" | "update" | "physics" | "late" | "end" | "touch" | "event";
export interface Handler {
  hook: HookName;
  param?: LoopVar;
  eventName?: string;
  body: Stmt[];
  span: Span;
}
export interface ActionDecl {
  kind: "action" | "condition";
  name: string;
  nameSpan: Span;
  params: Param[];
  label?: string;
  body: Stmt[];
  span: Span;
}
export interface BlockDecl extends StmtBase {
  k: "block";
  name: string;
  nameSpan: Span;
  label?: string;
  description?: string;
  category?: string;
  priority?: number;
  requires: { name: string; span: Span }[];
  props: PropDecl[];
  events: NamedDecl[];
  states: NamedDecl[];
  fields: FieldDecl[];
  funcs: FuncDecl[];
  handlers: Handler[];
  actions: ActionDecl[];
}

export type Stmt =
  | ExprStmt
  | Assign
  | ConstDecl
  | If
  | While
  | Repeat
  | ForEach
  | ForRange
  | Return
  | Break
  | Continue
  | Pass
  | Check
  | Wait
  | Try
  | Fail
  | Panic
  | Later
  | Match
  | Emit
  | FuncDecl
  | TypeDecl
  | EnumDecl
  | TestDecl
  | UseDecl
  | BlockDecl;

export interface Program {
  body: Stmt[];
}

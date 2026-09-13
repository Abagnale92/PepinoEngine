import type { Entity } from "./entity";
import type { Scene } from "./scene";
import type { Game } from "./game";
import type { Renderer } from "../render/renderer";

/**
 * Un Blocco è una funzione pronta che si aggiunge a un oggetto (come un Component di Unity).
 * Ogni blocco dichiara le stesse cinque cose: proprietà, stati, condizioni, azioni ed eventi.
 * L'editor legge queste dichiarazioni e genera Inspector, slot animazione e voci delle Regole.
 */

export type PropType =
  | "number"
  | "integer"
  | "boolean"
  | "string"
  | "text"
  | "select"
  | "image"
  | "audio"
  | "scene"
  | "tag"
  | "group"
  | "groups"
  | "color"
  | "variable"
  | "stateMap"
  // Tipi usati dai parametri delle Regole:
  | "object"
  | "input"
  | "prefab"
  | "compare"
  | "value"
  | "event"
  | "condition"
  | "blockAction"
  | "block"
  | "state"
  | "dialogue";

export interface PropOption {
  value: string;
  label: string;
}

export interface PropSchema {
  type: PropType;
  label: string;
  default?: unknown;
  /** Unità mostrata accanto al campo: "tile", "tile/s", "s", "px"… */
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: PropOption[];
  help?: string;
  /** Raggruppa i campi nell'Inspector (es. "Salto", "Dash"). */
  group?: string;
  /** Il campo può restare vuoto (il controllo del progetto non lo segnala). */
  optional?: boolean;
}

export interface NamedInfo {
  id: string;
  label: string;
}

type Self = BlockInstance<any>;

export interface ConditionDef {
  label: string;
  /** Parametri, nell'ordine in cui arrivano a `test` dopo `self`. */
  params?: Record<string, PropSchema>;
  test: (self: Self, ...args: any[]) => boolean;
}

export interface ActionDef {
  label: string;
  /** Parametri, nell'ordine in cui arrivano a `run` dopo `self`. Le Regole li mostrano come campi. */
  params?: Record<string, PropSchema>;
  run: (self: Self, ...args: any[]) => void;
}

interface Hooks {
  /** Chiamato quando l'oggetto entra in scena. */
  init?: (self: Self) => void;
  /** Logica, 60 volte al secondo, prima della fisica. */
  update?: (self: Self, dt: number) => void;
  /** Movimento e collisioni. */
  physics?: (self: Self, dt: number) => void;
  /** Dopo la fisica: camera, animazioni. */
  late?: (self: Self, dt: number) => void;
  /** Disegno nel mondo di gioco. */
  render?: (self: Self, r: Renderer) => void;
  /** Disegno sullo schermo (HUD), a piena risoluzione. */
  renderScreen?: (self: Self, r: Renderer) => void;
  /** Disegno di debug (F1): zone che colpiscono, percorsi, raggi di vista. */
  renderDebug?: (self: Self, r: Renderer) => void;
  destroy?: (self: Self) => void;
}

export interface BlockDef extends Hooks {
  type: string;
  label: string;
  category: string;
  description: string;
  props: Record<string, PropSchema>;
  states: NamedInfo[];
  events: NamedInfo[];
  conditions: Record<string, ConditionDef>;
  actions: Record<string, ActionDef>;
  /** Blocchi necessari: l'editor li aggiunge da solo. */
  requires: string[];
  /** Ordine di esecuzione: più basso = prima. */
  priority: number;
  /** "builtin" = blocco di Pepino, "custom" = scritto in uno script del progetto. */
  source: "builtin" | "custom";
  /** Id dello script che l'ha definito (solo blocchi personalizzati). */
  script?: string;
}

/** Forma "comoda" con cui si scrive un blocco (anche un blocco custom). */
export interface BlockSpec extends Hooks {
  name: string;
  label?: string;
  category?: string;
  description?: string;
  props?: Record<string, PropSchema>;
  states?: (string | NamedInfo)[];
  events?: (string | NamedInfo)[];
  conditions?: Record<string, ConditionDef | ((self: Self, ...args: any[]) => boolean)>;
  actions?: Record<string, ActionDef | ((self: Self, ...args: any[]) => void)>;
  requires?: string[];
  priority?: number;
}

const registry = new Map<string, BlockDef>();

const named = (list: (string | NamedInfo)[] | undefined): NamedInfo[] =>
  (list ?? []).map((s) => (typeof s === "string" ? { id: s, label: s } : s));

export function defineBlock(spec: BlockSpec): BlockDef {
  const def: BlockDef = {
    type: spec.name,
    label: spec.label ?? spec.name,
    category: spec.category ?? "Personalizzati",
    description: spec.description ?? "",
    props: spec.props ?? {},
    states: named(spec.states),
    events: named(spec.events),
    conditions: Object.fromEntries(
      Object.entries(spec.conditions ?? {}).map(([k, v]) => [k, typeof v === "function" ? { label: k, test: v } : v]),
    ),
    actions: Object.fromEntries(
      Object.entries(spec.actions ?? {}).map(([k, v]) => [k, typeof v === "function" ? { label: k, run: v } : v]),
    ),
    requires: spec.requires ?? [],
    priority: spec.priority ?? 50,
    source: "builtin",
    init: spec.init,
    update: spec.update,
    physics: spec.physics,
    late: spec.late,
    render: spec.render,
    renderScreen: spec.renderScreen,
    renderDebug: spec.renderDebug,
    destroy: spec.destroy,
  };
  registry.set(def.type, def);
  return def;
}

export const getBlockDef = (type: string) => registry.get(type);
export const listBlockDefs = () => [...registry.values()];

/** Toglie i blocchi definiti dagli script (prima di ricaricarli). Restituisce quelli tolti. */
export function unregisterCustomBlocks(): BlockDef[] {
  const removed: BlockDef[] = [];
  for (const [type, def] of registry) {
    if (def.source !== "custom") continue;
    registry.delete(type);
    removed.push(def);
  }
  return removed;
}

/** Rimette blocchi personalizzati tolti in precedenza, se nel frattempo il nome non è stato preso. */
export function restoreCustomBlocks(defs: BlockDef[]): string[] {
  const out: string[] = [];
  for (const d of defs) {
    if (registry.has(d.type)) continue;
    registry.set(d.type, d);
    out.push(d.type);
  }
  return out;
}

/** Tipi di proprietà che un blocco personalizzato può usare. */
export const CUSTOM_PROP_TYPES = new Set<string>([
  "number",
  "integer",
  "boolean",
  "string",
  "text",
  "select",
  "image",
  "audio",
  "scene",
  "tag",
  "group",
  "groups",
  "color",
  "variable",
  "prefab",
  "dialogue",
  "input",
  "stateMap",
]);

/** Valori finali delle proprietà: quelli salvati, altrimenti i predefiniti dello schema. */
export function resolveProps(def: BlockDef, values: Record<string, unknown> = {}): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, schema] of Object.entries(def.props)) {
    out[key] = key in values ? values[key] : structuredClone(schema.default);
  }
  return out;
}

export class BlockInstance<P extends Record<string, any> = Record<string, any>> {
  /** Stato interno del blocco (timer, contatori…). */
  data: Record<string, any> = {};
  readonly actions: Record<string, (...args: any[]) => void> = {};
  private unsubs: (() => void)[] = [];

  constructor(
    readonly def: BlockDef,
    readonly entity: Entity,
    public props: P,
    public enabled = true,
  ) {
    for (const [name, action] of Object.entries(def.actions)) {
      this.actions[name] = (...args: any[]) => action.run(this, ...args);
    }
  }

  get scene(): Scene {
    return this.entity.scene;
  }

  get game(): Game {
    return this.entity.scene.game;
  }

  get body() {
    return this.entity.body;
  }

  get state(): string {
    return this.entity.state;
  }

  set state(value: string) {
    this.entity.state = value;
  }

  test(condition: string, ...args: any[]): boolean {
    return this.def.conditions[condition]?.test(this, ...args) ?? false;
  }

  emit(event: string, data?: unknown): void {
    this.entity.emit(event, data);
  }

  /** Ascolta un evento dell'oggetto; l'ascolto termina da solo quando il blocco viene rimosso. */
  listen<T = any>(event: string, fn: (data: T) => void): void {
    this.unsubs.push(this.entity.on(event, fn));
  }

  dispose(): void {
    try {
      this.def.destroy?.(this);
    } catch {
      // un blocco personalizzato che sbaglia in destroy non deve bloccare il cambio di scena
    }
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }
}

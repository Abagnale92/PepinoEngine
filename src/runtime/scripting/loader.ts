import {
  CUSTOM_PROP_TYPES,
  defineBlock,
  getBlockDef,
  restoreCustomBlocks,
  unregisterCustomBlocks,
  type BlockDef,
  type BlockSpec,
  type BlockInstance,
} from "../core/block";
import { approach, clamp, damp, hexColor, lerp, overlaps, sign } from "../math";
import { findPath, lineOfSight } from "../world/pathfinding";
import { bodyCenter, facingVector, nearestTagged } from "../blocks/targets";
import { interpolate } from "../blocks/text";
import type { ScriptData } from "../project/format";
import { compilePython, PythonError } from "./python";
import { PY } from "./pyruntime";
import { clearScriptInfo, describeScriptError, registerScriptInfo, safeScriptId, snapshotScriptInfo } from "./errors";

export interface ScriptResult {
  id: string;
  name: string;
  language: "js" | "py";
  /** Blocchi registrati dallo script. */
  blocks: string[];
  error?: { message: string; line?: number; col?: number };
  /** Con `keepOnError`: lo script ha un errore e restano in uso i blocchi della versione precedente. */
  stale?: boolean;
}

export interface LoadOptions {
  /**
   * Se uno script ha un errore, tiene i blocchi che aveva definito prima (utile nell'editor:
   * mentre si scrive, gli oggetti non perdono il blocco a ogni errore di battitura).
   */
  keepOnError?: boolean;
}

/** Nomi Python degli hook → nomi del blocco. */
const PY_HOOKS: Record<string, keyof BlockSpec> = {
  init: "init",
  update: "update",
  physics: "physics",
  late: "late",
  render: "render",
  render_screen: "renderScreen",
  render_debug: "renderDebug",
  destroy: "destroy",
};

type Fn = (...args: any[]) => any;

function defineCustom(spec: BlockSpec, scriptId: string): BlockDef {
  if (!spec || typeof spec !== "object") throw new Error("defineBlock vuole un oggetto con name, props, update…");
  if (typeof spec.name !== "string" || !spec.name.trim()) throw new Error("Il blocco deve avere un nome (name).");
  const existing = getBlockDef(spec.name);
  if (existing && existing.source !== "custom") throw new Error(`Il nome «${spec.name}» è già usato da un blocco di Pepino: scegline un altro.`);
  if (existing && existing.script !== scriptId) throw new Error(`Il nome «${spec.name}» è già usato dallo script «${existing.script}».`);
  for (const [key, p] of Object.entries(spec.props ?? {})) {
    if (!p || typeof p !== "object" || !CUSTOM_PROP_TYPES.has(p.type)) {
      throw new Error(`La proprietà «${key}» ha un tipo non valido («${(p as { type?: string })?.type}»). Tipi possibili: ${[...CUSTOM_PROP_TYPES].join(", ")}.`);
    }
    if (!p.label) p.label = key;
  }
  const def = defineBlock({ category: "Personalizzati", ...spec });
  def.source = "custom";
  def.script = scriptId;
  return def;
}

/** Trasforma le variabili e le funzioni di un modulo Python nella definizione di un blocco. */
function fromPython(meta: Record<string, any>, fns: Record<string, Fn>): BlockSpec {
  const spec: BlockSpec = {
    name: meta.name,
    label: meta.label,
    category: meta.category,
    description: meta.description,
    props: meta.props,
    states: meta.states,
    events: meta.events,
    requires: meta.requires,
    priority: meta.priority,
  };
  for (const [py, key] of Object.entries(PY_HOOKS)) if (typeof fns[py] === "function") (spec as unknown as Record<string, unknown>)[key] = fns[py];
  const table = (kind: "actions" | "conditions") => {
    const src = meta[kind];
    if (!src) return undefined;
    const out: Record<string, any> = {};
    for (const [fname, desc] of Object.entries(src as Record<string, any>)) {
      const fn = fns[fname];
      if (typeof fn !== "function") {
        throw new Error(`${kind === "actions" ? "L'azione" : "La condizione"} «${fname}» non ha una funzione: scrivi def ${fname}(self):`);
      }
      const label = typeof desc === "string" ? desc : (desc?.label ?? fname);
      const params = typeof desc === "object" ? desc?.params : undefined;
      out[fname] =
        kind === "actions"
          ? { label, params, run: (self: BlockInstance, ...a: unknown[]) => fn(self, ...a) }
          : { label, params, test: (self: BlockInstance, ...a: unknown[]) => PY.truthy(fn(self, ...a)) };
    }
    return out;
  };
  spec.actions = table("actions");
  spec.conditions = table("conditions");
  return spec;
}

/** L'oggetto `Pepino` che vede ogni script. */
function makeApi(scriptId: string, defined: string[]) {
  const define = (spec: BlockSpec) => {
    const def = defineCustom(spec, scriptId);
    defined.push(def.type);
    return def;
  };
  return Object.freeze({
    defineBlock: define,
    definePythonBlock: (meta: Record<string, any>, fns: Record<string, Fn>) => define(fromPython(meta, fns)),
    py: PY,
    log: (...a: unknown[]) => PY.print(...a),
    clamp,
    lerp,
    approach,
    damp,
    sign,
    overlaps,
    hexColor,
    interpolate,
    nearestTagged,
    bodyCenter,
    facingVector,
    lineOfSight,
    findPath,
  });
}

/**
 * Carica gli script del progetto e registra i loro blocchi.
 * Toglie prima i blocchi personalizzati caricati in precedenza, così uno script cancellato sparisce.
 */
export function loadScripts(scripts: ScriptData[], opts: LoadOptions = {}): ScriptResult[] {
  const previous = unregisterCustomBlocks();
  const prevInfo = opts.keepOnError ? snapshotScriptInfo() : undefined;
  clearScriptInfo();
  const results: ScriptResult[] = [];
  const seen = new Set<string>();
  for (const s of scripts) {
    const res: ScriptResult = { id: s.id, name: s.name, language: s.language, blocks: [] };
    results.push(res);
    if (seen.has(s.id)) {
      res.error = { message: "Due script hanno lo stesso id." };
      continue;
    }
    seen.add(s.id);
    try {
      let code = s.code ?? "";
      let lineMap: number[] | undefined;
      if (s.language === "py") ({ code, lineMap } = compilePython(code));
      registerScriptInfo(s.id, { name: s.name, lineMap });
      const fn = new Function("Pepino", `${code}\n//# sourceURL=pepino-script/${safeScriptId(s.id)}`);
      fn(makeApi(s.id, res.blocks));
    } catch (err) {
      if (err instanceof PythonError) res.error = { message: err.reason, line: err.line, col: err.col };
      else {
        const d = describeScriptError(err);
        res.error = { message: err instanceof SyntaxError ? `Errore di sintassi: ${d.message}` : d.message, line: d.line };
      }
      if (opts.keepOnError) {
        const kept = restoreCustomBlocks(previous.filter((d) => d.script === s.id));
        if (kept.length) {
          res.stale = true;
          res.blocks = [...new Set([...res.blocks, ...kept])];
          // Le righe degli errori a gioco avviato devono riferirsi alla versione ancora in uso.
          const info = prevInfo?.get(safeScriptId(s.id));
          if (info) registerScriptInfo(s.id, info);
        }
      }
    }
  }
  return results;
}

import {
  COMPARE_OPTIONS,
  INPUT_LABELS,
  getBlockDef,
  splitRuleKey,
  type BlockData,
  type ProjectData,
  type PropSchema,
  type RuleItem,
  type RuleItemDef,
  type SceneData,
} from "@runtime";
import { effectiveBlocks, findEntity, flattenEntities, statesFor } from "./projectOps";
import { T } from "./i18n";

/** Contesto di una regola nell'editor: serve a sapere cosa sono "questo oggetto" e "l'altro". */
export interface RuleCtxInfo {
  project: ProjectData;
  /** Assente per le regole globali. */
  scene?: SceneData;
  trigger: RuleItem;
  triggerDef?: RuleItemDef;
}

export interface Choice {
  value: string;
  label: string;
  group?: string;
}

/** Blocchi che può avere l'oggetto indicato da un riferimento (#etichetta, @id, self, other). */
export function blocksForRef(ref: unknown, rc: RuleCtxInfo, depth = 0): BlockData[] {
  const r = String(ref ?? "");
  const td = rc.triggerDef;
  if (depth < 2 && r === "self" && td?.subject) return blocksForRef(rc.trigger.params[td.subject], rc, depth + 1);
  if (depth < 2 && r === "other" && td?.other) return blocksForRef(rc.trigger.params[td.other], rc, depth + 1);
  const out = new Map<string, BlockData>();
  const add = (list: BlockData[]) => {
    for (const b of list) if (b.enabled !== false && !out.has(b.type)) out.set(b.type, b);
  };
  const scenes = rc.scene ? [rc.scene] : rc.project.scenes;
  if (r.startsWith("#")) {
    const tag = r.slice(1);
    for (const pf of rc.project.prefabs) if (pf.tags?.includes(tag)) add(pf.blocks);
    for (const s of scenes) {
      for (const f of flattenEntities(s.entities)) {
        const pf = f.data.prefab ? rc.project.prefabs.find((p) => p.id === f.data.prefab) : undefined;
        if ([...(f.data.tags ?? []), ...(pf?.tags ?? [])].includes(tag)) add(effectiveBlocks(rc.project, f.data));
      }
    }
  } else if (r.startsWith("@")) {
    for (const s of scenes) {
      const e = findEntity(s.entities, r.slice(1));
      if (e) add(effectiveBlocks(rc.project, e));
    }
  }
  return [...out.values()];
}

export function eventChoices(blocks: BlockData[]): Choice[] {
  const out: Choice[] = [];
  for (const b of blocks) {
    const def = getBlockDef(b.type);
    for (const ev of def?.events ?? []) if (!out.some((o) => o.value === ev.id)) out.push({ value: ev.id, label: ev.label, group: def!.label });
  }
  return out;
}

export function conditionChoices(blocks: BlockData[]): Choice[] {
  const out: Choice[] = [];
  for (const b of blocks) {
    const def = getBlockDef(b.type);
    for (const [k, c] of Object.entries(def?.conditions ?? {})) out.push({ value: `${b.type}.${k}`, label: c.label, group: def!.label });
  }
  return out;
}

export function actionChoices(blocks: BlockData[]): Choice[] {
  const out: Choice[] = [];
  for (const b of blocks) {
    const def = getBlockDef(b.type);
    for (const [k, a] of Object.entries(def?.actions ?? {})) out.push({ value: `${b.type}.${k}`, label: a.label, group: def!.label });
  }
  return out;
}

export function blockChoices(blocks: BlockData[]): Choice[] {
  return blocks.map((b) => ({ value: b.type, label: getBlockDef(b.type)?.label ?? b.type }));
}

export function stateChoices(blocks: BlockData[]): Choice[] {
  return statesFor(blocks).map((s) => ({ value: s.id, label: s.label }));
}

export function describeRef(ref: unknown, rc: RuleCtxInfo): string {
  const r = String(ref ?? "");
  if (!r) return "";
  if (r === "self") return T("questo oggetto");
  if (r === "other") return T("l'altro oggetto");
  if (r === "*") return T("qualsiasi oggetto");
  if (r.startsWith("#")) return r;
  if (r.startsWith("@")) {
    const id = r.slice(1);
    for (const s of rc.scene ? [rc.scene] : rc.project.scenes) {
      const e = findEntity(s.entities, id);
      if (e) return e.name;
    }
    return id;
  }
  return r;
}

/** Valori iniziali di un nuovo elemento di regola. */
export function defaultParams(def: RuleItemDef, rc?: RuleCtxInfo): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(def.params)) {
    let v = structuredClone(s.default);
    if (s.type === "object" && def.kind !== "trigger" && v === "self" && !rc?.triggerDef?.subject) v = "";
    out[k] = v;
  }
  return out;
}

/** Parametri extra della condizione o dell'azione di blocco scelta (es. il danno da infliggere). */
export function argSchemas(def: RuleItemDef, item: RuleItem): Record<string, PropSchema> {
  const isCond = def.params.condition?.type === "condition";
  const isAction = def.params.action?.type === "blockAction";
  if (!isCond && !isAction) return {};
  const [type, name] = splitRuleKey(isCond ? item.params.condition : item.params.action);
  const bd = getBlockDef(type);
  return (isCond ? bd?.conditions[name]?.params : bd?.actions[name]?.params) ?? {};
}

const REQUIRED = new Set(["object", "event", "condition", "blockAction", "block", "prefab", "scene", "variable", "input", "dialogue", "language", "item"]);

/** Testo di un parametro dentro la frase della regola; `missing` = da completare. */
export function formatToken(
  schema: PropSchema | undefined,
  value: unknown,
  item: RuleItem,
  def: RuleItemDef,
  rc: RuleCtxInfo,
): { text: string; missing: boolean } {
  if (!schema) return { text: String(value ?? ""), missing: false };
  const s = String(value ?? "");
  const ok = (text: string) => ({ text, missing: false });
  const miss = (text: string) => ({ text, missing: true });
  if (s === "" && schema.optional) return ok(schema.type === "object" ? T("nessuno") : T("qualsiasi"));
  if (s === "" && REQUIRED.has(schema.type)) return miss(`${T(schema.label).toLowerCase()}?`);
  const argsText = () => {
    const args = argSchemas(def, item);
    const given = (item.params.args ?? {}) as Record<string, unknown>;
    return Object.entries(args)
      .map(([k, a]) => String(given[k] ?? a.default))
      .join(", ");
  };
  switch (schema.type) {
    case "object":
      return ok(describeRef(s, rc));
    case "input":
      return ok(T(INPUT_LABELS[s] ?? s));
    case "compare":
      return ok(T(COMPARE_OPTIONS.find((o) => o.value === s)?.label ?? s));
    case "scene": {
      const sc = rc.project.scenes.find((x) => x.id === s);
      return sc ? ok(sc.name) : miss(s);
    }
    case "prefab": {
      const pf = rc.project.prefabs.find((x) => x.id === s);
      return pf ? ok(pf.name) : miss(s);
    }
    case "dialogue": {
      const dl = rc.project.dialogues?.find((x) => x.id === s);
      return dl ? ok(dl.name) : miss(s);
    }
    case "item": {
      const it = rc.project.items?.find((x) => x.id === s);
      return it ? ok(`«${it.name}»`) : miss(s);
    }
    case "cutscene": {
      const cs = rc.project.cutscenes?.find((x) => x.id === s);
      return cs ? ok(cs.name) : miss(s || `${T(schema.label).toLowerCase()}?`);
    }
    case "language": {
      const l = rc.project.languages?.find((x) => x.id === s);
      return l ? ok(l.name) : miss(s);
    }
    case "audio":
      return ok(s || T("nessuna"));
    case "event": {
      const c = eventChoices(blocksForRef(item.params.target, rc)).find((x) => x.value === s);
      return c ? ok(T(c.label)) : miss(s);
    }
    case "condition":
    case "blockAction": {
      const list = schema.type === "condition" ? conditionChoices(blocksForRef(item.params.target, rc)) : actionChoices(blocksForRef(item.params.target, rc));
      const c = list.find((x) => x.value === s);
      if (!c) return miss(s);
      const a = argsText();
      return ok(a ? `${T(c.label)} (${a})` : T(c.label));
    }
    case "block": {
      const d = getBlockDef(s);
      return d ? ok(T(d.label)) : miss(s);
    }
    case "state": {
      const c = stateChoices(blocksForRef(item.params.target, rc)).find((x) => x.value === s);
      return ok(T(c?.label ?? s));
    }
    case "boolean":
      return ok(value ? T("sì") : T("no"));
    case "select":
      return ok(T(schema.options?.find((o) => o.value === s)?.label ?? s));
    case "number":
    case "integer":
      return ok(String(Math.round(Number(value ?? 0) * 1000) / 1000));
    default:
      return ok(s);
  }
}

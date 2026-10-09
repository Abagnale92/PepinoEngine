import { getBlockDef, listRows, resolveProps } from "../core/block";
import { mergeBlocks } from "../core/scene";
import { getRuleItemDef, splitRuleKey } from "../rules/rules";
import type { RuleItem } from "./format";
import type { BlockData, EntityData, ProjectData, RuleData } from "./format";

/** Un testo del gioco da tradurre e dove compare. */
export interface TextEntry {
  text: string;
  where: string[];
}

/** Testi scritti da Pepino stesso (menù di pausa): si traducono come gli altri. */
export const ENGINE_TEXTS = ["Pausa", "Premi Esc (o Start) per riprendere"];

const hasLetters = (s: string) => /\p{L}/u.test(s);

function flatten(list: EntityData[], out: EntityData[] = []): EntityData[] {
  for (const e of list) {
    out.push(e);
    if (e.children) flatten(e.children, out);
  }
  return out;
}

/**
 * Tutti i testi che il giocatore può vedere: proprietà dei blocchi segnate come traducibili
 * (Testo, Pulsante, fumetto…), messaggi delle Regole, battute e scelte dei dialoghi, testi di Pepino.
 * Numeri e simboli senza lettere non si traducono.
 */
export function collectTexts(p: ProjectData): TextEntry[] {
  const found = new Map<string, Set<string>>();
  const add = (value: unknown, where: string) => {
    if (typeof value !== "string" || !hasLetters(value)) return;
    let set = found.get(value);
    if (!set) found.set(value, (set = new Set()));
    set.add(where);
  };

  const blocks = (list: BlockData[], where: string) => {
    for (const b of list) {
      if (b.enabled === false) continue;
      const def = getBlockDef(b.type);
      if (!def) continue;
      const props = resolveProps(def, b.props);
      for (const [k, schema] of Object.entries(def.props)) {
        if (schema.translatable) add(props[k], `${where} › ${def.label}`);
        // Elenchi di righe (armi, carte…): anche i loro campi possono essere testi del gioco.
        if (schema.type !== "list") continue;
        for (const row of listRows(schema, props[k])) {
          for (const [fk, f] of Object.entries(schema.fields ?? {})) if (f.translatable) add(row[fk], `${where} › ${def.label}`);
        }
      }
      // Testi che il blocco scrive da solo (negozio, potenziamenti…).
      for (const t of def.texts ?? []) add(t, `Pepino › ${def.label}`);
    }
  };

  const ruleItems = (list: (RuleItem | undefined)[], where: string) => {
    for (const item of list) {
      const def = item && getRuleItemDef(item.type);
      if (!def) continue;
      for (const [k, schema] of Object.entries(def.params)) if (schema.translatable) add(item.params?.[k], where);
      // Parametri di un'azione di blocco, es. «Cambia testo» del blocco Testo.
      const isAction = def.params.action?.type === "blockAction";
      const isCond = def.params.condition?.type === "condition";
      if (!isAction && !isCond) continue;
      const [type, name] = splitRuleKey(isAction ? item.params.action : item.params.condition);
      const bd = getBlockDef(type);
      const params = (isAction ? bd?.actions[name]?.params : bd?.conditions[name]?.params) ?? {};
      const args = (item.params.args ?? {}) as Record<string, unknown>;
      for (const [k, schema] of Object.entries(params)) if (schema.translatable) add(args[k] ?? schema.default, where);
    }
  };

  const rules = (list: RuleData[] | undefined, where: string) => {
    for (const r of list ?? []) ruleItems([r.when, ...(r.conditions ?? []), ...(r.actions ?? [])], where);
  };

  for (const pf of p.prefabs) blocks(pf.blocks, `Modello «${pf.name}»`);
  for (const s of p.scenes) {
    for (const e of flatten(s.entities)) {
      const prefab = e.prefab ? p.prefabs.find((x) => x.id === e.prefab) : undefined;
      blocks(prefab ? mergeBlocks(prefab.blocks, e.blocks) : e.blocks, `Scena «${s.name}» › ${e.name}`);
    }
    rules(s.rules, `Scena «${s.name}» › Regole`);
  }
  rules(p.rules, "Regole globali");
  for (const d of p.dialogues ?? []) {
    const where = `Dialogo «${d.name}»`;
    for (const l of d.lines) {
      add(l.speaker, where);
      add(l.text, where);
      for (const c of l.choices ?? []) add(c.text, where);
    }
  }
  for (const c of p.cutscenes ?? []) ruleItems(c.steps ?? [], `Filmato «${c.name}»`);
  for (const it of p.items ?? []) {
    add(it.name, `Oggetto «${it.name}»`);
    add(it.description, `Oggetto «${it.name}»`);
  }
  for (const t of ENGINE_TEXTS) add(t, "Pepino › Pausa");
  return [...found].map(([text, where]) => ({ text, where: [...where] }));
}

/** Testi ancora senza traduzione nella lingua indicata. */
export function missingTranslations(p: ProjectData, language: string, texts = collectTexts(p)): TextEntry[] {
  const tr = p.translations?.[language] ?? {};
  return texts.filter((t) => !tr[t.text]?.trim());
}

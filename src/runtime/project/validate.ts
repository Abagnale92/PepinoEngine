import { getBlockDef, resolveProps, type PropSchema } from "../core/block";
import { mergeBlocks } from "../core/scene";
import { getRuleItemDef, splitRuleKey, type RuleItemDef } from "../rules/rules";
import { DEFAULT_INPUT, DIALOGUE_END, type BlockData, type EntityData, type ProjectData, type RuleData, type RuleItem, type SceneData } from "./format";

/**
 * Controllo del progetto: trova riferimenti rotti (asset, scene, modelli, id, variabili)
 * e regole incomplete prima che diventino bug a gioco avviato.
 */

export type IssueLevel = "error" | "warn";

export interface ProjectIssue {
  level: IssueLevel;
  /** Dove si trova il problema, leggibile: Scena «Livello 1» › Pepino › Sprite. */
  where: string;
  message: string;
  sceneId?: string;
  entityId?: string;
  prefabId?: string;
  ruleId?: string;
}

type Ids = Pick<ProjectIssue, "sceneId" | "entityId" | "prefabId" | "ruleId">;

const q = (s: string) => `«${s}»`;

function flatten(list: EntityData[], out: EntityData[] = []): EntityData[] {
  for (const e of list) {
    out.push(e);
    if (e.children) flatten(e.children, out);
  }
  return out;
}

export function validateProject(p: ProjectData): ProjectIssue[] {
  const issues: ProjectIssue[] = [];
  const add = (level: IssueLevel, where: string, message: string, ids: Ids = {}) => issues.push({ level, where, message, ...ids });

  const assets = new Map(p.assets.map((a) => [a.id, a]));
  const vars = new Set(Object.keys(p.variables ?? {}));
  const groups = new Set(p.settings.collisionGroups ?? []);
  const sceneIds = new Set(p.scenes.map((s) => s.id));
  const prefabs = new Map(p.prefabs.map((x) => [x.id, x]));
  const inputs = new Set([...Object.keys(DEFAULT_INPUT), ...Object.keys(p.input ?? {})]);
  const dialogues = new Map((p.dialogues ?? []).map((d) => [d.id, d]));
  const allTags = new Set<string>();
  for (const pf of p.prefabs) pf.tags?.forEach((t) => allTags.add(t));
  for (const s of p.scenes) for (const e of flatten(s.entities)) e.tags?.forEach((t) => allTags.add(t));

  const duplicates = (ids: string[], what: string, where: string, extra: Ids = {}) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) add("error", where, `Due ${what} hanno lo stesso id ${q(id)}.`, extra);
      seen.add(id);
    }
  };

  // ---------------------------------------------------------- progetto
  duplicates(p.assets.map((a) => a.id), "asset", "Asset");
  duplicates(p.scenes.map((s) => s.id), "scene", "Scene");
  duplicates(p.prefabs.map((x) => x.id), "modelli", "Modelli");
  duplicates(p.tilesets.map((t) => t.id), "tileset", "Tileset");
  if (!sceneIds.has(p.settings.startScene)) add("error", "Progetto", `La scena iniziale ${q(p.settings.startScene)} non esiste.`);
  if (!(p.settings.tileSize > 0)) add("error", "Progetto", "La dimensione dei tile deve essere maggiore di zero.");
  const res = p.settings.resolution;
  if (!(res?.width > 0 && res?.height > 0)) add("error", "Progetto", "La risoluzione deve essere maggiore di zero.");

  for (const a of p.assets) {
    const where = `Asset ${q(a.id)}`;
    if (!a.src) add("error", where, "Manca il percorso del file.");
    if (a.type === "image") {
      for (const [name, an] of Object.entries(a.animations ?? {})) {
        if (!an.frames?.length) add("warn", `${where} › Animazione ${q(name)}`, "Non ha fotogrammi.");
        if (!(an.fps > 0)) add("warn", `${where} › Animazione ${q(name)}`, "Gli fps devono essere maggiori di zero.");
      }
    }
  }

  for (const t of p.tilesets) {
    const where = `Tileset ${q(t.name)}`;
    if (assets.get(t.image)?.type !== "image") add("error", where, `L'immagine ${q(t.image)} non esiste.`);
    if (!(t.columns > 0)) add("error", where, "Il numero di colonne deve essere maggiore di zero.");
  }

  // ---------------------------------------------------------- dialoghi
  duplicates((p.dialogues ?? []).map((d) => d.id), "dialoghi", "Dialoghi");
  for (const d of p.dialogues ?? []) {
    const dw = `Dialogo ${q(d.name)}`;
    if (!d.lines?.length) {
      add("warn", dw, "Non ha battute.");
      continue;
    }
    const lineIds = new Set<string>();
    for (const l of d.lines) {
      if (lineIds.has(l.id)) add("error", dw, `Due battute hanno lo stesso id ${q(l.id)}.`);
      lineIds.add(l.id);
    }
    const validGoto = (g?: string) => !g || g === DIALOGUE_END || lineIds.has(g);
    d.lines.forEach((l, i) => {
      const lw = `${dw} › Battuta ${i + 1}`;
      if (!l.text?.trim()) add("warn", lw, "Il testo è vuoto.");
      if (l.portrait && assets.get(l.portrait)?.type !== "image") add("error", lw, `Il ritratto ${q(l.portrait)} non esiste.`);
      if (!validGoto(l.goto)) add("error", lw, `Salta a una battuta che non esiste (${q(String(l.goto))}).`);
      (l.choices ?? []).forEach((c, j) => {
        const cw = `${lw} › Scelta ${j + 1}`;
        if (!c.text?.trim()) add("warn", cw, "Il testo della scelta è vuoto.");
        if (!validGoto(c.goto)) add("error", cw, `Porta a una battuta che non esiste (${q(String(c.goto))}).`);
        if (c.setVar && !vars.has(c.setVar)) add("warn", cw, `La variabile ${q(c.setVar)} non è tra le variabili globali.`);
      });
    });
  }

  for (const pf of p.prefabs) checkBlocks(pf.blocks, `Modello ${q(pf.name)}`, { prefabId: pf.id }, true);

  // ---------------------------------------------------------- scene
  for (const s of p.scenes) {
    const sw = `Scena ${q(s.name)}`;
    duplicates(s.layers.map((l) => l.id), "layer", sw, { sceneId: s.id });
    for (const l of s.layers) {
      const lw = `${sw} › Layer ${q(l.name)}`;
      const ts = p.tilesets.find((t) => t.id === l.tileset);
      if (!ts) add("error", lw, `Il tileset ${q(l.tileset)} non esiste.`, { sceneId: s.id });
      if (l.data.length !== l.width * l.height) add("error", lw, `Contiene ${l.data.length} tile invece di ${l.width * l.height}.`, { sceneId: s.id });
      if (l.width !== s.width || l.height !== s.height) add("warn", lw, `Misura ${l.width}×${l.height} mentre la scena è ${s.width}×${s.height}.`, { sceneId: s.id });
      if (ts) {
        const bad = l.data.filter((t) => t >= ts.count).length;
        if (bad) add("warn", lw, `${bad} tile usano un numero che il tileset non ha.`, { sceneId: s.id });
      }
    }

    const flat = flatten(s.entities);
    duplicates(flat.map((e) => e.id), "oggetti", sw, { sceneId: s.id });
    for (const e of flat) {
      const where = `${sw} › ${e.name}`;
      const ids = { sceneId: s.id, entityId: e.id };
      const prefab = e.prefab ? prefabs.get(e.prefab) : undefined;
      if (e.prefab && !prefab) add("error", where, `Usa il modello ${q(e.prefab)} che non esiste.`, ids);
      checkBlocks(prefab ? mergeBlocks(prefab.blocks, e.blocks) : e.blocks, where, ids);
    }
    (s.rules ?? []).forEach((r, i) => checkRule(r, i, s));
  }
  (p.rules ?? []).forEach((r, i) => checkRule(r, i, undefined));
  return issues;

  // ---------------------------------------------------------- blocchi
  /** `isPrefab`: nei modelli alcuni campi restano vuoti apposta, li completa ogni istanza. */
  function checkBlocks(blocks: BlockData[], where: string, ids: Ids, isPrefab = false) {
    const seen = new Set<string>();
    const active = new Set(blocks.filter((b) => b.enabled !== false).map((b) => b.type));
    for (const b of blocks) {
      const def = getBlockDef(b.type);
      if (!def) {
        add("error", where, `Blocco sconosciuto ${q(b.type)}.`, ids);
        continue;
      }
      const bw = `${where} › ${def.label}`;
      if (seen.has(b.type)) add("warn", bw, "Il blocco compare due volte: conta solo il primo.", ids);
      seen.add(b.type);
      if (b.enabled === false) continue;
      for (const r of def.requires) if (!active.has(r)) add("warn", bw, `Serve anche il blocco ${q(getBlockDef(r)?.label ?? r)}.`, ids);
      for (const k of Object.keys(b.props ?? {})) if (!(k in def.props)) add("warn", bw, `Proprietà sconosciuta ${q(k)}.`, ids);
      const props = resolveProps(def, b.props);
      for (const [k, schema] of Object.entries(def.props)) checkProp(schema, props[k], `${bw} › ${schema.label}`, ids, blocks);
    }
    const propsOf = (type: string) => {
      const b = blocks.find((x) => x.type === type && x.enabled !== false);
      const def = getBlockDef(type);
      return b && def ? resolveProps(def, b.props) : undefined;
    };
    const ctrl = propsOf("PlatformController") ?? propsOf("TopDownController");
    if (active.has("Patrol") && ctrl?.input === "player") {
      add("warn", where, "La Pattuglia non ha effetto: imposta il controller su «IA o Regole».", ids);
    }
    if (propsOf("Sprite") && !propsOf("Sprite")!.image) add("warn", `${where} › Sprite`, "Nessuna immagine scelta.", ids);
    if (!isPrefab && propsOf("SceneExit") && !propsOf("SceneExit")!.scene) {
      add("warn", `${where} › Uscita verso scena`, "Scegli la scena di destinazione.", ids);
    }
    if (!isPrefab && propsOf("Talker") && !propsOf("Talker")!.dialogue) {
      add("warn", `${where} › Personaggio che parla`, "Scegli il dialogo.", ids);
    }
    if (!isPrefab && propsOf("Spawner") && !propsOf("Spawner")!.prefab) {
      add("warn", `${where} › Generatore`, "Scegli il modello da generare.", ids);
    }
    const shooter = propsOf("Shooter");
    if (shooter) {
      const pf = prefabs.get(String(shooter.projectile));
      if (!shooter.projectile) add("warn", `${where} › Spara`, "Scegli il proiettile.", ids);
      else if (pf && !pf.blocks.some((b) => b.type === "Projectile" && b.enabled !== false)) {
        add("warn", `${where} › Spara`, `Il modello ${q(pf.name)} non ha il blocco «Proiettile»: non volerà da solo.`, ids);
      }
    }
  }

  function checkProp(schema: PropSchema, v: unknown, where: string, ids: Ids, blocks: BlockData[]) {
    const s = typeof v === "string" ? v : "";
    switch (schema.type) {
      case "number":
      case "integer":
        if (typeof v !== "number" || Number.isNaN(v)) add("error", where, `Deve essere un numero (trovato ${JSON.stringify(v)}).`, ids);
        break;
      case "boolean":
        if (typeof v !== "boolean") add("warn", where, "Deve essere sì o no.", ids);
        break;
      case "image":
      case "audio":
        if (s && assets.get(s)?.type !== schema.type) {
          add("error", where, assets.has(s) ? `L'asset ${q(s)} non è del tipo giusto.` : `L'asset ${q(s)} non esiste.`, ids);
        }
        break;
      case "scene":
        if (s && !sceneIds.has(s)) add("error", where, `La scena ${q(s)} non esiste.`, ids);
        break;
      case "variable":
        if (s && !vars.has(s)) add("warn", where, `La variabile ${q(s)} non è tra le variabili globali.`, ids);
        break;
      case "group":
        if (s && !groups.has(s)) add("warn", where, `Il gruppo ${q(s)} non è tra i gruppi di collisione.`, ids);
        break;
      case "groups":
        if (!Array.isArray(v)) add("warn", where, "Deve essere un elenco di gruppi.", ids);
        else for (const g of v) if (!groups.has(String(g))) add("warn", where, `Il gruppo ${q(String(g))} non è tra i gruppi di collisione.`, ids);
        break;
      case "select":
        if (schema.options && !schema.options.some((o) => o.value === v)) add("warn", where, `Valore ${q(String(v))} non previsto.`, ids);
        break;
      case "prefab":
        if (s && !prefabs.has(s)) add("error", where, `Il modello ${q(s)} non esiste.`, ids);
        break;
      case "dialogue":
        if (s && !dialogues.has(s)) add("error", where, `Il dialogo ${q(s)} non esiste.`, ids);
        break;
      case "input":
        if (s && !inputs.has(s)) add("error", where, `Il comando ${q(s)} non esiste.`, ids);
        break;
      case "stateMap": {
        const sprite = blocks.find((b) => b.type === "Sprite");
        const spriteDef = getBlockDef("Sprite");
        const imgId = sprite && spriteDef ? String(resolveProps(spriteDef, sprite.props).image) : "";
        const img = assets.get(imgId);
        const anims = img?.type === "image" ? (img.animations ?? {}) : {};
        for (const [state, anim] of Object.entries((v ?? {}) as Record<string, string>)) {
          if (anim && !(anim in anims)) add("warn", where, `L'animazione ${q(anim)} per lo stato ${q(state)} non esiste nell'immagine.`, ids);
        }
        break;
      }
    }
  }

  // ---------------------------------------------------------- regole
  function entitiesFor(ref: string, scene: SceneData | undefined, trigger: RuleItem | undefined, tdef: RuleItemDef | undefined): EntityData[] | undefined {
    if (ref === "self" && tdef?.subject && trigger) return entitiesFor(String(trigger.params?.[tdef.subject] ?? ""), scene, undefined, undefined);
    if (ref === "other" && tdef?.other && trigger) return entitiesFor(String(trigger.params?.[tdef.other] ?? ""), scene, undefined, undefined);
    const scenes = scene ? [scene] : p.scenes;
    if (ref.startsWith("#")) {
      const tag = ref.slice(1);
      return scenes.flatMap((s) => flatten(s.entities)).filter((e) => [...(e.tags ?? []), ...(prefabs.get(e.prefab ?? "")?.tags ?? [])].includes(tag));
    }
    if (ref.startsWith("@")) return scenes.flatMap((s) => flatten(s.entities)).filter((e) => e.id === ref.slice(1));
    return undefined;
  }

  function blocksOf(e: EntityData): BlockData[] {
    const pf = e.prefab ? prefabs.get(e.prefab) : undefined;
    return (pf ? mergeBlocks(pf.blocks, e.blocks) : e.blocks).filter((b) => b.enabled !== false);
  }

  function checkRule(r: RuleData, index: number, scene: SceneData | undefined) {
    const where = `${scene ? `Scena ${q(scene.name)}` : "Regole globali"} › Regola ${index + 1}${r.comment ? ` (${r.comment})` : ""}`;
    const ids: Ids = { sceneId: scene?.id, ruleId: r.id };
    const tdef = r.when ? getRuleItemDef(r.when.type) : undefined;
    if (!r.when || !tdef) add("error", where, `Evento sconosciuto ${q(String(r.when?.type ?? ""))}.`, ids);
    else if (tdef.kind !== "trigger") add("error", where, `${q(tdef.label)} non è un evento.`, ids);
    if (!r.actions?.length) add("warn", where, "Nessuna azione: la regola non fa niente.", ids);

    const kindLabel = { trigger: "evento", condition: "condizione", action: "azione" } as const;
    const items: [RuleItem, keyof typeof kindLabel][] = [
      ...(r.when && tdef ? [[r.when, "trigger"] as [RuleItem, "trigger"]] : []),
      ...(r.conditions ?? []).map((c) => [c, "condition"] as [RuleItem, "condition"]),
      ...(r.actions ?? []).map((a) => [a, "action"] as [RuleItem, "action"]),
    ];
    for (const [item, kind] of items) {
      const def = getRuleItemDef(item.type);
      if (!def) {
        add("error", where, `${kindLabel[kind]} sconosciuta ${q(item.type)}.`, ids);
        continue;
      }
      if (def.kind !== kind) {
        add("error", where, `${q(def.label)} non si può usare come ${kindLabel[kind]}.`, ids);
        continue;
      }
      const iw = `${where} › ${def.label}`;
      for (const [name, schema] of Object.entries(def.params)) {
        checkRuleParam(name, schema, item, def, iw, ids, scene, r.when, tdef);
      }
    }
  }

  function checkRuleParam(
    name: string,
    schema: PropSchema,
    item: RuleItem,
    def: RuleItemDef,
    where: string,
    ids: Ids,
    scene: SceneData | undefined,
    trigger: RuleItem | undefined,
    tdef: RuleItemDef | undefined,
  ) {
    const v = item.params?.[name];
    const s = String(v ?? "");
    const err = (m: string) => add("error", where, m, ids);
    const warn = (m: string) => add("warn", where, m, ids);
    switch (schema.type) {
      case "object": {
        if (!s) {
          if (!(def.kind === "trigger" && name === def.other) && !schema.optional) err(`Scegli ${schema.label.toLowerCase()}.`);
          return;
        }
        if (s === "self" && (def.kind === "trigger" || !tdef?.subject)) err("«questo oggetto» non esiste con questo evento.");
        if (s === "other" && (def.kind === "trigger" || !tdef?.other)) err("«l'altro oggetto» non esiste con questo evento.");
        if (s.startsWith("@") && !entitiesFor(s, scene, undefined, undefined)?.length) {
          err(`L'oggetto con id ${q(s.slice(1))} non esiste${scene ? " in questa scena" : ""}.`);
        }
        if (s.startsWith("#") && !allTags.has(s.slice(1))) warn(`Nessun oggetto ha l'etichetta ${q(s.slice(1))}.`);
        return;
      }
      case "event": {
        if (!s) return err("Scegli cosa deve succedere.");
        const ents = entitiesFor(String(item.params?.target ?? ""), scene, trigger, tdef);
        if (ents?.length && !ents.some((e) => blocksOf(e).some((b) => getBlockDef(b.type)?.events.some((ev) => ev.id === s)))) {
          warn(`Nessun blocco di questo oggetto produce l'evento ${q(s)}.`);
        }
        return;
      }
      case "condition":
      case "blockAction": {
        if (!s) return err(`Scegli ${schema.label.toLowerCase()}.`);
        const [type, key] = splitRuleKey(s);
        const bd = getBlockDef(type);
        const exists = schema.type === "condition" ? bd?.conditions[key] : bd?.actions[key];
        if (!exists) return err(`${q(s)} non esiste.`);
        const ents = entitiesFor(String(item.params?.target ?? ""), scene, trigger, tdef);
        if (ents?.length && !ents.some((e) => blocksOf(e).some((b) => b.type === type))) warn(`Nessun oggetto indicato ha il blocco ${q(bd!.label)}.`);
        return;
      }
      case "dialogue":
        if (!s) {
          if (!schema.optional) err("Scegli il dialogo.");
        } else if (!dialogues.has(s)) err(`Il dialogo ${q(s)} non esiste.`);
        return;
      case "block":
        if (!s) err("Scegli il blocco.");
        else if (!getBlockDef(s)) err(`Blocco sconosciuto ${q(s)}.`);
        return;
      case "scene":
        if (s && !sceneIds.has(s)) err(`La scena ${q(s)} non esiste.`);
        else if (!s && def.type === "scene.goto") err("Scegli la scena.");
        return;
      case "prefab":
        if (!s) err("Scegli il modello.");
        else if (!prefabs.has(s)) err(`Il modello ${q(s)} non esiste.`);
        return;
      case "audio":
        if (s && assets.get(s)?.type !== "audio") err(`Il suono ${q(s)} non esiste.`);
        return;
      case "variable":
        if (!s) err("Scegli la variabile.");
        else if (!vars.has(s)) warn(`La variabile ${q(s)} non è tra le variabili globali.`);
        return;
      case "input":
        if (!inputs.has(s)) err(`Il comando ${q(s)} non esiste.`);
        return;
      case "number":
      case "integer":
        if (typeof v !== "number" || Number.isNaN(v)) err(`${schema.label}: serve un numero.`);
        return;
    }
  }
}

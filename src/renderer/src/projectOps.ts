import {
  getBlockDef,
  getRuleItemDef,
  mergeBlocks,
  resolveProps,
  type BlockData,
  type EntityData,
  type ImageAsset,
  type NamedInfo,
  type ProjectData,
  type RuleData,
  type RuleItem,
  type SceneData,
} from "@runtime";

export type AssetKind = "image" | "audio" | "font";

/**
 * Riferimenti a un asset nel progetto: campi di blocchi, modelli, Regole e filmati, musica delle scene,
 * immagini dei tileset, ritratti dei dialoghi, carattere del gioco. Con `to` li sostituisce, con `null` li conta soltanto.
 */
export function replaceAssetRefs(p: ProjectData, kind: AssetKind, from: string, to: string | null): number {
  let n = 0;
  const swap = (obj: object | undefined, key: string) => {
    const o = obj as Record<string, unknown> | undefined;
    if (!o || o[key] !== from) return;
    n++;
    if (to !== null) o[key] = to;
  };
  const blocks = (list: BlockData[] | undefined) => {
    for (const b of list ?? []) {
      const def = getBlockDef(b.type);
      if (!def || !b.props) continue;
      for (const [k, s] of Object.entries(def.props)) {
        if (s.type === kind) swap(b.props, k);
        // Elenchi di righe (armi, carte…): anche i loro campi possono puntare a un asset.
        if (s.type !== "list" || !Array.isArray(b.props[k])) continue;
        for (const row of b.props[k] as object[]) {
          for (const [fk, f] of Object.entries(s.fields ?? {})) if (f.type === kind) swap(row, fk);
        }
      }
    }
  };
  const entities = (list: EntityData[] | undefined) => {
    for (const e of list ?? []) {
      blocks(e.blocks);
      entities(e.children);
    }
  };
  const items = (list: (RuleItem | undefined)[] | undefined) => {
    for (const it of list ?? []) {
      const def = it && getRuleItemDef(it.type);
      if (!it?.params || !def?.params) continue;
      for (const [k, s] of Object.entries(def.params)) if (s.type === kind) swap(it.params, k);
    }
  };
  const rules = (list: RuleData[] | undefined) => {
    for (const r of list ?? []) {
      items([r.when]);
      items(r.conditions);
      items(r.actions);
    }
  };
  for (const s of p.scenes) {
    if (kind === "audio") swap(s, "music");
    entities(s.entities);
    rules(s.rules);
  }
  for (const pf of p.prefabs) blocks(pf.blocks);
  rules(p.rules);
  for (const c of p.cutscenes ?? []) items(c.steps);
  if (kind === "image") {
    for (const t of p.tilesets) swap(t, "image");
    for (const d of p.dialogues ?? []) for (const l of d.lines) swap(l, "portrait");
    for (const it of p.items ?? []) swap(it, "icon");
  }
  if (kind === "font") swap(p.settings, "font");
  return n;
}

/** Dopo aver rinominato un suono, lo aggiornano i campi audio di blocchi, modelli, Regole, filmati e la musica delle scene. */
export function replaceSoundRefs(p: ProjectData, from: string, to: string): void {
  replaceAssetRefs(p, "audio", from, to);
}

/**
 * Riferimenti a un oggetto dell'archivio: campi «oggetto» ed elenchi dei negozi nei blocchi, parametri delle Regole
 * e dei filmati. Con `to` li sostituisce (vuoto = li toglie), con `null` li conta soltanto.
 */
export function replaceItemRefs(p: ProjectData, from: string, to: string | null): number {
  let n = 0;
  const blocks = (list: BlockData[] | undefined) => {
    for (const b of list ?? []) {
      const def = getBlockDef(b.type);
      if (!def || !b.props) continue;
      for (const [k, s] of Object.entries(def.props)) {
        if (s.type === "item" && b.props[k] === from) {
          n++;
          if (to !== null) b.props[k] = to;
        } else if (s.type === "itemList" && Array.isArray(b.props[k])) {
          const rows = b.props[k] as { item?: string }[];
          const hits = rows.filter((r) => r?.item === from).length;
          n += hits;
          if (hits && to !== null) b.props[k] = to ? rows.map((r) => (r?.item === from ? { ...r, item: to } : r)) : rows.filter((r) => r?.item !== from);
        } else if (s.type === "list" && Array.isArray(b.props[k])) {
          // Elenchi di righe: i campi «oggetto» dentro le righe.
          for (const row of b.props[k] as Record<string, unknown>[]) {
            for (const [fk, f] of Object.entries(s.fields ?? {})) {
              if (f.type !== "item" || !row || row[fk] !== from) continue;
              n++;
              if (to !== null) row[fk] = to;
            }
          }
        }
      }
    }
  };
  const entities = (list: EntityData[] | undefined) => {
    for (const e of list ?? []) {
      blocks(e.blocks);
      entities(e.children);
    }
  };
  const items = (list: (RuleItem | undefined)[] | undefined) => {
    for (const it of list ?? []) {
      const def = it && getRuleItemDef(it.type);
      if (!it?.params || !def?.params) continue;
      for (const [k, s] of Object.entries(def.params)) {
        if (s.type !== "item" || it.params[k] !== from) continue;
        n++;
        if (to !== null) it.params[k] = to;
      }
    }
  };
  const rules = (list: RuleData[] | undefined) => {
    for (const r of list ?? []) items([r.when, ...r.conditions, ...r.actions]);
  };
  for (const s of p.scenes) {
    entities(s.entities);
    rules(s.rules);
  }
  for (const pf of p.prefabs) blocks(pf.blocks);
  rules(p.rules);
  for (const c of p.cutscenes ?? []) items(c.steps);
  return n;
}

/** Quante volte il progetto usa un asset. */
export function assetUses(p: ProjectData, id: string): number {
  const a = p.assets.find((x) => x.id === id);
  return a ? replaceAssetRefs(p, a.type, id, null) : 0;
}

export interface FlatEntity {
  data: EntityData;
  /** Posizione nel mondo (somma con i genitori). */
  wx: number;
  wy: number;
  depth: number;
}

export function sceneOf(p: ProjectData, id: string): SceneData | undefined {
  return p.scenes.find((s) => s.id === id);
}

export function findEntity(list: EntityData[], id: string): EntityData | undefined {
  for (const e of list) {
    if (e.id === id) return e;
    const c = e.children && findEntity(e.children, id);
    if (c) return c;
  }
  return undefined;
}

export function removeEntity(list: EntityData[], id: string): boolean {
  const i = list.findIndex((e) => e.id === id);
  if (i >= 0) {
    list.splice(i, 1);
    return true;
  }
  return list.some((e) => (e.children ? removeEntity(e.children, id) : false));
}

export function flattenEntities(list: EntityData[], px = 0, py = 0, depth = 0, out: FlatEntity[] = []): FlatEntity[] {
  for (const e of list) {
    const wx = px + e.x;
    const wy = py + e.y;
    out.push({ data: e, wx, wy, depth });
    if (e.children) flattenEntities(e.children, wx, wy, depth + 1, out);
  }
  return out;
}

export function collectIds(scene: SceneData): Set<string> {
  return new Set(flattenEntities(scene.entities).map((f) => f.data.id));
}

/** Blocchi effettivi: quelli del modello con sopra le modifiche dell'istanza. */
export function effectiveBlocks(project: ProjectData, e: EntityData): BlockData[] {
  const prefab = e.prefab ? project.prefabs.find((p) => p.id === e.prefab) : undefined;
  return prefab ? mergeBlocks(prefab.blocks, e.blocks) : e.blocks;
}

export function blockProps(b: BlockData): Record<string, any> {
  const def = getBlockDef(b.type);
  return def ? resolveProps(def, b.props) : b.props;
}

export function spriteOf(project: ProjectData, blocks: BlockData[]) {
  const sb = blocks.find((b) => b.type === "Sprite" && b.enabled !== false);
  if (!sb) return null;
  const p = blockProps(sb);
  const asset = project.assets.find((a) => a.id === p.image && a.type === "image") as ImageAsset | undefined;
  let frame: number = p.frame ?? 0;
  const anim = asset?.animations?.idle ?? asset?.animations?.idle_down;
  if (blocks.some((b) => b.type === "Animator" && b.enabled !== false) && anim?.frames.length) frame = anim.frames[0];
  return {
    image: p.image as string,
    frame,
    origin: (p.origin ?? "bottom") as "bottom" | "center" | "topleft",
    offsetX: Number(p.offsetX ?? 0),
    offsetY: Number(p.offsetY ?? 0),
    asset,
  };
}

export function toSlug(base: string): string {
  return (
    base
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "") || "oggetto"
  );
}

export function uniqueId(base: string, taken: Set<string>): string {
  const slug = toSlug(base);
  let id = slug;
  for (let n = 2; taken.has(id); n++) id = `${slug}_${n}`;
  return id;
}

/** Blocchi da aggiungere per avere `type` con tutti i blocchi che richiede. */
export function missingWithRequires(existing: BlockData[], type: string): string[] {
  const have = new Set(existing.filter((b) => b.enabled !== false).map((b) => b.type));
  const out: string[] = [];
  const visit = (t: string) => {
    const def = getBlockDef(t);
    if (!def || have.has(t)) return;
    for (const r of def.requires) visit(r);
    have.add(t);
    out.push(t);
  };
  visit(type);
  return out;
}

export function statesFor(blocks: BlockData[]): NamedInfo[] {
  const out: NamedInfo[] = [];
  for (const b of blocks) {
    if (b.enabled === false) continue;
    for (const s of getBlockDef(b.type)?.states ?? []) if (!out.some((o) => o.id === s.id)) out.push(s);
  }
  return out;
}

export function projectTags(project: ProjectData): string[] {
  const tags = new Set<string>();
  for (const p of project.prefabs) p.tags?.forEach((t) => tags.add(t));
  for (const s of project.scenes) for (const f of flattenEntities(s.entities)) f.data.tags?.forEach((t) => tags.add(t));
  return [...tags].sort();
}

export function prefabUses(project: ProjectData, prefabId: string): number {
  let n = 0;
  for (const s of project.scenes) for (const f of flattenEntities(s.entities)) if (f.data.prefab === prefabId) n++;
  return n;
}

/** Quanti oggetti (e modelli) usano un dialogo con il blocco Personaggio che parla. */
export function dialogueUses(project: ProjectData, dialogueId: string): number {
  const uses = (blocks: BlockData[]) => blocks.some((b) => b.type === "Talker" && b.enabled !== false && blockProps(b).dialogue === dialogueId);
  let n = project.prefabs.filter((p) => uses(p.blocks)).length;
  for (const s of project.scenes) for (const f of flattenEntities(s.entities)) if (!f.data.prefab && uses(f.data.blocks)) n++;
  return n;
}

export type EntityKind = "player" | "enemy" | "item" | "text" | "exit" | "object";

export function entityKind(project: ProjectData, e: EntityData): EntityKind {
  const blocks = effectiveBlocks(project, e);
  const has = (t: string) => blocks.some((b) => b.type === t && b.enabled !== false);
  const tags = new Set([...(e.tags ?? []), ...(project.prefabs.find((p) => p.id === e.prefab)?.tags ?? [])]);
  if (tags.has("giocatore")) return "player";
  if (tags.has("nemico") || has("ContactDamage")) return "enemy";
  if (has("Collectible")) return "item";
  if (has("SceneExit")) return "exit";
  if (has("Text") && !has("Sprite")) return "text";
  return "object";
}

export function assetUrl(baseUrl: string, src: string, rev?: number): string {
  let url = src;
  try {
    url = new URL(src, baseUrl).href;
  } catch {
    // Indirizzo non valido: si usa com'è.
  }
  // Dopo un salvataggio dal Disegno il file ha lo stesso nome: la revisione evita l'immagine vecchia in cache.
  return rev && !url.startsWith("data:") ? `${url}${url.includes("?") ? "&" : "?"}v=${rev}` : url;
}

/** Gradi tra -180 (escluso) e 180, con un decimale: così la rotazione resta leggibile nell'Inspector. */
export function normalizeDegrees(deg: number): number {
  let d = deg % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return Math.round(d * 10) / 10;
}

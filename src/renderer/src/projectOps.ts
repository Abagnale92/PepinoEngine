import {
  getBlockDef,
  mergeBlocks,
  resolveProps,
  type BlockData,
  type EntityData,
  type ImageAsset,
  type NamedInfo,
  type ProjectData,
  type SceneData,
} from "@runtime";

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

export function assetUrl(baseUrl: string, src: string): string {
  try {
    return new URL(src, baseUrl).href;
  } catch {
    return src;
  }
}

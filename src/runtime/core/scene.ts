import { Emitter } from "./events";
import { Entity } from "./entity";
import { Camera } from "./camera";
import type { Game } from "./game";
import { hexColor, overlaps } from "../math";
import type { BlockData, EntityData, SceneData, TileLayerData } from "../project/format";
import type { BodyState, Side } from "../physics/body";
import { COLL, type CollisionGrid } from "../physics/collision";
import { buildCollisionGrid, drawTileLayer } from "../world/tilemap";
import type { Renderer } from "../render/renderer";
import { COLLISION_TYPES } from "../project/format";
import { RuleSystem } from "../rules/rules";
import { describeScriptError } from "../scripting/errors";
import type { BlockInstance } from "./block";

type HookName = "init" | "update" | "physics" | "late" | "render" | "renderScreen" | "renderDebug";

const HOOK_LABEL: Record<HookName, string> = {
  init: "all'avvio",
  update: "in update",
  physics: "in physics",
  late: "in late",
  render: "nel disegno",
  renderScreen: "nel disegno dell'HUD",
  renderDebug: "nel disegno di debug",
};

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/** Da quale lato `a` tocca `b`, guardando le posizioni del passo precedente. */
function sideOf(a: BodyState, b: BodyState): Side {
  if (a.prevTop + a.h <= b.prevTop + 4) return "bottom";
  if (a.prevTop >= b.prevTop + b.h - 4) return "top";
  if (a.prevLeft + a.w <= b.prevLeft + 2) return "right";
  if (a.prevLeft >= b.prevLeft + b.w - 2) return "left";
  const dx = b.left + b.w / 2 - (a.left + a.w / 2);
  const dy = b.top + b.h / 2 - (a.top + a.h / 2);
  if (Math.abs(dx) * (a.h + b.h) > Math.abs(dy) * (a.w + b.w)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "bottom" : "top";
}

/** I blocchi dell'istanza sovrascrivono (o si aggiungono a) quelli del modello. */
export function mergeBlocks(base: BlockData[], over: BlockData[]): BlockData[] {
  const out: BlockData[] = base.map((b) => ({ type: b.type, enabled: b.enabled, props: { ...b.props } }));
  for (const o of over) {
    const t = out.find((b) => b.type === o.type);
    if (t) {
      t.props = { ...t.props, ...o.props };
      if (o.enabled !== undefined) t.enabled = o.enabled;
    } else {
      out.push(structuredClone(o));
    }
  }
  return out;
}

const DEBUG_COLORS: Record<number, number> = Object.fromEntries(
  COLLISION_TYPES.filter((c) => c.id !== "none").map((c) => [COLL[c.id], hexColor(c.color, 0.35)]),
);

export class Scene {
  readonly events = new Emitter();
  readonly tileSize: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly grid: CollisionGrid;
  readonly camera: Camera;
  readonly rules: RuleSystem;
  entities: Entity[] = [];
  time = 0;
  /** Pulsante del menù selezionato (indice nell'ordine dei pulsanti). */
  uiFocus = 0;
  private removals = new Set<Entity>();
  private spawnCounter = 0;
  private reported = new Set<string>();

  /** Esegue una funzione di un blocco: se va in errore si ferma quel blocco, non il gioco. */
  callHook(b: BlockInstance, hook: HookName, arg?: unknown): void {
    const fn = b.def[hook] as ((self: BlockInstance, a?: unknown) => void) | undefined;
    if (!fn) return;
    try {
      fn(b, arg);
    } catch (err) {
      this.blockFailed(b, hook, err);
    }
  }

  private blockFailed(b: BlockInstance, hook: HookName, err: unknown): void {
    b.enabled = false;
    const d = describeScriptError(err);
    const key = `${b.def.type}|${hook}|${d.message}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.game.log(
      `Il blocco «${b.def.label}» su «${b.entity.name}» si è fermato ${HOOK_LABEL[hook]}: ${d.message}${d.where ? ` (${d.where})` : ""}`,
      "error",
    );
  }

  constructor(
    readonly game: Game,
    readonly data: SceneData,
  ) {
    const s = game.project.settings;
    this.tileSize = s.tileSize;
    this.widthPx = data.width * s.tileSize;
    this.heightPx = data.height * s.tileSize;
    this.grid = buildCollisionGrid(game.project, data);
    this.camera = new Camera(s.resolution.width, s.resolution.height);
    for (const ed of data.entities) this.build(ed);
    const seen = new Set<string>();
    for (const e of this.entities) {
      if (seen.has(e.id)) game.log(`Scena "${data.name}": due oggetti hanno lo stesso id "${e.id}" (le Regole useranno solo il primo)`, "warn");
      seen.add(e.id);
    }
    for (const e of [...this.entities]) e.init();
    this.rules = new RuleSystem(this, [...(game.project.rules ?? []), ...(data.rules ?? [])]);
  }

  private build(ed: EntityData, parent?: Entity): Entity {
    const prefab = ed.prefab ? this.game.project.prefabs.find((p) => p.id === ed.prefab) : undefined;
    if (ed.prefab && !prefab) this.game.log(`Modello "${ed.prefab}" non trovato per "${ed.name}"`, "warn");
    const e = new Entity(this, {
      id: ed.id,
      name: ed.name,
      x: ed.x,
      y: ed.y,
      z: ed.z ?? prefab?.z,
      tags: [...(prefab?.tags ?? []), ...(ed.tags ?? [])],
      visible: ed.visible,
    });
    e.prefab = ed.prefab;
    for (const bd of mergeBlocks(prefab?.blocks ?? [], ed.blocks)) e.addBlock(bd);
    if (parent) {
      e.parent = parent;
      parent.children.push(e);
    }
    this.entities.push(e);
    for (const c of ed.children ?? []) this.build(c, e);
    return e;
  }

  /** Crea un oggetto da un modello durante il gioco (proiettili, nemici generati…). */
  spawn(prefabId: string, x: number, y: number): Entity | undefined {
    const prefab = this.game.project.prefabs.find((p) => p.id === prefabId);
    if (!prefab) {
      this.game.log(`Modello "${prefabId}" non trovato`, "warn");
      return undefined;
    }
    const e = this.build({ id: `${prefabId}#${++this.spawnCounter}`, name: prefab.name, x, y, prefab: prefabId, blocks: [] });
    e.init();
    return e;
  }

  remove(e: Entity): void {
    if (this.removals.has(e)) return;
    e.destroyed = true;
    this.removals.add(e);
    for (const c of e.children) this.remove(c);
  }

  /** Cerca per nome, id o etichetta. */
  find(key: string): Entity | undefined {
    return this.entities.find((e) => !e.destroyed && (e.name === key || e.id === key || e.tags.has(key)));
  }

  findAll(tag: string): Entity[] {
    return this.entities.filter((e) => !e.destroyed && e.tags.has(tag));
  }

  update(dt: number): void {
    this.time += dt;
    const list = this.entities;
    for (const e of list) {
      if (e.destroyed) continue;
      for (const b of e.blocks) if (b.enabled && b.def.update) this.callHook(b, "update", dt);
    }
    for (const e of list) e.body?.savePrev();
    for (const e of list) {
      if (e.destroyed) continue;
      for (const b of e.blocks) if (b.enabled && b.def.physics) this.callHook(b, "physics", dt);
    }
    this.updateContacts();
    for (const e of list) {
      if (e.destroyed) continue;
      for (const b of e.blocks) if (b.enabled && b.def.late) this.callHook(b, "late", dt);
    }
    this.rules.process(dt);
    this.camera.update(dt);
    this.flush();
  }

  private updateContacts(): void {
    const bodies: BodyState[] = [];
    for (const e of this.entities) if (!e.destroyed && e.body) bodies.push(e.body);
    const next = new Map<BodyState, Map<Entity, Side>>();
    for (const b of bodies) next.set(b, new Map());
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      const ra = a.rect();
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        if (!a.mask.has(b.group) && !b.mask.has(a.group)) continue;
        if (!overlaps(ra, b.rect())) continue;
        const sideA = a.contacts.get(b.entity) ?? sideOf(a, b);
        next.get(a)!.set(b.entity, sideA);
        next.get(b)!.set(a.entity, b.contacts.get(a.entity) ?? OPPOSITE[sideA]);
      }
    }
    for (const b of bodies) {
      const old = b.contacts;
      const now = next.get(b)!;
      b.contacts = now;
      for (const [other, side] of now) if (!old.has(other)) b.entity.emit("contact", { other, side });
      for (const other of old.keys()) if (!now.has(other)) b.entity.emit("contactEnd", { other });
    }
  }

  private flush(): void {
    if (this.removals.size === 0) return;
    for (const e of this.removals) {
      e.dispose();
      if (e.parent) e.parent.children = e.parent.children.filter((c) => c !== e);
    }
    this.entities = this.entities.filter((e) => !this.removals.has(e));
    for (const e of this.entities) {
      if (e.body) for (const r of this.removals) e.body.contacts.delete(r);
    }
    this.removals.clear();
  }

  render(r: Renderer, debug = false): void {
    const cam = this.camera;
    const vw = cam.viewW / cam.zoom;
    const vh = cam.viewH / cam.zoom;
    const x0 = cam.left;
    const y0 = cam.top;

    type Draw = { z: number; y: number; order: number; layer?: TileLayerData; entity?: Entity };
    const draws: Draw[] = [];
    this.data.layers.forEach((l, i) => {
      if (l.visible !== false) draws.push({ z: l.z, y: 0, order: i, layer: l });
    });
    for (const e of this.entities) {
      if (!e.destroyed && e.visible) draws.push({ z: e.z, y: this.data.ySort ? e.worldY : 0, order: e.uid, entity: e });
    }
    draws.sort((a, b) => a.z - b.z || (a.layer ? 0 : 1) - (b.layer ? 0 : 1) || a.y - b.y || a.order - b.order);

    const project = this.game.project;
    for (const d of draws) {
      if (d.layer) {
        const ts = project.tilesets.find((t) => t.id === d.layer!.tileset);
        if (!ts) continue;
        const p = d.layer.parallax ?? 1;
        const lx = Math.round(x0 * p);
        const ly = Math.round(y0 * p);
        r.setView(lx, ly, cam.zoom);
        drawTileLayer(r, this.game.assets, ts, d.layer, this.tileSize, lx, ly, vw, vh, d.layer.opacity ?? 1);
      } else {
        r.setView(x0, y0, cam.zoom);
        for (const b of d.entity!.blocks) if (b.enabled && b.def.render) this.callHook(b, "render", r);
      }
    }
    if (debug) {
      r.setView(x0, y0, cam.zoom);
      this.renderDebug(r, x0, y0, vw, vh);
    }
  }

  renderScreen(r: Renderer): void {
    const list = [...this.entities].sort((a, b) => a.z - b.z || a.uid - b.uid);
    for (const e of list) {
      if (e.destroyed || !e.visible) continue;
      for (const b of e.blocks) if (b.enabled && b.def.renderScreen) this.callHook(b, "renderScreen", r);
    }
  }

  private renderDebug(r: Renderer, x0: number, y0: number, vw: number, vh: number): void {
    const s = this.tileSize;
    const g = this.grid;
    const c0 = Math.max(0, Math.floor(x0 / s));
    const c1 = Math.min(g.cols - 1, Math.floor((x0 + vw) / s));
    const r0 = Math.max(0, Math.floor(y0 / s));
    const r1 = Math.min(g.rows - 1, Math.floor((y0 + vh) / s));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const color = DEBUG_COLORS[g.get(col, row)];
        if (color) r.rect(col * s, row * s, s, s, color);
      }
    }
    const green = hexColor("#5dff8a");
    const yellow = hexColor("#ffe45d");
    for (const e of this.entities) {
      const b = e.body;
      if (!b || e.destroyed) continue;
      r.strokeRect(b.left, b.top, b.w, b.h, 1, b.contacts.size ? yellow : green);
    }
    for (const e of this.entities) {
      if (e.destroyed) continue;
      for (const b of e.blocks) if (b.enabled && b.def.renderDebug) this.callHook(b, "renderDebug", r);
    }
  }

  dispose(): void {
    for (const e of this.entities) e.dispose();
    this.entities = [];
    this.events.clear();
  }
}

import { Emitter } from "./events";
import { BlockInstance, getBlockDef, resolveProps } from "./block";
import type { BlockData } from "../project/format";
import type { Scene } from "./scene";
import type { BodyState } from "../physics/body";

/** Cosa l'oggetto "vuole fare" in questo frame. Lo scrive il giocatore (input) o l'IA. */
export interface Intent {
  x: number;
  y: number;
  jump: boolean;
  jumpPressed: boolean;
  dashPressed: boolean;
  actionPressed: boolean;
}

export type Direction = "down" | "up" | "left" | "right";

export interface SpriteState {
  image: string;
  frame: number;
  flipX: boolean;
  opacity: number;
  tint: string;
  offsetX: number;
  offsetY: number;
  origin: "bottom" | "center" | "topleft";
  /** 0..1: quanto lo sprite diventa bianco (colpo subito). */
  flash: number;
  visible: boolean;
}

/**
 * Deformazione del momento, calcolata ogni fotogramma dal blocco Effetti animati:
 * spostamento, scala, rotazione, inclinazione, trasparenza e lampo di colore.
 */
export interface SpriteFX {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  rot: number;
  skew: number;
  alpha: number;
  flash: number;
  flashColor: number;
}

export const identityFx = (): SpriteFX => ({ dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, skew: 0, alpha: 1, flash: 0, flashColor: 0xffffff });

let nextUid = 1;

export class Entity {
  readonly uid = nextUid++;
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  tags: Set<string>;
  visible = true;
  /** Stato corrente (fermo, corsa, salto…): lo impostano i blocchi, lo legge l'animatore. */
  state = "idle";
  facingX: 1 | -1 = 1;
  direction: Direction = "down";
  /** Secondi in cui l'oggetto non risponde ai comandi (dopo un contraccolpo). */
  stunned = 0;
  /** Altezza da terra in pixel (salti nei beat 'em up): lo sprite sale, l'ombra e il corpo restano a terra. */
  elevation = 0;
  /** Effetti animati del momento (schiacciata, lampo, tremolio…): li legge lo Sprite. */
  fx: SpriteFX = identityFx();
  intent: Intent = { x: 0, y: 0, jump: false, jumpPressed: false, dashPressed: false, actionPressed: false };
  blocks: BlockInstance[] = [];
  body?: BodyState;
  sprite?: SpriteState;
  parent?: Entity;
  children: Entity[] = [];
  prefab?: string;
  destroyed = false;
  initialized = false;
  private events = new Emitter();

  constructor(
    readonly scene: Scene,
    init: { id: string; name: string; x: number; y: number; z?: number; tags?: string[]; visible?: boolean },
  ) {
    this.id = init.id;
    this.name = init.name;
    this.x = init.x;
    this.y = init.y;
    this.z = init.z ?? 0;
    this.tags = new Set(init.tags ?? []);
    this.visible = init.visible !== false;
  }

  get worldX(): number {
    return this.parent ? this.parent.worldX + this.x : this.x;
  }

  get worldY(): number {
    return this.parent ? this.parent.worldY + this.y : this.y;
  }

  addBlock(data: BlockData): BlockInstance | undefined {
    const def = getBlockDef(data.type);
    if (!def) {
      this.scene.game.log(`Blocco sconosciuto "${data.type}" su "${this.name}"`, "warn");
      return undefined;
    }
    const inst = new BlockInstance(def, this, resolveProps(def, data.props), data.enabled !== false);
    this.blocks.push(inst);
    this.blocks.sort((a, b) => a.def.priority - b.def.priority);
    if (this.initialized) this.scene.callHook(inst, "init");
    return inst;
  }

  get<P extends Record<string, any> = Record<string, any>>(type: string): BlockInstance<P> | undefined {
    return this.blocks.find((b) => b.def.type === type) as BlockInstance<P> | undefined;
  }

  has(type: string): boolean {
    return this.blocks.some((b) => b.def.type === type);
  }

  hasTag(tag: string): boolean {
    return this.tags.has(tag);
  }

  on<T = any>(event: string, fn: (data: T) => void): () => void {
    return this.events.on(event, fn);
  }

  emit(event: string, data?: unknown): void {
    this.events.emit(event, data);
    this.scene.events.emit(event, { entity: this, data });
  }

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    for (const b of this.blocks) this.scene.callHook(b, "init");
  }

  destroy(): void {
    this.scene.remove(this);
  }

  dispose(): void {
    for (const b of this.blocks) b.dispose();
    this.events.clear();
    this.destroyed = true;
  }
}

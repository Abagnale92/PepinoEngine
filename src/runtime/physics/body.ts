import { clamp, type Rect } from "../math";
import type { Entity } from "../core/entity";
import { COLL, type CollisionGrid } from "./collision";

export type Side = "top" | "bottom" | "left" | "right";

const EPS = 0.001;

/**
 * Corpo cinematico: si muove con la sua velocità e si ferma contro i tile solidi.
 * Il movimento è separato per assi e diviso in piccoli passi, così non attraversa i muri.
 */
export class BodyState {
  vx = 0;
  vy = 0;
  onGround = false;
  onCeiling = false;
  onWallLeft = false;
  onWallRight = false;
  onLadder = false;
  ladderX = 0;
  inHazard = false;
  groundCode = 0;
  /** Secondi rimanenti in cui si passa attraverso le piattaforme attraversabili. */
  dropThrough = 0;
  outOfBounds = false;
  prevLeft = 0;
  prevTop = 0;
  /** Oggetti toccati in questo momento e da quale lato di questo corpo. */
  contacts = new Map<Entity, Side>();

  constructor(
    readonly entity: Entity,
    public w: number,
    public h: number,
    public ox: number,
    public oy: number,
    public group: string,
    public mask: Set<string>,
    public world: boolean,
  ) {}

  get left() {
    return this.entity.worldX + this.ox;
  }
  get top() {
    return this.entity.worldY + this.oy;
  }
  get right() {
    return this.left + this.w;
  }
  get bottom() {
    return this.top + this.h;
  }

  rect(): Rect {
    return { x: this.left, y: this.top, w: this.w, h: this.h };
  }

  savePrev(): void {
    this.prevLeft = this.left;
    this.prevTop = this.top;
  }

  /** Vero se tocca un oggetto con quell'etichetta (o di quel gruppo), opzionalmente da un lato preciso. */
  touched(tagOrGroup: string, side?: Side): boolean {
    for (const [e, s] of this.contacts) {
      if (e.destroyed) continue;
      if ((e.hasTag(tagOrGroup) || e.body?.group === tagOrGroup) && (!side || s === side)) return true;
    }
    return false;
  }

  touching(tagOrGroup: string): Entity[] {
    const out: Entity[] = [];
    for (const e of this.contacts.keys()) {
      if (!e.destroyed && (e.hasTag(tagOrGroup) || e.body?.group === tagOrGroup)) out.push(e);
    }
    return out;
  }

  step(dt: number, grid: CollisionGrid): void {
    this.onGround = this.onCeiling = this.onWallLeft = this.onWallRight = false;
    if (this.dropThrough > 0) this.dropThrough -= dt;
    const dx = this.vx * dt;
    const dy = this.vy * dt;
    if (!this.world) {
      this.entity.x += dx;
      this.entity.y += dy;
    } else {
      this.moveX(dx, grid);
      this.moveY(dy, grid);
      this.scanCells(grid);
    }
    const fell = this.top > grid.rows * grid.size + 32;
    if (fell && !this.outOfBounds) this.entity.emit("outOfBounds");
    this.outOfBounds = fell;
  }

  private solidInCol(g: CollisionGrid, col: number, r0: number, r1: number): boolean {
    for (let r = r0; r <= r1; r++) if (g.get(col, r) === COLL.solid) return true;
    return false;
  }

  private moveX(dx: number, g: CollisionGrid): void {
    const s = g.size;
    const max = s * 0.5;
    let remaining = dx;
    while (Math.abs(remaining) > 1e-6) {
      const step = clamp(remaining, -max, max);
      remaining -= step;
      const r0 = Math.floor(this.top / s);
      const r1 = Math.floor((this.bottom - EPS) / s);
      if (step > 0) {
        const col = Math.floor((this.right + step - EPS) / s);
        if (this.solidInCol(g, col, r0, r1)) {
          this.entity.x += col * s - this.right;
          this.vx = 0;
          this.onWallRight = true;
          return;
        }
      } else {
        const col = Math.floor((this.left + step) / s);
        if (this.solidInCol(g, col, r0, r1)) {
          this.entity.x += (col + 1) * s - this.left;
          this.vx = 0;
          this.onWallLeft = true;
          return;
        }
      }
      this.entity.x += step;
    }
  }

  private moveY(dy: number, g: CollisionGrid): void {
    const s = g.size;
    const max = s * 0.5;
    let remaining = dy;
    while (Math.abs(remaining) > 1e-6) {
      const step = clamp(remaining, -max, max);
      remaining -= step;
      const c0 = Math.floor(this.left / s);
      const c1 = Math.floor((this.right - EPS) / s);
      if (step > 0) {
        const row = Math.floor((this.bottom + step - EPS) / s);
        const rowTop = row * s;
        for (let c = c0; c <= c1; c++) {
          const code = g.get(c, row);
          const blocks =
            code === COLL.solid || (code === COLL.oneway && this.dropThrough <= 0 && this.bottom <= rowTop + EPS);
          if (blocks) {
            this.entity.y += rowTop - this.bottom;
            this.vy = 0;
            this.onGround = true;
            this.groundCode = code;
            return;
          }
        }
      } else {
        const row = Math.floor((this.top + step) / s);
        for (let c = c0; c <= c1; c++) {
          if (g.get(c, row) === COLL.solid) {
            this.entity.y += (row + 1) * s - this.top;
            this.vy = 0;
            this.onCeiling = true;
            return;
          }
        }
      }
      this.entity.y += step;
    }
  }

  /** Scale e pericoli: basta sovrapporsi, non bloccano. */
  private scanCells(g: CollisionGrid): void {
    const s = g.size;
    this.onLadder = false;
    this.inHazard = false;
    const c0 = Math.floor((this.left + 2) / s);
    const c1 = Math.floor((this.right - 2) / s);
    const r0 = Math.floor((this.top + 2) / s);
    const r1 = Math.floor((this.bottom - 1) / s);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const code = g.get(c, r);
        if (code === COLL.ladder) {
          this.onLadder = true;
          this.ladderX = c * s + s / 2;
        } else if (code === COLL.hazard) {
          this.inHazard = true;
        }
      }
    }
  }
}

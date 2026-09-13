import type { CollisionType } from "../project/format";

/** Codici numerici dei tipi di collisione, per la griglia compatta. */
export const COLL = { none: 0, solid: 1, oneway: 2, ladder: 3, hazard: 4 } as const;
export type CollisionCode = (typeof COLL)[keyof typeof COLL];

export const codeOf = (t: CollisionType | undefined): CollisionCode => (t ? COLL[t] : COLL.none);

/** Quando due layer si sovrappongono vince il tipo più "forte". */
const RANK: Record<number, number> = { 0: 0, 3: 1, 2: 2, 4: 3, 1: 4 };

export class CollisionGrid {
  readonly cells: Uint8Array;
  /** I bordi della scena bloccano come muri. */
  solidEdges = true;
  openBottom = false;

  constructor(
    readonly cols: number,
    readonly rows: number,
    readonly size: number,
  ) {
    this.cells = new Uint8Array(cols * rows);
  }

  get(cx: number, cy: number): number {
    if (cx < 0 || cx >= this.cols || cy < 0) return this.solidEdges ? COLL.solid : COLL.none;
    if (cy >= this.rows) return this.openBottom || !this.solidEdges ? COLL.none : COLL.solid;
    return this.cells[cy * this.cols + cx];
  }

  merge(cx: number, cy: number, code: number): void {
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return;
    const i = cy * this.cols + cx;
    if (RANK[code] > RANK[this.cells[i]]) this.cells[i] = code;
  }

  atPixel(x: number, y: number): number {
    return this.get(Math.floor(x / this.size), Math.floor(y / this.size));
  }
}

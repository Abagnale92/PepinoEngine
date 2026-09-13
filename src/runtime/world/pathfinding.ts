import { COLL, type CollisionGrid } from "../physics/collision";

export interface Cell {
  x: number;
  y: number;
}

/** Si può camminare sulla cella? (niente muri e niente pericoli) */
export function walkable(g: CollisionGrid, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) return false;
  const c = g.get(x, y);
  return c !== COLL.solid && c !== COLL.hazard;
}

const DIRS4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const DIRS8 = [...DIRS4, [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * Percorso A* sulla griglia dei tile, dalla cella di partenza (esclusa) a quella d'arrivo (inclusa).
 * In diagonale non taglia gli angoli dei muri. `null` se non c'è strada.
 */
export function findPath(
  g: CollisionGrid,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  opts: { diagonal?: boolean; maxNodes?: number } = {},
): Cell[] | null {
  if (!walkable(g, tx, ty)) return null;
  if (sx === tx && sy === ty) return [];
  const W = g.cols;
  const N = W * g.rows;
  if (sx < 0 || sy < 0 || sx >= W || sy >= g.rows) return null;
  const diagonal = !!opts.diagonal;
  const maxNodes = opts.maxNodes ?? 4000;
  const start = sy * W + sx;
  const goal = ty * W + tx;
  const gScore = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const h = (i: number) => {
    const dx = Math.abs((i % W) - tx);
    const dy = Math.abs(Math.floor(i / W) - ty);
    return diagonal ? Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy) : dx + dy;
  };

  // Coda con priorità (heap binario) di coppie [f, indice].
  const heap: [number, number][] = [];
  const push = (f: number, i: number) => {
    heap.push([f, i]);
    let k = heap.length - 1;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (heap[parent][0] <= heap[k][0]) break;
      [heap[parent], heap[k]] = [heap[k], heap[parent]];
      k = parent;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top[1];
  };

  gScore[start] = 0;
  push(h(start), start);
  let expanded = 0;
  while (heap.length) {
    const cur = pop();
    if (closed[cur]) continue;
    if (cur === goal) break;
    closed[cur] = 1;
    if (++expanded > maxNodes) return null;
    const cx = cur % W;
    const cy = Math.floor(cur / W);
    for (const [dx, dy] of diagonal ? DIRS8 : DIRS4) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!walkable(g, nx, ny)) continue;
      if (dx && dy && (!walkable(g, cx + dx, cy) || !walkable(g, cx, cy + dy))) continue;
      const ni = ny * W + nx;
      if (closed[ni]) continue;
      const cost = gScore[cur] + (dx && dy ? Math.SQRT2 : 1);
      if (cost < gScore[ni]) {
        gScore[ni] = cost;
        came[ni] = cur;
        push(cost + h(ni), ni);
      }
    }
  }
  if (came[goal] < 0) return null;
  const path: Cell[] = [];
  for (let i = goal; i !== start; i = came[i]) path.push({ x: i % W, y: Math.floor(i / W) });
  return path.reverse();
}

/** Da un punto all'altro (in pixel) c'è un muro in mezzo? */
export function lineOfSight(g: CollisionGrid, x0: number, y0: number, x1: number, y1: number): boolean {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(dist / (g.size / 4)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (g.atPixel(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t) === COLL.solid) return false;
  }
  return true;
}

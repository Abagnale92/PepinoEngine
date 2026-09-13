import type { Entity } from "../core/entity";
import type { Scene } from "../core/scene";

/** Centro del corpo (o la posizione, se non ha un Corpo). */
export function bodyCenter(e: Entity): { x: number; y: number } {
  const b = e.body;
  return b ? { x: b.left + b.w / 2, y: b.top + b.h / 2 } : { x: e.worldX, y: e.worldY };
}

/** L'oggetto più vicino con quell'etichetta, entro `maxDist` pixel. */
export function nearestTagged(scene: Scene, from: Entity, tag: string, maxDist = Infinity): Entity | undefined {
  const c = bodyCenter(from);
  let best: Entity | undefined;
  let bestD = maxDist;
  for (const o of scene.entities) {
    if (o === from || o.destroyed || !o.hasTag(tag)) continue;
    const oc = bodyCenter(o);
    const d = Math.hypot(oc.x - c.x, oc.y - c.y);
    if (d <= bestD) {
      best = o;
      bestD = d;
    }
  }
  return best;
}

/** Direzione in cui guarda: le 4 direzioni nel top-down, destra/sinistra nei platform. */
export function facingVector(e: Entity): { x: number; y: number } {
  if (e.has("TopDownController")) {
    switch (e.direction) {
      case "up":
        return { x: 0, y: -1 };
      case "down":
        return { x: 0, y: 1 };
      case "left":
        return { x: -1, y: 0 };
      default:
        return { x: 1, y: 0 };
    }
  }
  return { x: e.facingX, y: 0 };
}

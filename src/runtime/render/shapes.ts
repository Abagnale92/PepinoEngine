import { hexColor } from "../math";
import type { Renderer } from "./renderer";

/**
 * Banda ad arco tra i raggi r0 e r1, dall'angolo a0 ad a1 (radianti): la scia di un colpo.
 * La coda (verso a0) sfuma, la testa (verso a1) è piena.
 */
export function drawArc(
  r: Renderer,
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
  hex: string,
  alpha = 1,
  segments = 8,
): void {
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    const b0 = a0 + (a1 - a0) * t0;
    const b1 = a0 + (a1 - a0) * t1;
    const c0 = Math.cos(b0);
    const s0 = Math.sin(b0);
    const c1 = Math.cos(b1);
    const s1 = Math.sin(b1);
    // La banda si assottiglia verso la coda.
    const in0 = r1 - (r1 - r0) * (0.3 + 0.7 * t0);
    const in1 = r1 - (r1 - r0) * (0.3 + 0.7 * t1);
    r.drawQuad(
      r.white,
      0,
      0,
      1,
      1,
      cx + c0 * r1,
      cy + s0 * r1,
      cx + c1 * r1,
      cy + s1 * r1,
      cx + c1 * in1,
      cy + s1 * in1,
      cx + c0 * in0,
      cy + s0 * in0,
      hexColor(hex, alpha * (0.15 + 0.85 * t1)),
    );
  }
}

/** Segmento spesso `width` che parte da (x, y) nella direzione `angle`. */
export function drawRay(r: Renderer, x: number, y: number, angle: number, len: number, width: number, hex: string, alpha = 1): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const nx = (-s * width) / 2;
  const ny = (c * width) / 2;
  const ex = x + c * len;
  const ey = y + s * len;
  r.drawQuad(r.white, 0, 0, 1, 1, x + nx, y + ny, ex + nx, ey + ny, ex - nx, ey - ny, x - nx, y - ny, hexColor(hex, alpha));
}

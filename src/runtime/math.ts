export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** Muove `value` verso `target` di al massimo `delta`. */
export function approach(value: number, target: number, delta: number): number {
  return value < target ? Math.min(value + delta, target) : Math.max(value - delta, target);
}

/** Smorzamento esponenziale indipendente dal frame rate. `smoothing` = velocità di recupero (1/s). */
export function damp(current: number, target: number, smoothing: number, dt: number): number {
  if (smoothing <= 0) return target;
  return lerp(current, target, 1 - Math.exp(-smoothing * dt));
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export type RGBA = [number, number, number, number];

/** Legge #rgb, #rgba, #rrggbb o #rrggbbaa. Valori 0..1. */
export function parseColor(input: string | undefined, fallback: RGBA = [1, 1, 1, 1]): RGBA {
  if (!input) return fallback;
  let hex = input.trim().replace(/^#/, "");
  if (hex.length === 3 || hex.length === 4) hex = hex.split("").map((c) => c + c).join("");
  if (hex.length !== 6 && hex.length !== 8) return fallback;
  const n = parseInt(hex, 16);
  if (Number.isNaN(n)) return fallback;
  if (hex.length === 6) return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
  return [((n >>> 24) & 255) / 255, ((n >>> 16) & 255) / 255, ((n >>> 8) & 255) / 255, (n & 255) / 255];
}

/** Colore premoltiplicato impacchettato in un Uint32 (byte in ordine RGBA). */
export function packColor(r: number, g: number, b: number, a = 1): number {
  const A = clamp(a, 0, 1);
  return (
    (Math.round(clamp(r, 0, 1) * A * 255) |
      (Math.round(clamp(g, 0, 1) * A * 255) << 8) |
      (Math.round(clamp(b, 0, 1) * A * 255) << 16) |
      (Math.round(A * 255) << 24)) >>>
    0
  );
}

export const WHITE = packColor(1, 1, 1, 1);

export function hexColor(hex: string | undefined, alpha = 1): number {
  const [r, g, b, a] = parseColor(hex);
  return packColor(r, g, b, a * alpha);
}

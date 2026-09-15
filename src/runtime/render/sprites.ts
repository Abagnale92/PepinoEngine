import { frameRect, type LoadedImage } from "../assets/assets";
import { WHITE } from "../math";
import type { Renderer } from "./renderer";

export type Origin = "bottom" | "center" | "topleft";

/** Deformazione di uno sprite attorno al suo punto di origine (effetti animati). */
export interface SpriteTransform {
  sx: number;
  sy: number;
  /** Rotazione in radianti. */
  rot: number;
  /** Inclinazione orizzontale: la parte alta scorre di `skew` pixel per pixel di altezza. */
  skew: number;
  /** Colore del lampo, 0xRRGGBB. */
  flashColor?: number;
}

const isIdentity = (t?: SpriteTransform) => !t || (t.sx === 1 && t.sy === 1 && t.rot === 0 && t.skew === 0);

/** Disegna un fotogramma di uno sprite con il punto di origine scelto (piedi, centro, angolo). */
export function drawSpriteFrame(
  r: Renderer,
  img: LoadedImage,
  frame: number,
  x: number,
  y: number,
  origin: Origin = "bottom",
  flipX = false,
  color = WHITE,
  flash = 0,
  tf?: SpriteTransform,
): void {
  const { sx, sy, fw, fh } = frameRect(img, frame);
  const flashColor = tf?.flashColor ?? 0xffffff;
  // Angolo in alto a sinistra rispetto al punto di origine.
  let lx = 0;
  let ly = 0;
  if (origin === "bottom") {
    lx = -fw / 2;
    ly = -fh;
  } else if (origin === "center") {
    lx = -fw / 2;
    ly = -fh / 2;
  }
  if (isIdentity(tf)) {
    r.draw(img.tex, sx, sy, fw, fh, Math.round(x + lx), Math.round(y + ly), fw, fh, color, flipX, flash, flashColor);
    return;
  }
  const t = tf!;
  const px = Math.round(x);
  const py = Math.round(y);
  const cos = Math.cos(t.rot);
  const sin = Math.sin(t.rot);
  const corner = (cx: number, cy: number): [number, number] => {
    let X = cx * t.sx;
    const Y = cy * t.sy;
    X += Y * t.skew;
    return [px + X * cos - Y * sin, py + X * sin + Y * cos];
  };
  const [x0, y0] = corner(lx, ly);
  const [x1, y1] = corner(lx + fw, ly);
  const [x2, y2] = corner(lx + fw, ly + fh);
  const [x3, y3] = corner(lx, ly + fh);
  const inset = 0.01;
  let u0 = (sx + inset) / img.tex.width;
  let u1 = (sx + fw - inset) / img.tex.width;
  const v0 = (sy + inset) / img.tex.height;
  const v1 = (sy + fh - inset) / img.tex.height;
  if (flipX) [u0, u1] = [u1, u0];
  r.drawQuad(img.tex, u0, v0, u1, v1, x0, y0, x1, y1, x2, y2, x3, y3, color, flash, flashColor);
}

/** Rettangolo occupato da uno sprite, per selezione e gizmo nell'editor. */
export function spriteBounds(img: LoadedImage | undefined, x: number, y: number, origin: Origin = "bottom") {
  const w = img?.fw ?? 16;
  const h = img?.fh ?? 16;
  if (origin === "bottom") return { x: x - w / 2, y: y - h, w, h };
  if (origin === "center") return { x: x - w / 2, y: y - h / 2, w, h };
  return { x, y, w, h };
}

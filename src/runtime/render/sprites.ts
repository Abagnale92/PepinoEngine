import { frameRect, type LoadedImage } from "../assets/assets";
import { WHITE } from "../math";
import type { Renderer } from "./renderer";

export type Origin = "bottom" | "center" | "topleft";

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
): void {
  const { sx, sy, fw, fh } = frameRect(img, frame);
  let dx = x;
  let dy = y;
  if (origin === "bottom") {
    dx -= fw / 2;
    dy -= fh;
  } else if (origin === "center") {
    dx -= fw / 2;
    dy -= fh / 2;
  }
  r.draw(img.tex, sx, sy, fw, fh, Math.round(dx), Math.round(dy), fw, fh, color, flipX, flash);
}

/** Rettangolo occupato da uno sprite, per selezione e gizmo nell'editor. */
export function spriteBounds(img: LoadedImage | undefined, x: number, y: number, origin: Origin = "bottom") {
  const w = img?.fw ?? 16;
  const h = img?.fh ?? 16;
  if (origin === "bottom") return { x: x - w / 2, y: y - h, w, h };
  if (origin === "center") return { x: x - w / 2, y: y - h / 2, w, h };
  return { x, y, w, h };
}

import { clamp } from "../math";

export class Camera {
  /** Centro della camera, in pixel del mondo. */
  x: number;
  y: number;
  zoom = 1;
  private shakeTime = 0;
  private shakeDuration = 0;
  private shakeAmp = 0;
  private sx = 0;
  private sy = 0;

  constructor(
    public viewW: number,
    public viewH: number,
  ) {
    this.x = viewW / 2;
    this.y = viewH / 2;
  }

  get halfW(): number {
    return this.viewW / (2 * this.zoom);
  }

  get halfH(): number {
    return this.viewH / (2 * this.zoom);
  }

  /** Angolo in alto a sinistra visibile, arrotondato al pixel (niente tremolii nella pixel art). */
  get left(): number {
    return Math.round(this.x - this.halfW + this.sx);
  }

  get top(): number {
    return Math.round(this.y - this.halfH + this.sy);
  }

  shake(amplitude: number, duration: number): void {
    this.shakeAmp = Math.max(amplitude, this.shakeTime > 0 ? this.shakeAmp : 0);
    this.shakeTime = this.shakeDuration = Math.max(0.01, duration);
  }

  update(dt: number): void {
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const a = this.shakeAmp * Math.max(0, this.shakeTime / this.shakeDuration);
      this.sx = (Math.random() * 2 - 1) * a;
      this.sy = (Math.random() * 2 - 1) * a;
    } else {
      this.sx = this.sy = 0;
    }
  }

  /** Tiene la camera dentro la scena (se la scena è più piccola dello schermo, la centra). */
  clampTo(width: number, height: number): void {
    this.x = width <= this.halfW * 2 ? width / 2 : clamp(this.x, this.halfW, width - this.halfW);
    this.y = height <= this.halfH * 2 ? height / 2 : clamp(this.y, this.halfH, height - this.halfH);
  }
}

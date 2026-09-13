import { useEffect, useRef } from "react";

const cache = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(url: string): Promise<HTMLImageElement> {
  let p = cache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Immagine non trovata: ${url}`));
      img.src = url;
    });
    cache.set(url, p);
  }
  return p;
}

/** Miniatura pixel-perfect di una porzione di immagine (un fotogramma, un tile). */
export function FrameThumb({
  url,
  sx = 0,
  sy = 0,
  sw,
  sh,
  frame,
  size = 40,
}: {
  url: string;
  sx?: number;
  sy?: number;
  sw?: number;
  sh?: number;
  /** Se indicato, (sx, sy) si calcolano dal numero del fotogramma nello sprite sheet. */
  frame?: number;
  size?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    loadImage(url)
      .then((img) => {
        const c = ref.current;
        if (!alive || !c) return;
        const w = sw || img.width;
        const h = sh || img.height;
        let x = sx;
        let y = sy;
        if (frame !== undefined) {
          const cols = Math.max(1, Math.floor(img.width / w));
          x = (frame % cols) * w;
          y = Math.floor(frame / cols) * h;
        }
        const scale = Math.max(1, Math.floor(size / Math.max(w, h)));
        c.width = w * scale;
        c.height = h * scale;
        const g = c.getContext("2d")!;
        g.imageSmoothingEnabled = false;
        g.clearRect(0, 0, c.width, c.height);
        g.drawImage(img, x, y, w, h, 0, 0, w * scale, h * scale);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url, sx, sy, sw, sh, frame, size]);
  return <canvas ref={ref} className="thumb" style={{ maxWidth: size, maxHeight: size }} />;
}

/** Anteprima animata di un'animazione dello sprite sheet. */
export function AnimPreview({
  url,
  fw,
  fh,
  frames,
  fps,
  size = 96,
}: {
  url: string;
  fw: number;
  fh: number;
  frames: number[];
  fps: number;
  size?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    let timer = 0;
    loadImage(url)
      .then((img) => {
        const c = ref.current;
        if (!alive || !c || frames.length === 0) return;
        const w = fw || img.width;
        const h = fh || img.height;
        const cols = Math.max(1, Math.floor(img.width / w));
        const scale = Math.max(1, Math.floor(size / Math.max(w, h)));
        c.width = w * scale;
        c.height = h * scale;
        const g = c.getContext("2d")!;
        g.imageSmoothingEnabled = false;
        let i = 0;
        const tick = () => {
          const f = frames[i % frames.length];
          g.clearRect(0, 0, c.width, c.height);
          g.drawImage(img, (f % cols) * w, Math.floor(f / cols) * h, w, h, 0, 0, w * scale, h * scale);
          i++;
        };
        tick();
        timer = window.setInterval(tick, 1000 / Math.max(1, fps));
      })
      .catch(() => {});
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [url, fw, fh, frames.join(","), fps, size]);
  return <canvas ref={ref} className="thumb anim" style={{ maxWidth: size, maxHeight: size }} />;
}

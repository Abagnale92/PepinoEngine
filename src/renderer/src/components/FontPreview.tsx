import { useEffect, useRef } from "react";
import { bitmapFont, drawBitmapText, fontCss, fontFamilyName, measureBitmapText, SANS_CSS } from "@runtime";
import { useEditor } from "../store";
import { assetUrl } from "../projectOps";

const loaded = new Map<string, Promise<void>>();

/** Registra nell'editor un carattere importato, per le anteprime (una volta sola per file). */
export function ensureEditorFont(id: string, url: string): Promise<void> {
  const key = `${id}|${url}`;
  let p = loaded.get(key);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => new FontFace(fontFamilyName(id), buf).load())
      .then((face) => void document.fonts.add(face));
    loaded.set(key, p);
  }
  return p;
}

/** Riga di esempio scritta con un carattere del gioco: Pixel, di sistema o importato. */
export function FontPreview({ font, text = "Aa Bb 123 àè!", size = 14 }: { font: string; text?: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const src = useEditor((s) => s.project?.assets.find((a) => a.id === font && a.type === "font")?.src);
  const baseUrl = useEditor((s) => s.baseUrl);

  useEffect(() => {
    let alive = true;
    const paint = () => {
      const c = ref.current;
      const ctx = c?.getContext("2d");
      if (!alive || !c || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const color = getComputedStyle(c).color;
      const bm = bitmapFont(font);
      if (bm) {
        const unit = Math.max(1, Math.round((size * dpr) / bm.em));
        c.width = measureBitmapText(bm, text) * unit + unit * 2;
        c.height = (bm.cap + 6) * unit;
        ctx.fillStyle = color;
        drawBitmapText(ctx, bm, text, unit, 3 * unit, unit);
      } else {
        const css = src ? `"${fontFamilyName(font)}", ${SANS_CSS}` : (fontCss(font) ?? SANS_CSS);
        const f = `${Math.round(size * dpr)}px ${css}`;
        ctx.font = f;
        c.width = Math.ceil(ctx.measureText(text).width) + 4;
        c.height = Math.ceil(size * dpr * 1.4);
        // Cambiare le dimensioni del canvas azzera lo stile del testo.
        ctx.font = f;
        ctx.textBaseline = "top";
        ctx.fillStyle = color;
        ctx.fillText(text, 2, Math.round(size * dpr * 0.15));
      }
      c.style.width = `${c.width / dpr}px`;
      c.style.height = `${c.height / dpr}px`;
    };
    paint();
    if (src) ensureEditorFont(font, assetUrl(baseUrl, src)).then(paint, () => {});
    return () => void (alive = false);
  }, [font, text, size, src, baseUrl]);

  return <canvas ref={ref} className="font-preview" style={{ display: "block", color: "var(--text)", maxWidth: "100%" }} />;
}

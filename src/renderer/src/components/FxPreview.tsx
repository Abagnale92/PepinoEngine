import { useEffect, useRef, useState } from "react";
import { LOOP_EFFECTS, ONE_SHOT_EFFECTS, applyEffect, applyLoop, effectDuration, identityFx } from "@runtime";
import { T } from "../i18n";
import { loadImage } from "./thumbs";

/** Lo sprite dell'oggetto da animare nell'anteprima (null = un cetriolo di prova). */
export interface FxSprite {
  url: string;
  fw: number;
  fh: number;
  frame: number;
  origin: string;
}

/** Proprietà del blocco con un effetto «una volta», con il nome del pulsante che lo rivede. */
const EVENTS: [string, string][] = [
  ["onJump", "Salto"],
  ["onLand", "Atterraggio"],
  ["onHurt", "Colpo"],
  ["onAttack", "Attacco"],
  ["onAppear", "Appare"],
  ["onDeath", "Sparisce"],
  ["customEffect", "Evento"],
];

const W = 150;
const H = 100;
const FLOOR = H - 16;
/** Pausa tra una ripetizione e l'altra dell'effetto scelto. */
const GAP = 0.7;

const hexOf = (n: number) => `#${(n & 0xffffff).toString(16).padStart(6, "0")}`;
const numOf = (hex: string) => parseInt(String(hex || "#ffffff").slice(1, 7), 16) || 0xffffff;
const labelOf = (list: { value: string; label: string }[], v: string) => list.find((o) => o.value === v)?.label ?? v;

type Props = Record<string, any>;

/**
 * Anteprima degli Effetti animati nell'Inspector: l'effetto continuo gira sempre, quello scelto
 * per ultimo (o con i pulsanti) si ripete, sullo sprite dell'oggetto.
 */
export function FxPreview({ props, sprite }: { props: Props; sprite: FxSprite | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [demo, setDemo] = useState("");
  const [nonce, setNonce] = useState(0);
  const prev = useRef(props);
  // L'Inspector ricrea le proprietà a ogni disegno: conta solo se cambiano davvero.
  const propsKey = JSON.stringify(props);
  const live = useRef({ props, demo, start: performance.now() });

  const play = (key: string) => {
    setDemo(key);
    setNonce((n) => n + 1);
  };

  // Scegliendo un effetto, l'anteprima lo mostra subito.
  useEffect(() => {
    const before = prev.current;
    prev.current = props;
    const changed = EVENTS.find(([k]) => before[k] !== props[k] && props[k] && props[k] !== "none");
    if (changed) play(changed[0]);
    else if (before.idle !== props.idle) setDemo("");
  }, [propsKey]);

  useEffect(() => {
    live.current = { props, demo, start: performance.now() };
  }, [propsKey, demo, nonce]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    let alive = true;
    let raf = 0;
    let img: HTMLImageElement | null = null;
    if (sprite?.url) loadImage(sprite.url).then((i) => void (img = i)).catch(() => {});
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    c.style.width = `${W}px`;
    c.style.height = `${H}px`;
    const g = c.getContext("2d")!;
    const off = document.createElement("canvas");
    const t0 = performance.now();
    const draw = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(draw);
      const { props: p, demo: key, start } = live.current;
      const fx = identityFx();
      applyLoop(fx, String(p.idle ?? "none"), (now - t0) / 1000, Number(p.idleSpeed ?? 1), Number(p.idleStrength ?? 1));
      const kind = key ? String(p[key] ?? "none") : "none";
      const dur = effectDuration(kind) / Math.max(0.1, Number(p.speed ?? 1));
      if (dur > 0) {
        const t = ((now - start) / 1000) % (dur + GAP);
        if (t < dur) applyEffect(fx, kind, t / dur, Number(p.strength ?? 1), 1, numOf(p.flashColor));
      }
      paint(g, dpr, off, img, sprite, fx);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [sprite?.url, sprite?.fw, sprite?.fh, sprite?.frame, sprite?.origin]);

  const shown = EVENTS.filter(([k]) => props[k] && props[k] !== "none");
  const current = EVENTS.find(([k]) => k === demo);
  const caption = current
    ? `${T(current[1])}: ${T(labelOf(ONE_SHOT_EFFECTS, String(props[demo])))}`
    : props.idle && props.idle !== "none"
      ? `${T("Effetto continuo")}: ${T(labelOf(LOOP_EFFECTS, String(props.idle)))}`
      : T("Scegli un effetto: l'anteprima lo mostra qui");

  return (
    <div className="fx-preview">
      <canvas ref={canvas} className="fx-canvas" />
      <div className="fx-side">
        <div className="fx-caption">{caption}</div>
        <div className="fx-buttons">
          {shown.map(([k, label]) => (
            <button key={k} type="button" className={`btn small${demo === k ? " primary" : ""}`} onClick={() => play(k)}>
              {T(label)}
            </button>
          ))}
          {demo && (
            <button type="button" className="btn small" onClick={() => setDemo("")}>
              {T("Solo continuo")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type Fx = ReturnType<typeof identityFx>;

function paint(g: CanvasRenderingContext2D, dpr: number, off: HTMLCanvasElement, img: HTMLImageElement | null, sprite: FxSprite | null, fx: Fx) {
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#171d16";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#2f3d2c";
  g.fillRect(8, FLOOR, W - 16, 1);

  // Il fotogramma (o il cetriolo di prova) in una tela a parte, con il lampo sopra.
  const fw = img ? sprite!.fw || img.width : 12;
  const fh = img ? sprite!.fh || img.height : 18;
  off.width = fw;
  off.height = fh;
  const o = off.getContext("2d")!;
  o.clearRect(0, 0, fw, fh);
  if (img) {
    const cols = Math.max(1, Math.floor(img.width / fw));
    const f = sprite!.frame;
    o.drawImage(img, (f % cols) * fw, Math.floor(f / cols) * fh, fw, fh, 0, 0, fw, fh);
  } else {
    o.fillStyle = "#6cc24a";
    o.beginPath();
    o.ellipse(fw / 2, fh / 2, fw / 2, fh / 2, 0, 0, Math.PI * 2);
    o.fill();
    o.fillStyle = "#1d2819";
    o.fillRect(3, 6, 2, 2);
    o.fillRect(7, 6, 2, 2);
  }
  if (fx.flash > 0) {
    o.globalCompositeOperation = "source-atop";
    o.globalAlpha = Math.min(1, fx.flash);
    o.fillStyle = hexOf(fx.flashColor);
    o.fillRect(0, 0, fw, fh);
    o.globalAlpha = 1;
    o.globalCompositeOperation = "source-over";
  }

  const scale = Math.max(1, Math.floor(Math.min((W - 50) / fw, (FLOOR - 16) / fh)));
  const w = fw * scale;
  const h = fh * scale;
  // Punto di origine come nel gioco: i piedi, il centro o l'angolo.
  const origin = sprite?.origin ?? "bottom";
  const ox = origin === "topleft" ? 0 : w / 2;
  const oy = origin === "bottom" ? h : origin === "center" ? h / 2 : 0;
  g.save();
  g.translate(W / 2 - w / 2 + ox + fx.dx * scale, FLOOR - h + oy + fx.dy * scale);
  g.rotate(fx.rot);
  g.transform(1, 0, -fx.skew, 1, 0, 0);
  g.scale(fx.sx, fx.sy);
  g.globalAlpha = Math.max(0, Math.min(1, fx.alpha));
  g.imageSmoothingEnabled = false;
  g.drawImage(off, -ox, -oy, w, h);
  g.restore();
}

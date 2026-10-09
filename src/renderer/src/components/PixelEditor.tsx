import { useEffect, useRef, useState } from "react";
import type { ImageAsset } from "@runtime";
import { useEditor } from "../store";
import { assetUrl } from "../projectOps";
import { N, T } from "../i18n";
import { Icon } from "./Icon";
import { CommitInput } from "./fields";
import { FrameThumb } from "./thumbs";
import { PALETTES, composite, toImageData, type PixelDoc } from "../pixel/doc";
import {
  addFrame,
  addLayer,
  addPaletteColor,
  clearCel,
  closeDoc,
  duplicateFrame,
  flipCel,
  mergeDown,
  moveFrame,
  moveLayer,
  newDoc,
  openImageAsset,
  removeFrame,
  removeLayer,
  removePaletteColor,
  renameLayer,
  resizeDoc,
  saveDoc,
  selectFrame,
  selectLayer,
  setFps,
  setPixelState,
  strokeEnd,
  strokeMove,
  strokeStart,
  swapColors,
  toggleLayer,
  togglePixelPlay,
  usePixel,
  zoomBy,
  type PixelTool,
} from "../pixel/store";
import { Splitter, usePanelVar } from "./Splitter";

const TOOLS: { id: PixelTool; icon: string; label: string; key: string }[] = [
  { id: "pencil", icon: "paint", label: N("Matita"), key: "B" },
  { id: "eraser", icon: "erase", label: N("Gomma"), key: "E" },
  { id: "fill", icon: "fill", label: N("Secchiello"), key: "G" },
  { id: "line", icon: "line", label: N("Linea"), key: "L" },
  { id: "rect", icon: "rect", label: N("Rettangolo"), key: "R" },
  { id: "ellipse", icon: "ellipse", label: N("Ellisse"), key: "O" },
  { id: "picker", icon: "picker", label: N("Contagocce"), key: "I" },
  { id: "move", icon: "move", label: N("Sposta"), key: "M" },
];

/** Scheda Disegno: pixel art con livelli, fotogrammi e tavolozze, salvata come immagine del progetto. */
export function PixelEditor() {
  const hasDoc = usePixel((s) => !!s.doc);
  return hasDoc ? <PixelWorkspace /> : <PixelStart />;
}

// ------------------------------------------------------------------ schermata iniziale

function PixelStart() {
  const project = useEditor((s) => s.project)!;
  const baseUrl = useEditor((s) => s.baseUrl);
  const [name, setName] = useState("disegno");
  const [w, setW] = useState(16);
  const [h, setH] = useState(16);
  const images = project.assets.filter((a): a is ImageAsset => a.type === "image");
  return (
    <div className="px-start">
      <section className="px-card">
        <h3>
          <Icon name="paint" />
          {T("Nuovo disegno")}
        </h3>
        <p>{T("Disegna sprite, tile e sfondi in pixel art: livelli, fotogrammi per le animazioni e tavolozze pronte. Il disegno si salva come immagine negli Asset del progetto.")}</p>
        <div className="px-form">
          <label>
            {T("Nome")}
            <input className="px-name-input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            {T("Larghezza")}
            <input type="number" min={1} max={512} value={w} onChange={(e) => setW(Number(e.target.value))} />
          </label>
          <label>
            {T("Altezza")}
            <input type="number" min={1} max={512} value={h} onChange={(e) => setH(Number(e.target.value))} />
          </label>
          <button type="button" className="px-btn primary" onClick={() => newDoc(name, w, h)}>
            {T("Crea")}
          </button>
        </div>
        <div className="px-presets">
          {[8, 16, 24, 32, 48, 64].map((n) => (
            <button
              key={n}
              type="button"
              className={`px-btn${w === n && h === n ? " on" : ""}`}
              onClick={() => {
                setW(n);
                setH(n);
              }}
            >
              {n}×{n}
            </button>
          ))}
        </div>
      </section>
      {images.length > 0 && (
        <section className="px-card">
          <h3>{T("Modifica un'immagine del progetto")}</h3>
          <div className="cards">
            {images.map((a) => (
              <button key={a.id} type="button" className="card" onClick={() => void openImageAsset(a.id)}>
                <div className="card-thumb checker">
                  <FrameThumb url={assetUrl(baseUrl, a.src, a.rev)} sw={a.frameWidth} sh={a.frameHeight} frame={0} size={44} />
                </div>
                <span className="card-name">{a.id}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ area di lavoro

function PixelWorkspace() {
  const s = usePixel((x) => x);
  const sideVar = usePanelVar("--side-w", "paintSide");
  return (
    <div className="px-view">
      <div className="px-top">
        <Icon name="paint" />
        <input className="px-name" value={s.name} title={T("Nome dell'immagine negli asset")} onChange={(e) => setPixelState({ name: e.target.value })} />
        {s.dirty && <span className="px-dirty" title={T("Modifiche non salvate")}>●</span>}
        <ResizeControl />
        <span className="px-spacer" />
        <button type="button" className="px-btn" title={T("Rimpicciolisci")} onClick={() => zoomBy(-1)}>
          <Icon name="minus" size={13} />
        </button>
        <span className="px-zoom">{s.zoom}×</span>
        <button type="button" className="px-btn" title={T("Ingrandisci")} onClick={() => zoomBy(1)}>
          <Icon name="plus" size={13} />
        </button>
        <button type="button" className={`px-btn${s.grid ? " on" : ""}`} title={T("Griglia dei pixel")} onClick={() => setPixelState({ grid: !s.grid })}>
          <Icon name="grid" size={13} />
        </button>
        <button type="button" className="px-btn" onClick={closeDoc}>
          {T("Chiudi")}
        </button>
        <button type="button" className="px-btn primary" disabled={s.saving} onClick={() => void saveDoc()}>
          <Icon name="save" size={13} />
          {T(" Salva immagine")}
        </button>
      </div>
      <div className="px-main" style={sideVar}>
        <Splitter id="paintSide" edge="end" />
        <ToolColumn />
        <PixelCanvas />
        <SidePanel />
      </div>
      <FrameStrip />
    </div>
  );
}

function ResizeControl() {
  const doc = usePixel((s) => s.doc)!;
  usePixel((s) => s.version);
  const [w, setW] = useState(doc.w);
  const [h, setH] = useState(doc.h);
  useEffect(() => {
    setW(doc.w);
    setH(doc.h);
  }, [doc.w, doc.h]);
  const changed = w !== doc.w || h !== doc.h;
  return (
    <span className="px-resize" title={T("Dimensione del disegno in pixel")}>
      <input type="number" min={1} max={512} value={w} onChange={(e) => setW(Number(e.target.value))} />
      ×
      <input type="number" min={1} max={512} value={h} onChange={(e) => setH(Number(e.target.value))} />
      {changed && (
        <button type="button" className="px-btn" onClick={() => resizeDoc(w, h)}>
          {T("Applica")}
        </button>
      )}
    </span>
  );
}

function ToolColumn() {
  const s = usePixel((x) => x);
  return (
    <div className="px-tools">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`px-tool${s.tool === t.id ? " on" : ""}`}
          title={`${T(t.label)} (${t.key})`}
          onClick={() => setPixelState({ tool: t.id })}
        >
          <Icon name={t.icon} />
        </button>
      ))}
      <div className="px-sep" />
      <select value={s.size} title={T("Grandezza del pennello ([ e ])")} onChange={(e) => setPixelState({ size: Number(e.target.value) })}>
        {[1, 2, 3, 4, 6, 8].map((n) => (
          <option key={n} value={n}>
            {n}px
          </option>
        ))}
      </select>
      <button
        type="button"
        className={`px-tool${s.mirrorX ? " on" : ""}`}
        title={T("Disegna a specchio (sinistra-destra)")}
        onClick={() => setPixelState({ mirrorX: !s.mirrorX })}
      >
        <Icon name="mirror" />
      </button>
      <button
        type="button"
        className={`px-tool${s.mirrorY ? " on" : ""}`}
        title={T("Disegna a specchio (sopra-sotto)")}
        onClick={() => setPixelState({ mirrorY: !s.mirrorY })}
      >
        <Icon name="mirrorV" />
      </button>
      <button type="button" className={`px-tool${s.filled ? " on" : ""}`} title={T("Rettangoli ed ellissi pieni")} onClick={() => setPixelState({ filled: !s.filled })}>
        ■
      </button>
      <div className="px-sep" />
      <button type="button" className="px-tool" title={T("Rifletti il livello in orizzontale")} onClick={() => flipCel(true)}>
        ⇆
      </button>
      <button type="button" className="px-tool" title={T("Rifletti il livello in verticale")} onClick={() => flipCel(false)}>
        ⇅
      </button>
      <button type="button" className="px-tool" title={T("Svuota il livello in questo fotogramma (Canc)")} onClick={clearCel}>
        <Icon name="trash" />
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ tela

let checkerTile: HTMLCanvasElement | null = null;

/** Scacchiera dietro i pixel trasparenti. */
function checker(): HTMLCanvasElement {
  if (!checkerTile) {
    checkerTile = document.createElement("canvas");
    checkerTile.width = checkerTile.height = 16;
    const g = checkerTile.getContext("2d")!;
    g.fillStyle = "#b5b5b5";
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = "#8a8a8a";
    g.fillRect(0, 0, 8, 8);
    g.fillRect(8, 8, 8, 8);
  }
  return checkerTile;
}

/** Disegna i pixel di un fotogramma su `g`, ingranditi `z` volte. */
function paintPixels(g: CanvasRenderingContext2D, off: HTMLCanvasElement, doc: PixelDoc, data: Uint32Array, z: number, alpha: number) {
  off.width = doc.w;
  off.height = doc.h;
  off.getContext("2d")!.putImageData(toImageData(data, doc.w, doc.h), 0, 0);
  g.globalAlpha = alpha;
  g.drawImage(off, 0, 0, doc.w * z, doc.h * z);
  g.globalAlpha = 1;
}

function PixelCanvas() {
  const s = usePixel((x) => x);
  const doc = s.doc!;
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const off = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const pan = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const space = useRef(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const z = s.zoom;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(doc.w * z * dpr);
    c.height = Math.round(doc.h * z * dpr);
    c.style.width = `${doc.w * z}px`;
    c.style.height = `${doc.h * z}px`;
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = g.createPattern(checker(), "repeat")!;
    g.fillRect(0, 0, doc.w * z, doc.h * z);
    const n = doc.cels.length;
    if (s.onion && n > 1) paintPixels(g, off.current, doc, composite(doc, (s.frame - 1 + n) % n), z, 0.3);
    paintPixels(g, off.current, doc, composite(doc, s.frame), z, 1);
    if (s.grid && z >= 6) {
      g.strokeStyle = "rgba(0, 0, 0, 0.16)";
      g.lineWidth = 1 / dpr;
      g.beginPath();
      for (let x = 1; x < doc.w; x++) {
        g.moveTo(x * z, 0);
        g.lineTo(x * z, doc.h * z);
      }
      for (let y = 1; y < doc.h; y++) {
        g.moveTo(0, y * z);
        g.lineTo(doc.w * z, y * z);
      }
      g.stroke();
    }
    if (hover) {
      const size = s.tool === "pencil" || s.tool === "eraser" || s.tool === "line" || s.tool === "rect" || s.tool === "ellipse" ? s.size : 1;
      const from = -Math.floor((size - 1) / 2);
      const x = (hover.x + from) * z;
      const y = (hover.y + from) * z;
      g.lineWidth = 1;
      g.strokeStyle = "rgba(0, 0, 0, 0.7)";
      g.strokeRect(x - 0.5, y - 0.5, size * z + 1, size * z + 1);
      g.strokeStyle = "rgba(255, 255, 255, 0.9)";
      g.strokeRect(x + 0.5, y + 0.5, size * z - 1, size * z - 1);
    }
  }, [doc, s.version, s.frame, s.zoom, s.grid, s.onion, s.tool, s.size, hover]);

  // Rotella = zoom (serve un ascoltatore non "passive" per bloccare lo scorrimento della pagina).
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1 : -1);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " && !(e.target as HTMLElement | null)?.closest?.("input, textarea, select")) space.current = e.type === "keydown";
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  const toPixel = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.floor((e.clientX - r.left) / s.zoom), y: Math.floor((e.clientY - r.top) / s.zoom) };
  };

  return (
    <div className="px-canvas-area">
      <div className="px-canvas-wrap" ref={wrap}>
        <div className="px-canvas-pad">
          <canvas
            ref={ref}
            className="px-canvas"
            title={T("Clic sinistro: colore principale · clic destro: secondario · Alt: contagocce · rotella: zoom · tasto centrale o Spazio: sposta la vista")}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={(e) => {
              e.preventDefault();
              ref.current!.setPointerCapture(e.pointerId);
              if (e.button === 1 || space.current) {
                pan.current = { x: e.clientX, y: e.clientY, sl: wrap.current!.scrollLeft, st: wrap.current!.scrollTop };
                return;
              }
              const p = toPixel(e);
              strokeStart(p.x, p.y, e.button, e.altKey);
            }}
            onPointerMove={(e) => {
              if (pan.current) {
                wrap.current!.scrollLeft = pan.current.sl - (e.clientX - pan.current.x);
                wrap.current!.scrollTop = pan.current.st - (e.clientY - pan.current.y);
                return;
              }
              const p = toPixel(e);
              if (!hover || hover.x !== p.x || hover.y !== p.y) setHover(p);
              if (e.buttons & 3) strokeMove(p.x, p.y, e.altKey, e.buttons & 2 ? 2 : 0);
            }}
            onPointerUp={() => {
              pan.current = null;
              strokeEnd();
            }}
            onPointerLeave={() => setHover(null)}
          />
        </div>
      </div>
      {hover && hover.x >= 0 && hover.y >= 0 && hover.x < doc.w && hover.y < doc.h && (
        <div className="px-status">
          {hover.x}, {hover.y}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ colori e livelli

function SidePanel() {
  const s = usePixel((x) => x);
  const doc = s.doc!;
  const palette = PALETTES.find((p) => p.id === s.paletteId) ?? PALETTES[0];
  const swatch = (hex: string, remove?: () => void) => (
    <button
      key={hex}
      type="button"
      className="px-swatch"
      style={{ background: hex }}
      title={hex}
      onClick={(e) => (e.altKey && remove ? remove() : setPixelState({ primary: hex }))}
      onContextMenu={(e) => {
        e.preventDefault();
        setPixelState({ secondary: hex });
      }}
    />
  );
  const layers = doc.layers.map((l, i) => ({ l, i })).reverse();
  return (
    <div className="px-side">
      <div className="px-colors">
        <label className="px-color" title={T("Colore principale (clic sinistro)")}>
          <input type="color" value={s.primary} onChange={(e) => setPixelState({ primary: e.target.value })} />
        </label>
        <label className="px-color secondary" title={T("Colore secondario (clic destro)")}>
          <input type="color" value={s.secondary} onChange={(e) => setPixelState({ secondary: e.target.value })} />
        </label>
        <button type="button" className="icon-btn" title={T("Scambia i colori (X)")} onClick={swapColors}>
          <Icon name="swap" size={13} />
        </button>
      </div>

      <div className="px-h">
        {T("Tavolozza")}
        <select value={s.paletteId} onChange={(e) => setPixelState({ paletteId: e.target.value })}>
          {PALETTES.map((p) => (
            <option key={p.id} value={p.id}>
              {T(p.label)}
            </option>
          ))}
        </select>
      </div>
      <div className="px-swatches">{palette.colors.map((c) => swatch(c))}</div>

      <div className="px-h">
        {T("Colori del disegno")}
        <span className="px-h-btns">
          <button type="button" className="icon-btn" title={T("Aggiungi il colore principale")} onClick={addPaletteColor}>
            <Icon name="plus" size={12} />
          </button>
        </span>
      </div>
      {doc.palette.length > 0 ? (
        <div className="px-swatches">{doc.palette.map((c) => swatch(c, () => removePaletteColor(c)))}</div>
      ) : (
        <p className="empty-hint">{T("Aggiungi qui i colori che usi di più. Alt+clic ne toglie uno.")}</p>
      )}

      <div className="px-h">
        {T("Livelli")}
        <span className="px-h-btns">
          <button type="button" className="icon-btn" title={T("Nuovo livello")} onClick={addLayer}>
            <Icon name="plus" size={12} />
          </button>
          <button type="button" className="icon-btn" title={T("Sposta su")} disabled={s.layer >= doc.layers.length - 1} onClick={() => moveLayer(1)}>
            <Icon name="up" size={12} />
          </button>
          <button type="button" className="icon-btn" title={T("Sposta giù")} disabled={s.layer <= 0} onClick={() => moveLayer(-1)}>
            <Icon name="down" size={12} />
          </button>
          <button type="button" className="icon-btn" title={T("Unisci al livello sotto")} disabled={s.layer <= 0} onClick={mergeDown}>
            ⤓
          </button>
          <button type="button" className="icon-btn" title={T("Elimina livello")} disabled={doc.layers.length <= 1} onClick={removeLayer}>
            <Icon name="trash" size={12} />
          </button>
        </span>
      </div>
      <div className="px-layers">
        {layers.map(({ l, i }) => (
          <div key={i} className={`px-layer${i === s.layer ? " on" : ""}`} onClick={() => selectLayer(i)}>
            <button
              type="button"
              className="icon-btn"
              title={l.visible ? T("Nascondi") : T("Mostra")}
              onClick={(e) => {
                e.stopPropagation();
                toggleLayer(i);
              }}
            >
              <Icon name={l.visible ? "eye" : "eyeOff"} size={12} />
            </button>
            <CommitInput value={l.name} onCommit={(v) => renameLayer(i, v)} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ fotogrammi

function FrameStrip() {
  const s = usePixel((x) => x);
  const doc = s.doc!;
  return (
    <div className="px-frames">
      <div className="px-frames-tools">
        <span className="px-h">{T("Fotogrammi")}</span>
        <button
          type="button"
          className={`px-btn${s.playing ? " on" : ""}`}
          title={s.playing ? T("Ferma l'anteprima") : T("Guarda l'animazione")}
          disabled={doc.cels.length < 2}
          onClick={togglePixelPlay}
        >
          <Icon name={s.playing ? "stop" : "play"} size={12} />
        </button>
        <label className="px-fps">
          {T("fps")}
          <input type="number" min={1} max={60} value={doc.fps} onChange={(e) => setFps(Number(e.target.value))} />
        </label>
        <button
          type="button"
          className={`px-btn${s.onion ? " on" : ""}`}
          title={T("Mostra in trasparenza il fotogramma prima (onion skin)")}
          onClick={() => setPixelState({ onion: !s.onion })}
        >
          <Icon name="onion" size={12} />
          {T(" Cipolla")}
        </button>
        <span className="px-spacer" />
        <button type="button" className="icon-btn" title={T("Nuovo fotogramma")} onClick={addFrame}>
          <Icon name="plus" size={12} />
        </button>
        <button type="button" className="icon-btn" title={T("Duplica il fotogramma")} onClick={duplicateFrame}>
          <Icon name="copy" size={12} />
        </button>
        <button type="button" className="icon-btn" title={T("Sposta il fotogramma a sinistra")} disabled={s.frame <= 0} onClick={() => moveFrame(-1)}>
          ◀
        </button>
        <button type="button" className="icon-btn" title={T("Sposta il fotogramma a destra")} disabled={s.frame >= doc.cels.length - 1} onClick={() => moveFrame(1)}>
          ▶
        </button>
        <button type="button" className="icon-btn" title={T("Elimina il fotogramma")} disabled={doc.cels.length <= 1} onClick={removeFrame}>
          <Icon name="trash" size={12} />
        </button>
      </div>
      <div className="px-frame-list">
        {doc.cels.map((_, i) => (
          <FrameCell key={i} index={i} />
        ))}
      </div>
    </div>
  );
}

function FrameCell({ index }: { index: number }) {
  const doc = usePixel((s) => s.doc)!;
  const version = usePixel((s) => s.version);
  const on = usePixel((s) => s.frame === index);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const scale = Math.max(1, Math.floor(36 / Math.max(doc.w, doc.h)));
    const off = document.createElement("canvas");
    off.width = doc.w;
    off.height = doc.h;
    off.getContext("2d")!.putImageData(toImageData(composite(doc, index), doc.w, doc.h), 0, 0);
    c.width = doc.w * scale;
    c.height = doc.h * scale;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.drawImage(off, 0, 0, c.width, c.height);
  }, [doc, version, index]);
  return (
    <button type="button" className={`px-frame${on ? " on" : ""}`} onClick={() => selectFrame(index)}>
      <canvas ref={ref} style={{ maxWidth: 36, maxHeight: 36 }} />
      <span>{index}</span>
    </button>
  );
}

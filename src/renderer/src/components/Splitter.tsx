import { useRef, type CSSProperties } from "react";
import { getSettings, updatePanel, useSettings } from "../settings";
import { N, T } from "../i18n";

interface PanelDef {
  /** Dimensione iniziale, minima e massima in px. */
  def: number;
  min: number;
  max: number;
  /** Spazio che resta sempre al resto del contenitore (oltre agli altri riquadri con un divisore sullo stesso asse). */
  keep: number;
  label: string;
}

const LIST = N("Trascina per cambiare la larghezza dell'elenco (doppio clic: dimensione iniziale)");
const SIDE = N("Trascina per cambiare la larghezza del pannello laterale (doppio clic: dimensione iniziale)");

/** Tutti i riquadri ridimensionabili dell'editor. */
export const PANELS = {
  // Disposizione principale (App.tsx)
  left: { def: 240, min: 160, max: 560, keep: 360, label: N("Trascina per cambiare la larghezza della Gerarchia (doppio clic: dimensione iniziale)") },
  right: { def: 340, min: 260, max: 760, keep: 360, label: N("Trascina per cambiare la larghezza dell'Inspector (doppio clic: dimensione iniziale)") },
  // 204 = 160 per la vista al centro + 44 della barra degli strumenti
  bottom: { def: 224, min: 90, max: 640, keep: 204, label: N("Trascina per cambiare l'altezza del pannello in basso (doppio clic: dimensione iniziale)") },
  // Riquadri dentro le schede
  dialogues: { def: 220, min: 150, max: 480, keep: 320, label: LIST },
  music: { def: 210, min: 150, max: 480, keep: 320, label: LIST },
  items: { def: 220, min: 150, max: 480, keep: 320, label: LIST },
  codeList: { def: 190, min: 120, max: 420, keep: 310, label: LIST },
  codeSide: { def: 320, min: 220, max: 680, keep: 310, label: N("Trascina per cambiare la larghezza della guida (doppio clic: dimensione iniziale)") },
  paintSide: { def: 216, min: 180, max: 480, keep: 240, label: SIDE },
  playDebug: { def: 200, min: 140, max: 480, keep: 240, label: SIDE },
  // Scheda Tileset: oltre alla colonna ci sono la tavolozza dei tile, le collisioni (almeno 220 px), margini e spazi.
  tiles: { def: 190, min: 170, max: 420, keep: 440, label: N("Trascina per cambiare la larghezza della colonna (doppio clic: dimensione iniziale)") },
} satisfies Record<string, PanelDef>;

export type PanelId = keyof typeof PANELS;

/** Dimensione salvata di un riquadro, entro minimo e massimo (o quella iniziale). */
function stored(id: PanelId): number {
  const p = PANELS[id];
  const v = getSettings().panels?.[id];
  return typeof v === "number" && Number.isFinite(v) ? Math.max(p.min, Math.min(p.max, v)) : p.def;
}

/** Dimensione attuale di un riquadro. */
export function usePanel(id: PanelId): number {
  return useSettings(() => stored(id));
}

/** Stile con la variabile CSS che dà la dimensione al riquadro (`--nome: 220px`). */
export function usePanelVar(name: string, id: PanelId): CSSProperties {
  return { [name]: `${usePanel(id)}px` } as CSSProperties;
}

const STEP = 16;

/** Dimensione ammessa: tra minimo e massimo, lasciando spazio al resto del contenitore e agli altri riquadri sullo stesso asse. */
function clampSize(id: PanelId, size: number, el: HTMLElement, axis: "x" | "y"): number {
  const p = PANELS[id];
  let max = p.max;
  const box = el.parentElement;
  if (box) {
    const total = axis === "x" ? box.clientWidth : box.clientHeight;
    let others = 0;
    for (const sib of box.querySelectorAll<HTMLElement>(`:scope > .splitter[data-axis="${axis}"]`)) {
      if (sib !== el) others += Number(sib.dataset.size) || 0;
    }
    max = Math.min(max, total - p.keep - others);
  }
  return Math.round(Math.max(p.min, Math.min(Math.max(p.min, max), size)));
}

interface Props {
  id: PanelId;
  /** x = bordo verticale che cambia una larghezza; y = bordo orizzontale che cambia un'altezza. */
  axis?: "x" | "y";
  /** Da che parte del contenitore sta il riquadro: all'inizio (sinistra/sopra) o alla fine (destra/sotto). */
  edge?: "start" | "end";
  /** Distanza in più tra il bordo del contenitore e il centro del divisore (margini e spazi della griglia). */
  offset?: number;
  /** Posizionato dal CSS nella griglia (disposizione principale) invece che sopra il bordo del riquadro. */
  grid?: boolean;
  className?: string;
}

/**
 * Bordo divisore tra due sezioni dell'editor: si trascina col mouse o si sposta con le frecce; doppio clic = dimensione iniziale.
 * Senza `grid` sta in posizione assoluta nel contenitore (che deve essere posizionato), sopra il bordo del riquadro.
 */
export function Splitter({ id, axis = "x", edge = "start", offset = 0, grid, className }: Props) {
  const drag = useRef<{ id: number; start: number; size: number } | null>(null);
  const size = usePanel(id);
  // All'inizio trascinare in avanti (destra/giù) allarga il riquadro; alla fine lo stringe.
  const sign = edge === "start" ? 1 : -1;
  const x = axis === "x";

  const current = () => stored(id);
  const set = (el: HTMLElement, v: number, save: boolean) => updatePanel(id, clampSize(id, v, el, axis), save);
  const end = (el: HTMLElement) => {
    drag.current = null;
    document.body.classList.remove("resizing-x", "resizing-y");
    el.classList.remove("dragging");
    // Salva solo alla fine, una volta.
    set(el, current(), true);
  };

  const pos = size + offset - 4;
  const style: CSSProperties | undefined = grid
    ? undefined
    : x
      ? edge === "start" ? { left: pos } : { right: pos }
      : edge === "start" ? { top: pos } : { bottom: pos };

  return (
    <div
      className={`splitter ${axis}${grid ? "" : " abs"}${className ? ` ${className}` : ""}`}
      style={style}
      data-axis={axis}
      data-size={size}
      role="separator"
      aria-orientation={x ? "vertical" : "horizontal"}
      aria-valuenow={size}
      tabIndex={0}
      title={T(PANELS[id].label)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { id: e.pointerId, start: x ? e.clientX : e.clientY, size: current() };
        document.body.classList.add(x ? "resizing-x" : "resizing-y");
        e.currentTarget.classList.add("dragging");
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        set(e.currentTarget, d.size + sign * ((x ? e.clientX : e.clientY) - d.start), false);
      }}
      onPointerUp={(e) => drag.current?.id === e.pointerId && end(e.currentTarget)}
      onLostPointerCapture={(e) => drag.current && end(e.currentTarget)}
      onDoubleClick={() => updatePanel(id, undefined)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? STEP * 4 : STEP;
        const fwd = x ? "ArrowRight" : "ArrowDown";
        const back = x ? "ArrowLeft" : "ArrowUp";
        if (e.key === fwd || e.key === back) set(e.currentTarget, current() + (e.key === fwd ? sign : -sign) * step, true);
        else if (e.key === "Home" || e.key === "Enter") updatePanel(id, undefined);
        else return;
        // Le frecce non devono arrivare anche alle scorciatoie dell'editor (Disegno, Scena).
        e.preventDefault();
        e.stopPropagation();
      }}
    />
  );
}

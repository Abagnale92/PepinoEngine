import { defineBlock, type BlockInstance } from "../core/block";
import type { Renderer } from "../render/renderer";

/** Sostituisce {nome} con il valore della variabile globale. */
export function interpolate(text: string, vars: Record<string, unknown>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
}

/** Posizione sullo schermo di gioco: per l'HUD è quella dell'oggetto, altrimenti si toglie la camera. */
export function screenPos(self: BlockInstance, screen: boolean): { x: number; y: number } {
  const e = self.entity;
  if (screen) return { x: e.worldX, y: e.worldY };
  const cam = self.scene.camera;
  return { x: (e.worldX - cam.left) * cam.zoom, y: (e.worldY - cam.top) * cam.zoom };
}

/**
 * Il testo si disegna sempre nel passaggio "schermo", a piena risoluzione, così resta nitido.
 * Se non è HUD, la posizione del mondo viene convertita in posizione sullo schermo.
 */
function draw(self: BlockInstance, r: Renderer) {
  const p = self.props;
  const { x, y } = screenPos(self, p.screen);
  r.text(interpolate(p.text, self.game.vars), x, y, {
    size: p.size,
    color: p.color,
    align: p.align,
    shadow: p.shadow,
  });
}

defineBlock({
  name: "Text",
  label: "Testo",
  category: "Interfaccia",
  description: "Scrive un testo. Metti il nome di una variabile tra graffe per mostrarne il valore, es. Monete: {monete}.",
  priority: 100,
  props: {
    text: { type: "text", label: "Testo", default: "Testo" },
    size: { type: "number", label: "Dimensione", unit: "px", default: 10, min: 4 },
    color: { type: "color", label: "Colore", default: "#ffffff" },
    align: {
      type: "select",
      label: "Allineamento",
      default: "left",
      options: [
        { value: "left", label: "Sinistra" },
        { value: "center", label: "Centro" },
        { value: "right", label: "Destra" },
      ],
    },
    screen: {
      type: "boolean",
      label: "Fisso sullo schermo (HUD)",
      default: true,
      help: "La posizione è in pixel dello schermo di gioco, non del mondo.",
    },
    shadow: { type: "boolean", label: "Ombra", default: true },
  },
  actions: {
    setText: {
      label: "Cambia testo",
      params: { text: { type: "text", label: "Nuovo testo", default: "" } },
      run: (self, text: string) => (self.props.text = String(text ?? "")),
    },
  },
  renderScreen(self, r) {
    draw(self, r);
  },
});

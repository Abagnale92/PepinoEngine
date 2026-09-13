import { defineBlock } from "../core/block";
import { hexColor } from "../math";
import { drawSpriteFrame, type Origin } from "../render/sprites";

export const ORIGIN_OPTIONS = [
  { value: "bottom", label: "Piedi (in basso al centro)" },
  { value: "center", label: "Centro" },
  { value: "topleft", label: "Angolo in alto a sinistra" },
];

defineBlock({
  name: "Sprite",
  label: "Sprite",
  category: "Grafica",
  description: "Mostra un'immagine o un fotogramma di uno sprite sheet.",
  priority: 0,
  props: {
    image: { type: "image", label: "Immagine", default: "" },
    frame: { type: "integer", label: "Fotogramma", default: 0, min: 0 },
    origin: { type: "select", label: "Punto di origine", default: "bottom", options: ORIGIN_OPTIONS },
    flipWithFacing: { type: "boolean", label: "Si gira con la direzione", default: true },
    offsetX: { type: "number", label: "Spostamento X", unit: "px", default: 0 },
    offsetY: { type: "number", label: "Spostamento Y", unit: "px", default: 0 },
    opacity: { type: "number", label: "Opacità", default: 1, min: 0, max: 1, step: 0.05 },
    tint: { type: "color", label: "Colore", default: "#ffffff" },
  },
  init(self) {
    const p = self.props;
    self.entity.sprite = {
      image: p.image,
      frame: p.frame,
      flipX: false,
      opacity: p.opacity,
      tint: p.tint,
      offsetX: p.offsetX,
      offsetY: p.offsetY,
      origin: p.origin,
      flash: 0,
      visible: true,
    };
  },
  render(self, r) {
    const e = self.entity;
    const s = e.sprite;
    if (!s || !s.visible || s.opacity <= 0) return;
    const img = self.game.assets.image(s.image);
    if (!img) return;
    const flip = self.props.flipWithFacing ? e.facingX < 0 : s.flipX;
    drawSpriteFrame(
      r,
      img,
      s.frame,
      e.worldX + s.offsetX,
      e.worldY + s.offsetY,
      s.origin as Origin,
      flip,
      hexColor(s.tint, s.opacity),
      s.flash,
    );
  },
});

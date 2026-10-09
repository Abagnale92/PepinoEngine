import { defineBlock } from "../core/block";
import { hexColor, packColor } from "../math";
import { drawSpriteFrame, type Origin } from "../render/sprites";
import { frameRect } from "../assets/assets";

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
    shadow: {
      type: "boolean",
      label: "Ombra a terra",
      default: false,
      help: "Un'ombra sotto i piedi: fa capire dove si trova e dove atterrerà un personaggio che salta.",
    },
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
    const fx = e.fx;
    const opacity = s.opacity * fx.alpha;
    if (self.props.shadow) {
      // Più il personaggio è in alto, più l'ombra si stringe.
      const w = frameRect(img, s.frame).fw * 0.8 * Math.abs(fx.sx * e.scaleX) * (1 - Math.min(0.4, e.elevation / 100));
      const h = Math.max(3, w * 0.32);
      r.drawUV(r.radial, 0, 0, 1, 1, e.worldX + s.offsetX - w / 2, e.worldY - h / 2, w, h, packColor(0, 0, 0, 0.5 * opacity));
    }
    const flip = self.props.flipWithFacing ? e.facingX < 0 : s.flipX;
    // Lampo: vince il più forte tra quello della Salute (bianco) e quello degli Effetti animati (colorato).
    const fxWins = fx.flash > s.flash;
    drawSpriteFrame(
      r,
      img,
      s.frame,
      e.worldX + s.offsetX + fx.dx,
      e.worldY + s.offsetY - e.elevation + fx.dy,
      s.origin as Origin,
      flip,
      hexColor(s.tint, opacity),
      fxWins ? fx.flash : s.flash,
      { sx: fx.sx * e.scaleX, sy: fx.sy * e.scaleY, rot: e.rotation + fx.rot, skew: fx.skew, flashColor: fxWins ? fx.flashColor : 0xffffff },
    );
  },
});

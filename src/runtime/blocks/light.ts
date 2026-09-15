import { defineBlock } from "../core/block";
import { hexColor } from "../math";

defineBlock({
  name: "Light",
  label: "Luce",
  category: "Effetti",
  description:
    "Illumina intorno all'oggetto: torce, lampioni, lucciole, occhi che brillano. Si vede quando la scena ha la «Luce ambiente» attiva (Inspector della scena).",
  priority: 85,
  props: {
    radius: { type: "number", label: "Raggio", unit: "tile", default: 4, min: 0, step: 0.5 },
    color: { type: "color", label: "Colore", default: "#ffe2a8" },
    intensity: { type: "number", label: "Intensità", default: 1, min: 0, max: 3, step: 0.1 },
    flicker: {
      type: "number",
      label: "Tremolio",
      default: 0,
      min: 0,
      max: 1,
      step: 0.05,
      help: "0 = luce ferma, 1 = fiamma che trema molto.",
    },
    offsetX: { type: "number", label: "Spostamento X", unit: "px", default: 0 },
    offsetY: { type: "number", label: "Spostamento Y", unit: "px", default: -8 },
  },
  conditions: {
    isOn: { label: "È accesa", test: (self) => !!self.data.on },
  },
  actions: {
    on: { label: "Accendi", run: (self) => (self.data.on = true) },
    off: { label: "Spegni", run: (self) => (self.data.on = false) },
    toggle: { label: "Accendi o spegni", run: (self) => (self.data.on = !self.data.on) },
  },
  init(self) {
    self.data.on = true;
  },
  renderLight(self, r) {
    if (!self.data.on) return;
    const e = self.entity;
    const p = self.props;
    let k = 1;
    if (p.flicker > 0) {
      const t = self.scene.time + e.uid * 1.7;
      k = 1 - p.flicker * 0.5 * (0.5 + 0.25 * Math.sin(t * 11) + 0.25 * Math.sin(t * 23.7));
    }
    const rad = p.radius * self.scene.tileSize * k;
    if (rad <= 0) return;
    const x = e.worldX + p.offsetX;
    const y = e.worldY + p.offsetY - e.elevation;
    // Oltre 1 l'intensità si ottiene disegnando la luce più volte (le luci si sommano).
    for (let a = p.intensity * (0.85 + 0.15 * k); a > 0.001; a -= 1) {
      r.drawUV(r.radial, 0, 0, 1, 1, x - rad, y - rad, rad * 2, rad * 2, hexColor(p.color, Math.min(1, a)));
    }
  },
  renderDebug(self, r) {
    const e = self.entity;
    const p = self.props;
    const rad = p.radius * self.scene.tileSize;
    r.strokeRect(e.worldX + p.offsetX - rad, e.worldY + p.offsetY - rad, rad * 2, rad * 2, 1, hexColor(p.color, 0.6));
  },
});

import { defineBlock, type BlockInstance } from "../core/block";
import { damp } from "../math";

function targetOf(self: BlockInstance) {
  const e = self.entity;
  return { x: e.worldX, y: e.worldY + self.props.offsetY * self.scene.tileSize };
}

defineBlock({
  name: "CameraFollow",
  label: "Camera che segue",
  category: "Camera",
  description: "La camera segue questo oggetto. Scegli lo stile adatto al genere del gioco.",
  priority: 90,
  props: {
    mode: {
      type: "select",
      label: "Stile",
      default: "platform",
      options: [
        { value: "platform", label: "Platform: anticipa nella direzione di corsa" },
        { value: "topdown", label: "Dall'alto: morbida in tutte le direzioni" },
        { value: "locked", label: "Bloccata sull'oggetto" },
      ],
    },
    deadzoneW: { type: "number", label: "Zona morta (larghezza)", unit: "tile", default: 2, min: 0, step: 0.5 },
    deadzoneH: { type: "number", label: "Zona morta (altezza)", unit: "tile", default: 3, min: 0, step: 0.5 },
    lookahead: { type: "number", label: "Anticipo", unit: "tile", default: 2, min: 0, step: 0.5 },
    smoothing: { type: "number", label: "Rapidità", unit: "1/s", default: 6, min: 0, step: 0.5, help: "0 = segue di scatto." },
    offsetY: { type: "number", label: "Spostamento verticale", unit: "tile", default: -1, step: 0.5 },
    clamp: { type: "boolean", label: "Resta dentro la scena", default: true },
    zoom: { type: "number", label: "Zoom", unit: "×", default: 1, min: 0.25, max: 4, step: 0.25 },
  },
  actions: {
    shake: {
      label: "Scuoti lo schermo",
      params: {
        intensity: { type: "number", label: "Intensità", unit: "px", default: 3, min: 0 },
        duration: { type: "number", label: "Durata", unit: "s", default: 0.25, min: 0, step: 0.05 },
      },
      run: (self, intensity = 3, duration = 0.25) => self.scene.camera.shake(Number(intensity), Number(duration)),
    },
  },
  init(self) {
    const cam = self.scene.camera;
    cam.zoom = self.props.zoom;
    const t = targetOf(self);
    cam.x = t.x;
    cam.y = t.y;
    self.data.look = 0;
    if (self.props.clamp) cam.clampTo(self.scene.widthPx, self.scene.heightPx);
  },
  late(self, dt) {
    const cam = self.scene.camera;
    const p = self.props;
    const ts = self.scene.tileSize;
    let { x: tx, y: ty } = targetOf(self);
    if (p.mode === "locked") {
      cam.x = tx;
      cam.y = ty;
    } else {
      if (p.mode === "platform") {
        self.data.look = damp(self.data.look, self.entity.facingX * p.lookahead * ts, 3, dt);
        tx += self.data.look;
      }
      const hw = (p.deadzoneW * ts) / 2;
      const hh = (p.deadzoneH * ts) / 2;
      let gx = cam.x;
      let gy = cam.y;
      if (tx > gx + hw) gx = tx - hw;
      else if (tx < gx - hw) gx = tx + hw;
      if (ty > gy + hh) gy = ty - hh;
      else if (ty < gy - hh) gy = ty + hh;
      cam.x = damp(cam.x, gx, p.smoothing, dt);
      cam.y = damp(cam.y, gy, p.smoothing, dt);
    }
    if (p.clamp) cam.clampTo(self.scene.widthPx, self.scene.heightPx);
  },
});

import { defineBlock, type BlockInstance } from "../core/block";
import { damp } from "../math";

function targetOf(self: BlockInstance) {
  const e = self.entity;
  return { x: e.worldX, y: e.worldY + self.props.offsetY * self.scene.tileSize };
}

/** Stanza grande quanto lo schermo in cui si trova l'oggetto (camera «A stanze»). */
function roomOf(self: BlockInstance) {
  const cam = self.scene.camera;
  const w = cam.halfW * 2;
  const h = cam.halfH * 2;
  const e = self.entity;
  const rx = Math.floor(e.worldX / w);
  const ry = Math.floor((e.worldY - 1) / h);
  return { rx, ry, x: rx * w + w / 2, y: ry * h + h / 2 };
}

/** Il giocatore non esce dai bordi dello schermo (beat 'em up con la camera bloccata). */
function keepInView(self: BlockInstance) {
  if (!self.props.keepInView) return;
  const cam = self.scene.camera;
  const e = self.entity;
  const b = e.body;
  const half = b ? b.w / 2 : 4;
  const left = cam.x - cam.halfW + half;
  const right = cam.x + cam.halfW - half;
  if (e.worldX < left) {
    e.x += left - e.worldX;
    if (b && b.vx < 0) b.vx = 0;
  } else if (e.worldX > right) {
    e.x += right - e.worldX;
    if (b && b.vx > 0) b.vx = 0;
  }
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
        { value: "beatemup", label: "Beat 'em up: scorre solo in orizzontale" },
        { value: "rooms", label: "A stanze: passa da uno schermo all'altro" },
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
    noBacktrack: {
      type: "boolean",
      label: "Non torna indietro",
      default: false,
      help: "La camera avanza solo verso destra: tipico dei beat 'em up e dei runner.",
    },
    keepInView: {
      type: "boolean",
      label: "L'oggetto non esce dallo schermo",
      default: false,
      help: "Utile nei beat 'em up: con la camera bloccata il giocatore resta nell'arena.",
    },
  },
  events: [{ id: "roomChanged", label: "Entra in un'altra stanza (camera a stanze)" }],
  conditions: {
    isLocked: { label: "La camera è bloccata", test: (self) => !!self.data.locked },
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
    lock: { label: "Blocca la camera dov'è", run: (self) => (self.data.locked = true) },
    unlock: { label: "Sblocca la camera", run: (self) => (self.data.locked = false) },
  },
  init(self) {
    const cam = self.scene.camera;
    const p = self.props;
    cam.zoom = p.zoom;
    const t = targetOf(self);
    cam.x = t.x;
    cam.y = t.y;
    self.data.look = 0;
    self.data.locked = false;
    if (p.mode === "rooms") {
      const r = roomOf(self);
      cam.x = r.x;
      cam.y = r.y;
      self.data.room = `${r.rx},${r.ry}`;
    }
    if (p.clamp) cam.clampTo(self.scene.widthPx, self.scene.heightPx);
    self.data.maxX = cam.x;
  },
  late(self, dt) {
    const cam = self.scene.camera;
    const p = self.props;
    const d = self.data;
    const ts = self.scene.tileSize;
    if (d.locked) {
      keepInView(self);
      return;
    }
    let { x: tx, y: ty } = targetOf(self);
    if (p.mode === "locked") {
      cam.x = tx;
      cam.y = ty;
    } else if (p.mode === "rooms") {
      const r = roomOf(self);
      const key = `${r.rx},${r.ry}`;
      if (key !== d.room) {
        d.room = key;
        self.emit("roomChanged", { x: r.rx, y: r.ry });
      }
      cam.x = damp(cam.x, r.x, p.smoothing, dt);
      cam.y = damp(cam.y, r.y, p.smoothing, dt);
    } else {
      if (p.mode === "platform") {
        d.look = damp(d.look, self.entity.facingX * p.lookahead * ts, 3, dt);
        tx += d.look;
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
      // Nei beat 'em up la strada resta sempre alla stessa altezza sullo schermo.
      if (p.mode !== "beatemup") cam.y = damp(cam.y, gy, p.smoothing, dt);
    }
    if (p.clamp) cam.clampTo(self.scene.widthPx, self.scene.heightPx);
    if (p.noBacktrack) {
      cam.x = Math.max(cam.x, d.maxX);
      d.maxX = cam.x;
    }
    keepInView(self);
  },
});

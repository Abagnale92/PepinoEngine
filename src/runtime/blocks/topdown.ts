import { defineBlock } from "../core/block";
import { approach } from "../math";
import { INPUT_SOURCE_OPTIONS } from "./platform";

defineBlock({
  name: "TopDownController",
  label: "Controller Top-down",
  category: "Movimento",
  description: "Movimento visto dall'alto in 4 o 8 direzioni, senza gravità (stile Zelda o RPG).",
  requires: ["Body"],
  priority: 20,
  props: {
    input: { type: "select", label: "Comandato da", default: "player", options: INPUT_SOURCE_OPTIONS },
    directions: {
      type: "select",
      label: "Direzioni",
      default: "8",
      options: [
        { value: "8", label: "8 direzioni" },
        { value: "4", label: "4 direzioni" },
      ],
    },
    speed: { type: "number", label: "Velocità", unit: "tile/s", default: 5, min: 0, step: 0.5 },
    accelTime: { type: "number", label: "Tempo per partire", unit: "s", default: 0.05, min: 0, step: 0.01 },
    decelTime: { type: "number", label: "Tempo per fermarsi", unit: "s", default: 0.05, min: 0, step: 0.01 },
  },
  states: [
    { id: "idle", label: "Fermo" },
    { id: "walk", label: "Cammina" },
  ],
  conditions: {
    isMoving: { label: "Si sta muovendo", test: (self) => !!self.body && Math.hypot(self.body.vx, self.body.vy) > 4 },
  },
  actions: {
    stop: {
      label: "Fermati",
      run: (self) => {
        if (self.body) self.body.vx = self.body.vy = 0;
      },
    },
  },
  init(self) {
    self.data.lastAxis = "x";
    self.data.prevX = 0;
    self.data.prevY = 0;
  },
  update(self, dt) {
    const b = self.body;
    if (!b) return;
    const e = self.entity;
    const p = self.props;
    const d = self.data;
    if (p.input === "player") self.game.input.readIntent(e.intent);
    // Durante il contraccolpo il corpo scivola con la sua velocità, senza comandi.
    if (e.stunned > 0) {
      e.stunned -= dt;
      return;
    }
    const it = e.intent;

    let x = it.x;
    let y = it.y;
    if (x !== 0 && d.prevX === 0) d.lastAxis = "x";
    if (y !== 0 && d.prevY === 0) d.lastAxis = "y";
    d.prevX = x;
    d.prevY = y;
    if (p.directions === "4" && x !== 0 && y !== 0) {
      if (d.lastAxis === "x") y = 0;
      else x = 0;
    }
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }

    const speed = p.speed * self.scene.tileSize;
    const acc = speed / Math.max(p.accelTime, 1e-3);
    const dec = speed / Math.max(p.decelTime, 1e-3);
    const tx = x * speed;
    const ty = y * speed;
    b.vx = approach(b.vx, tx, (tx !== 0 ? acc : dec) * dt);
    b.vy = approach(b.vy, ty, (ty !== 0 ? acc : dec) * dt);

    if (x !== 0 || y !== 0) {
      e.direction = Math.abs(x) >= Math.abs(y) ? (x > 0 ? "right" : "left") : y > 0 ? "down" : "up";
      if (x !== 0) e.facingX = x > 0 ? 1 : -1;
    }
    self.state = Math.hypot(b.vx, b.vy) > 4 ? "walk" : "idle";
  },
});

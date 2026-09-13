import { defineBlock, type BlockInstance } from "../core/block";
import { hexColor } from "../math";
import { findPath, lineOfSight, type Cell } from "../world/pathfinding";
import { bodyCenter, nearestTagged } from "./targets";

function lose(self: BlockInstance) {
  self.data.chasing = false;
  self.data.path = null;
  self.entity.intent.x = self.entity.intent.y = 0;
  self.emit("lost");
}

defineBlock({
  name: "Chaser",
  label: "Insegue",
  category: "IA",
  description:
    "Quando vede il bersaglio lo insegue: in orizzontale (saltando gli ostacoli) nei platform, trovando la strada tra i muri nel top-down. Imposta il controller su «IA o Regole»; con la Pattuglia, quando lo perde torna a pattugliare.",
  requires: ["Body"],
  priority: 12,
  props: {
    target: { type: "tag", label: "Insegue chi ha l'etichetta", default: "giocatore" },
    seeRange: { type: "number", label: "Lo vede fino a", unit: "tile", default: 5, min: 0, step: 0.5 },
    loseRange: { type: "number", label: "Lo perde oltre", unit: "tile", default: 8, min: 0, step: 0.5 },
    lineOfSight: { type: "boolean", label: "I muri bloccano la vista", default: true },
    giveUp: { type: "number", label: "Si arrende se non lo vede per", unit: "s", default: 1.5, min: 0, step: 0.1 },
    stopDistance: { type: "number", label: "Si ferma a", unit: "tile", default: 0.5, min: 0, step: 0.25 },
    jump: { type: "boolean", label: "Salta gli ostacoli (platform)", default: true },
  },
  events: [
    { id: "spotted", label: "Ha visto il bersaglio" },
    { id: "lost", label: "Ha perso il bersaglio" },
  ],
  conditions: {
    isChasing: { label: "Sta inseguendo", test: (self) => !!self.data.chasing },
  },
  init(self) {
    self.data.chasing = false;
    self.data.unseen = 0;
    self.data.path = null;
    self.data.repath = 0;
  },
  update(self, dt) {
    const e = self.entity;
    const b = e.body;
    if (!b) return;
    const p = self.props;
    const d = self.data;
    const ts = self.scene.tileSize;
    const grid = self.scene.grid;
    const it = e.intent;
    it.jump = it.jumpPressed = false;

    const target = nearestTagged(self.scene, e, p.target, p.loseRange * ts);
    const from = bodyCenter(e);
    const to = target ? bodyCenter(target) : null;
    const dist = to ? Math.hypot(to.x - from.x, to.y - from.y) : Infinity;
    const sees = !!to && (!p.lineOfSight || lineOfSight(grid, from.x, from.y, to.x, to.y));

    if (!d.chasing) {
      if (!to || dist > p.seeRange * ts || !sees) return;
      d.chasing = true;
      d.unseen = 0;
      d.repath = 0;
      self.emit("spotted", target);
    }
    if (!to || dist > p.loseRange * ts) return lose(self);
    d.unseen = sees ? 0 : d.unseen + dt;
    if (d.unseen > p.giveUp) return lose(self);

    const stop = p.stopDistance * ts;
    const topdown = e.get("TopDownController");
    if (!topdown) {
      // Platform: avanti o indietro verso il bersaglio, salto se c'è un muro o se sta più in alto.
      const dx = to.x - from.x;
      it.x = Math.abs(dx) > Math.max(2, stop) ? Math.sign(dx) : 0;
      it.y = 0;
      if (p.jump && b.onGround) {
        const wall = (dx > 0 && b.onWallRight) || (dx < 0 && b.onWallLeft);
        const above = from.y - to.y > ts * 1.5 && Math.abs(dx) < ts * 3;
        if (wall || above) it.jump = it.jumpPressed = true;
      }
      return;
    }

    // Top-down: A* sulla griglia, ricalcolato ogni tanto.
    d.repath -= dt;
    if (d.repath <= 0 || !d.path) {
      d.repath = 0.4;
      d.path = findPath(grid, Math.floor(from.x / ts), Math.floor(from.y / ts), Math.floor(to.x / ts), Math.floor(to.y / ts), {
        diagonal: topdown.props.directions === "8",
      });
    }
    let wx = to.x;
    let wy = to.y;
    const path = d.path as Cell[] | null;
    if (path && path.length > 1) {
      while (path.length > 1 && Math.hypot((path[0].x + 0.5) * ts - from.x, (path[0].y + 0.5) * ts - from.y) < ts * 0.3) path.shift();
      wx = (path[0].x + 0.5) * ts;
      wy = (path[0].y + 0.5) * ts;
    }
    const vx = wx - from.x;
    const vy = wy - from.y;
    const len = Math.hypot(vx, vy);
    if (dist <= stop || len < 1) {
      it.x = it.y = 0;
    } else {
      it.x = vx / len;
      it.y = vy / len;
    }
  },
  renderDebug(self, r) {
    const path = self.data.path as Cell[] | null;
    if (!self.data.chasing || !path) return;
    const ts = self.scene.tileSize;
    const color = hexColor("#ffb14a", 0.35);
    for (const c of path) r.rect(c.x * ts + 4, c.y * ts + 4, ts - 8, ts - 8, color);
  },
});

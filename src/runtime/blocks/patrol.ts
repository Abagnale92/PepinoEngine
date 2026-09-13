import { defineBlock } from "../core/block";
import { COLL } from "../physics/collision";

defineBlock({
  name: "Patrol",
  label: "Pattuglia",
  category: "IA",
  description:
    "Va avanti e indietro, girandosi contro i muri e sul bordo delle piattaforme. Imposta il controller su \"IA o Regole\".",
  requires: ["Body"],
  priority: 10,
  props: {
    axis: {
      type: "select",
      label: "Direzione",
      default: "horizontal",
      options: [
        { value: "horizontal", label: "Orizzontale" },
        { value: "vertical", label: "Verticale (top-down)" },
      ],
    },
    start: {
      type: "select",
      label: "Parte verso",
      default: "left",
      options: [
        { value: "left", label: "Sinistra / su" },
        { value: "right", label: "Destra / giù" },
      ],
    },
    turnAtEdges: { type: "boolean", label: "Si gira sul bordo", default: true },
    pause: { type: "number", label: "Pausa quando si gira", unit: "s", default: 0.3, min: 0, step: 0.1 },
  },
  events: [{ id: "turned", label: "Si è girato" }],
  init(self) {
    self.data.dir = self.props.start === "left" ? -1 : 1;
    self.data.wait = 0;
  },
  update(self, dt) {
    const e = self.entity;
    const b = e.body;
    if (!b) return;
    const d = self.data;
    const it = e.intent;
    it.x = it.y = 0;
    if (d.wait > 0) {
      d.wait -= dt;
      return;
    }
    const turn = () => {
      d.dir = -d.dir;
      d.wait = self.props.pause;
      self.emit("turned");
    };
    if (self.props.axis === "horizontal") {
      if ((d.dir < 0 && b.onWallLeft) || (d.dir > 0 && b.onWallRight)) return turn();
      if (self.props.turnAtEdges && b.onGround) {
        const probeX = d.dir > 0 ? b.right + 1 : b.left - 1;
        const code = self.scene.grid.atPixel(probeX, b.bottom + 1);
        if (code !== COLL.solid && code !== COLL.oneway) return turn();
      }
      it.x = d.dir;
    } else {
      if ((d.dir < 0 && b.onCeiling) || (d.dir > 0 && b.onGround)) return turn();
      it.y = d.dir;
    }
  },
});

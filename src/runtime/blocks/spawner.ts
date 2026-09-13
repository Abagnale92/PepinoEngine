import { defineBlock, type BlockInstance } from "../core/block";
import type { Entity } from "../core/entity";
import { nearestTagged } from "./targets";

function spawnOne(self: BlockInstance): Entity | undefined {
  const p = self.props;
  if (!p.prefab) {
    if (!self.data.warned) self.game.log(`"${self.entity.name}": scegli il modello da generare`, "warn");
    self.data.warned = true;
    return undefined;
  }
  const ts = self.scene.tileSize;
  const e = self.scene.spawn(p.prefab, self.entity.worldX + p.offsetX * ts, self.entity.worldY + p.offsetY * ts);
  if (!e) return undefined;
  self.data.alive.push(e);
  self.data.total++;
  self.emit("spawned", e);
  return e;
}

defineBlock({
  name: "Spawner",
  label: "Generatore",
  category: "Gameplay",
  description: "Crea oggetti da un modello a intervalli regolari (nemici, oggetti che cadono…), senza superare un massimo.",
  priority: 60,
  props: {
    prefab: { type: "prefab", label: "Modello da creare", default: "" },
    interval: { type: "number", label: "Ogni", unit: "s", default: 4, min: 0.05, step: 0.5 },
    startDelay: { type: "number", label: "Il primo dopo", unit: "s", default: 1, min: 0, step: 0.5 },
    max: { type: "integer", label: "Massimo presenti insieme", default: 3, min: 1 },
    limit: { type: "integer", label: "Totale da creare", default: 0, min: 0, help: "0 = senza fine." },
    onlyNear: { type: "boolean", label: "Solo se il bersaglio è vicino", default: false },
    target: { type: "tag", label: "Bersaglio", default: "giocatore" },
    range: { type: "number", label: "Distanza", unit: "tile", default: 10, min: 0 },
    offsetX: { type: "number", label: "Spostamento X", unit: "tile", default: 0, step: 0.5 },
    offsetY: { type: "number", label: "Spostamento Y", unit: "tile", default: 0, step: 0.5 },
  },
  events: [{ id: "spawned", label: "Ha creato un oggetto" }],
  actions: { spawnNow: { label: "Crea ora", run: (self) => void spawnOne(self) } },
  init(self) {
    self.data.timer = self.props.startDelay;
    self.data.alive = [] as Entity[];
    self.data.total = 0;
  },
  update(self, dt) {
    const p = self.props;
    const d = self.data;
    d.alive = (d.alive as Entity[]).filter((e) => !e.destroyed);
    d.timer -= dt;
    if (d.timer > 1e-6) return;
    d.timer = p.interval;
    if (d.alive.length >= p.max) return;
    if (p.limit > 0 && d.total >= p.limit) return;
    if (p.onlyNear && !nearestTagged(self.scene, self.entity, p.target, p.range * self.scene.tileSize)) return;
    spawnOne(self);
  },
});

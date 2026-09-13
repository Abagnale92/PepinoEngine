import { defineBlock } from "../core/block";
import { BodyState } from "../physics/body";

defineBlock({
  name: "Body",
  label: "Corpo",
  category: "Fisica",
  description:
    "Dà all'oggetto una forma di collisione: si ferma contro i tile solidi e sente il contatto con gli oggetti dei gruppi scelti.",
  priority: 0,
  props: {
    width: { type: "number", label: "Larghezza", unit: "px", default: 12, min: 1 },
    height: { type: "number", label: "Altezza", unit: "px", default: 16, min: 1 },
    offsetX: { type: "number", label: "Spostamento X", unit: "px", default: 0 },
    offsetY: { type: "number", label: "Spostamento Y", unit: "px", default: 0 },
    group: { type: "group", label: "Gruppo", default: "giocatore" },
    collidesWith: {
      type: "groups",
      label: "Interagisce con",
      default: [],
      help: "Gruppi di oggetti di cui questo corpo sente il contatto.",
    },
    world: { type: "boolean", label: "Si ferma contro i muri", default: true },
  },
  conditions: {
    isOnGround: { label: "È a terra", test: (self) => !!self.body?.onGround },
    isOnWall: { label: "Tocca un muro", test: (self) => !!self.body && (self.body.onWallLeft || self.body.onWallRight) },
    touches: {
      label: "Tocca un oggetto con etichetta",
      params: { tag: { type: "tag", label: "Etichetta", default: "nemico" } },
      test: (self, tag: string) => !!self.body?.touched(tag),
    },
  },
  events: [
    { id: "contact", label: "Inizia a toccare un oggetto" },
    { id: "contactEnd", label: "Smette di toccare un oggetto" },
    { id: "outOfBounds", label: "È caduto fuori dalla scena" },
  ],
  init(self) {
    const p = self.props;
    const origin = (self.entity.get("Sprite")?.props.origin as string | undefined) ?? "bottom";
    let ox = -p.width / 2;
    let oy = -p.height;
    if (origin === "center") oy = -p.height / 2;
    else if (origin === "topleft") ox = oy = 0;
    self.entity.body = new BodyState(
      self.entity,
      p.width,
      p.height,
      ox + p.offsetX,
      oy + p.offsetY,
      p.group,
      new Set<string>(p.collidesWith ?? []),
      p.world,
    );
  },
  physics(self, dt) {
    self.entity.body?.step(dt, self.scene.grid);
  },
  destroy(self) {
    self.entity.body = undefined;
  },
});

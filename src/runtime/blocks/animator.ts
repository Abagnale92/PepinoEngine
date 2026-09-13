import { defineBlock } from "../core/block";

defineBlock({
  name: "Animator",
  label: "Animazioni per stato",
  category: "Grafica",
  description:
    "Collega ogni stato (fermo, corsa, salto…) a un'animazione dello sprite. Se l'animazione ha lo stesso nome dello stato, si collega da sola.",
  requires: ["Sprite"],
  priority: 95,
  props: {
    map: { type: "stateMap", label: "Animazioni", default: {} },
    speed: { type: "number", label: "Velocità", unit: "×", default: 1, min: 0, step: 0.1 },
  },
  events: [{ id: "animationEnd", label: "Un'animazione è finita" }],
  actions: {
    play: {
      label: "Riproduci animazione",
      params: { name: { type: "string", label: "Animazione", default: "" } },
      run: (self, name: string) => {
        self.data.forced = name;
        self.data.current = "";
      },
    },
  },
  init(self) {
    self.data.current = "";
    self.data.time = 0;
    self.data.forced = "";
  },
  late(self, dt) {
    const e = self.entity;
    const s = e.sprite;
    if (!s) return;
    const anims = self.game.assets.image(s.image)?.data.animations;
    if (!anims) return;
    if (self.data.forced && !anims[self.data.forced]) {
      self.game.log(`"${self.entity.name}": l'animazione "${self.data.forced}" non esiste`, "warn");
      self.data.forced = "";
    }
    const map = (self.props.map ?? {}) as Record<string, string>;
    const pick = (state: string) => map[state] || (anims[state] ? state : "");
    let name = self.data.forced || pick(e.state) || pick("idle");
    // Varianti per direzione (top-down): walk_up, walk_down, walk_side…
    const dir = e.direction;
    if (anims[`${name}_${dir}`]) name = `${name}_${dir}`;
    else if ((dir === "left" || dir === "right") && anims[`${name}_side`]) name = `${name}_side`;
    const anim = anims[name];
    if (!anim || anim.frames.length === 0) return;
    if (name !== self.data.current) {
      self.data.current = name;
      self.data.time = 0;
      self.data.ended = false;
    }
    self.data.time += dt * self.props.speed;
    const total = anim.frames.length;
    let idx = Math.floor(self.data.time * anim.fps);
    if (idx >= total) {
      if (anim.loop) idx %= total;
      else {
        idx = total - 1;
        if (!self.data.ended) {
          self.data.ended = true;
          self.data.forced = "";
          self.emit("animationEnd", name);
        }
      }
    }
    s.frame = anim.frames[idx];
  },
});

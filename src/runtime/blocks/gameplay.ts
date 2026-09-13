import { defineBlock } from "../core/block";

defineBlock({
  name: "ContactDamage",
  label: "Danno al contatto",
  category: "Combattimento",
  description: "Ferisce chi lo tocca. Se si può schiacciare, chi ci salta sopra lo colpisce invece di farsi male.",
  requires: ["Body"],
  priority: 40,
  props: {
    target: { type: "tag", label: "Colpisce chi ha l'etichetta", default: "giocatore" },
    amount: { type: "integer", label: "Danno", default: 1, min: 0 },
    stompable: { type: "boolean", label: "Si può schiacciare saltandoci sopra", default: true },
    bounce: { type: "number", label: "Rimbalzo dopo la schiacciata", unit: "tile/s", default: 10, min: 0 },
    stompSound: { type: "audio", label: "Suono schiacciata", default: "" },
  },
  events: [{ id: "stomped", label: "È stato schiacciato" }],
  init(self) {
    self.data.stompedBy = new Set();
  },
  update(self) {
    const b = self.body;
    if (!b) return;
    const p = self.props;
    const stomped: Set<unknown> = self.data.stompedBy;
    for (const [other, side] of b.contacts) {
      if (other.destroyed || !other.hasTag(p.target)) continue;
      if (p.stompable && side === "top") {
        if (stomped.has(other)) continue;
        stomped.add(other);
        if (other.body) other.body.vy = -p.bounce * self.scene.tileSize;
        if (p.stompSound) self.game.audio.play(p.stompSound);
        self.emit("stomped", other);
        const hp = self.entity.get("Health");
        if (hp) hp.actions.damage(1, { x: other.worldX, y: other.worldY });
        else self.entity.destroy();
      } else if (!stomped.has(other)) {
        other.get("Health")?.actions.damage(p.amount, { x: self.entity.worldX, y: self.entity.worldY });
      }
    }
    for (const o of [...stomped]) if (!b.contacts.has(o as never)) stomped.delete(o);
  },
});

defineBlock({
  name: "Collectible",
  label: "Raccoglibile",
  category: "Gameplay",
  description: "Sparisce quando lo tocca il giocatore e aggiunge un valore a una variabile (monete, punti, chiavi…).",
  requires: ["Body"],
  priority: 40,
  props: {
    target: { type: "tag", label: "Raccolto da", default: "giocatore" },
    variable: { type: "variable", label: "Variabile", default: "monete" },
    amount: { type: "integer", label: "Quantità", default: 1 },
    sound: { type: "audio", label: "Suono", default: "" },
    bob: { type: "boolean", label: "Fluttua", default: true },
  },
  events: [{ id: "collected", label: "È stato raccolto" }],
  init(self) {
    self.data.t = self.entity.worldX * 0.1;
    self.data.baseY = self.entity.sprite?.offsetY ?? 0;
  },
  update(self, dt) {
    const s = self.entity.sprite;
    if (self.props.bob && s) {
      self.data.t += dt;
      s.offsetY = self.data.baseY + Math.round(Math.sin(self.data.t * 4) * 1.5);
    }
    const b = self.body;
    if (!b || self.data.taken || !b.touched(self.props.target)) return;
    self.data.taken = true;
    const v = self.props.variable;
    if (v) self.game.vars[v] = Number(self.game.vars[v] ?? 0) + self.props.amount;
    if (self.props.sound) self.game.audio.play(self.props.sound);
    self.emit("collected");
    self.entity.destroy();
  },
});

defineBlock({
  name: "SceneExit",
  label: "Uscita verso scena",
  category: "Gameplay",
  description: "Quando il giocatore la tocca, porta a un'altra scena con una dissolvenza.",
  requires: ["Body"],
  priority: 40,
  props: {
    scene: { type: "scene", label: "Scena di destinazione", default: "" },
    target: { type: "tag", label: "Attivata da", default: "giocatore" },
    needsAction: { type: "boolean", label: "Serve premere Azione", default: false },
    fade: { type: "number", label: "Dissolvenza", unit: "s", default: 0.4, min: 0, step: 0.05 },
  },
  update(self) {
    const b = self.body;
    if (!b || self.data.used || !b.touched(self.props.target)) return;
    if (self.props.needsAction && !self.game.input.pressed("action")) return;
    if (!self.props.scene) {
      self.game.log(`"${self.entity.name}": scegli la scena di destinazione nell'Inspector`, "warn");
      self.data.used = true;
      return;
    }
    self.data.used = true;
    self.game.goToScene(self.props.scene, self.props.fade);
  },
});

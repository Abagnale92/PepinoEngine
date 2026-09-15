import { defineBlock, type BlockInstance } from "../core/block";
import type { Entity } from "../core/entity";
import { hexColor } from "../math";
import { screenPos } from "./text";
import { nearestTagged } from "./targets";

function talk(self: BlockInstance, who?: Entity) {
  const p = self.props;
  const e = self.entity;
  if (!p.dialogue) {
    if (!self.data.warned) self.game.log(`"${e.name}": scegli il dialogo nel blocco Personaggio che parla`, "warn");
    self.data.warned = true;
    return;
  }
  if (p.face && who) {
    const dx = who.worldX - e.worldX;
    const dy = who.worldY - e.worldY;
    e.facingX = dx < 0 ? -1 : 1;
    e.direction = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";
  }
  if (self.game.startDialogue(p.dialogue, e)) self.emit("talkStart", who);
}

defineBlock({
  name: "Talker",
  label: "Personaggio che parla",
  category: "Personaggi",
  description: "Quando il giocatore è vicino e preme Azione parte un dialogo. Sopra la testa compare un fumetto per suggerirlo.",
  priority: 50,
  props: {
    dialogue: { type: "dialogue", label: "Dialogo", default: "" },
    range: { type: "number", label: "Distanza per parlare", unit: "tile", default: 1.5, min: 0.25, step: 0.25 },
    target: { type: "tag", label: "Chi può parlargli", default: "giocatore" },
    command: { type: "input", label: "Comando", default: "action" },
    prompt: { type: "string", label: "Fumetto", default: "C", translatable: true, help: "Testo sopra la testa quando il giocatore è vicino. Vuoto = nessun fumetto." },
    face: { type: "boolean", label: "Si gira verso chi gli parla", default: true },
  },
  events: [
    { id: "talkStart", label: "Inizia a parlare" },
    { id: "dialogueEnd", label: "Il dialogo è finito" },
  ],
  conditions: { isNear: { label: "Il giocatore è vicino", test: (self) => !!self.data.near } },
  actions: { talk: { label: "Parla", run: (self) => talk(self, self.data.near) } },
  update(self) {
    const p = self.props;
    const who = nearestTagged(self.scene, self.entity, p.target, p.range * self.scene.tileSize);
    self.data.near = who;
    if (who && self.game.input.pressed(p.command) && !self.game.isBlocked) talk(self, who);
  },
  renderScreen(self, r) {
    const p = self.props;
    if (!self.data.near || !p.prompt || self.game.dialogue?.active) return;
    const { x, y } = screenPos(self, false);
    const s = self.entity.sprite;
    const h = (s && self.game.assets.image(s.image)?.fh) || 16;
    const w = Math.max(10, r.measureText(p.prompt, { size: 7 }) + 6);
    const top = y - h - 13;
    const bubble = hexColor("#fbfbf0");
    r.rect(x - w / 2, top, w, 10, bubble);
    r.rect(x - 1, top + 10, 2, 2, bubble);
    r.text(self.game.t(p.prompt), x, top + 1, { size: 7, align: "center", color: "#1d3b1f" });
  },
});

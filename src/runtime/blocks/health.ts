import { defineBlock, type BlockInstance } from "../core/block";

export interface DamageSource {
  x: number;
  y: number;
}

function syncVar(self: BlockInstance) {
  if (self.props.variable) self.game.vars[self.props.variable] = self.data.hp;
}

function damage(self: BlockInstance, amount: number, from?: DamageSource, force = false) {
  const d = self.data;
  if (d.dead || amount <= 0 || (!force && d.invuln > 0)) return;
  const e = self.entity;
  d.hp = Math.max(0, d.hp - amount);
  d.invuln = self.props.invulnerability;
  syncVar(self);
  if (e.sprite) e.sprite.flash = 1;
  if (self.props.hurtSound) self.game.audio.play(self.props.hurtSound);

  const b = e.body;
  const kb = self.props.knockback * self.scene.tileSize;
  if (b && kb > 0) {
    const platform = e.has("PlatformController");
    let dx = from ? e.worldX - from.x : -e.facingX;
    let dy = from && !platform ? e.worldY - from.y : 0;
    if (platform) {
      b.vx = (dx >= 0 ? 1 : -1) * kb;
      b.vy = -kb * 0.6;
    } else {
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      b.vx = dx * kb;
      b.vy = dy * kb;
    }
    e.stunned = 0.18;
  }
  self.emit("hurt", { amount });

  if (d.hp <= 0) {
    d.dead = true;
    self.emit("died");
    if (self.props.onDeath === "destroy") e.destroy();
    else if (self.props.onDeath === "restart") self.game.restartScene(0.5);
  }
}

defineBlock({
  name: "Health",
  label: "Salute",
  category: "Combattimento",
  description: "Punti vita, danno, contraccolpo e invulnerabilità dopo un colpo. Danneggia anche nei tile pericolo.",
  priority: 30,
  props: {
    max: { type: "integer", label: "Vita massima", default: 3, min: 1 },
    variable: {
      type: "variable",
      label: "Mostra nella variabile",
      default: "",
      help: 'Es. "vita": nell\'HUD scrivi {vita} per mostrarla.',
    },
    invulnerability: { type: "number", label: "Invulnerabile dopo un colpo", unit: "s", default: 1, min: 0, step: 0.1 },
    knockback: { type: "number", label: "Contraccolpo", unit: "tile/s", default: 8, min: 0 },
    hazardDamage: { type: "integer", label: "Danno dai tile pericolo", default: 1, min: 0 },
    hurtSound: { type: "audio", label: "Suono quando è colpito", default: "" },
    onDeath: {
      type: "select",
      label: "Quando la vita finisce",
      default: "destroy",
      options: [
        { value: "destroy", label: "Distruggi l'oggetto" },
        { value: "restart", label: "Riavvia la scena" },
        { value: "none", label: "Niente (gestisci con le Regole)" },
      ],
    },
  },
  events: [
    { id: "hurt", label: "È stato colpito" },
    { id: "died", label: "È morto" },
    { id: "healed", label: "È stato curato" },
  ],
  conditions: {
    isDead: { label: "È morto", test: (self) => !!self.data.dead },
    isInvulnerable: { label: "È invulnerabile", test: (self) => self.data.invuln > 0 },
  },
  actions: {
    damage: {
      label: "Infliggi danno",
      params: { amount: { type: "integer", label: "Danno", default: 1, min: 0 } },
      run: (self, amount = 1, from?: DamageSource) => damage(self, Number(amount), from),
    },
    heal: {
      label: "Cura",
      params: { amount: { type: "integer", label: "Vita recuperata", default: 1, min: 0 } },
      run: (self, amount = 1) => {
        amount = Number(amount);
        if (self.data.dead) return;
        self.data.hp = Math.min(self.props.max, self.data.hp + amount);
        syncVar(self);
        self.emit("healed", { amount });
      },
    },
    kill: { label: "Uccidi", run: (self) => damage(self, self.data.hp, undefined, true) },
  },
  init(self) {
    self.data.hp = self.props.max;
    self.data.invuln = 0;
    self.data.dead = false;
    self.data.baseOpacity = self.entity.sprite?.opacity ?? 1;
    syncVar(self);
    self.listen("outOfBounds", () => damage(self, self.data.hp, undefined, true));
  },
  update(self, dt) {
    const d = self.data;
    const s = self.entity.sprite;
    if (d.invuln > 0) {
      d.invuln -= dt;
      const base = d.baseOpacity ?? 1;
      if (s) s.opacity = d.invuln > 0 && Math.floor(d.invuln * 16) % 2 === 0 ? base * 0.35 : base;
    }
    if (s && s.flash > 0) s.flash = Math.max(0, s.flash - dt * 8);
    if (self.body?.inHazard && self.props.hazardDamage > 0) damage(self, self.props.hazardDamage);
  },
});

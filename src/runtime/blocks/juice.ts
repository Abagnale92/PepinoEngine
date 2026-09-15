import { defineBlock, type BlockInstance } from "../core/block";
import { identityFx, type SpriteFX } from "../core/entity";
import type { Scene } from "../core/scene";
import { hexColor, parseColor } from "../math";
import { drawSpriteFrame, type Origin } from "../render/sprites";
import { drawRay } from "../render/shapes";

/**
 * Effetti animati in stile JuiceFX: invece di disegnare altri fotogrammi, lo sprite viene deformato
 * nel tempo (schiacciato, allungato, ruotato, inclinato, lampeggiante, tremante). Gli effetti "una volta"
 * partono da un evento (salto, atterraggio, colpo…); quelli continui girano sempre.
 */

export const ONE_SHOT_EFFECTS = [
  { value: "none", label: "Nessuno" },
  { value: "squash", label: "Schiacciata" },
  { value: "stretch", label: "Allungata" },
  { value: "flash", label: "Lampo" },
  { value: "hit", label: "Colpito (lampo e tremolio)" },
  { value: "shake", label: "Tremolio" },
  { value: "jelly", label: "Gelatina" },
  { value: "pop", label: "Appare con un rimbalzo" },
  { value: "vanish", label: "Scompare rimpicciolendo" },
  { value: "spin", label: "Giravolta" },
  { value: "hop", label: "Saltello" },
  { value: "lunge", label: "Scatto in avanti" },
  { value: "teleport", label: "Teletrasporto" },
];

export const LOOP_EFFECTS = [
  { value: "none", label: "Nessuno" },
  { value: "float", label: "Galleggia" },
  { value: "pulse", label: "Pulsa" },
  { value: "breathe", label: "Respira" },
  { value: "wobble", label: "Ondeggia come gelatina" },
  { value: "swing", label: "Dondola" },
  { value: "spin", label: "Gira su se stesso" },
  { value: "blink", label: "Lampeggia" },
];

/** Durata di ogni effetto, in secondi (a velocità 1). */
const DURATION: Record<string, number> = {
  squash: 0.22,
  stretch: 0.22,
  flash: 0.15,
  hit: 0.25,
  shake: 0.3,
  jelly: 0.55,
  pop: 0.35,
  vanish: 0.35,
  spin: 0.45,
  hop: 0.3,
  lunge: 0.16,
  teleport: 0.4,
};

export function hexToNumber(hex: string | undefined): number {
  const [r, g, b] = parseColor(hex);
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

export function resetFx(fx: SpriteFX): void {
  Object.assign(fx, identityFx());
}

const easeOutBack = (u: number) => 1 + 2.70158 * (u - 1) ** 3 + 1.70158 * (u - 1) ** 2;
const easeInBack = (u: number) => 2.70158 * u ** 3 - 1.70158 * u ** 2;

function flash(fx: SpriteFX, amount: number, color: number) {
  if (amount > fx.flash) {
    fx.flash = amount;
    fx.flashColor = color;
  }
}

/** Aggiunge l'effetto `kind` al punto `u` (0..1) della sua durata. `k` = intensità. */
export function applyEffect(fx: SpriteFX, kind: string, u: number, k: number, facing: number, flashColor: number): void {
  const f = (1 - u) * (1 - u);
  switch (kind) {
    case "squash":
      fx.sx *= 1 + 0.35 * k * f;
      fx.sy *= 1 - 0.3 * k * f;
      break;
    case "stretch":
      fx.sx *= 1 - 0.2 * k * f;
      fx.sy *= 1 + 0.3 * k * f;
      break;
    case "flash":
      flash(fx, 1 - u, flashColor);
      break;
    case "hit":
      flash(fx, 1 - u, flashColor);
      fx.dx += (Math.random() * 2 - 1) * 2.5 * k * (1 - u);
      fx.dy += (Math.random() * 2 - 1) * 1.2 * k * (1 - u);
      break;
    case "shake":
      fx.dx += (Math.random() * 2 - 1) * 3 * k * (1 - u);
      fx.dy += (Math.random() * 2 - 1) * 2 * k * (1 - u);
      break;
    case "jelly": {
      const w = Math.sin(u * Math.PI * 6) * (1 - u);
      fx.sx *= 1 + 0.22 * k * w;
      fx.sy *= 1 - 0.22 * k * w;
      break;
    }
    case "pop": {
      const s = Math.max(0, easeOutBack(u));
      fx.sx *= s;
      fx.sy *= s;
      fx.alpha *= Math.min(1, u * 3);
      break;
    }
    case "vanish": {
      const s = Math.max(0, 1 - easeInBack(u));
      fx.sx *= s;
      fx.sy *= s;
      fx.alpha *= 1 - u;
      fx.rot += u * Math.PI * 0.5 * facing;
      flash(fx, 0.6 * (1 - u), flashColor);
      break;
    }
    case "spin":
      fx.rot += Math.PI * 2 * (1 - (1 - u) ** 3) * facing;
      break;
    case "hop":
      fx.dy -= Math.sin(Math.PI * u) * 6 * k;
      break;
    case "lunge":
      fx.dx += facing * Math.sin(Math.PI * u) * 3 * k;
      break;
    case "teleport": {
      const s = Math.sin(Math.PI * u);
      fx.sx *= 1 - 0.85 * s;
      fx.sy *= 1 + 0.6 * s;
      flash(fx, s, flashColor);
      break;
    }
  }
}

/** Effetti continui: `time` in secondi, `speed` in giri al secondo. */
export function applyLoop(fx: SpriteFX, kind: string, time: number, speed: number, k: number): void {
  const w = time * speed * Math.PI * 2;
  const s = Math.sin(w);
  switch (kind) {
    case "float":
      fx.dy -= (s + 1) * 1.5 * k;
      break;
    case "pulse": {
      const m = 1 + 0.07 * k * s;
      fx.sx *= m;
      fx.sy *= m;
      break;
    }
    case "breathe":
      fx.sy *= 1 + 0.05 * k * s;
      fx.sx *= 1 - 0.03 * k * s;
      break;
    case "wobble":
      fx.skew += 0.12 * k * s;
      break;
    case "swing":
      fx.rot += 0.15 * k * s;
      break;
    case "spin":
      fx.rot += w;
      break;
    case "blink":
      fx.alpha *= 0.55 + 0.45 * (0.5 + 0.5 * Math.cos(w));
      break;
  }
}

/** Stellina d'impatto dove arriva un colpo: sei raggi che si allargano e spariscono. */
export function spawnImpact(scene: Scene, x: number, y: number, hex = "#ffffff", size = 9): void {
  let t = 0;
  const dur = 0.14;
  const rot = Math.random() * Math.PI;
  scene.effects.push({
    update: (dt) => (t += dt) < dur,
    render: (r) => {
      const u = Math.min(1, t / dur);
      const len = size * (0.45 + 0.55 * u);
      for (let i = 0; i < 6; i++) {
        const a = rot + (i * Math.PI) / 3;
        drawRay(r, x + Math.cos(a) * len * 0.35, y + Math.sin(a) * len * 0.35, a, len * 0.65, 2 * (1 - u) + 0.6, hex, 1 - u);
      }
    },
  });
}

interface Active {
  kind: string;
  t: number;
  dur: number;
}

interface Ghost {
  x: number;
  y: number;
  frame: number;
  flip: boolean;
  age: number;
}

const TRAIL_LIFE = 0.22;

function start(self: BlockInstance, kind: string | undefined): void {
  if (!kind || kind === "none" || !DURATION[kind]) return;
  const d = self.data;
  d.list = (d.list as Active[]).filter((a) => a.kind !== kind);
  d.list.push({ kind, t: 0, dur: DURATION[kind] / Math.max(0.1, self.props.speed) });
}

function spriteFlip(self: BlockInstance): boolean {
  const e = self.entity;
  const sb = e.get("Sprite");
  return sb?.props.flipWithFacing ? e.facingX < 0 : !!e.sprite?.flipX;
}

defineBlock({
  name: "SpriteFX",
  label: "Effetti animati",
  category: "Effetti",
  description:
    "Dà vita alle sprite senza disegnare altri fotogrammi, come JuiceFX: si schiaccia quando atterra, si allunga quando salta, lampeggia e trema quando è colpita, sparisce con stile. Ci sono anche effetti continui: galleggia, pulsa, ondeggia.",
  priority: -5,
  props: {
    idle: { type: "select", label: "Effetto continuo", default: "none", options: LOOP_EFFECTS, group: "Sempre" },
    idleStrength: { type: "number", label: "Intensità", default: 1, min: 0, max: 3, step: 0.1, group: "Sempre" },
    idleSpeed: { type: "number", label: "Velocità", unit: "giri/s", default: 1, min: 0, step: 0.1, group: "Sempre" },
    onJump: { type: "select", label: "Quando salta", default: "stretch", options: ONE_SHOT_EFFECTS, group: "Quando succede qualcosa" },
    onLand: { type: "select", label: "Quando atterra", default: "squash", options: ONE_SHOT_EFFECTS, group: "Quando succede qualcosa" },
    onHurt: { type: "select", label: "Quando è colpito", default: "hit", options: ONE_SHOT_EFFECTS, group: "Quando succede qualcosa" },
    onAttack: { type: "select", label: "Quando attacca", default: "none", options: ONE_SHOT_EFFECTS, group: "Quando succede qualcosa" },
    onAppear: { type: "select", label: "Quando appare", default: "none", options: ONE_SHOT_EFFECTS, group: "Quando succede qualcosa" },
    onDeath: { type: "select", label: "Quando sparisce", default: "vanish", options: ONE_SHOT_EFFECTS, group: "Quando succede qualcosa" },
    customEvent: {
      type: "string",
      label: "E quando l'oggetto…",
      default: "",
      optional: true,
      group: "Quando succede qualcosa",
      help: "Nome di un altro evento dell'oggetto (es. collected, spotted, dashed): scatta l'effetto qui sotto.",
    },
    customEffect: { type: "select", label: "…fa l'effetto", default: "none", options: ONE_SHOT_EFFECTS, group: "Quando succede qualcosa" },
    strength: { type: "number", label: "Intensità", default: 1, min: 0, max: 3, step: 0.1, group: "Aspetto" },
    speed: { type: "number", label: "Velocità", unit: "×", default: 1, min: 0.1, step: 0.1, group: "Aspetto" },
    flashColor: { type: "color", label: "Colore del lampo", default: "#ffffff", group: "Aspetto" },
    trail: {
      type: "boolean",
      label: "Scia di immagini fantasma",
      default: false,
      group: "Aspetto",
      help: "Copie trasparenti che seguono l'oggetto quando va veloce, salta o attacca.",
    },
    trailColor: { type: "color", label: "Colore della scia", default: "#8cc4ff", group: "Aspetto" },
  },
  actions: {
    play: {
      label: "Esegui un effetto",
      params: { effect: { type: "select", label: "Effetto", default: "hit", options: ONE_SHOT_EFFECTS.slice(1) } },
      run: (self, effect) => start(self, String(effect)),
    },
    setIdle: {
      label: "Cambia l'effetto continuo",
      params: { effect: { type: "select", label: "Effetto", default: "float", options: LOOP_EFFECTS } },
      run: (self, effect) => (self.data.idle = String(effect)),
    },
  },
  init(self) {
    const p = self.props;
    const d = self.data;
    d.list = [] as Active[];
    d.ghosts = [] as Ghost[];
    d.trailT = 0;
    d.idle = p.idle;
    // Oggetti uguali non si muovono all'unisono.
    d.time = (self.entity.uid * 0.37) % 10;
    const on = (event: string, prop: string) => self.listen(event, () => start(self, self.props[prop]));
    on("jumped", "onJump");
    on("landed", "onLand");
    on("hurt", "onHurt");
    on("attackStart", "onAttack");
    const custom = String(p.customEvent ?? "").trim();
    if (custom) on(custom, "customEffect");
    start(self, p.onAppear);
  },
  late(self, dt) {
    const e = self.entity;
    const p = self.props;
    const d = self.data;
    const fx = e.fx;
    resetFx(fx);
    d.time += dt;
    applyLoop(fx, d.idle, d.time, p.idleSpeed, p.idleStrength);
    const color = hexToNumber(p.flashColor);
    d.list = (d.list as Active[]).filter((a) => {
      a.t += dt;
      const u = Math.min(1, a.t / a.dur);
      applyEffect(fx, a.kind, u, p.strength, e.facingX, color);
      return u < 1;
    });

    const ghosts = d.ghosts as Ghost[];
    for (const g of ghosts) g.age += dt;
    while (ghosts.length && ghosts[0].age >= TRAIL_LIFE) ghosts.shift();
    const s = e.sprite;
    if (p.trail && s) {
      d.trailT -= dt;
      const b = e.body;
      const ts = self.scene.tileSize;
      const fast = (b && Math.hypot(b.vx, b.vy) > 6 * ts) || e.elevation > 3 || e.state.startsWith("attack") || e.state === "airAttack";
      if (fast && d.trailT <= 0) {
        d.trailT = 0.035;
        ghosts.push({ x: e.worldX + s.offsetX, y: e.worldY + s.offsetY - e.elevation, frame: s.frame, flip: spriteFlip(self), age: 0 });
        if (ghosts.length > 6) ghosts.shift();
      }
    }
  },
  render(self, r) {
    const ghosts = self.data.ghosts as Ghost[];
    const s = self.entity.sprite;
    if (!ghosts?.length || !s) return;
    const img = self.game.assets.image(s.image);
    if (!img) return;
    const color = hexToNumber(self.props.trailColor);
    for (const g of ghosts) {
      const a = 0.45 * (1 - g.age / TRAIL_LIFE);
      drawSpriteFrame(r, img, g.frame, g.x, g.y, s.origin as Origin, g.flip, hexColor("#ffffff", a), 1, { sx: 1, sy: 1, rot: 0, skew: 0, flashColor: color });
    }
  },
  destroy(self) {
    // L'oggetto sparisce (sconfitto, raccolto…): una sua copia fa l'effetto finale al suo posto.
    const e = self.entity;
    const p = self.props;
    const s = e.sprite;
    resetFx(e.fx);
    const kind = String(p.onDeath ?? "none");
    if (!s || !s.visible || !DURATION[kind]) return;
    const img = self.game.assets.image(s.image);
    if (!img) return;
    const snap = { x: e.worldX + s.offsetX, y: e.worldY + s.offsetY - e.elevation, frame: s.frame, flip: spriteFlip(self), origin: s.origin, tint: s.tint, opacity: s.opacity };
    const dur = DURATION[kind] / Math.max(0.1, p.speed);
    const k = p.strength;
    const facing = e.facingX;
    const color = hexToNumber(p.flashColor);
    const fx = identityFx();
    let t = 0;
    self.scene.effects.push({
      update: (dt) => (t += dt) < dur,
      render: (r) => {
        resetFx(fx);
        applyEffect(fx, kind, Math.min(1, t / dur), k, facing, color);
        drawSpriteFrame(r, img, snap.frame, snap.x + fx.dx, snap.y + fx.dy, snap.origin as Origin, snap.flip, hexColor(snap.tint, snap.opacity * fx.alpha), fx.flash, {
          sx: fx.sx,
          sy: fx.sy,
          rot: fx.rot,
          skew: fx.skew,
          flashColor: fx.flashColor,
        });
      },
    });
  },
});

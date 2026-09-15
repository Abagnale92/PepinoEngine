import { defineBlock, type BlockInstance } from "../core/block";
import { lerp, packColor, parseColor, type RGBA } from "../math";
import type { Renderer } from "../render/renderer";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
}

/** Aspetto delle particelle, letto dalle proprietà una volta per fotogramma. */
interface Look {
  c0: RGBA;
  c1: RGBA;
  s0: number;
  s1: number;
  soft: boolean;
  add: boolean;
  gravity: number;
}

function lookOf(self: BlockInstance): Look {
  const p = self.props;
  return {
    c0: parseColor(p.colorStart),
    c1: parseColor(p.colorEnd),
    s0: p.sizeStart,
    s1: p.sizeEnd,
    soft: p.shape === "soft",
    add: !!p.additive,
    gravity: p.gravity * self.scene.tileSize,
  };
}

function step(list: Particle[], look: Look, dt: number): void {
  for (let i = list.length - 1; i >= 0; i--) {
    const q = list[i];
    q.life += dt;
    if (q.life >= q.max) {
      list[i] = list[list.length - 1];
      list.pop();
      continue;
    }
    q.vy += look.gravity * dt;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
  }
}

function draw(r: Renderer, list: Particle[], look: Look): void {
  if (!list.length) return;
  r.setBlend(look.add ? "add" : "normal");
  const { c0, c1 } = look;
  for (const q of list) {
    const t = q.life / q.max;
    const size = lerp(look.s0, look.s1, t);
    if (size <= 0.05) continue;
    const color = packColor(lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t), lerp(c0[3], c1[3], t));
    if (look.soft) r.drawUV(r.radial, 0, 0, 1, 1, q.x - size / 2, q.y - size / 2, size, size, color);
    else r.rect(q.x - size / 2, q.y - size / 2, size, size, color);
  }
  r.setBlend("normal");
}

function emit(self: BlockInstance, count: number): void {
  const e = self.entity;
  const p = self.props;
  const d = self.data;
  const ts = self.scene.tileSize;
  const n = Math.max(0, Math.min(Math.floor(count), p.max - d.list.length));
  for (let i = 0; i < n; i++) {
    const a = ((p.direction + (Math.random() - 0.5) * p.spread) * Math.PI) / 180;
    const sp = p.speed * ts * (0.4 + Math.random() * 0.6);
    d.list.push({
      x: e.worldX + p.offsetX + (Math.random() - 0.5) * p.area,
      y: e.worldY + p.offsetY - e.elevation + (Math.random() - 0.5) * p.area,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 0,
      max: p.lifetime * (0.6 + Math.random() * 0.4),
    });
  }
}

defineBlock({
  name: "Particles",
  label: "Particelle",
  category: "Effetti",
  description:
    "Polvere, scintille, fumo, pioggia di stelle: tante piccole particelle che nascono dall'oggetto. Di continuo, oppure a raffica quando succede qualcosa (colpo, salto, morte…).",
  priority: 80,
  props: {
    mode: {
      type: "select",
      label: "Quando nascono",
      default: "burst",
      options: [
        { value: "burst", label: "A raffica (con un evento o un'azione)" },
        { value: "continuous", label: "Di continuo" },
      ],
      group: "Emissione",
    },
    burstOn: {
      type: "string",
      label: "Raffica quando l'oggetto…",
      default: "",
      group: "Emissione",
      optional: true,
      help: "Nome di un evento dell'oggetto: hit, hurt, died, jumped, landed, attackStart… Vuoto = solo con l'azione «Emetti una raffica».",
    },
    burstCount: { type: "integer", label: "Particelle per raffica", default: 12, min: 1, group: "Emissione" },
    rate: { type: "number", label: "Particelle al secondo", default: 20, min: 0, group: "Emissione", help: "Solo «Di continuo»." },
    area: { type: "number", label: "Zona di partenza", unit: "px", default: 0, min: 0, group: "Emissione", help: "0 = tutte dallo stesso punto." },
    offsetX: { type: "number", label: "Spostamento X", unit: "px", default: 0, group: "Emissione" },
    offsetY: { type: "number", label: "Spostamento Y", unit: "px", default: -6, group: "Emissione" },
    speed: { type: "number", label: "Velocità", unit: "tile/s", default: 3, min: 0, step: 0.5, group: "Movimento" },
    direction: {
      type: "number",
      label: "Direzione",
      unit: "°",
      default: -90,
      step: 15,
      group: "Movimento",
      help: "-90 = verso l'alto, 0 = destra, 90 = giù, 180 = sinistra.",
    },
    spread: { type: "number", label: "Apertura", unit: "°", default: 360, min: 0, max: 360, step: 15, group: "Movimento" },
    gravity: { type: "number", label: "Gravità", unit: "tile/s²", default: 0, step: 1, group: "Movimento", help: "Positiva = cadono, negativa = salgono (fumo)." },
    lifetime: { type: "number", label: "Durata", unit: "s", default: 0.6, min: 0.05, step: 0.05, group: "Movimento" },
    sizeStart: { type: "number", label: "Grandezza iniziale", unit: "px", default: 3, min: 0, step: 0.5, group: "Aspetto" },
    sizeEnd: { type: "number", label: "Grandezza finale", unit: "px", default: 0, min: 0, step: 0.5, group: "Aspetto" },
    colorStart: { type: "color", label: "Colore iniziale", default: "#fff3a6", group: "Aspetto" },
    colorEnd: { type: "color", label: "Colore finale", default: "#ff6b3b00", group: "Aspetto" },
    shape: {
      type: "select",
      label: "Forma",
      default: "square",
      options: [
        { value: "square", label: "Pixel quadrato" },
        { value: "soft", label: "Cerchio sfumato" },
      ],
      group: "Aspetto",
    },
    additive: { type: "boolean", label: "Luminose (i colori si sommano)", default: false, group: "Aspetto" },
    max: { type: "integer", label: "Massimo in scena", default: 300, min: 1, group: "Aspetto" },
  },
  conditions: {
    isEmitting: { label: "Sta emettendo di continuo", test: (self) => self.props.mode === "continuous" && !!self.data.on },
  },
  actions: {
    burst: {
      label: "Emetti una raffica",
      params: { count: { type: "integer", label: "Quante", default: 12, min: 1 } },
      run: (self, count) => emit(self, Number(count ?? self.props.burstCount)),
    },
    start: { label: "Avvia l'emissione continua", run: (self) => (self.data.on = true) },
    stop: { label: "Ferma l'emissione continua", run: (self) => (self.data.on = false) },
  },
  init(self) {
    self.data.list = [] as Particle[];
    self.data.acc = 0;
    self.data.on = true;
    self.data.look = lookOf(self);
    const ev = String(self.props.burstOn ?? "").trim();
    if (ev) self.listen(ev, () => emit(self, self.props.burstCount));
  },
  update(self, dt) {
    const d = self.data;
    const p = self.props;
    if (p.mode === "continuous" && d.on) {
      d.acc += dt * p.rate;
      const n = Math.floor(d.acc);
      d.acc -= n;
      if (n) emit(self, n);
    }
    d.look = lookOf(self);
    step(d.list, d.look, dt);
  },
  render(self, r) {
    draw(r, self.data.list, self.data.look ?? lookOf(self));
  },
  destroy(self) {
    // L'oggetto sparisce (es. un nemico sconfitto): le particelle già nate finiscono il loro volo.
    const list = self.data.list as Particle[] | undefined;
    if (!list?.length) return;
    const look = self.data.look ?? lookOf(self);
    self.scene.effects.push({
      update: (dt) => {
        step(list, look, dt);
        return list.length > 0;
      },
      render: (r) => draw(r, list, look),
    });
  },
});

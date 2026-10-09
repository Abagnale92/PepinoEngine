import { defineBlock, type BlockInstance } from "../core/block";
import type { Entity } from "../core/entity";
import type { Scene } from "../core/scene";
import { clamp, hexColor } from "../math";
import { COLL } from "../physics/collision";
import { FONT_PROP, interpolate, screenPos } from "./text";

// ------------------------------------------------------------------ Pulsante

/** Pulsanti visibili della scena, nell'ordine del menù. */
function menuButtons(scene: Scene): Entity[] {
  return scene.entities
    .filter((e) => !e.destroyed && e.visible && e.get("Button")?.enabled)
    .sort((a, b) => a.get("Button")!.props.order - b.get("Button")!.props.order || a.worldY - b.worldY || a.uid - b.uid);
}

function press(self: BlockInstance) {
  if (self.data.pressedAt === self.scene.time) return;
  self.data.pressedAt = self.scene.time;
  self.emit("pressed");
  if (self.props.sound) self.game.audio.play(self.props.sound);
  if (self.props.scene) self.game.goToScene(self.props.scene);
}

function buttonRect(self: BlockInstance) {
  const p = self.props;
  const e = self.entity;
  return { x: e.worldX - p.width / 2, y: e.worldY - p.height / 2, w: p.width, h: p.height };
}

defineBlock({
  name: "Button",
  label: "Pulsante",
  category: "Interfaccia",
  description:
    "Pulsante di un menù. Si sceglie con le frecce, il mouse o il tocco e si conferma con Azione, Salto o clic. Può portare direttamente a una scena.",
  priority: 100,
  props: {
    text: { type: "text", label: "Testo", default: "Gioca", translatable: true },
    scene: { type: "scene", label: "Porta alla scena", default: "", help: "Facoltativo: per azioni diverse usa le Regole." },
    order: { type: "integer", label: "Ordine nel menù", default: 0 },
    width: { type: "number", label: "Larghezza", unit: "px", default: 96, min: 8 },
    height: { type: "number", label: "Altezza", unit: "px", default: 18, min: 6 },
    size: { type: "number", label: "Dimensione testo", unit: "px", default: 8, min: 4 },
    font: FONT_PROP,
    color: { type: "color", label: "Colore", default: "#2c4a2c" },
    focusColor: { type: "color", label: "Colore selezionato", default: "#8cc480" },
    textColor: { type: "color", label: "Colore testo", default: "#ffffff" },
    sound: { type: "audio", label: "Suono", default: "" },
  },
  events: [{ id: "pressed", label: "È stato premuto" }],
  actions: { press: { label: "Premi", run: (self) => press(self) } },
  update(self) {
    const scene = self.scene;
    const list = menuButtons(scene);
    const idx = list.indexOf(self.entity);
    if (idx < 0) return;
    const input = self.game.input;
    const ptr = input.pointer;
    if (ptr.moved || ptr.pressed) {
      const v = self.game.renderer.toVirtual(ptr.x, ptr.y);
      const r = buttonRect(self);
      const inside = v.x >= r.x && v.x <= r.x + r.w && v.y >= r.y && v.y <= r.y + r.h;
      if (inside) {
        scene.uiFocus = idx;
        if (ptr.pressed) return press(self);
      }
    }
    // Il primo pulsante del menù gestisce la navigazione da tastiera e gamepad.
    if (idx !== 0) return;
    const n = list.length;
    scene.uiFocus = clamp(scene.uiFocus, 0, n - 1);
    if (input.pressed("down")) scene.uiFocus = (scene.uiFocus + 1) % n;
    if (input.pressed("up")) scene.uiFocus = (scene.uiFocus - 1 + n) % n;
    if (input.pressed("action") || input.pressed("jump")) {
      const target = list[scene.uiFocus]?.get("Button");
      if (target) press(target);
    }
  },
  renderScreen(self, r) {
    const p = self.props;
    const list = menuButtons(self.scene);
    const focused = list[self.scene.uiFocus] === self.entity;
    const b = buttonRect(self);
    r.rect(b.x, b.y, b.w, b.h, hexColor(focused ? p.focusColor : p.color));
    if (focused) r.strokeRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2, Math.max(0.5, 1 / r.pixelScale), hexColor("#ffffff", 0.9));
    r.text(interpolate(self.game.t(p.text), self.game.vars), self.entity.worldX, b.y + (b.h - p.size * 1.3) / 2, {
      size: p.size,
      align: "center",
      font: p.font,
      color: focused ? "#0d180e" : p.textColor,
    });
  },
});

// ------------------------------------------------------------------ Barra

defineBlock({
  name: "Bar",
  label: "Barra",
  category: "Interfaccia",
  description: "Barra che si riempie in base a una variabile: vita, energia, tempo…",
  priority: 100,
  props: {
    variable: { type: "variable", label: "Valore", default: "vita" },
    max: { type: "number", label: "Valore massimo", default: 3, min: 0.001 },
    width: { type: "number", label: "Larghezza", unit: "px", default: 40, min: 1 },
    height: { type: "number", label: "Altezza", unit: "px", default: 5, min: 1 },
    color: { type: "color", label: "Colore", default: "#e5695f" },
    background: { type: "color", label: "Sfondo", default: "#00000099" },
    screen: { type: "boolean", label: "Fissa sullo schermo (HUD)", default: true },
  },
  renderScreen(self, r) {
    const p = self.props;
    const { x, y } = screenPos(self, p.screen);
    const k = clamp(Number(self.game.vars[p.variable] ?? 0) / p.max, 0, 1);
    r.rect(x - 1, y - 1, p.width + 2, p.height + 2, hexColor(p.background));
    r.rect(x, y, p.width * k, p.height, hexColor(p.color));
  },
});

// ------------------------------------------------------------------ Minimappa

defineBlock({
  name: "MiniMap",
  label: "Minimappa",
  category: "Interfaccia",
  description:
    "Una piccola mappa della scena in un angolo dello schermo: i tile solidi sono i muri, l'oggetto che la porta è il puntino verde e gli altri con l'etichetta scelta sono puntini colorati.",
  priority: 100,
  props: {
    size: { type: "number", label: "Grandezza", unit: "px", default: 56, min: 16 },
    corner: {
      type: "select",
      label: "Angolo",
      default: "topright",
      options: [
        { value: "topright", label: "In alto a destra" },
        { value: "topleft", label: "In alto a sinistra" },
        { value: "bottomright", label: "In basso a destra" },
        { value: "bottomleft", label: "In basso a sinistra" },
      ],
    },
    wallColor: { type: "color", label: "Colore dei muri", default: "#c8d4c2" },
    background: { type: "color", label: "Sfondo", default: "#00000088" },
    selfColor: { type: "color", label: "Colore di questo oggetto", default: "#9be26a" },
    mark: { type: "tag", label: "Segna anche chi ha l'etichetta", default: "nemico" },
    markColor: { type: "color", label: "Colore dei segnalini", default: "#e5695f" },
  },
  renderScreen(self, r) {
    const p = self.props;
    const g = self.scene.grid;
    const cell = Math.max(0.5, Math.min(p.size / g.cols, p.size / g.rows));
    const mw = g.cols * cell;
    const mh = g.rows * cell;
    const right = String(p.corner).endsWith("right");
    const bottom = String(p.corner).startsWith("bottom");
    const ox = right ? r.width - mw - 6 : 6;
    const oy = bottom ? r.height - mh - 6 : 6;
    r.rect(ox - 2, oy - 2, mw + 4, mh + 4, hexColor(p.background));
    const wall = hexColor(p.wallColor, 0.8);
    for (let y = 0; y < g.rows; y++) {
      for (let x = 0; x < g.cols; x++) if (g.get(x, y) === COLL.solid) r.rect(ox + x * cell, oy + y * cell, cell, cell, wall);
    }
    const ts = self.scene.tileSize;
    const dot = (e: Entity, color: number, s: number) => {
      const b = e.body;
      const x = b ? b.left + b.w / 2 : e.worldX;
      const y = b ? b.top + b.h / 2 : e.worldY;
      r.rect(ox + (x / ts) * cell - s / 2, oy + (y / ts) * cell - s / 2, s, s, color);
    };
    if (p.mark) for (const o of self.scene.findAll(p.mark)) dot(o, hexColor(p.markColor), 2);
    dot(self.entity, hexColor(p.selfColor), 3);
  },
});

// ------------------------------------------------------------------ Rettangolo

defineBlock({
  name: "Rect",
  label: "Rettangolo",
  category: "Interfaccia",
  description: "Rettangolo colorato: sfondi dei menù, riquadri, forme semplici.",
  priority: 90,
  props: {
    width: { type: "number", label: "Larghezza", unit: "px", default: 64, min: 1 },
    height: { type: "number", label: "Altezza", unit: "px", default: 32, min: 1 },
    color: { type: "color", label: "Colore", default: "#00000080" },
    screen: { type: "boolean", label: "Fisso sullo schermo (HUD)", default: true },
  },
  render(self, r) {
    const p = self.props;
    if (!p.screen) r.rect(self.entity.worldX, self.entity.worldY, p.width, p.height, hexColor(p.color));
  },
  renderScreen(self, r) {
    const p = self.props;
    if (p.screen) r.rect(self.entity.worldX, self.entity.worldY, p.width, p.height, hexColor(p.color));
  },
});

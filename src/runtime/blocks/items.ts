import { defineBlock, type BlockInstance } from "../core/block";
import type { Entity } from "../core/entity";
import type { GamePanel } from "../core/game";
import type { Input } from "../input/input";
import { clamp, hexColor, overlaps } from "../math";
import type { Renderer } from "../render/renderer";
import {
  POWERUP_KINDS,
  POWERUP_OPTIONS,
  addItem,
  countItem,
  drawItemIcon,
  itemDef,
  itemName,
  powerupInfo,
  useItem,
} from "../items/items";
import { bodyCenter } from "./targets";

// Oggetti da raccogliere, potenziamenti a tempo e negozio.

// ------------------------------------------------------------------ Oggetto da raccogliere

defineBlock({
  name: "ItemPickup",
  label: "Oggetto da raccogliere",
  category: "Gameplay",
  description:
    "Un oggetto dell'archivio (scheda Oggetti) lasciato nella scena: chi lo tocca lo mette nell'inventario. Quelli che «fanno effetto appena presi» (cure, munizioni, potenziamenti) agiscono subito.",
  requires: ["Body"],
  priority: 40,
  props: {
    item: { type: "item", label: "Oggetto", default: "" },
    quantity: { type: "integer", label: "Quantità", default: 1, min: 1 },
    target: { type: "tag", label: "Raccolto da", default: "giocatore" },
    sound: { type: "audio", label: "Suono", default: "", optional: true },
    bob: { type: "boolean", label: "Fluttua", default: true },
    showIcon: {
      type: "boolean",
      label: "Mostra l'icona dell'oggetto",
      default: true,
      help: "Se l'oggetto non ha uno Sprite, nella scena si vede l'icona scelta nell'archivio.",
    },
  },
  events: [
    { id: "collected", label: "È stato raccolto" },
    { id: "full", label: "L'inventario ne ha già il massimo" },
  ],
  init(self) {
    self.data.t = self.entity.worldX * 0.1;
    self.data.bobY = 0;
    self.data.baseY = self.entity.sprite?.offsetY ?? 0;
  },
  update(self, dt) {
    const p = self.props;
    const d = self.data;
    const e = self.entity;
    if (p.bob) {
      d.t += dt;
      d.bobY = Math.round(Math.sin(d.t * 4) * 1.5);
      if (e.sprite) e.sprite.offsetY = d.baseY + d.bobY;
    }
    const b = self.body;
    if (!b || d.taken) return;
    const who = self.scene.findAll(p.target).find((o) => o !== e && o.body && overlaps(o.body.rect(), b.rect()));
    if (!who) {
      d.full = false;
      return;
    }
    const game = self.game;
    const def = itemDef(game.project, p.item);
    if (!def) {
      if (!d.warned) game.log(`"${e.name}": scegli l'oggetto nel blocco Oggetto da raccogliere`, "warn");
      d.warned = true;
      return;
    }
    if (def.kind === "instant") {
      for (let i = 0; i < p.quantity; i++) useItem(self.scene, who, def.id, false);
    } else if (addItem(game.vars, def.id, p.quantity, def.max ?? 0) <= 0) {
      if (!d.full) self.emit("full", def.id);
      d.full = true;
      return;
    }
    d.taken = true;
    if (p.sound) game.audio.play(p.sound);
    self.emit("collected", def.id);
    e.destroy();
  },
  render(self, r) {
    const e = self.entity;
    if (!self.props.showIcon || e.sprite) return;
    const def = itemDef(self.game.project, self.props.item);
    if (!def) return;
    drawItemIcon(self.game, r, def.id, e.worldX, e.worldY - 8 + self.data.bobY, 16);
  },
});

// ------------------------------------------------------------------ Potenziamenti

interface Active {
  kind: string;
  left: number;
  total: number;
  strength: number;
}

const INVINCIBLE_TINTS = ["#ffe066", "#ff9fb0", "#8fd3ff", "#b4ff8a"];

function give(self: BlockInstance, kind: string, seconds: number, strength: number) {
  const info = powerupInfo(String(kind));
  if (!info) return;
  const d = self.data;
  const s = Number(strength) > 0 ? Number(strength) : info.strength;
  const sec = Number(seconds) > 0 ? Number(seconds) : Infinity;
  const list = d.active as Active[];
  const cur = list.find((a) => a.kind === info.value);
  if (cur && info.value === "shield") {
    cur.strength += s;
    cur.left = Math.max(cur.left, sec);
  } else if (cur) {
    cur.left = Math.max(cur.left, sec);
    cur.total = cur.left;
    cur.strength = Math.max(cur.strength, s);
  } else list.push({ kind: info.value, left: sec, total: sec, strength: s });
  writeBoosts(self);
  self.emit("powerUpStart", info.value);
}

function writeBoosts(self: BlockInstance) {
  const boosts: Record<string, number> = {};
  for (const a of self.data.active as Active[]) boosts[a.kind] = a.strength;
  self.entity.boosts = boosts;
}

/** Lo scudo para un colpo: vero se l'ha parato (e ne consuma uno). */
export function absorbHit(e: Entity): boolean {
  const pu = e.get("PowerUps");
  const a = (pu?.data.active as Active[] | undefined)?.find((x) => x.kind === "shield" && x.strength > 0);
  if (!pu || !a) return false;
  a.strength -= 1;
  writeBoosts(pu);
  return true;
}

defineBlock({
  name: "PowerUps",
  label: "Potenziamenti",
  category: "Gameplay",
  description:
    "Rende l'oggetto (di solito il giocatore) capace di ricevere potenziamenti a tempo: velocità, super salto, invincibilità, più forza, calamita per monete e oggetti, scudo che para i colpi, salto in più. Li danno gli oggetti dell'archivio e la Regola «Dai un potenziamento»; sullo schermo si vede quanto tempo resta.",
  priority: 1,
  props: {
    hud: { type: "boolean", label: "Mostra sullo schermo", default: true },
    blink: { type: "boolean", label: "Cambia colore quando è invincibile", default: true },
    endSound: { type: "audio", label: "Suono quando uno finisce", default: "", optional: true },
  },
  events: [
    { id: "powerUpStart", label: "Riceve un potenziamento" },
    { id: "powerUpEnd", label: "Finisce un potenziamento" },
  ],
  conditions: {
    has: {
      label: "Ha il potenziamento",
      params: { kind: { type: "select", label: "Potenziamento", default: "speed", options: POWERUP_OPTIONS } },
      test: (self, kind: string) => (self.data.active as Active[]).some((a) => a.kind === kind),
    },
  },
  actions: {
    give: {
      label: "Dai un potenziamento",
      params: {
        kind: { type: "select", label: "Potenziamento", default: "speed", options: POWERUP_OPTIONS },
        seconds: { type: "number", label: "Durata", unit: "s", default: 8, min: 0, step: 0.5, help: "0 = finché non si toglie." },
        strength: { type: "number", label: "Intensità", default: 0, min: 0, step: 0.1, help: "0 = quella normale." },
      },
      run: (self, kind: string, seconds: number, strength: number) => give(self, kind, seconds, strength),
    },
    clear: {
      label: "Togli tutti i potenziamenti",
      run: (self) => {
        self.data.active = [];
        writeBoosts(self);
      },
    },
  },
  texts: POWERUP_KINDS.map((k) => k.label),
  init(self) {
    self.data.active = [] as Active[];
    self.data.t = 0;
    self.data.baseTint = self.entity.sprite?.tint ?? "#ffffff";
    self.entity.boosts = {};
  },
  update(self, dt) {
    const d = self.data;
    const e = self.entity;
    d.t += dt;
    const before = (d.active as Active[]).length;
    d.active = (d.active as Active[]).filter((a) => {
      a.left -= dt;
      const over = a.left <= 0 || (a.kind === "shield" && a.strength <= 0);
      if (over) {
        self.emit("powerUpEnd", a.kind);
        if (self.props.endSound) self.game.audio.play(self.props.endSound);
      }
      return !over;
    });
    if (before || (d.active as Active[]).length) writeBoosts(self);

    // Calamita: monete e oggetti da raccogliere vicini volano verso l'oggetto.
    const radius = e.boost("magnet", 0) * self.scene.tileSize;
    if (radius > 0) {
      const c = bodyCenter(e);
      const step = 12 * self.scene.tileSize * dt;
      for (const o of self.scene.entities) {
        if (o.destroyed || o === e || !(o.has("Collectible") || o.has("ItemPickup"))) continue;
        const oc = bodyCenter(o);
        const dist = Math.hypot(c.x - oc.x, c.y - oc.y);
        if (dist > radius || dist < 1) continue;
        const k = Math.min(1, step / dist);
        o.x += (c.x - oc.x) * k;
        o.y += (c.y - oc.y) * k;
      }
    }

    // Invincibile: il colore cambia di continuo, come una stella.
    const s = e.sprite;
    if (s && self.props.blink) {
      if (e.hasBoost("invincible")) s.tint = INVINCIBLE_TINTS[Math.floor(d.t * 12) % INVINCIBLE_TINTS.length];
      else if (s.tint !== d.baseTint && INVINCIBLE_TINTS.includes(s.tint)) s.tint = d.baseTint;
    }
  },
  renderScreen(self, r) {
    if (!self.props.hud) return;
    const list = self.data.active as Active[];
    list.forEach((a, i) => {
      const info = powerupInfo(a.kind);
      if (!info) return;
      const label = self.game.t(info.label);
      const value = a.kind === "shield" ? `×${a.strength}` : Number.isFinite(a.left) ? `${Math.ceil(a.left)}s` : "";
      const text = value ? `${label} ${value}` : label;
      const w = r.measureText(text, { size: 7 }) + 12;
      const x = r.width - w - 6;
      const y = 6 + i * 13;
      r.rect(x, y, w, 11, hexColor("#000000", 0.55));
      r.rect(x, y, 3, 11, hexColor(info.color));
      if (Number.isFinite(a.total) && a.total > 0) r.rect(x + 3, y + 10, (w - 3) * clamp(a.left / a.total, 0, 1), 1, hexColor(info.color, 0.8));
      r.text(text, x + 7, y + 2, { size: 7, color: "#ffffff" });
    });
  },
});

// ------------------------------------------------------------------ Negozio

interface ShopRow {
  item: string;
  price: number;
}

function shopRows(self: BlockInstance): ShopRow[] {
  const list = Array.isArray(self.props.items) ? (self.props.items as { item?: string; price?: number }[]) : [];
  const out: ShopRow[] = [];
  for (const r of list) {
    const def = itemDef(self.game.project, r?.item);
    if (!def) continue;
    out.push({ item: def.id, price: Number(r.price) > 0 ? Number(r.price) : Math.max(0, def.price ?? 0) });
  }
  return out;
}

const ROW_H = 15;

/** La finestra del negozio: su e giù (o il mouse) per scegliere, Azione o clic per comprare, Esc per uscire. */
class ShopPanel implements GamePanel {
  closed = false;
  sel = 0;
  first = 0;
  msg = "";
  msgT = 0;
  /** Breve attesa: il tasto che ha aperto il negozio non compra subito. */
  wait = 0.15;
  rects: { y: number; h: number; x: number; w: number }[] = [];

  constructor(
    private shop: BlockInstance,
    private buyer: Entity | undefined,
  ) {}

  private close() {
    this.closed = true;
    this.shop.emit("closed");
  }

  private buy(row: ShopRow) {
    const shop = this.shop;
    const game = shop.game;
    const p = shop.props;
    const def = itemDef(game.project, row.item);
    if (!def) return;
    const money = Number(game.vars[p.currency] ?? 0);
    if (money < row.price) {
      this.say(game.t("Non ti bastano"));
      shop.emit("notEnough", def.id);
      if (p.failSound) game.audio.play(p.failSound);
      return;
    }
    if (def.kind === "instant") {
      if (!useItem(shop.scene, this.buyer, def.id, false)) {
        this.say(game.t("Non si può usare adesso"));
        return;
      }
    } else if (addItem(game.vars, def.id, 1, def.max ?? 0) <= 0) {
      this.say(game.t("Ne hai già il massimo"));
      return;
    }
    game.vars[p.currency] = money - row.price;
    this.say(game.t("Comprato!"));
    shop.emit("bought", def.id);
    if (p.buySound) game.audio.play(p.buySound);
  }

  private say(text: string) {
    this.msg = text;
    this.msgT = 1.4;
  }

  update(dt: number, input: Input) {
    if (this.msgT > 0) this.msgT -= dt;
    if (this.wait > 0) {
      this.wait -= dt;
      return;
    }
    const rows = shopRows(this.shop);
    const n = rows.length + 1;
    if (input.pressed("down")) this.sel = (this.sel + 1) % n;
    if (input.pressed("up")) this.sel = (this.sel - 1 + n) % n;
    let confirm = input.pressed("action") || input.pressed("jump");
    const ptr = input.pointer;
    if (ptr.moved || ptr.pressed) {
      const v = this.shop.game.renderer.toVirtual(ptr.x, ptr.y);
      const i = this.rects.findIndex((r) => v.x >= r.x && v.x <= r.x + r.w && v.y >= r.y && v.y < r.y + r.h);
      if (i >= 0) {
        this.sel = Math.min(n - 1, this.first + i);
        if (ptr.pressed) confirm = true;
      }
    }
    if (input.pressed("pause") || (confirm && this.sel === rows.length)) return this.close();
    if (confirm) this.buy(rows[this.sel]);
  }

  render(r: Renderer) {
    const shop = this.shop;
    const game = shop.game;
    const p = shop.props;
    const W = r.width;
    const H = r.height;
    const rows = shopRows(shop);
    const x = 20;
    const y = 12;
    const w = W - 40;
    const h = H - 24;
    const t = Math.max(0.5, 1 / r.pixelScale);
    r.rect(0, 0, W, H, hexColor("#000000", 0.45));
    r.rect(x, y, w, h, hexColor("#0a100a", 0.95));
    r.strokeRect(x, y, w, h, t, hexColor("#8cc480"));
    r.text(game.t(p.title), x + 10, y + 7, { size: 10, color: "#fff3a6" });
    const money = Number(game.vars[p.currency] ?? 0);
    r.text(`${game.t(p.currencyName)}: ${money}`, x + w - 10, y + 9, { size: 8, align: "right", color: "#ffffff" });

    const top = y + 26;
    const visible = Math.max(1, Math.floor((h - 64) / ROW_H));
    const n = rows.length + 1;
    this.first = clamp(this.first, Math.max(0, this.sel - visible + 1), Math.min(this.sel, Math.max(0, n - visible)));
    this.rects = [];
    for (let i = 0; i < Math.min(visible, n - this.first); i++) {
      const idx = this.first + i;
      const ry = top + i * ROW_H;
      const on = idx === this.sel;
      this.rects.push({ x: x + 6, y: ry, w: w - 12, h: ROW_H });
      if (on) r.rect(x + 6, ry, w - 12, ROW_H - 1, hexColor("#8cc480", 0.25));
      if (idx === rows.length) {
        r.text(game.t("Esci"), x + 12, ry + 3, { size: 8, color: on ? "#ffffff" : "#9aa894" });
        continue;
      }
      const row = rows[idx];
      drawItemIcon(game, r, row.item, x + 18, ry + ROW_H / 2, 12);
      const owned = countItem(game.vars, row.item);
      r.text(itemName(game, row.item) + (owned ? `  ×${owned}` : ""), x + 30, ry + 3, { size: 8, color: on ? "#ffffff" : "#c8d4c2" });
      r.text(String(row.price), x + w - 12, ry + 3, { size: 8, align: "right", color: money >= row.price ? "#9be26a" : "#e5695f" });
    }
    const sel = rows[this.sel];
    const desc = sel ? (itemDef(game.project, sel.item)?.description ?? "") : "";
    if (desc) r.text(game.t(desc), x + 10, y + h - 30, { size: 7, color: "#c8d4c2" });
    if (this.msgT > 0 && this.msg) r.text(this.msg, W / 2, y + h - 16, { size: 8, align: "center", color: "#fff3a6" });
    else r.text(game.t("↑ ↓ scegli · Azione compra · Esc esci"), W / 2, y + h - 16, { size: 7, align: "center", color: "#7f8f7a" });
  }
}

function openShop(self: BlockInstance, buyer?: Entity) {
  const game = self.game;
  if (game.panel) return;
  game.panel = new ShopPanel(self, buyer ?? self.scene.findAll(self.props.player)[0]);
  self.emit("opened");
}

defineBlock({
  name: "Shop",
  label: "Negozio",
  category: "Gameplay",
  description:
    "Un venditore: vicino a lui il giocatore preme Azione (o lo clicca) e si apre la finestra del negozio con gli oggetti dell'archivio in vendita. Si paga con una variabile (le monete); il gioco resta fermo finché il negozio è aperto.",
  priority: 60,
  props: {
    items: { type: "itemList", label: "In vendita", default: [], help: "Prezzo 0 = quello scritto nell'archivio." },
    currency: { type: "variable", label: "Si paga con", default: "monete" },
    currencyName: { type: "string", label: "Nome dei soldi", default: "Monete", translatable: true },
    title: { type: "string", label: "Titolo", default: "Negozio", translatable: true },
    openWith: {
      type: "select",
      label: "Si apre",
      default: "near",
      options: [
        { value: "near", label: "Vicino, premendo Azione (o con un clic)" },
        { value: "rules", label: "Solo con le Regole (azione «Apri il negozio»)" },
      ],
    },
    player: { type: "tag", label: "Chi compra", default: "giocatore" },
    radius: { type: "number", label: "Distanza", unit: "tile", default: 1.5, min: 0.5, step: 0.5 },
    prompt: { type: "string", label: "Fumetto", default: "Negozio", translatable: true, help: "Compare sopra il venditore quando il giocatore è vicino." },
    buySound: { type: "audio", label: "Suono quando compri", default: "", optional: true },
    failSound: { type: "audio", label: "Suono se non bastano i soldi", default: "", optional: true },
  },
  events: [
    { id: "opened", label: "Il negozio si apre" },
    { id: "bought", label: "Ha venduto un oggetto" },
    { id: "notEnough", label: "Non bastano i soldi" },
    { id: "closed", label: "Il negozio si chiude" },
  ],
  conditions: {
    isOpen: { label: "Il negozio è aperto", test: (self) => self.game.panel instanceof ShopPanel },
  },
  actions: {
    open: { label: "Apri il negozio", run: (self) => openShop(self) },
  },
  texts: ["Esci", "Comprato!", "Non ti bastano", "Ne hai già il massimo", "Non si può usare adesso", "↑ ↓ scegli · Azione compra · Esc esci"],
  init(self) {
    self.data.near = false;
  },
  update(self) {
    const p = self.props;
    const d = self.data;
    if (p.openWith !== "near") return;
    const e = self.entity;
    const c = bodyCenter(e);
    const r = p.radius * self.scene.tileSize;
    const buyer = self.scene.findAll(p.player).find((o) => {
      const oc = bodyCenter(o);
      return Math.hypot(oc.x - c.x, oc.y - c.y) <= r;
    });
    d.near = !!buyer;
    const input = self.game.input;
    let clicked = false;
    const ptr = input.pointer;
    if (ptr.pressed && buyer) {
      const v = self.game.renderer.toVirtual(ptr.x, ptr.y);
      const cam = self.scene.camera;
      const wx = cam.left + v.x / cam.zoom;
      const wy = cam.top + v.y / cam.zoom;
      clicked = Math.abs(wx - c.x) <= 10 && Math.abs(wy - c.y) <= 14;
    }
    if (buyer && (input.pressed("action") || clicked)) openShop(self, buyer);
  },
  renderScreen(self, r) {
    if (!self.data.near || self.game.panel || !self.props.prompt) return;
    const e = self.entity;
    const cam = self.scene.camera;
    const x = (e.worldX - cam.left) * cam.zoom;
    const y = (e.worldY - cam.top) * cam.zoom - 34 * cam.zoom;
    const text = self.game.t(self.props.prompt);
    const w = r.measureText(text, { size: 7 }) + 8;
    r.rect(x - w / 2, y, w, 11, hexColor("#0a100a", 0.85));
    r.strokeRect(x - w / 2, y, w, 11, Math.max(0.5, 1 / r.pixelScale), hexColor("#8cc480"));
    r.text(text, x, y + 2, { size: 7, align: "center", color: "#fff3a6" });
  },
});

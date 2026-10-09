import { frameRect } from "../assets/assets";
import type { Entity } from "../core/entity";
import type { Scene } from "../core/scene";
import { hexColor } from "../math";
import type { ItemData, ProjectData, VariableValue } from "../project/format";
import type { Renderer } from "../render/renderer";

// Oggetti dell'archivio (scheda Oggetti), inventario e catalogo dei potenziamenti.

/** Variabile globale con l'inventario, come «pozione:2|chiave»: resta cambiando scena e si salva con la partita. */
export const INVENTORY_VAR = "inventario";

/** Potenziamenti a tempo: `strength` è il valore normale (moltiplicatore, raggio in tile, salti o colpi). */
export const POWERUP_KINDS = [
  { value: "speed", label: "Velocità", strength: 1.6, color: "#4a8fd6" },
  { value: "jump", label: "Super salto", strength: 1.5, color: "#8cc480" },
  { value: "invincible", label: "Invincibilità", strength: 1, color: "#f0b43c" },
  { value: "damage", label: "Più forza", strength: 2, color: "#e5695f" },
  { value: "magnet", label: "Calamita", strength: 4, color: "#b452e0" },
  { value: "shield", label: "Scudo", strength: 1, color: "#8fd3ff" },
  { value: "airJump", label: "Salto in più", strength: 1, color: "#ffffff" },
];

export const POWERUP_OPTIONS = POWERUP_KINDS.map((k) => ({ value: k.value, label: k.label }));
export const powerupInfo = (kind: string) => POWERUP_KINDS.find((k) => k.value === kind);

export const ITEM_KINDS = [
  { value: "consumable", label: "Si usa e sparisce (pozioni, cibo)" },
  { value: "key", label: "Resta nell'inventario (chiavi, oggetti delle missioni)" },
  { value: "instant", label: "Fa effetto appena preso (monete, potenziamenti)" },
];

export const EFFECT_TYPES = [
  { value: "none", label: "Nessuno (ci pensano le Regole)" },
  { value: "heal", label: "Cura" },
  { value: "variable", label: "Aggiunge a una variabile" },
  { value: "powerup", label: "Potenziamento a tempo" },
];

export interface Stack {
  id: string;
  qty: number;
}

type Vars = Record<string, VariableValue>;
const clean = (s: unknown) => String(s ?? "").replace(/[|:=]/g, "").trim();

/** L'inventario in ordine di arrivo. */
export function inventory(vars: Vars): Stack[] {
  const out: Stack[] = [];
  for (const part of String(vars[INVENTORY_VAR] ?? "").split("|")) {
    const [raw, n] = part.split(":");
    const id = clean(raw.split("=")[0]);
    if (!id) continue;
    const qty = n === undefined ? 1 : Math.max(0, Math.floor(Number(n) || 0));
    const found = out.find((s) => s.id === id);
    if (found) found.qty += qty;
    else if (qty > 0) out.push({ id, qty });
  }
  return out;
}

function writeInventory(vars: Vars, list: Stack[]) {
  vars[INVENTORY_VAR] = list
    .filter((s) => s.qty > 0)
    .map((s) => (s.qty === 1 ? s.id : `${s.id}:${s.qty}`))
    .join("|");
}

export const countItem = (vars: Vars, id: unknown): number => inventory(vars).find((s) => s.id === clean(id))?.qty ?? 0;
export const hasItem = (vars: Vars, id: unknown, qty = 1): boolean => countItem(vars, id) >= Math.max(1, qty);

/** Aggiunge `qty` oggetti, fino al massimo (0 = senza limite). Restituisce quanti ne sono entrati. */
export function addItem(vars: Vars, id: unknown, qty = 1, max = 0): number {
  const n = clean(id);
  if (!n || !(qty > 0)) return 0;
  const list = inventory(vars);
  let s = list.find((x) => x.id === n);
  if (!s) list.push((s = { id: n, qty: 0 }));
  const added = max > 0 ? Math.max(0, Math.min(qty, max - s.qty)) : qty;
  s.qty += added;
  writeInventory(vars, list);
  return added;
}

/** Toglie fino a `qty` oggetti. Restituisce quanti ne ha tolti. */
export function removeItem(vars: Vars, id: unknown, qty = 1): number {
  const n = clean(id);
  const list = inventory(vars);
  const s = list.find((x) => x.id === n);
  if (!s) return 0;
  const removed = Math.min(s.qty, Math.max(0, qty));
  s.qty -= removed;
  writeInventory(vars, list);
  return removed;
}

/** Danno di chi attacca, con il potenziamento «Più forza» se ce l'ha. */
export function boosted(amount: number, attacker: Entity | undefined): number {
  const k = attacker?.boost("damage") ?? 1;
  return k === 1 || amount <= 0 ? amount : Math.max(1, Math.round(amount * k));
}

export const itemDef =(project: ProjectData, id: unknown): ItemData | undefined => project.items?.find((i) => i.id === id);

/** Nome dell'oggetto nella lingua del giocatore (l'id, se l'oggetto non è nell'archivio). */
export function itemName(game: { project: ProjectData; t(s: string): string }, id: string): string {
  return game.t(itemDef(game.project, id)?.name ?? id);
}

/**
 * Usa un oggetto: applica l'effetto a chi lo usa e manda l'evento per le Regole («Un oggetto viene usato»).
 * Con `fromInventory` lo prende dall'inventario: se è consumabile ne toglie uno.
 */
export function useItem(scene: Scene, user: Entity | undefined, id: string, fromInventory = true): boolean {
  const game = scene.game;
  const def = itemDef(game.project, id);
  if (fromInventory && !hasItem(game.vars, id)) return false;
  const fx = def?.effect;
  switch (fx?.type) {
    case "heal": {
      const h = user?.get("Health");
      if (!h) return false;
      h.actions.heal(fx.amount ?? 1);
      break;
    }
    case "variable":
      if (!fx.variable) return false;
      game.vars[fx.variable] = Number(game.vars[fx.variable] ?? 0) + Number(fx.amount ?? 1);
      break;
    case "powerup": {
      const pu = user?.get("PowerUps");
      if (!pu) {
        game.log(`"${def?.name ?? id}": chi lo usa non ha il blocco Potenziamenti`, "warn");
        return false;
      }
      pu.actions.give(fx.powerup ?? "speed", fx.seconds ?? 8, fx.strength ?? 0);
      break;
    }
  }
  if (fromInventory && def?.kind !== "key") removeItem(game.vars, id, 1);
  scene.events.emit("itemUse", { entity: user, data: { item: id } });
  return true;
}

/** Disegna l'icona di un oggetto dentro un quadrato di lato `max`, centrata in (cx, cy). */
export function drawItemIcon(game: { project: ProjectData; assets: { image(id: string): unknown } }, r: Renderer, id: string, cx: number, cy: number, max: number): void {
  const def = itemDef(game.project, id);
  const img = def?.icon ? (game.assets.image(def.icon) as Parameters<typeof frameRect>[0] | undefined) : undefined;
  if (!img) {
    r.rect(cx - 2, cy - 2, 4, 4, hexColor("#fff3a6"));
    return;
  }
  const f = frameRect(img, def?.frame ?? 0);
  let k = Math.min(max / f.fw, max / f.fh);
  if (k >= 1) k = Math.floor(k);
  const w = f.fw * k;
  const h = f.fh * k;
  r.draw(img.tex, f.sx, f.sy, f.fw, f.fh, cx - w / 2, cy - h / 2, w, h);
}

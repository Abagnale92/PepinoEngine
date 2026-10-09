import { describe, expect, it } from "vitest";
import type { EntityData, ItemData, ProjectData } from "@runtime";
import { addItem, countItem, inventory, removeItem } from "../src/runtime/items/items";
import { FLAT, makeProject, makeWorld, player, rule } from "./helpers";

const ITEMS: ItemData[] = [
  { id: "pozione", name: "Pozione", kind: "consumable", price: 3, max: 3, effect: { type: "heal", amount: 1 } },
  { id: "stivali", name: "Stivali", kind: "instant", price: 5, effect: { type: "powerup", powerup: "speed", seconds: 2 } },
  { id: "chiave", name: "Chiave", kind: "key" },
  { id: "gemma", name: "Gemma", kind: "instant", effect: { type: "variable", variable: "punti", amount: 10 } },
];

const withItems = (p: ProjectData) => {
  p.items = structuredClone(ITEMS);
  return p;
};

const HEALTH = { type: "Health", props: { max: 3, variable: "vita", invulnerability: 0, knockback: 0, onDeath: "none" } };
const hero = (x = 20, extra: EntityData["blocks"] = []) => player(x, 128, {}, { blocks: [HEALTH, { type: "PowerUps", props: {} }, ...extra] });

const pickup = (id: string, item: string, x: number): EntityData => ({
  id,
  name: id,
  x,
  y: 128,
  blocks: [
    { type: "Body", props: { width: 10, height: 10, group: "raccoglibili", world: false } },
    { type: "ItemPickup", props: { item } },
  ],
});

const VARS = { vita: 3, punti: 0, monete: 0, inventario: "" };
type World = ReturnType<typeof makeWorld>;
const press = (w: World, action: string) => {
  w.input.hold(action);
  w.step(1);
  w.input.release(action);
};
const powerups = (w: World, id = "p") => w.get(id).get("PowerUps")!;
const give = (w: World, kind: string, seconds = 5, id = "p") => powerups(w, id).def.actions.give.run(powerups(w, id), kind, seconds, 0);

describe("oggetti, potenziamenti e negozio", () => {
  it("l'inventario conta le quantità e rispetta il massimo", () => {
    const v: Record<string, string | number | boolean> = { inventario: "" };
    expect(addItem(v, "pozione", 2, 3)).toBe(2);
    expect(addItem(v, "pozione", 5, 3)).toBe(1);
    expect(v.inventario).toBe("pozione:3");
    addItem(v, "chiave");
    expect(inventory(v)).toEqual([
      { id: "pozione", qty: 3 },
      { id: "chiave", qty: 1 },
    ]);
    expect(v.inventario).toBe("pozione:3|chiave");
    expect(removeItem(v, "pozione", 2)).toBe(2);
    expect(countItem(v, "pozione")).toBe(1);
    removeItem(v, "pozione");
    expect(v.inventario).toBe("chiave");
  });

  it("gli oggetti da raccogliere vanno nell'inventario o fanno subito effetto", () => {
    const w = makeWorld(withItems(makeProject(FLAT, [hero(), pickup("p1", "pozione", 20), pickup("g1", "gemma", 20), pickup("s1", "stivali", 20)], { variables: { ...VARS } })));
    w.step(2);
    expect(countItem(w.game.vars, "pozione")).toBe(1);
    expect(w.game.vars.punti).toBe(10);
    expect(w.get("p").hasBoost("speed")).toBe(true);
    expect(w.scene.entities.some((e) => !e.destroyed && e.has("ItemPickup"))).toBe(false);
    w.step(130);
    expect(w.get("p").hasBoost("speed")).toBe(false);
  });

  it("con il potenziamento Velocità il personaggio corre più veloce", () => {
    const WIDE = [...Array(8).fill(".".repeat(60)), "#".repeat(60)];
    const q = { ...hero(20), id: "q", name: "Q" };
    const w = makeWorld(makeProject(WIDE, [hero(20), q], { variables: { ...VARS } }));
    give(w, "speed");
    w.input.hold("right");
    w.step(90);
    expect(w.get("p").body!.vx / w.get("q").body!.vx).toBeCloseTo(1.6, 1);
  });

  it("invincibilità e scudo fermano i colpi, «Più forza» raddoppia il danno", () => {
    const enemy: EntityData = {
      id: "n",
      name: "Nemico",
      x: 34,
      y: 128,
      tags: ["nemico"],
      blocks: [
        { type: "Body", props: { width: 10, height: 16, world: false } },
        { type: "Health", props: { max: 5, invulnerability: 0, knockback: 0, onDeath: "none" } },
      ],
    };
    const w = makeWorld(makeProject(FLAT, [hero(20, [{ type: "Attack", props: { mode: "ai", target: "nemico", damage: 1 } }]), enemy], { variables: { ...VARS } }));
    const hp = w.get("p").get("Health")!;
    give(w, "invincible");
    w.step(1);
    hp.actions.damage(1);
    expect(w.game.vars.vita).toBe(3);
    powerups(w).def.actions.clear.run(powerups(w));
    give(w, "shield", 0);
    w.step(1);
    hp.actions.damage(1);
    expect(w.game.vars.vita).toBe(3);
    w.step(1);
    hp.actions.damage(1);
    expect(w.game.vars.vita).toBe(2);

    give(w, "damage");
    w.step(1);
    const atk = w.get("p").get("Attack")!;
    atk.def.actions.attack.run(atk);
    w.step(12);
    expect(w.get("n").get("Health")!.data.hp).toBe(3);
  });

  it("la calamita attira le monete", () => {
    const coin: EntityData = {
      id: "c",
      name: "Moneta",
      x: 70,
      y: 128,
      blocks: [
        { type: "Body", props: { width: 8, height: 8, group: "raccoglibili", world: false } },
        { type: "Collectible", props: { variable: "monete" } },
      ],
    };
    const w = makeWorld(makeProject(FLAT, [hero(), coin], { variables: { ...VARS } }));
    w.step(30);
    expect(w.game.vars.monete).toBe(0);
    give(w, "magnet");
    w.step(40);
    expect(w.game.vars.monete).toBe(1);
  });

  it("nel negozio si compra con le monete, se bastano", () => {
    const shop: EntityData = {
      id: "negozio",
      name: "Negozio",
      x: 40,
      y: 128,
      blocks: [
        {
          type: "Shop",
          props: {
            items: [
              { item: "pozione", price: 0 },
              { item: "stivali", price: 4 },
            ],
            currency: "monete",
          },
        },
      ],
    };
    const w = makeWorld(withItems(makeProject(FLAT, [hero(), shop], { variables: { ...VARS, monete: 6 } })));
    w.step(2);
    press(w, "action");
    expect(w.game.panel).not.toBeNull();
    w.step(12);
    press(w, "action");
    expect(w.game.vars.monete).toBe(3);
    expect(countItem(w.game.vars, "pozione")).toBe(1);
    press(w, "down");
    press(w, "action");
    expect(w.game.vars.monete).toBe(3);
    expect(w.get("p").hasBoost("speed")).toBe(false);
    press(w, "down");
    press(w, "action");
    expect(w.game.panel).toBeNull();
  });

  it("la barra dell'inventario usa l'oggetto scelto con Q ed E cambia casella", () => {
    const bar: EntityData = { id: "barra", name: "Barra", x: 4, y: 150, blocks: [{ type: "Inventory", props: { slots: 4 } }] };
    const w = makeWorld(withItems(makeProject(FLAT, [hero(), bar], { variables: { ...VARS, inventario: "chiave|pozione:2" } })));
    w.step(1);
    w.get("p").get("Health")!.actions.damage(2);
    expect(w.game.vars.vita).toBe(1);
    press(w, "nextItem");
    press(w, "item");
    expect(w.game.vars.vita).toBe(2);
    expect(countItem(w.game.vars, "pozione")).toBe(1);
    press(w, "nextItem");
    press(w, "item");
    // La chiave resta: non si consuma.
    expect(countItem(w.game.vars, "chiave")).toBe(1);
  });

  it("le Regole usano gli oggetti e danno i potenziamenti", () => {
    const w = makeWorld(
      withItems(
        makeProject(FLAT, [hero()], {
          variables: { ...VARS, inventario: "pozione", usata: 0, salto: 0 },
          rules: [
            rule("usa", { type: "item.used", params: { item: "pozione" } }, [{ type: "var.set", params: { variable: "usata", value: "1" } }]),
            rule("dai", { type: "scene.start", params: {} }, [{ type: "powerup.give", params: { target: "#giocatore", kind: "jump", seconds: 5, strength: 0 } }]),
            rule("ha", { type: "always", params: {} }, [{ type: "var.set", params: { variable: "salto", value: "1" } }], [
              { type: "powerup.has", params: { target: "#giocatore", kind: "jump" } },
            ]),
            rule("usala", { type: "after", params: { seconds: 0.1 } }, [{ type: "item.use", params: { target: "#giocatore", item: "pozione" } }]),
          ],
        }),
      ),
    );
    w.step(20);
    expect(w.game.vars.salto).toBe(1);
    expect(w.game.vars.usata).toBe(1);
    expect(countItem(w.game.vars, "pozione")).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import type { DialogueData, EntityData } from "@runtime";
import { DialogueRunner } from "../src/runtime/dialogue/dialogue";
import { addItem, hasItem, inventory, removeItem } from "../src/runtime/items/items";
import { walkable } from "../src/runtime/world/pathfinding";
import { makeProject, makeWorld, rule } from "./helpers";

/** Stanza vuota: 20 × 8 tile. */
const ROOM = Array(8).fill(".".repeat(20));
const VARS = { inventario: "", monete: 0, vita: 3 };

type World = ReturnType<typeof makeWorld>;

const click = (w: World, x: number, y: number) => {
  Object.assign(w.input.pointer, { x, y, pressed: true, moved: true });
  w.step(1);
  Object.assign(w.input.pointer, { pressed: false, moved: false });
};

const walker = (x: number, y: number, mode = "horizontal"): EntityData => ({
  id: "p",
  name: "Pepino",
  x,
  y,
  tags: ["giocatore"],
  blocks: [{ type: "PointClickMover", props: { mode, speed: 4 } }],
});

const spot = (id: string, x: number, y: number, props: Record<string, unknown> = {}): EntityData => ({
  id,
  name: id,
  x,
  y,
  blocks: [{ type: "Hotspot", props: { name: id, width: 16, height: 16, ...props } }],
});

describe("punta e clicca", () => {
  it("si cammina dove si clicca: visto di lato solo a destra e a sinistra", () => {
    const w = makeWorld(makeProject(ROOM, [walker(40, 100)], { variables: { ...VARS } }));
    const p = w.get("p");
    let arrived = 0;
    p.on("arrived", () => arrived++);
    click(w, 140, 60);
    w.step(10);
    expect(p.state).toBe("walk");
    expect(p.facingX).toBe(1);
    w.step(120);
    expect(p.x).toBeCloseTo(140, 5);
    expect(p.y).toBe(100);
    expect(p.state).toBe("idle");
    expect(arrived).toBe(1);
  });

  it("visto dall'alto gira intorno ai muri", () => {
    const rows = ["............", "............", ".....#......", ".....#......", ".....#......", ".....#......", "............", "............"];
    const w = makeWorld(makeProject(rows, [walker(40, 72, "free")], { variables: { ...VARS } }));
    const p = w.get("p");
    click(w, 136, 72);
    let inWall = false;
    for (let i = 0; i < 300; i++) {
      w.step(1);
      if (!walkable(w.scene.grid, Math.floor(p.worldX / 16), Math.floor((p.worldY - 1) / 16))) inWall = true;
    }
    expect(inWall).toBe(false);
    expect(p.x).toBeCloseTo(136, 5);
    expect(p.y).toBeCloseTo(72, 5);
  });

  it("il Punto cliccabile: il personaggio ci va, poi la descrizione e l'evento", () => {
    const w = makeWorld(makeProject(ROOM, [walker(40, 100), spot("quadro", 200, 100, { description: "Un bel quadro.", standX: -12 })], { variables: { ...VARS } }));
    const q = w.get("quadro");
    const hs = q.get("Hotspot")!;
    let clicked = 0;
    q.on("clicked", () => clicked++);
    Object.assign(w.input.pointer, { x: 200, y: 92, moved: true });
    w.step(1);
    expect(hs.def.conditions.isHovered.test(hs)).toBe(true);
    click(w, 200, 92);
    expect(w.messages).toEqual([]);
    w.step(180);
    expect(w.get("p").x).toBeCloseTo(188, 5);
    expect(w.messages).toEqual(["Un bel quadro."]);
    expect(clicked).toBe(1);
  });

  it("si raccoglie, si sceglie nell'inventario e si usa dove serve", () => {
    const p = makeProject(
      ROOM,
      [
        spot("moneta", 100, 100, { name: "Moneta", give: "moneta" }),
        spot("porta", 200, 100, { name: "Porta", needs: "moneta", rightText: "Aperta!" }),
        { id: "inv", name: "Inventario", x: 4, y: 4, blocks: [{ type: "Inventory", props: { slots: 4, size: 20 } }] },
      ],
      { variables: { ...VARS } },
    );
    p.items = [
      { id: "moneta", name: "Moneta", kind: "key" },
      { id: "sasso", name: "Sasso", kind: "key" },
    ];
    const w = makeWorld(p);
    const porta = w.get("porta");
    const events: string[] = [];
    for (const ev of ["rightItem", "wrongItem", "clicked"]) porta.on(ev, () => events.push(ev));
    click(w, 100, 92);
    expect(w.game.vars.inventario).toBe("moneta");
    expect(w.scene.entities.some((e) => e.id === "moneta" && !e.destroyed)).toBe(false);
    addItem(w.game.vars, "sasso");
    const inv = w.get("inv").get("Inventory")!;
    click(w, 14, 14); // prima casella: la moneta
    expect(inv.def.conditions.hasSelected.test(inv)).toBe(true);
    click(w, 200, 92);
    expect(events).toEqual(["rightItem"]);
    expect(w.messages).toContain("Aperta!");
    expect(hasItem(w.game.vars, "moneta")).toBe(false);
    expect(inv.def.conditions.hasSelected.test(inv)).toBe(false);
    click(w, 14, 14); // ora nella prima casella c'è il sasso
    click(w, 200, 92);
    expect(events).toEqual(["rightItem", "wrongItem"]);
    expect(w.messages).toContain("Non funziona.");
    expect(hasItem(w.game.vars, "sasso")).toBe(true);
  });

  it("le Regole mettono e controllano gli oggetti dell'inventario", () => {
    const w = makeWorld(
      makeProject(ROOM, [], {
        variables: { inventario: "", trovata: 0 },
        rules: [
          rule("metti", { type: "scene.start", params: {} }, [{ type: "inventory.add", params: { item: "chiave", qty: 2 } }]),
          rule("controlla", { type: "always", params: {} }, [{ type: "var.set", params: { variable: "trovata", value: "1" } }], [
            { type: "inventory.has", params: { item: "chiave", qty: 2 } },
          ]),
        ],
      }),
    );
    w.step(3);
    expect(inventory(w.game.vars)).toEqual([{ id: "chiave", qty: 2 }]);
    expect(w.game.vars.trovata).toBe(1);
    removeItem(w.game.vars, "chiave", 5);
    expect(w.game.vars.inventario).toBe("");
  });

  it("nei dialoghi il clic va avanti e sceglie la risposta sotto il puntatore", () => {
    let ended = false;
    const data: DialogueData[] = [
      {
        id: "d",
        name: "D",
        lines: [
          { id: "a", text: "Ciao", choices: [{ text: "Sì", goto: "b" }, { text: "No", goto: "c" }] },
          { id: "b", text: "Bene" },
          { id: "c", text: "Peccato" },
        ],
      },
    ];
    const runner = new DialogueRunner(
      () => data,
      () => ({}),
      () => (ended = true),
    );
    const idle = { pressed: () => false, pointer: { pressed: false } };
    const tap = { pressed: () => false, pointer: { pressed: true } };
    runner.start("d");
    runner.update(0.2, idle);
    expect(runner.fullyShown).toBe(true);
    runner.update(0.02, tap); // clic fuori dalle risposte: non sceglie
    expect(runner.current!.index).toBe(0);
    runner.update(0.02, tap, 1);
    expect(runner.current!.index).toBe(2);
    runner.update(0.2, idle);
    runner.update(0.02, tap);
    expect(ended).toBe(true);
  });
});

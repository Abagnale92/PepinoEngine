import { describe, expect, it } from "vitest";
import type { EntityData, PrefabData } from "@runtime";
import { COLL } from "../src/runtime/physics/collision";
import { TS, makeProject, makeWorld } from "./helpers";

/** Una scena vuota 20 × 14: il generatore ci scava dentro. */
const EMPTY = Array.from({ length: 14 }, () => ".".repeat(20));

const slime: PrefabData = {
  id: "slime",
  name: "Slime",
  tags: ["nemico"],
  blocks: [{ type: "Body", props: { width: 10, height: 10, group: "nemici", collidesWith: ["giocatore"] } }],
};

const scala: PrefabData = {
  id: "scala",
  name: "Scala",
  tags: ["scala"],
  blocks: [
    { type: "Body", props: { width: 12, height: 12, group: "trigger", collidesWith: ["giocatore"], world: false } },
    { type: "FloorExit", props: { target: "giocatore", floorVar: "piano", fade: 0 } },
  ],
};

const hero: EntityData = {
  id: "p",
  name: "Pepino",
  x: 24,
  y: 24,
  tags: ["giocatore"],
  blocks: [
    { type: "Body", props: { width: 10, height: 10, group: "giocatore", collidesWith: ["nemici", "trigger"] } },
    { type: "TopDownController", props: { speed: 4 } },
  ],
};

const generator = (props: Record<string, unknown> = {}): EntityData => ({
  id: "regia",
  name: "Sotterraneo",
  x: 0,
  y: 0,
  blocks: [
    {
      type: "DungeonGenerator",
      props: {
        rooms: 6,
        roomMin: 3,
        roomMax: 5,
        // Nel tileset dei test tutti i tile collidono: il pavimento resta vuoto (-1).
        floorTile: -1,
        wallTile: 0,
        seed: 42,
        player: "giocatore",
        exit: "scala",
        floorVar: "piano",
        spawns: [{ prefab: "slime", count: 2, perFloor: 1 }],
        ...props,
      },
    },
  ],
});

describe("sotterranei a caso (roguelike)", () => {
  it("scava stanze e corridoi, sposta il giocatore e mette l'uscita", () => {
    const w = makeWorld(makeProject(EMPTY, [hero, generator()], { prefabs: [slime, scala], variables: { piano: 1, vita: 3 } }));
    const gen = w.get("regia").get("DungeonGenerator")!;
    expect(gen.data.rooms.length).toBeGreaterThan(1);
    // Il giocatore è dentro una stanza, quindi su un tile libero.
    const p = w.get("p");
    expect(w.scene.grid.atPixel(p.worldX, p.worldY)).toBe(COLL.none);
    // C'è l'uscita, e sta anche lei su un tile libero.
    const exits = w.scene.findAll("scala");
    expect(exits).toHaveLength(1);
    expect(w.scene.grid.atPixel(exits[0].worldX, exits[0].worldY)).toBe(COLL.none);
    // I bordi restano di roccia.
    expect(w.scene.grid.get(0, 0)).toBe(COLL.solid);
    expect(w.logs.filter((l) => l.level !== "info")).toEqual([]);
  });

  it("con lo stesso seme la mappa è identica, con semi diversi cambia", () => {
    const build = (seed: number) => {
      const w = makeWorld(makeProject(EMPTY, [hero, generator({ seed })], { prefabs: [slime, scala], variables: { piano: 1, vita: 3 } }));
      return w.scene.data.layers[0].data.join("");
    };
    expect(build(42)).toBe(build(42));
    expect(build(42)).not.toBe(build(7));
  });

  it("più si scende, più nemici compaiono", () => {
    const count = (piano: number) => {
      const w = makeWorld(makeProject(EMPTY, [hero, generator()], { prefabs: [slime, scala], variables: { piano, vita: 3 } }));
      return w.scene.findAll("nemico").length;
    };
    expect(count(1)).toBe(2);
    expect(count(4)).toBe(5);
  });

  it("la scala porta al piano dopo: la variabile sale e la scena si ricarica", () => {
    const w = makeWorld(makeProject(EMPTY, [hero, generator()], { prefabs: [slime, scala], variables: { piano: 1, vita: 3 } }));
    const p = w.get("p");
    const uscita = w.scene.findAll("scala")[0];
    p.x = uscita.worldX;
    p.y = uscita.worldY;
    w.step(3);
    expect(w.game.vars.piano).toBe(2);
    expect(w.calls.some((c) => c.startsWith("goToScene:"))).toBe(true);
  });

  it("senza layer che collide avvisa invece di rompersi", () => {
    const project = makeProject(EMPTY, [generator()], { prefabs: [slime, scala] });
    project.scenes[0].layers[0].collides = false;
    const w = makeWorld(project);
    expect(w.logs.some((l) => l.level === "warn")).toBe(true);
    expect(w.get("regia").get("DungeonGenerator")!.data.rooms).toEqual([]);
  });

  it("la minimappa non disturba: si disegna senza errori", () => {
    const withMap: EntityData = { ...hero, blocks: [...hero.blocks, { type: "MiniMap", props: { size: 40, mark: "nemico" } }] };
    const w = makeWorld(makeProject(EMPTY, [withMap, generator()], { prefabs: [slime, scala], variables: { piano: 1, vita: 3 } }));
    w.step(5);
    expect(w.logs.filter((l) => l.level !== "info")).toEqual([]);
    expect(TS).toBe(16);
  });
});

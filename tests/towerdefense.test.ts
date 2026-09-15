import { describe, expect, it } from "vitest";
import type { EntityData, PrefabData } from "@runtime";
import { FLAT, makeProject, makeWorld } from "./helpers";

const point = (order: number, x: number, y: number, path = "strada"): EntityData => ({
  id: `punto${order}`,
  name: `Punto ${order}`,
  x,
  y,
  blocks: [{ type: "Waypoint", props: { path, order } }],
});

const walker = (props: Record<string, unknown>): EntityData => ({
  id: "w",
  name: "Slime",
  x: 20,
  y: 50,
  tags: ["nemico"],
  blocks: [{ type: "PathFollower", props: { path: "strada", ...props } }],
});

const ROUTE = [point(2, 100, 50), point(1, 20, 50), point(3, 100, 100)];

describe("tower defense", () => {
  it("segue i punti del percorso in ordine e alla fine sparisce", () => {
    const w = makeWorld(makeProject(FLAT, [...ROUTE, walker({ speed: 5 })]));
    const s = w.get("w");
    const reached: unknown[] = [];
    let ends = 0;
    s.on("reachedPoint", (i) => reached.push(i));
    s.on("reachedEnd", () => ends++);
    w.step(90);
    expect(s.x).toBeCloseTo(100, 3);
    expect(s.y).toBeCloseTo(90, 3);
    expect(s.direction).toBe("down");
    w.step(20);
    expect(reached).toEqual([0, 1, 2]);
    expect(ends).toBe(1);
    expect(s.destroyed).toBe(true);
  });

  it("con «Ricomincia il giro» continua a girare", () => {
    const w = makeWorld(makeProject(FLAT, [...ROUTE, walker({ speed: 8, atEnd: "loop", startAtFirst: true })]));
    const s = w.get("w");
    let laps = 0;
    s.on("lap", () => laps++);
    w.step(120);
    expect(laps).toBeGreaterThanOrEqual(1);
    expect(s.destroyed).toBe(false);
  });

  it("la piazzola costruisce con un clic solo se le monete bastano", () => {
    const torre: PrefabData = { id: "torre", name: "Torre", tags: ["torre"], blocks: [] };
    const spot: EntityData = { id: "spot", name: "Piazzola", x: 50, y: 80, blocks: [{ type: "BuildSpot", props: { prefab: "torre", cost: 20, variable: "monete" } }] };
    const w = makeWorld(makeProject(FLAT, [spot], { prefabs: [torre] }));
    const events: string[] = [];
    const s = w.get("spot");
    s.on("built", () => events.push("built"));
    s.on("tooExpensive", () => events.push("tooExpensive"));
    const click = (x: number, y: number) => {
      Object.assign(w.input.pointer, { x, y, pressed: true, moved: true });
      w.step(1);
      Object.assign(w.input.pointer, { pressed: false, moved: false });
    };
    click(50, 72);
    expect(events).toEqual(["tooExpensive"]);
    w.game.vars.monete = 30;
    click(90, 72);
    expect(events).toEqual(["tooExpensive"]);
    click(50, 72);
    expect(events).toEqual(["tooExpensive", "built"]);
    expect(w.game.vars.monete).toBe(10);
    expect(w.scene.findAll("torre")).toHaveLength(1);
    click(50, 72);
    expect(w.scene.findAll("torre")).toHaveLength(1);
  });

  it("le ondate crescono, contano nella variabile e avvisano quando sono finite", () => {
    const nemico: PrefabData = { id: "nemico", name: "Nemico", tags: ["nemico"], blocks: [] };
    const waves: EntityData = {
      id: "ondate",
      name: "Ondate",
      x: 8,
      y: 40,
      blocks: [{ type: "Waves", props: { prefab: "nemico", waves: 3, count: 2, increase: 1, interval: 0.5, pause: 1, startDelay: 0.5, variable: "ondata" } }],
    };
    const w = makeWorld(makeProject(FLAT, [waves], { prefabs: [nemico] }));
    const o = w.get("ondate");
    const started: unknown[] = [];
    let cleared = 0;
    o.on("waveStarted", (n) => started.push(n));
    o.on("cleared", () => cleared++);
    w.step(90);
    expect(started).toEqual([1]);
    expect(w.scene.findAll("nemico")).toHaveLength(2);
    w.step(600);
    expect(started).toEqual([1, 2, 3]);
    expect(w.scene.findAll("nemico")).toHaveLength(2 + 3 + 4);
    expect(w.game.vars.ondata).toBe(3);
    expect(cleared).toBe(0);
    for (const e of w.scene.findAll("nemico")) e.destroy();
    w.step(2);
    expect(cleared).toBe(1);
  });
});

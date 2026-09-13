import { describe, expect, it } from "vitest";
import { COLL, bodyCenter, findPath, lineOfSight, type EntityData } from "@runtime";
import { FLAT, TS, makeProject, makeWorld } from "./helpers";

const grid = (rows: string[]) => makeWorld(makeProject(rows, [])).scene.grid;

describe("pathfinding", () => {
  it("trova la strada intorno a un muro, passo dopo passo", () => {
    const g = grid(["........", "...#....", "...#....", "...#....", "........"]);
    const path = findPath(g, 1, 2, 6, 2)!;
    expect(path).not.toBeNull();
    expect(path.at(-1)).toEqual({ x: 6, y: 2 });
    let prev = { x: 1, y: 2 };
    for (const c of path) {
      expect(g.get(c.x, c.y)).not.toBe(COLL.solid);
      expect(Math.abs(c.x - prev.x) + Math.abs(c.y - prev.y)).toBe(1);
      prev = c;
    }
  });

  it("nessuna strada se il bersaglio è chiuso tra i muri", () => {
    const g = grid(["........", "....###.", "....#.#.", "....###.", "........"]);
    expect(findPath(g, 0, 0, 5, 2)).toBeNull();
  });

  it("in diagonale non taglia gli angoli dei muri", () => {
    const g = grid([".#..", "#...", "...."]);
    expect(findPath(g, 0, 0, 1, 1, { diagonal: true })).toBeNull();
    expect(findPath(g, 2, 0, 3, 1, { diagonal: true })).toEqual([{ x: 3, y: 1 }]);
  });

  it("evita i tile pericolo", () => {
    const g = grid(["......", "..^...", "......"]);
    const path = findPath(g, 0, 1, 4, 1)!;
    expect(path.some((c) => c.x === 2 && c.y === 1)).toBe(false);
  });

  it("linea di vista: i muri la bloccano", () => {
    const g = grid(["........", "...#....", "........"]);
    expect(lineOfSight(g, 0.5 * TS, 1.5 * TS, 6.5 * TS, 1.5 * TS)).toBe(false);
    expect(lineOfSight(g, 0.5 * TS, 0.5 * TS, 6.5 * TS, 0.5 * TS)).toBe(true);
  });
});

const hunter = (x: number, y: number, kind: "platform" | "topdown", chaser: Record<string, unknown> = {}, ctrl: Record<string, unknown> = {}): EntityData => ({
  id: "cacciatore",
  name: "Cacciatore",
  x,
  y,
  tags: ["nemico"],
  blocks: [
    { type: "Body", props: { width: 12, height: kind === "topdown" ? 8 : 10, group: "nemici" } },
    kind === "platform"
      ? { type: "PlatformController", props: { input: "ai", speed: 3, dash: false, airJumps: 0, ...ctrl } }
      : { type: "TopDownController", props: { input: "ai", speed: 4, ...ctrl } },
    { type: "Chaser", props: { seeRange: 6, ...chaser } },
  ],
});

const prey = (x: number, y: number): EntityData => ({
  id: "preda",
  name: "Preda",
  x,
  y,
  tags: ["giocatore"],
  blocks: [{ type: "Body", props: { width: 10, height: 12, group: "giocatore", world: false } }],
});

const gap = (w: ReturnType<typeof makeWorld>) => {
  const a = bodyCenter(w.get("cacciatore"));
  const b = bodyCenter(w.get("preda"));
  return Math.hypot(a.x - b.x, a.y - b.y);
};

describe("Insegue", () => {
  it("platform: vede il bersaglio e gli va incontro", () => {
    const w = makeWorld(makeProject(FLAT, [hunter(200, 128, "platform"), prey(120, 128)]));
    let spotted = false;
    w.get("cacciatore").on("spotted", () => (spotted = true));
    w.step(60);
    expect(spotted).toBe(true);
    expect(w.get("cacciatore").x).toBeLessThan(180);
  });

  it("troppo lontano: resta fermo", () => {
    const w = makeWorld(makeProject(FLAT, [hunter(200, 128, "platform"), prey(20, 128)]));
    w.step(60);
    expect(Math.abs(w.get("cacciatore").x - 200)).toBeLessThan(1);
  });

  it("un muro in mezzo gli toglie la vista", () => {
    const rows = [...FLAT];
    for (const r of [5, 6, 7]) rows[r] = "..........#.....";
    const w = makeWorld(makeProject(rows, [hunter(200, 128, "platform"), prey(120, 128)]));
    w.step(60);
    expect(w.get("cacciatore").get("Chaser")!.data.chasing).toBe(false);
  });

  it("platform: salta un ostacolo basso per raggiungerlo", () => {
    const rows = [...FLAT];
    rows[7] = ".........#......";
    const w = makeWorld(makeProject(rows, [hunter(200, 128, "platform", { lineOfSight: false, seeRange: 10 }), prey(100, 128)]));
    w.step(180);
    expect(w.get("cacciatore").x).toBeLessThan(9 * TS);
  });

  it("se il bersaglio si allontana troppo, smette di inseguire", () => {
    const w = makeWorld(makeProject(FLAT, [hunter(200, 128, "platform", { seeRange: 4, loseRange: 5 }), prey(150, 128)]));
    let lost = false;
    w.get("cacciatore").on("lost", () => (lost = true));
    w.step(10);
    expect(w.get("cacciatore").get("Chaser")!.data.chasing).toBe(true);
    w.get("preda").x = 10;
    w.step(2);
    expect(lost).toBe(true);
  });

  const maze = ["........", "........", "...#....", "...#....", "...#....", "........", "........"];

  it("top-down: gira intorno al muro e raggiunge il bersaglio", () => {
    const w = makeWorld(makeProject(maze, [hunter(24, 64, "topdown", { seeRange: 10, loseRange: 20, lineOfSight: false }, { directions: "8" }), prey(104, 64)]));
    w.step(240);
    expect(gap(w)).toBeLessThan(20);
  });

  it("top-down a 4 direzioni: ci arriva lo stesso", () => {
    const w = makeWorld(makeProject(maze, [hunter(24, 64, "topdown", { seeRange: 10, loseRange: 20, lineOfSight: false }, { directions: "4" }), prey(104, 64)]));
    w.step(300);
    expect(gap(w)).toBeLessThan(20);
  });
});

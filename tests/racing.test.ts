import { describe, expect, it } from "vitest";
import type { EntityData } from "@runtime";
import { TS, makeProject, makeWorld } from "./helpers";

/** Spiazzo senza muri: 30 × 20 tile. */
const LOT = Array(20).fill(".".repeat(30));

const car = (id: string, x: number, y: number, props: Record<string, unknown> = {}, extra: EntityData["blocks"] = []): EntityData => ({
  id,
  name: id,
  x,
  y,
  tags: ["giocatore"],
  blocks: [{ type: "Body", props: { width: 10, height: 10, world: false } }, { type: "CarController", props: { maxSpeed: 8, ...props } }, ...extra],
});

const checkpoint = (order: number, x: number, y: number): EntityData => ({
  id: `cp${order}`,
  name: `Traguardo ${order}`,
  x,
  y,
  blocks: [{ type: "Checkpoint", props: { order, width: 2, height: 2 } }],
});

describe("corse", () => {
  it("l'auto accelera fino alla velocità massima e sterza solo quando si muove", () => {
    const w = makeWorld(makeProject(LOT, [car("a", 100, 100)]));
    const a = w.get("a");
    w.input.hold("left");
    w.step(30);
    expect(a.fx.rot).toBe(0);
    expect(a.x).toBe(100);
    w.input.release("left");
    w.input.hold("up");
    w.step(120);
    expect(a.body!.vx).toBeGreaterThan(7 * TS);
    expect(a.body!.vx).toBeLessThanOrEqual(8 * TS + 1e-6);
    expect(a.state).toBe("drive");
    w.input.hold("right");
    w.step(20);
    expect(a.fx.rot).toBeGreaterThan(0.3);
    expect(a.body!.vy).toBeGreaterThan(0);
  });

  it("fuori dal layer della pista rallenta", () => {
    const p = makeProject(LOT, [car("in", 40, 60, { trackLayer: "pista" }), car("out", 40, 200, { trackLayer: "pista" })]);
    const W = 30;
    const H = 20;
    // Asfalto solo nelle prime 8 righe.
    const data = Array.from({ length: W * H }, (_, i) => (Math.floor(i / W) < 8 ? 0 : -1));
    p.scenes[0].layers.push({ id: "pista", name: "pista", tileset: "t", width: W, height: H, data, z: 1, collides: false });
    const w = makeWorld(p);
    w.input.hold("up");
    w.step(90);
    expect(w.get("in").body!.vx).toBeGreaterThan(7 * TS);
    expect(w.get("out").body!.vx).toBeLessThanOrEqual(4 * TS + 1e-6);
    const cc = w.get("out").get("CarController")!;
    expect(cc.def.conditions.isOffroad.test(cc)).toBe(true);
  });

  it("i giri si contano passando dai traguardi in ordine, poi la gara finisce", () => {
    const counter = { type: "LapCounter", props: { laps: 2, lapVariable: "giro", timeVariable: "tempo", bestVariable: "migliore" } };
    const w = makeWorld(
      makeProject(LOT, [checkpoint(0, 48, 48), checkpoint(1, 240, 48), checkpoint(2, 240, 240), { id: "p", name: "Pilota", x: 48, y: 48, blocks: [counter] }]),
    );
    const p = w.get("p");
    const events: string[] = [];
    p.on("lap", (n) => events.push(`lap${n}`));
    p.on("finished", () => events.push("finished"));
    const go = (x: number, y: number) => {
      p.x = x;
      p.y = y;
      w.step(10);
    };
    w.step(5);
    expect(w.game.vars.giro).toBe(1);
    go(48, 240); // fuori ordine: non conta
    go(240, 240);
    go(240, 48);
    go(240, 240);
    go(48, 48);
    expect(events).toEqual(["lap1"]);
    expect(w.game.vars.giro).toBe(2);
    go(240, 48);
    go(240, 240);
    go(48, 48);
    expect(events).toEqual(["lap1", "lap2", "finished"]);
    expect(Number(w.game.vars.tempo)).toBeGreaterThan(0.5);
    expect(Number(w.game.vars.migliore)).toBeGreaterThan(0);
    const lc = p.get("LapCounter")!;
    expect(lc.def.conditions.isFinished.test(lc)).toBe(true);
  });

  it("la classifica mette avanti chi ha passato più traguardi", () => {
    const lc = (pos = "") => ({ type: "LapCounter", props: { laps: 3, positionVariable: pos } });
    const w = makeWorld(
      makeProject(LOT, [
        checkpoint(0, 48, 48),
        checkpoint(1, 240, 48),
        checkpoint(2, 240, 240),
        { id: "io", name: "Io", x: 48, y: 48, blocks: [lc("posizione")] },
        { id: "lui", name: "Lui", x: 48, y: 48, blocks: [lc()] },
      ]),
    );
    w.step(2);
    w.get("lui").x = 240;
    w.step(2);
    expect(w.game.vars.posizione).toBe(2);
    const io = w.get("io");
    io.x = 240;
    w.step(2);
    io.y = 240;
    w.step(2);
    expect(w.game.vars.posizione).toBe(1);
  });

  it("l'avversario sul percorso aspetta il via e ruota verso dove va", () => {
    const pts = [
      { id: "w1", name: "P1", x: 200, y: 100, blocks: [{ type: "Waypoint", props: { path: "giro", order: 1 } }] },
      { id: "w2", name: "P2", x: 200, y: 200, blocks: [{ type: "Waypoint", props: { path: "giro", order: 2 } }] },
    ];
    const rival: EntityData = { id: "r", name: "Rivale", x: 100, y: 100, blocks: [{ type: "PathFollower", props: { path: "giro", speed: 6, autoStart: false, rotate: true, atEnd: "loop" } }] };
    const w = makeWorld(makeProject(LOT, [...pts, rival]));
    const r = w.get("r");
    w.step(30);
    expect(r.x).toBe(100);
    const pf = r.get("PathFollower")!;
    pf.def.actions.go.run(pf);
    w.step(60);
    expect(r.x).toBeCloseTo(196, 0);
    expect(r.fx.rot).toBeCloseTo(0, 3);
    w.step(20);
    expect(r.fx.rot).toBeCloseTo(Math.PI / 2, 3);
  });
});

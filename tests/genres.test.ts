import { describe, expect, it } from "vitest";
import type { EntityData } from "@runtime";
import { TS, makeProject, makeWorld } from "./helpers";

/** Strada senza muri: 60 × 12 tile. */
const STREET = Array(12).fill(".".repeat(60));

const fighter = (x: number, y: number, ctrl: Record<string, unknown> = {}, extra: EntityData["blocks"] = []): EntityData => ({
  id: "p",
  name: "Pepino",
  x,
  y,
  tags: ["giocatore"],
  blocks: [
    { type: "Body", props: { width: 10, height: 8, group: "giocatore", collidesWith: ["nemici"] } },
    { type: "BeatEmUpController", props: ctrl },
    ...extra,
  ],
});

describe("beat 'em up", () => {
  it("cammina avanti e in profondità con velocità diverse", () => {
    const w = makeWorld(makeProject(STREET, [fighter(100, 100, { speed: 4, depthSpeed: 2.5 })]));
    const p = w.get("p");
    w.input.hold("right");
    w.step(60);
    expect(p.x - 100).toBeGreaterThan(60);
    expect(p.x - 100).toBeLessThanOrEqual(4 * TS);
    w.input.release("right");
    w.step(10);
    const x = p.x;
    w.input.hold("down");
    w.step(60);
    expect(p.y - 100).toBeGreaterThan(36);
    expect(p.y - 100).toBeLessThanOrEqual(2.5 * TS);
    expect(p.x).toBeCloseTo(x, 3);
  });

  it("salta sull'asse dell'altezza e torna a terra: il corpo resta sulla strada", () => {
    const w = makeWorld(makeProject(STREET, [fighter(100, 100, { jumpHeight: 2, timeToApex: 0.3 })]));
    const p = w.get("p");
    const events: string[] = [];
    p.on("jumped", () => events.push("jumped"));
    p.on("landed", () => events.push("landed"));
    w.input.hold("jump");
    w.step(1);
    w.input.release("jump");
    let top = 0;
    for (let i = 0; i < 60; i++) {
      w.step(1);
      top = Math.max(top, p.elevation);
      expect(p.y).toBe(100);
    }
    expect(top).toBeGreaterThan(2 * TS - 1);
    expect(top).toBeLessThan(2 * TS + 1);
    expect(p.elevation).toBe(0);
    expect(events).toEqual(["jumped", "landed"]);
    expect(p.state).toBe("idle");
  });

  it("un nemico con «Attacco da solo» colpisce chi è a portata, ma non chi salta alto", () => {
    const enemy: EntityData = {
      id: "e",
      name: "Teppista",
      x: 60,
      y: 100,
      tags: ["nemico"],
      blocks: [
        { type: "Body", props: { width: 10, height: 8, group: "nemici", collidesWith: ["giocatore"] } },
        { type: "Attack", props: { mode: "auto", target: "giocatore", reach: 12, width: 16, height: 14, cooldown: 1 } },
      ],
    };
    const health = [{ type: "Health", props: { max: 3, invulnerability: 0, knockback: 0 } }];

    const w = makeWorld(makeProject(STREET, [enemy, fighter(72, 100, {}, health)]));
    w.step(30);
    expect(w.get("p").get("Health")!.data.hp).toBe(2);

    const w2 = makeWorld(makeProject(STREET, [enemy, fighter(72, 100, {}, health)]));
    const p2 = w2.get("p");
    for (let i = 0; i < 30; i++) {
      p2.elevation = 40;
      w2.step(1);
    }
    expect(p2.get("Health")!.data.hp).toBe(3);
  });
});

describe("camera", () => {
  it("beat 'em up: scorre solo in orizzontale e non torna indietro", () => {
    const cam = { type: "CameraFollow", props: { mode: "beatemup", noBacktrack: true, smoothing: 0, deadzoneW: 0, offsetY: 0 } };
    const w = makeWorld(makeProject(STREET, [fighter(160, 120, { speed: 6 }, [cam])]));
    const c = w.scene.camera;
    const y0 = c.y;
    w.input.hold("right");
    w.input.hold("up");
    w.step(60);
    const x1 = c.x;
    expect(x1).toBeGreaterThan(200);
    expect(c.y).toBe(y0);
    w.input.release("right");
    w.input.release("up");
    w.input.hold("left");
    // Frenando, Pepino scivola ancora un attimo in avanti: la camera lo segue, poi non torna più indietro.
    w.step(10);
    const x2 = c.x;
    expect(x2).toBeGreaterThanOrEqual(x1);
    w.step(60);
    expect(w.get("p").x).toBeLessThan(x1 - 100);
    expect(c.x).toBe(x2);
  });

  it("bloccata, tiene il giocatore dentro lo schermo", () => {
    const cam = { type: "CameraFollow", props: { mode: "beatemup", smoothing: 0, deadzoneW: 0, keepInView: true } };
    const w = makeWorld(makeProject(STREET, [fighter(200, 120, { speed: 8 }, [cam])]));
    const p = w.get("p");
    w.step(1);
    p.get("CameraFollow")!.actions.lock();
    const x0 = w.scene.camera.x;
    w.input.hold("right");
    w.step(120);
    expect(w.scene.camera.x).toBe(x0);
    expect(p.x).toBeLessThanOrEqual(x0 + 160 - 5 + 1e-6);
    p.get("CameraFollow")!.actions.unlock();
    w.step(30);
    expect(w.scene.camera.x).toBeGreaterThan(x0);
  });

  it("a stanze: passa da uno schermo all'altro e avvisa le Regole", () => {
    const rooms = Array(24).fill(".".repeat(40));
    const cam = { type: "CameraFollow", props: { mode: "rooms", smoothing: 0 } };
    const w = makeWorld(makeProject(rooms, [fighter(100, 100, {}, [cam])]));
    const c = w.scene.camera;
    expect([c.x, c.y]).toEqual([160, 90]);
    const changes: unknown[] = [];
    const p = w.get("p");
    p.on("roomChanged", (d) => changes.push(d));
    p.x = 400;
    w.step(1);
    expect([c.x, c.y]).toEqual([480, 90]);
    p.y = 250;
    w.step(1);
    expect([c.x, c.y]).toEqual([480, 270]);
    expect(changes).toEqual([
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);
  });
});

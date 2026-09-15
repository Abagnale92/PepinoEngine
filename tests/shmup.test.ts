import { describe, expect, it } from "vitest";
import type { EntityData, PrefabData } from "@runtime";
import { makeProject, makeWorld } from "./helpers";

/** Spazio vuoto: 20 × 40 tile (320 × 640 px), niente muri. */
const SPACE = Array(40).fill(".".repeat(20));

const rig = (speed = 4): EntityData => ({ id: "rig", name: "Scorrimento", x: 160, y: 550, blocks: [{ type: "AutoScroll", props: { direction: "up", speed } }] });

const ship = (extra: EntityData["blocks"] = []): EntityData => ({
  id: "s",
  name: "Navicella",
  x: 160,
  y: 600,
  tags: ["giocatore"],
  blocks: [{ type: "Body", props: { width: 10, height: 10, world: false } }, { type: "ShipController", props: { speed: 6 } }, ...extra],
});

const flyer = (id: string, x: number, y: number, props: Record<string, unknown>): EntityData => ({
  id,
  name: id,
  x,
  y,
  tags: ["nemico"],
  blocks: [{ type: "MovePattern", props }],
});

describe("shoot'em up", () => {
  it("lo scorrimento automatico porta la camera fino in cima e avvisa", () => {
    const w = makeWorld(makeProject(SPACE, [rig(4)]));
    const cam = w.scene.camera;
    const r = w.get("rig");
    let ends = 0;
    r.on("end", () => ends++);
    expect(cam.y).toBe(550);
    w.step(60);
    expect(cam.y).toBeCloseTo(550 - 64, 3);
    expect(r.y).toBeCloseTo(550 - 64, 3);
    w.step(500);
    expect(cam.y).toBe(90);
    expect(ends).toBe(1);
  });

  it("la navicella viene trascinata dallo schermo e non ne esce", () => {
    const w = makeWorld(makeProject(SPACE, [rig(4), ship()]));
    const s = w.get("s");
    const cam = w.scene.camera;
    w.step(60);
    expect(s.y).toBeLessThan(545);
    expect(s.y).toBeGreaterThan(530);
    w.input.hold("left");
    w.input.hold("down");
    w.step(120);
    const r = s.body!.rect();
    expect(r.x).toBeGreaterThanOrEqual(cam.x - 160 + 4 - 1e-6);
    expect(r.y + r.h).toBeLessThanOrEqual(cam.y + 90 - 4 + 1e-6);
    expect(s.state).toBe("left");
  });

  it("le traiettorie partono quando entrano nello schermo, fanno l'onda e spariscono uscendo", () => {
    const w = makeWorld(
      makeProject(SPACE, [
        flyer("lontano", 160, 400, { pattern: "straight", direction: 90, speed: 2 }),
        flyer("onda", 100, 50, { pattern: "wave", direction: 90, speed: 4, amplitude: 1, frequency: 1 }),
      ]),
    );
    const far = w.get("lontano");
    const wave = w.get("onda");
    let left = 0;
    wave.on("leftScreen", () => left++);
    w.step(15);
    expect(far.y).toBe(400);
    expect(wave.y).toBeCloseTo(66, 0);
    expect(wave.x).toBeCloseTo(84, 0);
    w.step(200);
    expect(wave.destroyed).toBe(true);
    expect(left).toBe(1);
    expect(far.destroyed).toBe(false);
  });

  it("in picchiata punta dove si trovava il bersaglio", () => {
    const target: EntityData = { id: "p", name: "Bersaglio", x: 200, y: 120, tags: ["giocatore"], blocks: [] };
    const w = makeWorld(makeProject(SPACE, [target, flyer("caccia", 100, 20, { pattern: "dive", speed: 3, target: "giocatore" })]));
    const c = w.get("caccia");
    w.step(30);
    expect(c.x - 100).toBeGreaterThan(12);
    expect(c.x - 100).toBeCloseTo(c.y - 20, 3);
  });

  it("Spara: verso l'alto a ventaglio, di continuo tenendo premuto", () => {
    const laser: PrefabData = {
      id: "laser",
      name: "Laser",
      blocks: [
        { type: "Body", props: { width: 2, height: 4, world: false, collidesWith: [] } },
        { type: "Projectile", props: { target: "nemico", lifetime: 2 } },
      ],
    };
    const gun = {
      type: "Shooter",
      props: { projectile: "laser", mode: "player", command: "attack", hold: true, aim: "fixed", angle: -90, count: 3, spread: 30, interval: 0.1, speed: 10 },
    };
    const w = makeWorld(makeProject(SPACE, [ship([gun])], { prefabs: [laser] }));
    const bullets = () => w.scene.entities.filter((e) => !e.destroyed && e.get("Projectile"));
    w.input.hold("attack");
    w.step(1);
    const first = bullets();
    expect(first).toHaveLength(3);
    const vx = first.map((b) => Math.round(b.body!.vx)).sort((a, b) => a - b);
    expect(vx[1]).toBe(0);
    expect(vx[0]).toBe(-vx[2]);
    expect(first.every((b) => b.body!.vy < 0)).toBe(true);
    w.step(12);
    expect(bullets().length).toBeGreaterThanOrEqual(6);
  });
});

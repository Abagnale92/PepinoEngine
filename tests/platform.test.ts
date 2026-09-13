import { describe, expect, it } from "vitest";
import { FLAT, TS, makeProject, makeWorld, player } from "./helpers";

/** Altezza massima raggiunta (in pixel) tenendo premuto salto. */
function apex(controller: Record<string, unknown> = {}, holdFrames = Infinity) {
  const w = makeWorld(makeProject(FLAT, [player(40, 8 * TS, controller)]));
  w.step(2);
  w.input.hold("jump");
  let minY = Infinity;
  let apexFrame = 0;
  for (let f = 0; f < 90; f++) {
    if (f === holdFrames) w.input.release("jump");
    w.step();
    const y = w.get("p").y;
    if (y < minY) {
      minY = y;
      apexFrame = f + 1;
    }
  }
  return { height: 8 * TS - minY, apexFrame };
}

describe("Controller Platform", () => {
  it("il salto raggiunge l'altezza impostata in tile", () => {
    const { height, apexFrame } = apex({ jumpHeight: 3.5, timeToApex: 0.38 });
    expect(Math.abs(height - 3.5 * TS)).toBeLessThan(1);
    // 0,38 s = circa 23 fotogrammi
    expect(Math.abs(apexFrame - 0.38 * 60)).toBeLessThanOrEqual(2);
  });

  it("anche un salto diverso rispetta l'altezza", () => {
    const { height } = apex({ jumpHeight: 2, timeToApex: 0.3 });
    expect(Math.abs(height - 2 * TS)).toBeLessThan(1);
  });

  it("rilasciando subito il tasto il salto è più basso", () => {
    const full = apex().height;
    const short = apex({}, 3).height;
    expect(short).toBeLessThan(full * 0.6);
  });

  it("doppio salto: uno in aria, non di più", () => {
    const w = makeWorld(makeProject(FLAT, [player(40, 8 * TS, { airJumps: 1 })]));
    w.step(2);
    let jumps = 0;
    w.get("p").on("jumped", () => jumps++);
    for (let k = 0; k < 3; k++) {
      w.input.hold("jump");
      w.step();
      w.input.release("jump");
      w.step(12);
    }
    expect(jumps).toBe(2);
  });

  it("coyote time: si salta anche appena dopo il bordo", () => {
    const rows = [...Array(8).fill("................"), "######.........."];
    const run = (coyoteTime: number) => {
      const w = makeWorld(makeProject(rows, [player(5 * TS + 8, 8 * TS, { coyoteTime, airJumps: 0 })]));
      w.step(2);
      w.input.hold("right");
      let guard = 0;
      while (w.get("p").body!.onGround && guard++ < 120) w.step();
      w.step(2);
      w.input.hold("jump");
      w.step();
      return w.get("p").body!.vy;
    };
    expect(run(0.1)).toBeLessThan(0);
    expect(run(0)).toBeGreaterThan(0);
  });

  it("memoria del salto: premuto poco prima di atterrare, parte all'atterraggio", () => {
    const w = makeWorld(makeProject(FLAT, [player(40, 8 * TS - 40, { jumpBuffer: 0.12, airJumps: 0 })]));
    let guard = 0;
    // Aspetta di essere a pochi pixel da terra, poi premi salto.
    while (w.get("p").y < 8 * TS - 6 && guard++ < 120) w.step();
    w.input.hold("jump");
    w.step();
    w.input.release("jump");
    let jumped = false;
    w.get("p").on("jumped", () => (jumped = true));
    w.step(8);
    expect(jumped).toBe(true);
  });

  it("dash: scatto nella direzione in cui guarda", () => {
    const w = makeWorld(makeProject([...Array(8).fill("..............................."), "###############################"], [player(40, 8 * TS, { dashSpeed: 18, dashTime: 0.16 })]));
    w.step(2);
    const x0 = w.get("p").x;
    w.input.hold("dash");
    w.step(10);
    const moved = w.get("p").x - x0;
    expect(moved).toBeGreaterThan(18 * TS * 0.16 * 0.85);
    expect(w.get("p").facingX).toBe(1);
  });

  it("gli stati seguono il movimento", () => {
    const w = makeWorld(makeProject(FLAT, [player(40, 8 * TS)]));
    w.step(2);
    expect(w.get("p").state).toBe("idle");
    w.input.hold("right");
    w.step(5);
    expect(w.get("p").state).toBe("run");
    w.input.hold("jump");
    w.step(3);
    expect(w.get("p").state).toBe("jump");
  });
});

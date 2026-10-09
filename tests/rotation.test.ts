import { describe, expect, it } from "vitest";
import { makeProject, makeWorld, TS } from "./helpers";
import { normalizeDegrees } from "../src/renderer/src/projectOps";

// Rotazione degli oggetti: si sceglie nell'editor (in gradi) e il gioco parte con lo sprite ruotato.

describe("rotazione degli oggetti", () => {
  it("la rotazione del progetto (gradi) arriva all'oggetto in radianti; il corpo resta dritto", () => {
    const w = makeWorld(
      makeProject(["#####", "#...#", "#####"], [
        {
          id: "a",
          name: "A",
          x: 2 * TS,
          y: 2 * TS,
          rotation: 90,
          blocks: [
            { type: "Sprite", props: { image: "" } },
            { type: "Body", props: { width: 10, height: 6 } },
          ],
        },
        { id: "b", name: "B", x: 3 * TS, y: 2 * TS, blocks: [{ type: "Sprite", props: { image: "" } }] },
      ]),
    );
    w.step(1);
    expect(w.get("a").rotation).toBeCloseTo(Math.PI / 2);
    expect(w.get("b").rotation).toBe(0);
    const body = w.get("a").body!;
    expect([body.w, body.h]).toEqual([10, 6]);
  });

  it("i gradi restano tra -180 e 180", () => {
    expect(normalizeDegrees(0)).toBe(0);
    expect(normalizeDegrees(370)).toBe(10);
    expect(normalizeDegrees(-190)).toBe(170);
    expect(normalizeDegrees(180)).toBe(180);
    expect(normalizeDegrees(-180)).toBe(180);
    expect(normalizeDegrees(45.26)).toBe(45.3);
  });
});

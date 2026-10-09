import { describe, expect, it } from "vitest";
import type { EntityData } from "@runtime";
import { makeProject, makeWorld, TS } from "./helpers";

// Animazioni per stato: lo stato sceglie l'animazione, la direzione sceglie la variante (walk_up, walk_side…).

const ARENA = ["##########", "#........#", "#........#", "#........#", "##########"];

const walker = (props: Record<string, unknown> = {}): EntityData => ({
  id: "a",
  name: "A",
  x: 4 * TS,
  y: 3 * TS,
  blocks: [
    { type: "Sprite", props: { image: "foglio" } },
    { type: "Body", props: { width: 10, height: 8 } },
    { type: "TopDownController", props: { input: "player", speed: 4, accelTime: 0.01, decelTime: 0.01 } },
    { type: "Animator", props },
  ],
});

/** Un foglio con solo le varianti per direzione: nessuna animazione «walk» o «idle» semplice. */
const ANIMS = {
  idle_down: { frames: [0], fps: 1, loop: true },
  walk_down: { frames: [1, 2, 3, 4], fps: 10, loop: true },
  idle_side: { frames: [5], fps: 1, loop: true },
  walk_side: { frames: [6, 7, 8, 9], fps: 10, loop: true },
  idle_up: { frames: [10], fps: 1, loop: true },
  walk_up: { frames: [11, 12, 13, 14], fps: 10, loop: true },
};

function world(props: Record<string, unknown> = {}) {
  const w = makeWorld(makeProject(ARENA, [walker(props)]));
  w.game.assets = { image: () => ({ data: { animations: ANIMS } }) };
  return w;
}

describe("Animazioni per stato", () => {
  it("con le sole varianti per direzione la camminata si anima (giù, di lato, su)", () => {
    const w = world();
    w.step(2);
    const e = w.get("a");
    expect(e.sprite!.frame).toBe(0);
    w.input.hold("down");
    const seen = new Set<number>();
    for (let i = 0; i < 30; i++) {
      w.step(1);
      seen.add(e.sprite!.frame);
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
    w.input.release("down");
    w.input.hold("left");
    w.step(10);
    expect([6, 7, 8, 9]).toContain(e.sprite!.frame);
    w.input.release("left");
    w.input.hold("up");
    w.step(10);
    expect([11, 12, 13, 14]).toContain(e.sprite!.frame);
    w.input.release("up");
    w.step(5);
    expect(e.sprite!.frame).toBe(10);
  });

  it("«Riproduci animazione» accetta un nome che esiste solo con le varianti", () => {
    const w = world();
    w.step(1);
    w.get("a").get("Animator")!.actions.play("walk");
    w.step(3);
    expect([1, 2, 3, 4]).toContain(w.get("a").sprite!.frame);
    expect(w.logs.filter((l) => l.level !== "info")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { COLL } from "@runtime";
import { FLAT, TS, makeProject, makeWorld, player } from "./helpers";

describe("collisioni con i tile", () => {
  it("cade e si ferma appoggiato sul pavimento", () => {
    const w = makeWorld(makeProject(FLAT, [player(40, 40, { input: "ai" })]));
    w.step(90);
    const p = w.get("p");
    expect(p.body!.onGround).toBe(true);
    expect(p.y).toBe(8 * TS);
    expect(p.body!.vy).toBe(0);
  });

  it("la piattaforma attraversabile si passa da sotto e ci si atterra sopra", () => {
    const rows = [...FLAT];
    rows[5] = "..====..........";
    const w = makeWorld(makeProject(rows, [player(3 * TS + 8, 8 * TS)]));
    w.input.hold("jump");
    w.step(90);
    const p = w.get("p");
    expect(p.y).toBe(5 * TS);
    expect(p.body!.onGround).toBe(true);
    expect(p.body!.groundCode).toBe(COLL.oneway);
  });

  it("giù + salto fa scendere dalla piattaforma attraversabile", () => {
    const rows = [...FLAT];
    rows[5] = "..====..........";
    const w = makeWorld(makeProject(rows, [player(3 * TS + 8, 5 * TS)]));
    w.step(5);
    expect(w.get("p").y).toBe(5 * TS);
    w.input.hold("down");
    w.input.hold("jump");
    w.step(1);
    w.input.release("jump");
    w.step(60);
    expect(w.get("p").y).toBe(8 * TS);
  });

  it("un muro ferma il movimento orizzontale", () => {
    const rows = [...FLAT];
    rows[6] = "........#.......";
    rows[7] = "........#.......";
    const w = makeWorld(makeProject(rows, [player(40, 8 * TS)]));
    w.input.hold("right");
    w.step(60);
    const p = w.get("p");
    expect(p.body!.right).toBe(8 * TS);
    expect(p.body!.onWallRight).toBe(true);
  });

  it("i bordi della scena bloccano come muri", () => {
    const w = makeWorld(makeProject(FLAT, [player(40, 8 * TS)]));
    w.input.hold("left");
    w.step(60);
    expect(w.get("p").body!.left).toBe(0);
  });

  it("sulle scale ci si arrampica", () => {
    const rows = [...FLAT];
    for (let y = 3; y <= 7; y++) rows[y] = ".....H..........";
    const w = makeWorld(makeProject(rows, [player(5 * TS + 8, 8 * TS)]));
    w.step(2);
    expect(w.get("p").body!.onLadder).toBe(true);
    w.input.hold("up");
    w.step(20);
    const p = w.get("p");
    expect(p.state).toBe("climb");
    expect(p.y).toBeLessThan(8 * TS - 20);
  });

  it("i tile pericolo tolgono vita", () => {
    const rows = [...FLAT];
    rows[7] = "..^^............";
    const w = makeWorld(
      makeProject(rows, [
        player(2 * TS + 8, 8 * TS, {}, { blocks: [{ type: "Health", props: { max: 3, variable: "vita", knockback: 0 } }] }),
      ]),
    );
    w.step(5);
    expect(w.game.vars.vita).toBe(2);
  });

  it("chi cade fuori dalla scena perde tutta la vita", () => {
    const rows = [...Array(8).fill("................"), "######.........."];
    const project = makeProject(rows, [
      player(8 * TS, 8 * TS, {}, { blocks: [{ type: "Health", props: { max: 3, variable: "vita", onDeath: "none" } }] }),
    ]);
    project.scenes[0].openBottom = true;
    const w = makeWorld(project);
    w.step(120);
    expect(w.game.vars.vita).toBe(0);
  });
});

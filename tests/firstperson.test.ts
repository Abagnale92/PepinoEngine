import { describe, expect, it } from "vitest";
import type { EntityData } from "@runtime";
import { castRay } from "../src/runtime/blocks/firstperson";
import { makeProject, makeWorld } from "./helpers";

/** Stanza vista dall'alto 10 × 7 tile con un pezzo di muro in mezzo (colonna 5, righe 3-4). */
const MAP = ["##########", "#........#", "#........#", "#....#...#", "#....#...#", "#........#", "##########"];

const fp = (x: number, y: number, extra: EntityData["blocks"] = []): EntityData => ({
  id: "p",
  name: "Pepino",
  x,
  y,
  tags: ["giocatore"],
  blocks: [{ type: "Body", props: { width: 10, height: 10 } }, { type: "FirstPersonController", props: { speed: 4, turn: 90 } }, ...extra],
});

const enemy = (id: string, x: number, y: number): EntityData => ({
  id,
  name: id,
  x,
  y,
  tags: ["nemico"],
  blocks: [
    { type: "Body", props: { width: 10, height: 10, world: false } },
    { type: "Health", props: { max: 3, invulnerability: 0, knockback: 0, onDeath: "none" } },
  ],
});

type World = ReturnType<typeof makeWorld>;
const press = (w: World, action: string) => {
  w.input.hold(action);
  w.step(1);
  w.input.release(action);
};

describe("prima persona", () => {
  it("il raggio si ferma sul primo muro", () => {
    const w = makeWorld(makeProject(MAP, []));
    const hit = castRay(w.scene.grid, 2.5, 3.5, 1, 0)!;
    expect(hit.dist).toBeCloseTo(2.5, 5);
    expect([hit.mapX, hit.mapY, hit.side]).toEqual([5, 3, 0]);
    const up = castRay(w.scene.grid, 2.5, 3.5, 0, -1)!;
    expect(up.dist).toBeCloseTo(2.5, 5);
    expect(up.side).toBe(1);
  });

  it("su va avanti dove si guarda, sinistra e destra girano, Dash + destra fa il passo di lato", () => {
    const w = makeWorld(makeProject(MAP, [fp(40, 45)]));
    const p = w.get("p");
    w.input.hold("up");
    w.step(30);
    expect(p.x).toBeGreaterThan(65);
    expect(p.y).toBeCloseTo(45, 0);
    w.input.release("up");
    w.input.hold("left");
    w.step(60);
    w.input.release("left");
    expect(p.get("FirstPersonController")!.data.angle).toBeCloseTo(-Math.PI / 2, 1);
    const y0 = p.y;
    w.input.hold("up");
    w.step(10);
    w.input.release("up");
    expect(p.y).toBeLessThan(y0 - 4);
    const x0 = p.x;
    w.input.hold("dash");
    w.input.hold("right");
    w.step(10);
    expect(p.x).toBeGreaterThan(x0 + 4);
  });

  it("l'arma colpisce il nemico nel mirino, non quello dietro un muro, e consuma le munizioni", () => {
    const weapon = { type: "FirstPersonWeapon", props: { weapons: [{ name: "Sparasemi", damage: 1, interval: 0.1, range: 12, ammo: "munizioni" }] } };
    const w = makeWorld(
      makeProject(MAP, [fp(24, 45, [weapon]), enemy("davanti", 104, 45), enemy("dietro", 120, 61)], { variables: { munizioni: 2 } }),
    );
    const hits: string[] = [];
    let empty = 0;
    const p = w.get("p");
    p.on("hit", (o) => hits.push((o as { id: string }).id));
    p.on("empty", () => empty++);
    press(w, "attack");
    expect(hits).toEqual(["davanti"]);
    expect(w.get("davanti").get("Health")!.data.hp).toBe(2);
    expect(w.game.vars.munizioni).toBe(1);
    // Mira al nemico dietro il muro: il colpo si ferma sul muro.
    p.y = 61;
    w.step(12);
    press(w, "attack");
    expect(hits).toEqual(["davanti"]);
    expect(w.game.vars.munizioni).toBe(0);
    w.step(12);
    press(w, "attack");
    expect(empty).toBe(1);
  });

  it("si cambia arma con il comando: spara solo quella in mano e il cambio è animato", () => {
    const arsenal = {
      type: "FirstPersonWeapon",
      props: {
        weapons: [
          { name: "Sparasemi", damage: 1, interval: 0.1, range: 12, ammo: "munizioni" },
          { name: "Lanciapeperoncini", damage: 3, interval: 0.1, range: 12, ammo: "peperoncini", unlock: "arma2" },
        ],
      },
    };
    const w = makeWorld(
      makeProject(MAP, [fp(24, 45, [arsenal]), enemy("davanti", 104, 45)], { variables: { munizioni: 5, peperoncini: 5, arma2: 0 } }),
    );
    const p = w.get("p");
    const arms = p.get("FirstPersonWeapon")!;
    w.step(1);
    expect(arms.data.i).toBe(0);
    // La seconda arma non è ancora disponibile: il comando non cambia nulla.
    press(w, "nextItem");
    expect(arms.data.i).toBe(0);
    w.game.vars.arma2 = 1;
    press(w, "nextItem");
    expect(arms.data.switching).toBeGreaterThan(0);
    // Mentre l'arma scende e sale non si spara.
    w.input.hold("attack");
    w.step(6);
    w.input.release("attack");
    expect(w.game.vars.munizioni).toBe(5);
    w.step(30);
    expect(arms.data.i).toBe(1);
    expect(arms.data.switching).toBe(0);
    // Adesso sparano i peperoncini, che fanno 3 di danno.
    press(w, "attack");
    expect(w.game.vars.peperoncini).toBe(4);
    expect(w.game.vars.munizioni).toBe(5);
    expect(w.get("davanti").get("Health")!.data.hp).toBe(0);
    // Il giro delle armi torna alla prima.
    press(w, "nextItem");
    w.step(30);
    expect(arms.data.i).toBe(0);
  });

  it("la Vista in prima persona prende il posto della scena vista dall'alto", () => {
    const w = makeWorld(makeProject(MAP, [fp(40, 45, [{ type: "FirstPersonView", props: {} }])]));
    expect(w.scene.firstPerson?.def.type).toBe("FirstPersonView");
    w.get("p").destroy();
    w.step(1);
    expect(w.scene.firstPerson).toBeNull();
  });
});

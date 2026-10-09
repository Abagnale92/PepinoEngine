import { describe, expect, it } from "vitest";
import type { EntityData } from "@runtime";
import { TS, makeProject, makeWorld } from "./helpers";

/** Una stanza 10 × 7 vista dall'alto, con un muro in mezzo (colonna 5, righe 2-4). */
const ROOM = ["##########", "#........#", "#....#...#", "#....#...#", "#....#...#", "#........#", "##########"];

const hero = (x: number, y: number, extra: EntityData["blocks"] = []): EntityData => ({
  id: "p",
  name: "Pepino",
  x,
  y,
  tags: ["giocatore"],
  blocks: [
    { type: "Body", props: { width: 10, height: 10, group: "giocatore", collidesWith: ["nemici"] } },
    { type: "TopDownController", props: { speed: 4, directions: "8" } },
    ...extra,
  ],
});

const monster = (x: number, y: number, props: Record<string, unknown> = {}): EntityData => ({
  id: "ombra",
  name: "Ombra",
  x,
  y,
  tags: ["mostro", "nemico"],
  blocks: [
    { type: "Body", props: { width: 10, height: 10, group: "nemici", collidesWith: ["giocatore"] } },
    { type: "TopDownController", props: { input: "ai", speed: 1, directions: "8" } },
    { type: "Stalker", props: { target: "giocatore", seeRange: 6, hearRange: 4, hearSpeed: 2, patience: 3, ...props } },
  ],
});

describe("horror", () => {
  it("la torcia consuma la batteria, si spegne a zero e si ricarica", () => {
    const w = makeWorld(
      makeProject(ROOM, [hero(40, 40, [{ type: "Flashlight", props: { battery: "batteria", drain: 60, command: "item" } }])], {
        variables: { batteria: 100, vita: 3 },
      }),
    );
    const torch = w.get("p").get("Flashlight")!;
    w.step(30);
    expect(Number(w.game.vars.batteria)).toBeLessThan(80);
    // Il comando la spegne e la riaccende.
    w.input.hold("item");
    w.step(1);
    w.input.release("item");
    expect(torch.data.on).toBe(false);
    const left = Number(w.game.vars.batteria);
    w.step(30);
    expect(Number(w.game.vars.batteria)).toBe(left);
    w.input.hold("item");
    w.step(1);
    w.input.release("item");
    // Finita la batteria si spegne da sola.
    w.game.vars.batteria = 0;
    let dead = 0;
    w.get("p").on("dead", () => dead++);
    w.step(2);
    expect(torch.data.on).toBe(false);
    expect(dead).toBe(1);
    torch.actions.charge(40);
    expect(Number(w.game.vars.batteria)).toBe(40);
  });

  it("chi cerca al buio sente i rumori e insegue quando vede, ma non chi è nascosto", () => {
    // Sguardo a tutto tondo: così il test non dipende da dove sta girando la testa mentre vaga.
    const w = makeWorld(makeProject(ROOM, [hero(40, 40), monster(120, 40, { fov: 360 })], { variables: { vita: 3 } }));
    const stalker = w.get("ombra").get("Stalker")!;
    const p = w.get("p");
    // Fermo e lontano: il mostro vaga.
    w.step(2);
    expect(["wander", "search"]).toContain(stalker.data.mode);
    // Il giocatore corre vicino: viene visto e inseguito.
    p.x = 96;
    w.input.hold("left");
    w.step(6);
    expect(stalker.data.mode).toBe("hunt");
    // Nascosto: il mostro lo perde di vista.
    p.tags.add("nascosto");
    w.step(4);
    expect(stalker.data.mode).not.toBe("hunt");
  });

  it("il coraggio cala al buio, risale con la torcia e avvisa quando finisce", () => {
    const project = makeProject(ROOM, [hero(40, 40, [{ type: "Sanity", props: { variable: "coraggio", max: 100, darkLoss: 60, recover: 60, low: 30, monster: "mostro" } }])], {
      variables: { coraggio: 100, vita: 3 },
    });
    project.scenes[0].ambient = "#101010";
    const w = makeWorld(project);
    const p = w.get("p");
    w.step(60);
    expect(Number(w.game.vars.coraggio)).toBeLessThan(50);
    let scared = 0;
    let empty = 0;
    p.on("scared", () => scared++);
    p.on("empty", () => empty++);
    w.step(60);
    expect(scared).toBe(1);
    expect(empty).toBe(1);
    expect(Number(w.game.vars.coraggio)).toBe(0);
  });

  it("nel nascondiglio si sparisce e si torna fuori con lo stesso comando", () => {
    const armadio: EntityData = {
      id: "armadio",
      name: "Armadio",
      x: 60,
      y: 40,
      blocks: [{ type: "HidingSpot", props: { target: "giocatore", range: 1.5, command: "action", hideTag: "nascosto" } }],
    };
    const w = makeWorld(makeProject(ROOM, [hero(56, 40), armadio], { variables: { vita: 3 } }));
    const p = w.get("p");
    const spot = w.get("armadio").get("HidingSpot")!;
    w.input.hold("action");
    w.step(1);
    w.input.release("action");
    expect(spot.data.who).toBe(p);
    expect(p.visible).toBe(false);
    expect(p.hasTag("nascosto")).toBe(true);
    w.step(10);
    expect(p.worldX).toBe(60);
    w.input.hold("action");
    w.step(1);
    w.input.release("action");
    expect(spot.data.who).toBeNull();
    expect(p.visible).toBe(true);
    expect(p.hasTag("nascosto")).toBe(false);
    expect(TS).toBe(16);
  });

  it("nel nascondiglio il mostro non fa male e il coraggio risale", () => {
    const armadio: EntityData = {
      id: "armadio",
      name: "Armadio",
      x: 60,
      y: 40,
      blocks: [{ type: "HidingSpot", props: { target: "giocatore", range: 1.5, command: "action", hideTag: "nascosto" } }],
    };
    const ombra: EntityData = {
      id: "ombra",
      name: "Ombra",
      x: 60,
      y: 40,
      tags: ["mostro", "nemico"],
      blocks: [
        { type: "Body", props: { width: 10, height: 10, group: "nemici", collidesWith: ["giocatore"] } },
        { type: "ContactDamage", props: { target: "giocatore", amount: 1, stompable: false } },
      ],
    };
    const eroe = hero(56, 40, [
      { type: "Health", props: { max: 3, variable: "vita", onDeath: "none" } },
      { type: "Sanity", props: { variable: "coraggio", max: 100, fearLoss: 20, fearRange: 4, monster: "mostro", recover: 5, darkLoss: 5 } },
    ]);
    const p0 = makeProject(ROOM, [eroe, armadio, ombra], { variables: { vita: 3, coraggio: 100 } });
    p0.scenes[0].ambient = "#101018";
    const w = makeWorld(p0);
    w.input.hold("action");
    w.step(1);
    w.input.release("action");
    w.game.vars.coraggio = 40;
    w.step(60);
    expect(Number(w.game.vars.vita)).toBe(3);
    expect(Number(w.game.vars.coraggio)).toBeGreaterThan(44);
  });
});

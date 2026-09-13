import { describe, expect, it } from "vitest";
import type { BlockData, EntityData, PrefabData } from "@runtime";
import { FLAT, TS, makeProject, makeWorld, player } from "./helpers";

const seme: PrefabData = {
  id: "seme",
  name: "Seme",
  blocks: [
    { type: "Sprite", props: { origin: "center" } },
    { type: "Body", props: { width: 6, height: 6, group: "proiettili", world: true } },
    { type: "Projectile", props: { target: "giocatore", damage: 1 } },
  ],
};

const hero = (x: number, extra: BlockData[] = []) =>
  player(x, 8 * TS, { input: "ai" }, { blocks: [{ type: "Health", props: { max: 3, variable: "vita", invulnerability: 0, knockback: 0 } }, ...extra] });

const enemy = (id: string, x: number, hp = 3): EntityData => ({
  id,
  name: id,
  x,
  y: 8 * TS,
  tags: ["nemico"],
  blocks: [
    { type: "Body", props: { width: 12, height: 12, group: "nemici", world: false } },
    { type: "Health", props: { max: hp, invulnerability: 0, knockback: 0 } },
  ],
});

const hp = (w: ReturnType<typeof makeWorld>, id: string) => w.get(id).get("Health")!.data.hp;

describe("Spara e Proiettile", () => {
  it("una torretta spara al giocatore e lo ferisce", () => {
    const turret: EntityData = {
      id: "torretta",
      name: "Torretta",
      x: 200,
      y: 8 * TS,
      tags: ["nemico"],
      blocks: [
        { type: "Body", props: { width: 12, height: 12, group: "nemici", world: false } },
        { type: "Shooter", props: { projectile: "seme", mode: "auto", aim: "target", range: 10, interval: 1, speed: 8, offsetX: 0, offsetY: -6 } },
      ],
    };
    const w = makeWorld(makeProject(FLAT, [turret, hero(100)], { prefabs: [seme] }));
    let shots = 0;
    w.get("torretta").on("shot", () => shots++);
    w.step(120);
    expect(shots).toBeGreaterThanOrEqual(1);
    expect(w.game.vars.vita).toBeLessThan(3);
    expect(w.get("torretta").facingX).toBe(-1);
  });

  it("il proiettile sparisce contro un muro", () => {
    const w = makeWorld(makeProject(FLAT, [], { prefabs: [seme] }));
    const s = w.scene.spawn("seme", 40, 100)!;
    s.body!.vx = -300;
    w.step(20);
    expect(s.destroyed).toBe(true);
  });

  it("il proiettile sparisce da solo dopo la sua durata", () => {
    const w = makeWorld(makeProject(FLAT, [], { prefabs: [{ ...seme, blocks: [...seme.blocks.slice(0, 2), { type: "Projectile", props: { lifetime: 0.5 } }] }] }));
    const s = w.scene.spawn("seme", 100, 60)!;
    s.body!.vx = 0;
    w.step(40);
    expect(s.destroyed).toBe(true);
  });

  it("in modalità giocatore spara solo quando premi il comando", () => {
    const w = makeWorld(
      makeProject(FLAT, [hero(100, [{ type: "Shooter", props: { projectile: "seme", mode: "player", command: "attack", aim: "facing", interval: 0.5, speed: 8 } }])], {
        prefabs: [seme],
      }),
    );
    const count = () => w.scene.entities.filter((e) => e.prefab === "seme").length;
    w.step(10);
    expect(count()).toBe(0);
    w.input.hold("attack");
    w.step(10);
    expect(count()).toBe(1);
    w.input.release("attack");
    w.step(40);
    w.input.hold("attack");
    w.step(1);
    expect(count()).toBe(2);
  });
});

describe("Attacco corpo a corpo", () => {
  const fighter = () => hero(100, [{ type: "Attack", props: { target: "nemico", damage: 1 } }]);

  it("colpisce chi è davanti, solo nel colpo attivo, una volta per attacco", () => {
    const w = makeWorld(makeProject(FLAT, [fighter(), enemy("davanti", 118), enemy("dietro", 82)]));
    w.step(2);
    w.input.hold("attack");
    w.step(2);
    expect(hp(w, "davanti")).toBe(3);
    expect(w.get("p").state).toBe("attack");
    w.step(10);
    expect(hp(w, "davanti")).toBe(2);
    expect(hp(w, "dietro")).toBe(3);
    w.input.release("attack");
    w.step(20);
    expect(hp(w, "davanti")).toBe(2);
  });

  it("finito un attacco se ne può fare un altro", () => {
    const w = makeWorld(makeProject(FLAT, [fighter(), enemy("davanti", 118)]));
    for (let k = 0; k < 2; k++) {
      w.input.hold("attack");
      w.step(30);
      w.input.release("attack");
      w.step(2);
    }
    expect(hp(w, "davanti")).toBe(1);
  });

  it("un blocco disattivato non attacca finché una Regola non lo attiva", () => {
    const p = fighter();
    p.blocks.find((b) => b.type === "Attack")!.enabled = false;
    const w = makeWorld(makeProject(FLAT, [p, enemy("davanti", 118)]));
    w.input.hold("attack");
    w.step(20);
    expect(hp(w, "davanti")).toBe(3);
    w.get("p").get("Attack")!.enabled = true;
    w.input.release("attack");
    w.step();
    w.input.hold("attack");
    w.step(20);
    expect(hp(w, "davanti")).toBe(2);
  });
});

describe("Generatore", () => {
  const cosa: PrefabData = { id: "cosa", name: "Cosa", tags: ["cosa"], blocks: [] };
  const gen = (props: Record<string, unknown>): EntityData => ({
    id: "gen",
    name: "Generatore",
    x: 50,
    y: 50,
    blocks: [{ type: "Spawner", props: { prefab: "cosa", interval: 0.5, startDelay: 0, ...props } }],
  });

  it("non supera il massimo e rimpiazza chi sparisce", () => {
    const w = makeWorld(makeProject(FLAT, [gen({ max: 2 })], { prefabs: [cosa] }));
    w.step(180);
    expect(w.scene.findAll("cosa")).toHaveLength(2);
    w.scene.findAll("cosa")[0].destroy();
    w.step(40);
    expect(w.scene.findAll("cosa")).toHaveLength(2);
  });

  it("rispetta il totale da creare", () => {
    const w = makeWorld(makeProject(FLAT, [gen({ max: 10, limit: 3 })], { prefabs: [cosa] }));
    w.step(300);
    expect(w.scene.findAll("cosa")).toHaveLength(3);
  });
});

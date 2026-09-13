import { describe, expect, it } from "vitest";
import type { EntityData } from "@runtime";
import { FLAT, TS, makeProject, makeWorld, player, rule } from "./helpers";

const slime = (x: number, y: number): EntityData => ({
  id: "slime",
  name: "Slime",
  x,
  y,
  tags: ["nemico"],
  blocks: [
    { type: "Body", props: { width: 12, height: 9, group: "nemici", collidesWith: ["giocatore"] } },
    { type: "Health", props: { max: 1, invulnerability: 0, knockback: 0 } },
    { type: "ContactDamage", props: { target: "giocatore" } },
  ],
});

const hero = (x: number, y: number) =>
  player(x, y, {}, { blocks: [{ type: "Health", props: { max: 3, variable: "vita", invulnerability: 1 } }] });

describe("combattimento", () => {
  it("saltando sopra un nemico lo si schiaccia e si rimbalza", () => {
    const w = makeWorld(
      makeProject(FLAT, [slime(100, 8 * TS), hero(100, 60)], {
        variables: { vita: 3, punti: 0 },
        rules: [rule("r", { type: "event", params: { target: "#nemico", event: "stomped" } }, [{ type: "var.add", params: { amount: 10, variable: "punti" } }])],
      }),
    );
    let bounced = false;
    for (let i = 0; i < 60 && !w.get("slime")?.destroyed; i++) {
      w.step();
      if (w.get("p").body!.vy < 0) bounced = true;
    }
    w.step();
    expect(w.scene.entities.some((e) => e.id === "slime")).toBe(false);
    expect(bounced).toBe(true);
    expect(w.game.vars.vita).toBe(3);
    expect(w.game.vars.punti).toBe(10);
  });

  it("toccandolo di lato ci si fa male, poi si è invulnerabili per un po'", () => {
    const w = makeWorld(makeProject(FLAT, [slime(100, 8 * TS), hero(60, 8 * TS)]));
    w.step(2);
    w.input.hold("right");
    let guard = 0;
    while (w.game.vars.vita === 3 && guard++ < 120) w.step();
    expect(w.game.vars.vita).toBe(2);
    // Continua a spingere contro il nemico per mezzo secondo: l'invulnerabilità evita altri colpi.
    w.step(30);
    expect(w.game.vars.vita).toBe(2);
  });

  it("le monete si raccolgono una volta sola", () => {
    const coin: EntityData = {
      id: "coin",
      name: "Moneta",
      x: 60,
      y: 8 * TS - 8,
      blocks: [
        { type: "Sprite", props: { origin: "center" } },
        { type: "Body", props: { width: 8, height: 8, group: "raccoglibili", collidesWith: ["giocatore"], world: false } },
        { type: "Collectible", props: { variable: "monete", amount: 1 } },
      ],
    };
    const w = makeWorld(makeProject(FLAT, [coin, player(40, 8 * TS)]));
    w.step(2);
    w.input.hold("right");
    w.step(30);
    expect(w.game.vars.monete).toBe(1);
    expect(w.scene.entities.some((e) => e.id === "coin")).toBe(false);
  });

  it("alla morte con «Riavvia la scena» chiede il riavvio", () => {
    const w = makeWorld(makeProject(FLAT, [player(40, 8 * TS, {}, { blocks: [{ type: "Health", props: { max: 1, onDeath: "restart" } }] })]));
    w.get("p").get("Health")!.actions.damage(1);
    expect(w.calls).toContain("restartScene");
  });
});

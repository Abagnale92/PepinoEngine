import { describe, expect, it } from "vitest";
import type { EntityData } from "@runtime";
import { FLAT, TS, makeProject, makeWorld } from "./helpers";

/** Un lottatore: corpo, controller, salute e un colpo corpo a corpo. */
const fighter = (id: string, x: number, tags: string[], props: Record<string, unknown> = {}, extra: EntityData["blocks"] = []): EntityData => ({
  id,
  name: id,
  x,
  y: 8 * TS,
  tags,
  blocks: [
    { type: "Body", props: { width: 12, height: 20, group: "giocatore", collidesWith: ["nemici"] } },
    { type: "FighterController", props },
    { type: "Health", props: { max: 5, invulnerability: 0, knockback: 0, onDeath: "none" } },
    ...extra,
  ],
});

const punch = (target: string) => ({
  type: "Attack",
  props: { mode: "ai", target, damage: 1, reach: 12, width: 16, height: 18, startup: 0, active: 0.1, recovery: 0.1 },
});

describe("picchiaduro 1 contro 1", () => {
  it("i due si guardano sempre in faccia e avanti e indietro cambiano velocità", () => {
    const w = makeWorld(
      makeProject(FLAT, [fighter("p", 60, ["giocatore"], { opponent: "avversario", speed: 4, backSpeed: 2 }), fighter("cpu", 180, ["avversario"], { input: "ai", opponent: "giocatore" })]),
    );
    const p = w.get("p");
    const cpu = w.get("cpu");
    w.step(2);
    expect(p.facingX).toBe(1);
    expect(cpu.facingX).toBe(-1);
    // Verso l'avversario si va più veloci che all'indietro.
    const x0 = p.x;
    w.input.hold("right");
    w.step(30);
    w.input.release("right");
    const avanti = p.x - x0;
    const x1 = p.x;
    w.input.hold("left");
    w.step(30);
    w.input.release("left");
    expect(avanti).toBeGreaterThan(x1 - p.x);
    expect(p.x).toBeLessThan(x1);
  });

  it("tenendo indietro si para: il colpo da davanti non fa danno", () => {
    const w = makeWorld(
      makeProject(FLAT, [
        fighter("p", 100, ["giocatore"], { opponent: "avversario" }),
        fighter("cpu", 118, ["avversario"], { input: "ai", opponent: "giocatore" }, [punch("giocatore")]),
      ]),
    );
    const p = w.get("p");
    const hp = p.get("Health")!;
    const attack = w.get("cpu").get("Attack")!;
    w.step(2);
    // Senza parata il colpo arriva.
    attack.actions.attack();
    w.step(20);
    expect(hp.data.hp).toBe(4);
    // Tenendo indietro (a sinistra, l'avversario è a destra) si para.
    w.input.hold("left");
    w.step(2);
    expect(p.get("FighterController")!.data.guarding).toBe(true);
    let blocked = 0;
    p.on("blocked", () => blocked++);
    p.x = 100;
    attack.actions.attack();
    w.step(6);
    expect(hp.data.hp).toBe(4);
    expect(blocked).toBe(1);
  });

  it("abbassandosi il corpo diventa più basso e si torna su lasciando Giù", () => {
    const w = makeWorld(makeProject(FLAT, [fighter("p", 100, ["giocatore"], { opponent: "avversario" })]));
    const p = w.get("p");
    w.step(2);
    const h = p.body!.h;
    w.input.hold("down");
    w.step(2);
    expect(p.body!.h).toBeLessThan(h);
    expect(p.state).toBe("crouch");
    w.input.release("down");
    w.step(2);
    expect(p.body!.h).toBe(h);
  });

  it("la Regia conta i round: chi resta senza vita li perde e alla fine c'è un vincitore", () => {
    const regia = {
      id: "regia",
      name: "Regia",
      x: 0,
      y: 0,
      blocks: [{ type: "FightMatch", props: { fighter1: "giocatore", fighter2: "avversario", rounds: 2, time: 0 } }],
    };
    const w = makeWorld(
      makeProject(FLAT, [fighter("p", 60, ["giocatore"], { opponent: "avversario" }), fighter("cpu", 180, ["avversario"], { input: "ai", opponent: "giocatore" }), regia]),
    );
    const match = w.get("regia").get("FightMatch")!;
    const cpuHp = w.get("cpu").get("Health")!;
    expect(match.data.phase).toBe("intro");
    expect(w.game.lockControls).toBe(true);
    w.step(120);
    expect(match.data.phase).toBe("fight");
    expect(w.game.lockControls).toBe(false);
    // Primo round: la CPU va al tappeto.
    cpuHp.actions.kill();
    w.step(2);
    expect(match.data.phase).toBe("ko");
    w.step(180);
    // Nuovo round: vita piena per tutti e conto dei round aggiornato.
    expect(match.data.round).toBe(2);
    expect(cpuHp.data.hp).toBe(5);
    w.step(120);
    cpuHp.actions.kill();
    w.step(200);
    expect(match.data.phase).toBe("over");
    expect(w.game.vars.vincitore).toBeUndefined();
  });

  it("l'avversario del computer si avvicina e attacca", () => {
    const w = makeWorld(
      makeProject(FLAT, [
        fighter("p", 60, ["giocatore"], { opponent: "avversario" }),
        fighter("cpu", 200, ["avversario"], { input: "ai", opponent: "giocatore" }, [
          punch("giocatore"),
          { type: "FighterAI", props: { target: "giocatore", aggression: 1, think: 0.1, jumpChance: 0 } },
        ]),
      ]),
    );
    const cpu = w.get("cpu");
    const hp = w.get("p").get("Health")!;
    const x0 = cpu.x;
    w.step(60 * 4);
    expect(cpu.x).toBeLessThan(x0 - 40);
    expect(hp.data.hp).toBeLessThan(5);
  });

  it("dopo il K.O. chi ha perso resta a terra e il computer smette di attaccare", () => {
    const regia = {
      id: "regia",
      name: "Regia",
      x: 0,
      y: 0,
      blocks: [{ type: "FightMatch", props: { fighter1: "giocatore", fighter2: "avversario", rounds: 1, time: 0 } }],
    };
    const w = makeWorld(
      makeProject(FLAT, [
        fighter("p", 100, ["giocatore"], { opponent: "avversario" }),
        fighter("cpu", 118, ["avversario"], { input: "ai", opponent: "giocatore" }, [
          punch("giocatore"),
          { type: "FighterAI", props: { target: "giocatore", aggression: 1, think: 0.05, jumpChance: 0 } },
        ]),
        regia,
      ]),
    );
    const match = w.get("regia").get("FightMatch")!;
    w.step(120);
    expect(match.data.phase).toBe("fight");
    // Il giocatore manda al tappeto la CPU: lei resta a terra e non colpisce più.
    const p = w.get("p").get("Health")!;
    const cpu = w.get("cpu");
    p.data.hp = 5;
    cpu.get("Health")!.actions.kill();
    w.step(2);
    const hp = p.data.hp;
    w.step(60 * 3);
    expect(match.data.phase).toBe("over");
    expect(cpu.state).toBe("down");
    expect(p.data.hp).toBe(hp);
  });
});

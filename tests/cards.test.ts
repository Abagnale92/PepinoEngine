import { describe, expect, it } from "vitest";
import type { EntityData } from "@runtime";
import { FLAT, makeProject, makeWorld } from "./helpers";

/** Un tavolo da duello: mazzo con una carta sola per tipo, così si sa sempre cosa arriva. */
const table = (props: Record<string, unknown> = {}): EntityData => ({
  id: "duello",
  name: "Duello",
  x: 0,
  y: 0,
  blocks: [
    {
      type: "CardBattle",
      props: {
        hp: 20,
        enemyHp: 12,
        energy: 3,
        handSize: 3,
        enemyName: "Cavolo Nero",
        deck: [
          { name: "Colpo", cost: 1, effect: "attack", value: 4, copies: 6, color: "#c2504a" },
          { name: "Scudo", cost: 1, effect: "shield", value: 5, copies: 3, color: "#4a8fd6" },
        ],
        enemyDeck: [{ name: "Zampata", cost: 0, effect: "attack", value: 3, copies: 1, color: "#c2504a" }],
        hpVar: "vita",
        enemyHpVar: "vita_nemico",
        wonVar: "vinto",
        ...props,
      },
    },
  ],
});

type World = ReturnType<typeof makeWorld>;
const press = (w: World, action: string) => {
  w.input.hold(action);
  w.step(1);
  w.input.release(action);
};

describe("duello a carte", () => {
  it("si parte con la mano piena, l'energia e la vita giuste", () => {
    const w = makeWorld(makeProject(FLAT, [table()], { variables: { vita: 0, vita_nemico: 0, vinto: 0 } }));
    const d = w.get("duello").get("CardBattle")!.data;
    expect(d.hand).toHaveLength(3);
    expect(d.energy).toBe(3);
    expect(d.hp).toBe(20);
    expect(w.game.vars.vita).toBe(20);
    expect(w.game.vars.vita_nemico).toBe(12);
    expect(d.phase).toBe("player");
  });

  it("giocare una carta spende energia e fa danno; senza energia non si gioca", () => {
    const w = makeWorld(makeProject(FLAT, [table({ energy: 1 })], { variables: { vita: 0, vita_nemico: 0, vinto: 0 } }));
    const b = w.get("duello").get("CardBattle")!;
    b.data.hand = [{ name: "Colpo", cost: 1, effect: "attack", value: 4, color: "#c2504a" }];
    b.data.energy = 1;
    press(w, "action");
    expect(b.data.enemyHp).toBe(8);
    expect(b.data.energy).toBe(0);
    expect(b.data.hand).toHaveLength(0);
    // Con la mano vuota e zero energia non succede nulla.
    b.data.hand = [{ name: "Colpo", cost: 1, effect: "attack", value: 4, color: "#c2504a" }];
    press(w, "action");
    expect(b.data.enemyHp).toBe(8);
    expect(b.data.hand).toHaveLength(1);
  });

  it("lo scudo assorbe il colpo dell'avversario e poi il turno torna al giocatore", () => {
    const w = makeWorld(makeProject(FLAT, [table()], { variables: { vita: 0, vita_nemico: 0, vinto: 0 } }));
    const b = w.get("duello").get("CardBattle")!;
    b.data.hand = [{ name: "Scudo", cost: 1, effect: "shield", value: 5, color: "#4a8fd6" }];
    press(w, "action");
    expect(b.data.shield).toBe(5);
    press(w, "dash"); // fine turno
    expect(b.data.phase).toBe("enemy");
    w.step(120);
    // La zampata da 3 è tutta assorbita dallo scudo.
    expect(b.data.hp).toBe(20);
    expect(b.data.phase).toBe("player");
    expect(b.data.hand.length).toBeGreaterThan(0);
  });

  it("finita la vita dell'avversario si vince, e l'esito finisce nella variabile", () => {
    const w = makeWorld(makeProject(FLAT, [table({ enemyHp: 4 })], { variables: { vita: 0, vita_nemico: 0, vinto: 0 } }));
    const b = w.get("duello").get("CardBattle")!;
    let won = 0;
    w.get("duello").on("won", () => won++);
    b.data.hand = [{ name: "Colpo", cost: 1, effect: "attack", value: 4, color: "#c2504a" }];
    press(w, "action");
    expect(b.data.result).toBe("win");
    expect(won).toBe(1);
    expect(w.game.vars.vinto).toBe(1);
  });

  it("le carte imparate si aggiungono al mazzo del duello dopo", () => {
    const w = makeWorld(makeProject(FLAT, [table({ deckVar: "carte" })], { variables: { vita: 0, vita_nemico: 0, vinto: 0, carte: "" } }));
    const b = w.get("duello").get("CardBattle")!;
    const prima = b.data.draw.length + b.data.hand.length;
    b.actions.addCard("Scudo");
    expect(w.game.vars.carte).toBe("Scudo");
    b.actions.restart();
    expect(b.data.draw.length + b.data.hand.length).toBe(prima + 1);
  });

  it("si imparano anche le carte che all'inizio non sono nel mazzo (0 copie)", () => {
    const deck = [
      { name: "Colpo", cost: 1, effect: "attack", value: 4, copies: 6, color: "#c2504a" },
      { name: "Peperoncino", cost: 2, effect: "attack", value: 9, copies: 0, color: "#ff8a3c" },
    ];
    const w = makeWorld(makeProject(FLAT, [table({ deck, deckVar: "carte" })], { variables: { vita: 0, vita_nemico: 0, vinto: 0, carte: "" } }));
    const b = w.get("duello").get("CardBattle")!;
    const all = () => [...b.data.draw, ...b.data.hand] as { name: string }[];
    expect(all().some((c) => c.name === "Peperoncino")).toBe(false);
    b.actions.addCard("Peperoncino");
    b.actions.restart();
    expect(all()).toHaveLength(7);
    expect(all().filter((c) => c.name === "Peperoncino")).toHaveLength(1);
  });

  it("un mazzo vuoto avvisa invece di bloccarsi", () => {
    const w = makeWorld(makeProject(FLAT, [table({ deck: [] })], { variables: { vita: 0, vita_nemico: 0, vinto: 0 } }));
    expect(w.logs.some((l) => l.level === "warn")).toBe(true);
    w.step(5);
    expect(w.get("duello").get("CardBattle")!.data.hand).toHaveLength(0);
  });
});

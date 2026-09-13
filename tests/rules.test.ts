import { describe, expect, it } from "vitest";
import type { EntityData, RuleData } from "@runtime";
import { DT, FLAT, TS, makeProject, makeWorld, player, rule } from "./helpers";

const box = (id: string, x: number, y: number, tags: string[] = []): EntityData => ({
  id,
  name: id,
  x,
  y,
  tags,
  blocks: [{ type: "Body", props: { width: 8, height: 8, group: "trigger", world: false } }],
});

const world = (rules: RuleData[], entities: EntityData[] = [player(40, 8 * TS)], variables: Record<string, number> = {}) =>
  makeWorld(makeProject(FLAT, entities, { rules, variables: { monete: 0, vita: 3, ...variables } }));

describe("Regole", () => {
  it("«la scena inizia» scatta una volta sola", () => {
    const w = world([rule("r", { type: "scene.start", params: {} }, [{ type: "var.add", params: { amount: 1, variable: "n" } }])], undefined, { n: 0 });
    w.step(10);
    expect(w.game.vars.n).toBe(1);
  });

  it("le regole globali valgono anche nella scena", () => {
    const project = makeProject(FLAT, [], {
      variables: { g: 0 },
      globalRules: [rule("g", { type: "scene.start", params: {} }, [{ type: "var.set", params: { variable: "g", value: "7" } }])],
    });
    const w = makeWorld(project);
    w.step();
    expect(w.game.vars.g).toBe(7);
  });

  it("contatto: scatta quando inizia, «l'altro oggetto» è la cosa toccata", () => {
    const w = world(
      [
        rule("r", { type: "contact", params: { target: "#giocatore", other: "#moneta" } }, [
          { type: "var.add", params: { amount: 1, variable: "monete" } },
          { type: "object.destroy", params: { target: "other" } },
        ]),
      ],
      [player(40, 8 * TS), box("c", 40, 8 * TS - 4, ["moneta"])],
    );
    w.step(10);
    expect(w.game.vars.monete).toBe(1);
    expect(w.scene.entities.some((e) => e.id === "c")).toBe(false);
  });

  it("il contatto funziona anche senza impostare i gruppi di collisione", () => {
    const other: EntityData = { ...box("x", 40, 8 * TS - 4, ["cosa"]) };
    other.blocks = [{ type: "Body", props: { width: 8, height: 8, group: "nemici", collidesWith: [], world: false } }];
    const p = player(40, 8 * TS);
    p.blocks[0].props.collidesWith = [];
    const w = world([rule("r", { type: "contact", params: { target: "#giocatore", other: "#cosa" } }, [{ type: "var.add", params: { amount: 1, variable: "monete" } }])], [p, other]);
    w.step(10);
    expect(w.game.vars.monete).toBe(1);
  });

  it("«smette di toccare» scatta quando ci si allontana", () => {
    const w = world(
      [rule("r", { type: "contact.end", params: { target: "#giocatore", other: "#zona" } }, [{ type: "var.add", params: { amount: 1, variable: "n" } }])],
      [player(40, 8 * TS), box("z", 40, 8 * TS - 4, ["zona"])],
      { n: 0 },
    );
    w.step(3);
    expect(w.game.vars.n).toBe(0);
    w.input.hold("right");
    w.step(40);
    expect(w.game.vars.n).toBe(1);
  });

  it("condizione + «una volta sola»", () => {
    const w = world(
      [
        rule(
          "r",
          { type: "always", params: {} },
          [{ type: "var.add", params: { amount: 1, variable: "premio" } }],
          [{ type: "var.compare", params: { variable: "monete", op: ">=", value: "2" } }],
          { once: true },
        ),
      ],
      undefined,
      { premio: 0 },
    );
    w.step(5);
    expect(w.game.vars.premio).toBe(0);
    w.game.vars.monete = 2;
    w.step(10);
    expect(w.game.vars.premio).toBe(1);
  });

  it("«non» inverte la condizione", () => {
    const w = world(
      [rule("r", { type: "always", params: {} }, [{ type: "var.add", params: { amount: 1, variable: "x" } }], [{ type: "var.compare", params: { variable: "vita", op: "==", value: "3" }, not: true }])],
      undefined,
      { x: 0 },
    );
    w.step(3);
    expect(w.game.vars.x).toBe(0);
    w.game.vars.vita = 2;
    w.step(3);
    expect(w.game.vars.x).toBe(3);
  });

  it("«attendi» rimanda le azioni successive", () => {
    const w = world(
      [
        rule("r", { type: "scene.start", params: {} }, [
          { type: "var.set", params: { variable: "a", value: "1" } },
          { type: "wait", params: { seconds: 0.5 } },
          { type: "var.set", params: { variable: "a", value: "2" } },
        ]),
      ],
      undefined,
      { a: 0 },
    );
    w.step(1);
    expect(w.game.vars.a).toBe(1);
    w.step(Math.floor(0.5 / DT) - 3);
    expect(w.game.vars.a).toBe(1);
    w.step(5);
    expect(w.game.vars.a).toBe(2);
  });

  it("«ogni tot secondi» e «dopo tot secondi»", () => {
    const w = world(
      [
        rule("e", { type: "every", params: { seconds: 0.5 } }, [{ type: "var.add", params: { amount: 1, variable: "n" } }]),
        rule("a", { type: "after", params: { seconds: 1 } }, [{ type: "var.set", params: { variable: "done", value: "true" } }]),
      ],
      undefined,
      { n: 0 },
    );
    w.step(55);
    expect(w.game.vars.done).toBeUndefined();
    w.step(65);
    expect(w.game.vars.n).toBe(4);
    expect(w.game.vars.done).toBe(true);
  });

  it("«il giocatore preme» scatta una volta per pressione", () => {
    const w = world([rule("r", { type: "input.pressed", params: { action: "action" } }, [{ type: "var.add", params: { amount: 1, variable: "j" } }])], undefined, { j: 0 });
    w.input.hold("action");
    w.step(5);
    expect(w.game.vars.j).toBe(1);
    w.input.release("action");
    w.step();
    w.input.hold("action");
    w.step();
    expect(w.game.vars.j).toBe(2);
  });

  it("azione di un blocco con parametri: infliggi danno", () => {
    const hero = player(40, 8 * TS, {}, { blocks: [{ type: "Health", props: { max: 3, variable: "vita" } }] });
    const w = world([rule("r", { type: "scene.start", params: {} }, [{ type: "block.action", params: { target: "#giocatore", action: "Health.damage", args: { amount: 2 } } }])], [hero]);
    w.step(2);
    expect(w.game.vars.vita).toBe(1);
  });

  it("crea un oggetto da un modello nella posizione di un altro", () => {
    const project = makeProject(FLAT, [player(40, 8 * TS)], {
      prefabs: [{ id: "stella", name: "Stella", tags: ["stella"], blocks: [{ type: "Sprite", props: {} }] }],
      rules: [rule("r", { type: "scene.start", params: {} }, [{ type: "object.spawn", params: { prefab: "stella", target: "#giocatore", offsetX: 1, offsetY: 0 } }])],
    });
    const w = makeWorld(project);
    w.step(1);
    const star = w.scene.findAll("stella")[0];
    expect(star).toBeDefined();
    expect(star.x).toBe(40 + TS);
  });

  it("messaggi, cambio scena e salvataggio arrivano al gioco", () => {
    const w = world([
      rule("r", { type: "scene.start", params: {} }, [
        { type: "message.show", params: { text: "Monete: {monete}", duration: 1, pause: false } },
        { type: "game.save", params: {} },
        { type: "scene.goto", params: { scene: "altra", fade: 0.2 } },
      ]),
    ]);
    w.step();
    expect(w.messages).toEqual(["Monete: 0"]);
    expect(w.calls).toEqual(["saveGame", "goToScene:altra"]);
  });

  it("un evento sconosciuto viene segnalato una sola volta", () => {
    const w = world([rule("r", { type: "boh", params: {} }, [])]);
    w.step(10);
    expect(w.logs.filter((l) => l.level === "warn" && l.message.includes("boh"))).toHaveLength(1);
  });

  it("un errore in un'azione non blocca le altre", () => {
    const w = world(
      [
        rule("r", { type: "scene.start", params: {} }, [
          { type: "block.action", params: { target: "#giocatore", action: "Inesistente.azione" } },
          { type: "var.set", params: { variable: "ok", value: "true" } },
        ]),
      ],
      undefined,
    );
    w.step();
    expect(w.game.vars.ok).toBe(true);
  });
});

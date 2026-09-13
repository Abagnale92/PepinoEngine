import { describe, expect, it } from "vitest";
import { DialogueRunner, validateProject, type DialogueData, type EntityData, type VariableValue } from "@runtime";
import { FLAT, TS, makeProject, makeWorld, player, rule } from "./helpers";

const dlg: DialogueData = {
  id: "d",
  name: "Prova",
  lines: [
    { id: "b1", speaker: "Nonno", text: "Hai {monete} monete." },
    {
      id: "b2",
      speaker: "Nonno",
      text: "Mi aiuti?",
      choices: [
        { text: "Sì", goto: "b3", setVar: "missione", setValue: "1" },
        { text: "No", goto: "b4" },
      ],
    },
    { id: "b3", text: "Grazie!", goto: "fine" },
    { id: "b4", text: "Peccato." },
  ],
};

function makeRunner(data: DialogueData[] = [dlg]) {
  const vars: Record<string, VariableValue> = { monete: 5, missione: 0 };
  const ended: string[] = [];
  const runner = new DialogueRunner(() => data, () => vars, (id) => ended.push(id));
  const tick = (action?: string) => runner.update(0.2, { pressed: (a) => a === action });
  /** Supera la breve attesa e completa il testo (premendo solo se serve). */
  const reveal = () => {
    tick();
    if (!runner.fullyShown) tick("action");
  };
  /** Mostra tutto il testo e passa avanti. */
  const next = () => {
    reveal();
    tick("action");
  };
  return { runner, vars, ended, tick, next, reveal };
}

describe("dialoghi", () => {
  it("scorre le battute e sostituisce le variabili", () => {
    const { runner } = makeRunner();
    expect(runner.start("d")).toBe(true);
    expect(runner.current!.text).toBe("Hai 5 monete.");
    expect(runner.line!.speaker).toBe("Nonno");
  });

  it("il primo tasto completa il testo, il secondo passa avanti", () => {
    const { runner, tick } = makeRunner();
    runner.start("d");
    tick();
    expect(runner.fullyShown).toBe(false);
    tick("action");
    expect(runner.fullyShown).toBe(true);
    expect(runner.current!.index).toBe(0);
    tick("action");
    expect(runner.current!.index).toBe(1);
  });

  it("le scelte si navigano, impostano variabili e portano alla battuta giusta", () => {
    const { runner, vars, ended, tick, next, reveal } = makeRunner();
    runner.start("d");
    next();
    reveal();
    expect(runner.choices.map((c) => c.text)).toEqual(["Sì", "No"]);
    tick("down");
    expect(runner.current!.choice).toBe(1);
    tick("up");
    tick("action");
    expect(vars.missione).toBe(1);
    expect(runner.line!.id).toBe("b3");
    next();
    expect(runner.active).toBe(false);
    expect(ended).toEqual(["d"]);
  });

  it("l'altra scelta porta altrove e il dialogo finisce dopo l'ultima battuta", () => {
    const { runner, vars, ended, next, reveal } = makeRunner();
    runner.start("d");
    next();
    reveal();
    runner.choose(1);
    expect(runner.line!.id).toBe("b4");
    expect(vars.missione).toBe(0);
    next();
    expect(ended).toEqual(["d"]);
  });

  it("un dialogo inesistente non parte; un salto a una battuta sconosciuta lo chiude", () => {
    const broken: DialogueData = { id: "x", name: "X", lines: [{ id: "a", text: "…", goto: "manca" }, { id: "b", text: "mai" }] };
    const { runner, ended, next } = makeRunner([broken]);
    expect(runner.start("nessuno")).toBe(false);
    runner.start("x");
    next();
    expect(ended).toEqual(["x"]);
  });
});

describe("Personaggio che parla", () => {
  const npc: EntityData = { id: "nonno", name: "Nonno", x: 60, y: 8 * TS, blocks: [{ type: "Talker", props: { dialogue: "d", range: 2 } }] };

  it("vicino + Azione apre il dialogo", () => {
    const w = makeWorld(makeProject(FLAT, [npc, player(40, 8 * TS, { input: "ai" })], { dialogues: [dlg] }));
    w.step(2);
    w.input.hold("action");
    w.step();
    expect(w.calls).toContain("dialogue:d");
    expect(w.get("nonno").facingX).toBe(-1);
  });

  it("lontano non succede niente", () => {
    const w = makeWorld(makeProject(FLAT, [npc, player(200, 8 * TS, { input: "ai" })], { dialogues: [dlg] }));
    w.input.hold("action");
    w.step(3);
    expect(w.calls).not.toContain("dialogue:d");
  });
});

describe("regole dei dialoghi", () => {
  it("«Avvia un dialogo» e «Un dialogo finisce»", () => {
    const w = makeWorld(
      makeProject(FLAT, [], {
        dialogues: [dlg],
        variables: { fatto: false, altro: false },
        rules: [
          rule("a", { type: "scene.start", params: {} }, [{ type: "dialogue.start", params: { dialogue: "d" } }]),
          rule("b", { type: "dialogue.end", params: { dialogue: "d" } }, [{ type: "var.set", params: { variable: "fatto", value: "true" } }]),
          rule("c", { type: "dialogue.end", params: { dialogue: "altro" } }, [{ type: "var.set", params: { variable: "altro", value: "true" } }]),
        ],
      }),
    );
    w.step();
    expect(w.calls).toContain("dialogue:d");
    w.scene.events.emit("dialogueEnd", { entity: undefined, data: { dialogue: "d" } });
    w.step();
    expect(w.game.vars.fatto).toBe(true);
    expect(w.game.vars.altro).toBe(false);
  });

  it("il controllo del progetto trova dialoghi e salti rotti", () => {
    const p = makeProject(FLAT, [{ id: "n", name: "NPC", x: 0, y: 0, blocks: [{ type: "Talker", props: { dialogue: "sparito" } }] }], {
      dialogues: [{ id: "d", name: "Prova", lines: [{ id: "b1", text: "Ciao", goto: "b9", choices: [{ text: "", goto: "boh" }] }] }],
    });
    const messages = validateProject(p).map((i) => `${i.level}: ${i.message}`);
    expect(messages).toContain("error: Il dialogo «sparito» non esiste.");
    expect(messages).toContain("error: Salta a una battuta che non esiste («b9»).");
    expect(messages).toContain("error: Porta a una battuta che non esiste («boh»).");
    expect(messages).toContain("warn: Il testo della scelta è vuoto.");
  });
});

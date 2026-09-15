import { describe, expect, it } from "vitest";
import { validateProject, type CutsceneData, type RuleItem } from "@runtime";
import { FLAT, makeProject, makeWorld, player, rule } from "./helpers";

const cutscene = (steps: RuleItem[], extra: Partial<CutsceneData> = {}): CutsceneData => ({ id: "intro", name: "Intro", steps, ...extra });
const start = rule("start", { type: "scene.start", params: {} }, [{ type: "cutscene.play", params: { cutscene: "intro" } }]);
const meta = { id: "meta", name: "Meta", x: 96, y: 112, blocks: [] };
const say = (text: string): RuleItem => ({ type: "message.show", params: { text, duration: 1 } });

describe("filmati", () => {
  it("esegue i passi in ordine e aspetta spostamenti e attese", () => {
    const project = makeProject(FLAT, [player(32, 112), meta], {
      rules: [start],
      cutscenes: [
        cutscene([
          { type: "cutscene.move", params: { target: "@p", dest: "@meta", seconds: 0.5, wait: true } },
          say("arrivato"),
          { type: "wait", params: { seconds: 0.5 } },
          say("fine"),
        ]),
      ],
    });
    const w = makeWorld(project);
    const p = w.get("p");
    w.step(1);
    expect(w.scene.rules.cutscene?.data.id).toBe("intro");
    expect(w.calls).toContain("bars:true");
    w.step(15);
    expect(p.x).toBeGreaterThan(40);
    expect(p.x).toBeLessThan(90);
    expect(w.messages).toEqual([]);
    w.step(20);
    expect(p.x).toBeCloseTo(96, 3);
    expect(p.facingX).toBe(1);
    expect(w.messages).toEqual(["arrivato"]);
    w.step(40);
    expect(w.messages).toEqual(["arrivato", "fine"]);
    expect(w.scene.rules.cutscene).toBeNull();
    expect(w.calls).toContain("bars:false");
  });

  it("saltandolo gli oggetti arrivano subito e dialoghi e messaggi non partono", () => {
    const project = makeProject(FLAT, [player(32, 112), meta], {
      rules: [start],
      cutscenes: [
        cutscene([
          { type: "cutscene.move", params: { target: "@p", dest: "@meta", seconds: 2, wait: true } },
          { type: "cutscene.dialogue", params: { dialogue: "d" } },
          say("fine"),
          { type: "cutscene.moveBy", params: { target: "@p", dx: 1, dy: 0, seconds: 1, wait: true } },
        ]),
      ],
    });
    const w = makeWorld(project);
    w.step(11);
    w.scene.rules.skipCutscene();
    expect(w.get("p").x).toBeCloseTo(112, 3);
    expect(w.calls.some((c) => c.startsWith("dialogue:"))).toBe(false);
    expect(w.messages).toEqual([]);
    expect(w.scene.rules.cutscene).toBeNull();
  });

  it("aspetta la fine del dialogo, poi scatta «Un filmato finisce»", () => {
    const project = makeProject(FLAT, [player(32, 112)], {
      rules: [start, rule("fine", { type: "cutscene.end", params: { cutscene: "intro" } }, [say("finito")])],
      cutscenes: [cutscene([{ type: "cutscene.dialogue", params: { dialogue: "d" } }, say("dopo")])],
    });
    const w = makeWorld(project);
    w.game.startDialogue = (id: string) => {
      w.calls.push(`dialogue:${id}`);
      w.game.dialogue.active = true;
      return true;
    };
    w.step(1);
    expect(w.calls).toContain("dialogue:d");
    w.step(10);
    expect(w.messages).toEqual([]);
    w.game.dialogue.active = false;
    w.step(1);
    expect(w.messages).toEqual(["dopo"]);
    w.step(1);
    expect(w.messages).toEqual(["dopo", "finito"]);
  });

  it("la dissolvenza aspetta il nero; un solo filmato alla volta", () => {
    const project = makeProject(FLAT, [player(32, 112)], {
      rules: [start, rule("di nuovo", { type: "after", params: { seconds: 0.1 } }, [{ type: "cutscene.play", params: { cutscene: "intro" } }])],
      cutscenes: [cutscene([{ type: "cutscene.fadeOut", params: { seconds: 0.5 } }, { type: "wait", params: { seconds: 1 } }, { type: "cutscene.fadeIn", params: { seconds: 0.5 } }])],
    });
    const w = makeWorld(project);
    w.step(10);
    expect(w.calls).toContain("fade:1");
    expect(w.logs.some((l) => l.message.includes("ce n'è già uno in corso"))).toBe(true);
    w.step(70);
    expect(w.calls).toContain("fade:0");
    expect(w.scene.rules.cutscene).toBeNull();
  });

  it("il controllo del progetto guarda i filmati e le regole che li usano", () => {
    const project = makeProject(FLAT, [player(32, 112)], {
      rules: [rule("r", { type: "scene.start", params: {} }, [{ type: "cutscene.play", params: { cutscene: "sparito" } }])],
      cutscenes: [cutscene([]), { id: "rotto", name: "Rotto", steps: [{ type: "cutscene.dialogue", params: { dialogue: "boh" } }] }],
    });
    const messages = validateProject(project).map((i) => i.message);
    expect(messages).toContain("Il filmato «sparito» non esiste.");
    expect(messages).toContain("Il filmato non ha passi.");
    expect(messages).toContain("Il dialogo «boh» non esiste.");
  });
});

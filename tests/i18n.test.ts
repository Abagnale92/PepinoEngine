import { describe, expect, it } from "vitest";
import { DialogueRunner, Translator, collectTexts, missingTranslations, validateProject, type EntityData } from "@runtime";
import { FLAT, makeProject, makeWorld, rule } from "./helpers";

const LANGS = [
  { id: "it", name: "Italiano" },
  { id: "en", name: "English" },
];

describe("traduzioni", () => {
  it("usa la traduzione se c'è, altrimenti il testo originale", () => {
    const tr = new Translator({ languages: LANGS, translations: { en: { Ciao: "Hello", Vuoto: "  " } } });
    expect(tr.language).toBe("it");
    expect(tr.t("Ciao")).toBe("Ciao");
    expect(tr.set("en")).toBe(true);
    expect(tr.t("Ciao")).toBe("Hello");
    expect(tr.t("Vuoto")).toBe("Vuoto");
    expect(tr.t("Mai visto")).toBe("Mai visto");
    expect(tr.set("fr")).toBe(false);
    expect(tr.nextId()).toBe("it");
    expect(new Translator({ languages: LANGS }, "en").language).toBe("en");
    expect(new Translator({ languages: LANGS }, "de").language).toBe("it");
    expect(new Translator({}).t("Ciao")).toBe("Ciao");
  });

  it("raccoglie tutti i testi che il giocatore vede, una volta sola", () => {
    const sign = (id: string, name: string): EntityData => ({
      id,
      name,
      x: 0,
      y: 0,
      blocks: [
        { type: "Text", props: { text: "Monete: {monete}" } },
        { type: "Button", props: { text: "Gioca" } },
        { type: "Talker", props: { dialogue: "d", prompt: "Parla" } },
      ],
    });
    const p = makeProject(FLAT, [sign("cartello", "Cartello"), sign("cartello2", "Cartello 2"), { id: "n", name: "Numero", x: 0, y: 0, blocks: [{ type: "Text", props: { text: "100" } }] }], {
      rules: [
        rule("r", { type: "scene.start", params: {} }, [
          { type: "message.show", params: { text: "Benvenuto!", duration: 1, pause: false } },
          { type: "block.action", params: { target: "@cartello", action: "Text.setText", args: { text: "Nuovo cartello" } } },
        ]),
      ],
      dialogues: [{ id: "d", name: "Saluto", lines: [{ id: "b1", speaker: "Nonno", text: "Ciao {nome}", choices: [{ text: "Ciao nonno" }] }] }],
    });
    const byText = Object.fromEntries(collectTexts(p).map((t) => [t.text, t.where]));
    expect(Object.keys(byText).sort()).toEqual(
      ["Benvenuto!", "Ciao nonno", "Ciao {nome}", "Gioca", "Monete: {monete}", "Nonno", "Nuovo cartello", "Parla", "Pausa", "Premi Esc (o Start) per riprendere"].sort(),
    );
    expect(byText["Gioca"]).toHaveLength(2);
    expect(byText["Benvenuto!"][0]).toMatch(/Regole/);
  });

  it("le Regole cambiano lingua e i messaggi escono tradotti", () => {
    const p = makeProject(FLAT, [], {
      variables: { nome: "Pepino" },
      languages: LANGS,
      translations: { en: { "Ciao {nome}!": "Hi {nome}!" } },
      rules: [
        rule("r1", { type: "scene.start", params: {} }, [
          { type: "lang.set", params: { language: "en" } },
          { type: "message.show", params: { text: "Ciao {nome}!", duration: 1, pause: false } },
        ]),
        rule("r2", { type: "scene.start", params: {} }, [{ type: "message.show", params: { text: "Solo in inglese", duration: 1, pause: false } }], [
          { type: "lang.is", params: { language: "en" } },
        ]),
      ],
    });
    const w = makeWorld(p);
    w.step(1);
    expect(w.game.language).toBe("en");
    expect(w.messages).toEqual(["Hi Pepino!", "Solo in inglese"]);
    w.game.nextLanguage();
    expect(w.game.language).toBe("it");
  });

  it("i dialoghi escono tradotti", () => {
    const tr = new Translator({ languages: LANGS, translations: { en: { "Ciao {nome}": "Hello {nome}" } } }, "en");
    const run = new DialogueRunner(
      () => [{ id: "d", name: "D", lines: [{ id: "b1", text: "Ciao {nome}" }] }],
      () => ({ nome: "Pepino" }),
      () => {},
      (s) => tr.t(s),
    );
    run.start("d");
    expect(run.current!.text).toBe("Hello Pepino");
  });

  it("il controllo del progetto conta i testi da tradurre e controlla le lingue nelle Regole", () => {
    const p = makeProject(FLAT, [{ id: "t", name: "Titolo", x: 0, y: 0, blocks: [{ type: "Text", props: { text: "Ciao" } }] }], {
      languages: LANGS,
      translations: { en: { Ciao: "Hello" } },
      rules: [rule("r", { type: "scene.start", params: {} }, [{ type: "lang.set", params: { language: "fr" } }])],
    });
    const issues = validateProject(p);
    const text = issues.map((i) => `${i.level}: ${i.where}: ${i.message}`);
    expect(text).toContainEqual(expect.stringMatching(/^warn: Lingua «English»: 2 testi non sono ancora tradotti/));
    expect(issues.find((i) => i.where.startsWith("Lingua"))?.language).toBe("en");
    expect(text).toContainEqual(expect.stringMatching(/^error: .*La lingua «fr» non è tra le lingue del gioco/));
    expect(missingTranslations(p, "en").map((t) => t.text)).toEqual(["Pausa", "Premi Esc (o Start) per riprendere"]);
  });
});

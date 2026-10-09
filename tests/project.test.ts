import { describe, expect, it } from "vitest";
import { validateProject } from "@runtime";
import { FLAT, makeProject, player, rule } from "./helpers";

describe("controllo del progetto", () => {
  it("un progetto di prova pulito non ha problemi", () => {
    expect(validateProject(makeProject(FLAT, [player(40, 128)]))).toEqual([]);
  });

  it("trova riferimenti rotti", () => {
    const p = makeProject(FLAT, [
      player(40, 128, {}, { blocks: [{ type: "Sprite", props: { image: "nonce" } }] }),
      { id: "p", name: "Doppione", x: 0, y: 0, blocks: [{ type: "Boh", props: {} }] },
      { id: "e", name: "Uscita", x: 0, y: 0, blocks: [{ type: "Body", props: {} }, { type: "SceneExit", props: { scene: "manca" } }] },
    ]);
    p.settings.startScene = "sparita";
    const messages = validateProject(p).map((i) => `${i.level}: ${i.message}`);
    expect(messages).toContain("error: La scena iniziale «sparita» non esiste.");
    expect(messages).toContain("error: L'asset «nonce» non esiste.");
    expect(messages).toContain("error: Due oggetti hanno lo stesso id «p».");
    expect(messages).toContain("error: Blocco sconosciuto «Boh».");
    expect(messages).toContain("error: La scena «manca» non esiste.");
  });

  it("segnala blocchi richiesti mancanti e pattuglie inutili", () => {
    const p = makeProject(FLAT, [
      { id: "a", name: "Senza corpo", x: 0, y: 0, blocks: [{ type: "PlatformController", props: {} }, { type: "Patrol", props: {} }] },
    ]);
    const messages = validateProject(p).map((i) => i.message);
    expect(messages).toContain("Serve anche il blocco «Corpo».");
    expect(messages.some((m) => m.startsWith("La Pattuglia non ha effetto"))).toBe(true);
  });

  it("controlla le regole", () => {
    const p = makeProject(FLAT, [player(40, 128)], {
      rules: [
        rule("a", { type: "contact", params: { target: "@fantasma", other: "*" } }, [{ type: "object.destroy", params: { target: "self" } }]),
        rule("b", { type: "scene.start", params: {} }, [{ type: "object.destroy", params: { target: "self" } }]),
        rule("c", { type: "event", params: { target: "#giocatore", event: "volato" } }, []),
        rule("d", { type: "var.compare", params: {} }, [{ type: "block.action", params: { target: "#giocatore", action: "Health.damage" } }]),
      ],
    });
    const messages = validateProject(p).map((i) => `${i.level}: ${i.message}`);
    expect(messages).toContain("error: L'oggetto con id «fantasma» non esiste in questa scena.");
    expect(messages).toContain("error: «questo oggetto» non esiste con questo evento.");
    expect(messages).toContain("warn: Nessun blocco di questo oggetto produce l'evento «volato».");
    expect(messages).toContain("warn: Nessuna azione: la regola non fa niente.");
    expect(messages).toContain("error: «Confronta una variabile» non è un evento.");
    expect(messages).toContain("warn: Nessun oggetto indicato ha il blocco «Salute».");
  });

  it("controlla le dimensioni dei layer", () => {
    const p = makeProject(FLAT, []);
    p.scenes[0].layers[0].data.pop();
    const messages = validateProject(p).map((i) => i.message);
    expect(messages.some((m) => m.includes("tile invece di"))).toBe(true);
  });
});

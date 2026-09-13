import { beforeEach, describe, expect, it } from "vitest";
import { editProject, getState, loadProject, redo, setState, undo } from "../src/renderer/src/store";
import { effectiveBlocks, missingWithRequires, removeEntity, sceneOf, uniqueId } from "../src/renderer/src/projectOps";
import { blocksForRef, describeRef, formatToken } from "../src/renderer/src/ruleOps";
import { getRuleItemDef } from "@runtime";
import { FLAT, makeProject, player } from "./helpers";

beforeEach(() => {
  loadProject({ path: "test", baseUrl: "http://x/", data: makeProject(FLAT, [player(40, 128)]) });
});

describe("store dell'editor", () => {
  it("annulla e ripeti", () => {
    editProject((p) => void (p.name = "Nuovo"));
    expect(getState().project!.name).toBe("Nuovo");
    expect(getState().dirty).toBe(true);
    undo();
    expect(getState().project!.name).toBe("Test");
    redo();
    expect(getState().project!.name).toBe("Nuovo");
  });

  it("modifiche con la stessa chiave diventano un solo passo (trascinamento)", () => {
    for (let x = 41; x <= 60; x++) editProject((p) => void (sceneOf(p, "s")!.entities[0].x = x), "drag-1");
    expect(sceneOf(getState().project!, "s")!.entities[0].x).toBe(60);
    undo();
    expect(sceneOf(getState().project!, "s")!.entities[0].x).toBe(40);
    expect(getState().canUndo).toBe(false);
  });

  it("una nuova modifica cancella il «ripeti»", () => {
    editProject((p) => void (p.name = "A"));
    undo();
    editProject((p) => void (p.name = "B"));
    expect(getState().canRedo).toBe(false);
  });

  it("se l'oggetto selezionato sparisce, la selezione si azzera", () => {
    setState({ selection: { kind: "entity", id: "p" } });
    editProject((p) => void removeEntity(sceneOf(p, "s")!.entities, "p"));
    expect(getState().selection).toBeNull();
    undo();
    expect(sceneOf(getState().project!, "s")!.entities).toHaveLength(1);
  });

  it("le modifiche non toccano la versione precedente (niente oggetti condivisi)", () => {
    const before = getState().project!;
    editProject((p) => void (sceneOf(p, "s")!.entities[0].x = 999));
    expect(sceneOf(before, "s")!.entities[0].x).toBe(40);
  });
});

describe("operazioni sul progetto", () => {
  it("aggiungere un controller porta con sé il Corpo", () => {
    expect(missingWithRequires([], "PlatformController")).toEqual(["Body", "PlatformController"]);
    expect(missingWithRequires([{ type: "Body", props: {} }], "PlatformController")).toEqual(["PlatformController"]);
    expect(missingWithRequires([{ type: "Body", props: {}, enabled: false }], "PlatformController")).toEqual(["Body", "PlatformController"]);
  });

  it("id unici e leggibili", () => {
    expect(uniqueId("Moneta d'oro", new Set())).toBe("moneta_d_oro");
    expect(uniqueId("Moneta", new Set(["moneta", "moneta_2"]))).toBe("moneta_3");
    expect(uniqueId("", new Set())).toBe("oggetto");
  });

  it("blocchi effettivi di un'istanza di modello", () => {
    const p = makeProject(FLAT, [], { prefabs: [{ id: "m", name: "M", blocks: [{ type: "Health", props: { max: 2 } }] }] });
    const blocks = effectiveBlocks(p, { id: "i", name: "I", x: 0, y: 0, prefab: "m", blocks: [{ type: "Health", props: { max: 4 } }] });
    expect(blocks).toEqual([{ type: "Health", enabled: undefined, props: { max: 4 } }]);
  });
});

describe("regole nell'editor", () => {
  const project = makeProject(FLAT, [player(40, 128)]);
  const trigger = { type: "event", params: { target: "#giocatore", event: "jumped" } };
  const rc = { project, scene: project.scenes[0], trigger, triggerDef: getRuleItemDef("event") };

  it("«questo oggetto» ha i blocchi del soggetto dell'evento", () => {
    expect(blocksForRef("self", rc).map((b) => b.type)).toEqual(["Body", "PlatformController"]);
    expect(describeRef("@p", rc)).toBe("Pepino");
  });

  it("le parti mancanti delle frasi sono evidenziate", () => {
    const def = getRuleItemDef("event")!;
    expect(formatToken(def.params.event, "", { type: "event", params: { target: "#giocatore" } }, def, rc)).toEqual({ text: "cosa succede?", missing: true });
    expect(formatToken(def.params.event, "jumped", trigger, def, rc)).toEqual({ text: "Ha saltato", missing: false });
  });
});

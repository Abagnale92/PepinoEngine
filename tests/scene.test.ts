import { describe, expect, it } from "vitest";
import { mergeBlocks, type PrefabData } from "@runtime";
import { FLAT, TS, makeProject, makeWorld, player } from "./helpers";

const slimePrefab: PrefabData = {
  id: "slime",
  name: "Slime",
  tags: ["nemico"],
  blocks: [
    { type: "Body", props: { width: 12, height: 9, group: "nemici" } },
    { type: "Health", props: { max: 1 } },
  ],
};

describe("scena e modelli", () => {
  it("l'istanza di un modello sovrascrive solo ciò che cambia", () => {
    const w = makeWorld(
      makeProject(FLAT, [{ id: "a", name: "Slime grosso", x: 50, y: 8 * TS, prefab: "slime", tags: ["boss"], blocks: [{ type: "Health", props: { max: 5 } }] }], {
        prefabs: [slimePrefab],
      }),
    );
    const e = w.get("a");
    expect(e.get("Health")!.props.max).toBe(5);
    expect(e.get("Body")!.props.width).toBe(12);
    expect([...e.tags].sort()).toEqual(["boss", "nemico"]);
  });

  it("mergeBlocks non modifica il modello originale", () => {
    const merged = mergeBlocks(slimePrefab.blocks, [{ type: "Health", props: { max: 9 } }]);
    merged[0].props.width = 99;
    expect(slimePrefab.blocks[0].props.width).toBe(12);
    expect(slimePrefab.blocks[1].props.max).toBe(1);
  });

  it("spawn crea un oggetto già inizializzato", () => {
    const w = makeWorld(makeProject(FLAT, [], { prefabs: [slimePrefab] }));
    const e = w.scene.spawn("slime", 30, 40)!;
    expect(e.id).toBe("slime#1");
    expect(e.body).toBeDefined();
    expect(w.scene.findAll("nemico")).toHaveLength(1);
  });

  it("i figli si muovono con il genitore", () => {
    const w = makeWorld(
      makeProject(FLAT, [
        player(40, 8 * TS, { input: "ai" }, { children: [{ id: "cappello", name: "Cappello", x: 0, y: -20, blocks: [] }] }),
      ]),
    );
    w.get("p").x = 100;
    expect(w.get("cappello").worldX).toBe(100);
    expect(w.get("cappello").worldY).toBe(w.get("p").worldY - 20);
  });

  it("id duplicati e blocchi sconosciuti vengono segnalati", () => {
    const w = makeWorld(
      makeProject(FLAT, [
        { id: "x", name: "Uno", x: 0, y: 0, blocks: [{ type: "BloccoCheNonEsiste", props: {} }] },
        { id: "x", name: "Due", x: 0, y: 0, blocks: [] },
      ]),
    );
    expect(w.logs.some((l) => l.message.includes("stesso id"))).toBe(true);
    expect(w.logs.some((l) => l.message.includes("BloccoCheNonEsiste"))).toBe(true);
  });

  it("un oggetto distrutto sparisce dai contatti degli altri", () => {
    const w = makeWorld(
      makeProject(FLAT, [
        player(40, 8 * TS),
        { id: "z", name: "Zona", x: 40, y: 8 * TS, blocks: [{ type: "Body", props: { width: 16, height: 16, group: "trigger", world: false } }] },
      ]),
    );
    w.step(2);
    const p = w.get("p");
    expect([...p.body!.contacts.keys()].map((e) => e.id)).toContain("z");
    w.get("z").destroy();
    w.step();
    expect([...p.body!.contacts.keys()].map((e) => e.id)).not.toContain("z");
  });
});

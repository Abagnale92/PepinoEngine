import { describe, expect, it } from "vitest";
import { assetUses, replaceAssetRefs } from "../src/renderer/src/projectOps";
import { FLAT, makeProject, makeWorld, rule } from "./helpers";

describe("asset e scala", () => {
  it("conta e svuota i riferimenti a un'immagine: blocchi, Regole, dialoghi e tileset", () => {
    const p = makeProject(FLAT, [{ id: "a", name: "A", x: 0, y: 0, blocks: [{ type: "Sprite", props: { image: "eroe" } }] }], {
      rules: [rule("r", { type: "scene.start", params: {} }, [{ type: "audio.play", params: { sound: "eroe" } }])],
      dialogues: [{ id: "d", name: "D", lines: [{ id: "l", text: "Ciao", portrait: "eroe" }] }],
    });
    p.assets.push({ id: "eroe", type: "image", src: "eroe.png" });
    p.items = [{ id: "x", name: "X", kind: "key", icon: "eroe" }];
    // Il suono della Regola ha lo stesso nome ma è un campo audio: non conta per l'immagine.
    expect(assetUses(p, "eroe")).toBe(3);
    expect(assetUses(p, "tiles")).toBe(1);
    replaceAssetRefs(p, "image", "eroe", "");
    expect(p.scenes[0].entities[0].blocks[0].props.image).toBe("");
    expect(p.items[0].icon).toBe("");
    expect(p.scenes[0].rules![0].actions[0].params.sound).toBe("eroe");
    expect(p.dialogues![0].lines[0].portrait).toBe("");
    expect(assetUses(p, "eroe")).toBe(0);
  });

  it("la scala dell'oggetto ingrandisce anche il corpo di collisione", () => {
    const body = { type: "Body", props: { width: 10, height: 16, world: false } };
    const w = makeWorld(
      makeProject(FLAT, [
        { id: "n", name: "Normale", x: 40, y: 100, blocks: [body] },
        { id: "g", name: "Grande", x: 100, y: 100, scaleX: 2, scaleY: 1.5, blocks: [body] },
      ]),
    );
    const n = w.get("n").body!;
    const g = w.get("g").body!;
    expect([n.w, n.h]).toEqual([10, 16]);
    expect([g.w, g.h]).toEqual([20, 24]);
    // I piedi restano sul punto dell'oggetto.
    expect(g.top + g.h).toBeCloseTo(100, 5);
    expect(g.left + g.w / 2).toBeCloseTo(100, 5);
    expect(w.get("g").scaleX).toBe(2);
  });
});

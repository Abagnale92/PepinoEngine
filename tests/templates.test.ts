import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { loadScripts, validateProject, type ProjectData } from "@runtime";
import { makeWorld } from "./helpers";

const load = (id: string) => JSON.parse(readFileSync(resolve(process.cwd(), "samples", "templates", `${id}.json`), "utf8")) as ProjectData;

describe("modelli di progetto (Nuovo progetto)", () => {
  for (const id of ["platform", "topdown", "beatemup"]) {
    it(`il modello «${id}» è pulito e parte senza errori`, () => {
      loadScripts([]);
      const p = load(id);
      expect(p.scripts ?? []).toEqual([]);
      expect(validateProject(p)).toEqual([]);
      const start = p.scenes.find((s) => s.id === p.settings.startScene)!;
      expect(start).toBeDefined();
      const w = makeWorld({ ...p, scenes: [start, ...p.scenes.filter((s) => s !== start)] });
      w.step(120);
      expect(w.logs.filter((l) => l.level !== "info")).toEqual([]);
    });
  }

  it("il beat 'em up blocca la camera nell'arena finché ci sono teppisti", () => {
    const p = load("beatemup");
    const w = makeWorld(p);
    const player = w.get("giocatore_strada");
    const arena = w.get("arena1");
    player.x = arena.x;
    w.step(2);
    expect(player.get("CameraFollow")!.data.locked).toBe(true);
    for (const e of w.scene.findAll("gruppo1")) e.destroy();
    w.step(2);
    expect(player.get("CameraFollow")!.data.locked).toBe(false);
  });
});

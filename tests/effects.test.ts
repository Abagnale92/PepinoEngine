import { describe, expect, it } from "vitest";
import type { EntityData } from "@runtime";
import { FLAT, makeProject, makeWorld, rule } from "./helpers";

const emitter = (props: Record<string, unknown>, extra: Partial<EntityData> = {}): EntityData => ({
  id: "fx",
  name: "Fontana",
  x: 100,
  y: 100,
  blocks: [{ type: "Particles", props }],
  ...extra,
});

/** Renderer finto: registra solo le chiamate che servono ai test. */
function fakeRenderer() {
  const calls: string[] = [];
  const radial = { tex: {}, width: 64, height: 64 };
  const r = {
    radial,
    calls,
    setView() {},
    setBlend(m: string) {
      calls.push(`blend:${m}`);
    },
    rect() {
      calls.push("rect");
    },
    strokeRect() {},
    draw() {},
    drawUV(tex: unknown) {
      calls.push(tex === radial ? "radial" : "drawUV");
    },
    beginLights() {
      calls.push("beginLights");
    },
    endLights() {
      calls.push("endLights");
    },
  };
  return r;
}

describe("particelle", () => {
  it("una raffica crea le particelle, che poi spariscono", () => {
    const w = makeWorld(makeProject(FLAT, [emitter({ lifetime: 0.5 })]));
    const b = w.get("fx").get("Particles")!;
    expect(b.data.list).toHaveLength(0);
    b.actions.burst(20);
    expect(b.data.list).toHaveLength(20);
    w.step(20);
    expect(b.data.list.length).toBeGreaterThan(0);
    w.step(20);
    expect(b.data.list).toHaveLength(0);
  });

  it("di continuo: circa tante particelle al secondo quante indicate, fino al massimo", () => {
    const w = makeWorld(makeProject(FLAT, [emitter({ mode: "continuous", rate: 30, lifetime: 10, max: 1000 })]));
    const b = w.get("fx").get("Particles")!;
    w.step(60);
    expect(b.data.list.length).toBeGreaterThanOrEqual(29);
    expect(b.data.list.length).toBeLessThanOrEqual(30);
    b.actions.stop();
    w.step(30);
    expect(b.data.list.length).toBeLessThanOrEqual(30);
    const w2 = makeWorld(makeProject(FLAT, [emitter({ mode: "continuous", rate: 100, lifetime: 10, max: 25 })]));
    w2.step(60);
    expect(w2.get("fx").get("Particles")!.data.list).toHaveLength(25);
  });

  it("partono a raffica con un evento dell'oggetto e sopravvivono all'oggetto distrutto", () => {
    const w = makeWorld(makeProject(FLAT, [emitter({ burstOn: "boom", burstCount: 8, lifetime: 0.5, speed: 2, gravity: 10 })]));
    const e = w.get("fx");
    e.emit("boom");
    expect(e.get("Particles")!.data.list).toHaveLength(8);
    e.destroy();
    w.step(1);
    expect(w.scene.entities.includes(e)).toBe(false);
    expect(w.scene.effects).toHaveLength(1);
    w.step(40);
    expect(w.scene.effects).toHaveLength(0);
  });

  it("le particelle luminose si disegnano sommando i colori", () => {
    const w = makeWorld(makeProject(FLAT, [emitter({ additive: true, shape: "soft" })]));
    w.get("fx").get("Particles")!.actions.burst(3);
    const r = fakeRenderer();
    w.scene.render(r as never);
    expect(r.calls.filter((c) => c === "radial")).toHaveLength(3);
    expect(r.calls).toContain("blend:add");
    expect(r.calls.at(-1)).toBe("blend:normal");
  });
});

describe("luci 2D", () => {
  const lamp: EntityData = { id: "lampione", name: "Lampione", x: 80, y: 100, blocks: [{ type: "Light", props: { radius: 3 } }] };

  it("senza luce ambiente la scena non passa dalle luci", () => {
    const w = makeWorld(makeProject(FLAT, [lamp]));
    const r = fakeRenderer();
    w.scene.render(r as never);
    expect(r.calls).not.toContain("beginLights");
  });

  it("con la luce ambiente ogni Luce accesa si disegna nella mappa di luce", () => {
    const p = makeProject(FLAT, [lamp, { ...lamp, id: "lampione2" }]);
    p.scenes[0].ambient = "#101020";
    const w = makeWorld(p);
    let r = fakeRenderer();
    w.scene.render(r as never);
    const i = r.calls.indexOf("beginLights");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(r.calls.slice(i + 1, r.calls.indexOf("endLights")).filter((c) => c === "radial")).toHaveLength(2);
    w.get("lampione").get("Light")!.actions.off();
    r = fakeRenderer();
    w.scene.render(r as never);
    expect(r.calls.filter((c) => c === "radial")).toHaveLength(1);
  });

  it("le Regole cambiano la luce ambiente e l'effetto a tutto schermo", () => {
    const p = makeProject(FLAT, [lamp], {
      rules: [
        rule("notte", { type: "scene.start", params: {} }, [
          { type: "light.ambient", params: { color: "#000000" } },
          { type: "screen.effect", params: { effect: "crt", strength: 0.5 } },
        ]),
      ],
    });
    const w = makeWorld(p);
    expect(w.scene.ambient).toBeUndefined();
    w.step(1);
    expect(w.scene.ambient).toBe("#000000");
    expect(w.game.screenEffect).toEqual({ id: "crt", strength: 0.5 });
  });
});

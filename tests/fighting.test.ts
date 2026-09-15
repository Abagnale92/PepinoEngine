import { describe, expect, it } from "vitest";
import { applyEffect, identityFx, type EntityData } from "@runtime";
import { makeProject, makeWorld } from "./helpers";

const STREET = Array(12).fill(".".repeat(60));

const fighter = (x: number, blocks: EntityData["blocks"] = []): EntityData => ({
  id: "p",
  name: "Pepino",
  x,
  y: 100,
  tags: ["giocatore"],
  blocks: [
    { type: "Body", props: { width: 10, height: 8, group: "giocatore", collidesWith: ["nemici"] } },
    { type: "BeatEmUpController", props: {} },
    { type: "Health", props: { max: 5, invulnerability: 0, knockback: 0 } },
    ...blocks,
  ],
});

const dummy = (x: number, extra: Partial<EntityData> = {}): EntityData => ({
  id: "e",
  name: "Sacco",
  x,
  y: 100,
  tags: ["nemico"],
  blocks: [
    { type: "Body", props: { width: 12, height: 8, group: "nemici", collidesWith: ["giocatore"] } },
    { type: "BeatEmUpController", props: { input: "ai" } },
    { type: "Health", props: { max: 20, invulnerability: 0, knockback: 0 } },
  ],
  ...extra,
});

/** Preme il tasto per un passo e lo rilascia. */
function tap(w: ReturnType<typeof makeWorld>, action = "attack") {
  w.input.hold(action);
  w.step(1);
  w.input.release(action);
}

describe("combo di colpi", () => {
  it("tre pressioni fanno tre colpi diversi; l'ultimo manda a terra", () => {
    const w = makeWorld(makeProject(STREET, [fighter(100, [{ type: "Combo", props: {} }]), dummy(113)]));
    const p = w.get("p");
    const e = w.get("e");
    const hp = () => e.get("Health")!.data.hp;
    const states: string[] = [];
    // Premendo di continuo (una volta ogni 4 passi) la combo va avanti da sola.
    for (let i = 0; i < 60; i++) {
      if (i % 4 === 0) tap(w);
      else w.step(1);
      if (p.state.startsWith("attack") && states.at(-1) !== p.state) states.push(p.state);
    }
    // Dopo il colpo finale la combo ricomincia dal primo colpo.
    expect(states.slice(0, 4)).toEqual(["attack1", "attack2", "attack3", "attack1"]);
    // 1 + 1 + 2 (+ il primo colpo della combo successiva, se il nemico è di nuovo in piedi)
    expect(20 - hp()).toBeGreaterThanOrEqual(4);
    expect(w.calls.filter((c) => c.startsWith("hitstop")).length).toBeGreaterThanOrEqual(3);
  });

  it("il colpo finale fa volare il nemico, che resta a terra e poi si rialza", () => {
    const w = makeWorld(makeProject(STREET, [fighter(100, [{ type: "Combo", props: { moves: 1 } }]), dummy(113)]));
    const e = w.get("e");
    const events: string[] = [];
    e.on("knockedDown", () => events.push("down"));
    e.on("gotUp", () => events.push("up"));
    tap(w);
    let top = 0;
    const seen = new Set<string>();
    for (let i = 0; i < 120; i++) {
      w.step(1);
      top = Math.max(top, e.elevation);
      seen.add(e.state);
    }
    expect(top).toBeGreaterThan(8);
    expect(seen.has("down")).toBe(true);
    expect(seen.has("getup")).toBe(true);
    expect(events).toEqual(["down", "up"]);
    expect(e.state).toBe("idle");
    expect(e.stunned).toBe(0);
  });

  it("finito il tempo per il colpo successivo, la combo ricomincia dal primo", () => {
    const w = makeWorld(makeProject(STREET, [fighter(100, [{ type: "Combo", props: { comboWindow: 0.2 } }])]));
    const p = w.get("p");
    tap(w);
    w.step(30);
    tap(w);
    expect(p.state).toBe("attack1");
  });

  it("in aria esce il colpo in aria, una volta per salto", () => {
    const w = makeWorld(makeProject(STREET, [fighter(100, [{ type: "Combo", props: {} }]), dummy(112)]));
    const p = w.get("p");
    tap(w, "jump");
    w.step(4);
    tap(w);
    expect(p.state).toBe("airAttack");
    w.step(60);
    expect(p.elevation).toBe(0);
    expect(w.get("e").get("Health")!.data.hp).toBeLessThan(20);
  });
});

describe("effetti animati", () => {
  it("l'atterraggio schiaccia lo sprite e poi torna normale", () => {
    const fx = identityFx();
    applyEffect(fx, "squash", 0, 1, 1, 0xffffff);
    expect(fx.sx).toBeGreaterThan(1.3);
    expect(fx.sy).toBeLessThan(0.75);
    const end = identityFx();
    applyEffect(end, "squash", 1, 1, 1, 0xffffff);
    expect(end).toEqual(identityFx());
  });

  it("il blocco reagisce agli eventi e alla fine lascia una copia che sparisce", () => {
    const e: EntityData = {
      id: "s",
      name: "Slime",
      x: 50,
      y: 100,
      blocks: [{ type: "SpriteFX", props: { idle: "float" } }],
    };
    const w = makeWorld(makeProject(STREET, [e]));
    const s = w.get("s");
    w.step(10);
    expect(s.fx.dy).toBeLessThan(0);
    s.emit("hurt");
    w.step(1);
    expect(s.fx.flash).toBeGreaterThan(0.5);
    w.step(30);
    expect(s.fx.flash).toBe(0);
    // Senza immagine non c'è nulla da far sparire; con lo sprite si aggiunge l'effetto alla scena (vedi demo).
    s.destroy();
    w.step(1);
    expect(s.fx).toEqual(identityFx());
  });
});

describe("boss", () => {
  const boss = (attacks: Record<string, unknown>, extra: EntityData["blocks"] = []): EntityData => ({
    id: "boss",
    name: "Capo",
    x: 200,
    y: 100,
    tags: ["nemico", "boss"],
    blocks: [
      { type: "Body", props: { width: 20, height: 10, group: "nemici", collidesWith: ["giocatore"] } },
      { type: "Health", props: { max: 10, invulnerability: 0, knockback: 0 } },
      {
        type: "Boss",
        props: { wakeRange: 8, windupTime: 0.2, restTime: 0.5, melee: false, charge: false, slam: false, ...attacks },
      },
      ...extra,
    ],
  });

  it("dorme finché il bersaglio è lontano, poi si sveglia", () => {
    const w = makeWorld(makeProject(STREET, [fighter(20), boss({ slam: true })]));
    const b = w.get("boss");
    const events: string[] = [];
    b.on("awake", () => events.push("awake"));
    w.step(10);
    expect(b.get("Boss")!.data.awake).toBe(false);
    w.get("p").x = 120;
    w.step(2);
    expect(events).toEqual(["awake"]);
  });

  it("la schiacciata atterra dove era il bersaglio e lo manda a terra", () => {
    const w = makeWorld(makeProject(STREET, [fighter(140), boss({ slam: true })]));
    const b = w.get("boss");
    const p = w.get("p");
    let top = 0;
    for (let i = 0; i < 150 && p.get("Health")!.data.hp === 5; i++) {
      w.step(1);
      top = Math.max(top, b.elevation);
    }
    expect(top).toBeGreaterThan(30);
    expect(p.get("Health")!.data.hp).toBe(4);
    expect(Math.abs(b.x - 140)).toBeLessThan(20);
    w.step(2);
    expect(p.get("BeatEmUpController")!.data.down).toBe(true);
  });

  it("chiama gli aiutanti e cambia fase quando la vita scende", () => {
    const minion = { id: "aiutante", name: "Aiutante", tags: ["nemico"], blocks: [{ type: "Body", props: { width: 8, height: 8, group: "nemici" } }] };
    const p = makeProject(STREET, [fighter(150), boss({ summon: true, minion: "aiutante", minions: 2 })], { prefabs: [minion] });
    const w = makeWorld(p);
    const b = w.get("boss");
    const phases: string[] = [];
    b.on("phase2", () => phases.push("2"));
    b.on("phase3", () => phases.push("3"));
    w.step(120);
    expect(w.scene.entities.filter((e) => e.prefab === "aiutante").length).toBeGreaterThanOrEqual(2);
    b.get("Health")!.actions.damage(5);
    w.step(1);
    b.get("Health")!.actions.damage(3);
    w.step(1);
    expect(phases).toEqual(["2", "3"]);
    expect(b.get("Boss")!.data.phase).toBe(3);
  });
});

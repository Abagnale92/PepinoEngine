import { describe, expect, it } from "vitest";
import { COLL, playerInput, type EntityData, type PrefabData } from "@runtime";
import { makeProject, makeWorld, TS } from "./helpers";

// Giochi di gruppo: Fuggitivo, Cacciatore, Bonus da raccogliere, Infestabile, Trappola, Partita a squadre, Scelta dei personaggi.

const ARENA = [
  "####################",
  "#..................#",
  "#..................#",
  "#..................#",
  "#..................#",
  "#..................#",
  "#..................#",
  "#..................#",
  "#..................#",
  "####################",
];

const at = (col: number, row: number) => ({ x: col * TS + TS / 2, y: (row + 1) * TS - 2 });

const kid = (id: string, col: number, row: number, props: Record<string, unknown> = {}): EntityData => ({
  id,
  name: id,
  ...at(col, row),
  tags: ["ragazzo"],
  blocks: [
    { type: "Body", props: { width: 10, height: 8, group: "giocatore", collidesWith: [] } },
    { type: "TopDownController", props: { input: "ai", speed: 5, accelTime: 0.01, decelTime: 0.01 } },
    { type: "Runner", props: { control: `c_${id}`, players: "giocatori", trap: "zucca", ...props } },
  ],
});

const monster = (col: number, row: number, props: Record<string, unknown> = {}): EntityData => ({
  id: "mostro",
  name: "Mostro",
  ...at(col, row),
  tags: ["mostro"],
  blocks: [
    { type: "Body", props: { width: 12, height: 10, group: "nemici", collidesWith: [] } },
    { type: "TopDownController", props: { input: "ai", speed: 5, accelTime: 0.01, decelTime: 0.01 } },
    { type: "Hunter", props: { control: "c_mostro", players: "giocatori", ...props } },
  ],
});

const candy = (id: string, col: number, row: number, props: Record<string, unknown> = {}): EntityData => ({
  id,
  name: id,
  ...at(col, row),
  blocks: [
    { type: "Body", props: { width: 8, height: 8, group: "raccoglibili" } },
    { type: "PartyItem", props: { kind: "candy", value: 1, ...props } },
  ],
});

const TRAP: PrefabData = {
  id: "zucca",
  name: "Zucca esplosiva",
  blocks: [
    { type: "Sprite", props: { image: "" } },
    { type: "Trap", props: { arm: 0.2, trigger: 1.2, blast: 2, stun: 2 } },
  ],
};

function world(entities: EntityData[], vars: Record<string, number | string> = {}, rows = ARENA) {
  const p = makeProject(rows, entities, {
    variables: { giocatori: 1, caramelle: 0, c_mostro: 0, ...vars },
    prefabs: [TRAP],
  });
  p.input = playerInput(4);
  return makeWorld(p);
}

const runner = (w: ReturnType<typeof world>, id: string) => w.get(id).get("Runner")!;
const hunter = (w: ReturnType<typeof world>) => w.get("mostro").get("Hunter")!;

describe("comandi di più giocatori", () => {
  it("con più giocatori ognuno usa i suoi tasti; da soli valgono quelli di sempre", () => {
    const w = world([kid("a", 3, 4), kid("b", 10, 4)], { giocatori: 2, c_a: 1, c_b: 2 });
    const ax = w.get("a").x;
    const bx = w.get("b").x;
    w.input.hold("p2.left");
    w.input.hold("right");
    w.step(20);
    expect(w.get("b").x).toBeLessThan(bx - 10);
    // «right» non è di nessuno dei due quando i giocatori sono due.
    expect(Math.abs(w.get("a").x - ax)).toBeLessThan(1);
    w.game.vars.giocatori = 1;
    w.step(20);
    expect(w.get("a").x).toBeGreaterThan(ax + 10);
  });

  it("chi ha -1 non partecipa: l'oggetto sparisce", () => {
    const w = world([kid("a", 3, 4), kid("b", 6, 4)], { c_a: 0, c_b: -1 });
    w.step(1);
    expect(w.scene.entities.some((e) => e.id === "b")).toBe(false);
    expect(w.scene.entities.some((e) => e.id === "a")).toBe(true);
  });
});

describe("Fuggitivo e Cacciatore", () => {
  it("raccoglie le caramelle: conto della squadra e suo", () => {
    const w = world([kid("a", 3, 4), candy("c1", 5, 4), candy("c2", 7, 4, { value: 3 })], { c_a: 1 });
    w.input.hold("right");
    w.step(60);
    expect(w.game.vars.caramelle).toBe(4);
    expect(runner(w, "a").data.candies).toBe(4);
    expect(w.scene.entities.some((e) => e.id === "c1")).toBe(false);
  });

  it("preso dal Cacciatore diventa un fantasma che passa nei muri", () => {
    const w = world([kid("a", 5, 4), monster(5, 4)], { c_a: 1 });
    w.step(2);
    const r = runner(w, "a");
    expect(r.data.status).toBe("turning");
    expect(w.get("a").hasTag("ragazzo")).toBe(false);
    w.step(60);
    expect(r.data.status).toBe("ghost");
    expect(w.get("a").hasTag("fantasma")).toBe(true);
    expect(w.get("a").body!.world).toBe(false);
    expect(hunter(w).data.captures).toBe(1);
  });

  it("con «prese da sopportare» resiste alla prima presa", () => {
    const w = world([kid("a", 5, 4, { extraHits: 1 }), monster(5, 4)], { c_a: 1 });
    w.step(2);
    const r = runner(w, "a");
    expect(r.data.status).toBe("run");
    expect(r.data.hits).toBe(0);
    expect(r.data.invuln).toBeGreaterThan(0);
  });

  it("il mantello lo rende imprendibile", () => {
    const w = world([kid("a", 5, 4), monster(12, 4)], { c_a: 1 });
    const r = runner(w, "a");
    r.actions.giveBonus("cloak");
    w.input.hold("action");
    w.step(1);
    expect(r.data.cloak).toBeGreaterThan(0);
    w.get("mostro").x = w.get("a").x;
    w.step(3);
    expect(r.data.status).toBe("run");
  });

  it("la torcia stordisce il Cacciatore vicino", () => {
    const w = world([kid("a", 5, 4), monster(8, 4)], { c_a: 1 });
    const r = runner(w, "a");
    r.actions.giveBonus("flashlight");
    w.input.hold("action");
    w.step(1);
    expect(hunter(w).data.stun).toBeGreaterThan(1.5);
    expect(r.data.held).toEqual([]);
  });

  it("la zucca esplosiva lasciata a terra stordisce il Cacciatore che ci passa", () => {
    const w = world([kid("a", 5, 4), monster(14, 4, { lightTag: "" })], { c_a: 1, c_mostro: 2, giocatori: 2 });
    const r = runner(w, "a");
    r.actions.giveBonus("pumpkin");
    w.input.hold("p1.action");
    w.step(1);
    w.input.release("p1.action");
    expect(w.scene.entities.some((e) => e.prefab === "zucca")).toBe(true);
    w.step(20);
    w.input.hold("p2.left");
    for (let i = 0; i < 120 && !(hunter(w).data.stun > 0); i++) w.step(1);
    expect(hunter(w).data.stun).toBeGreaterThan(0);
  });

  it("nella luce di un lampione il Cacciatore rallenta", () => {
    const lamp: EntityData = { id: "lamp", name: "Lampione", ...at(10, 4), tags: ["lampione"], blocks: [{ type: "Light", props: { radius: 4 } }] };
    const w = world([monster(8, 4), lamp], { c_mostro: 1 });
    w.step(1);
    expect(hunter(w).data.lit).toBe(true);
    w.input.hold("right");
    w.step(2);
    expect(w.get("mostro").boosts.speed).toBeCloseTo(0.6);
  });

  it("lo scatto del Cacciatore è veloce e poi deve aspettare", () => {
    const w = world([monster(4, 4)], { c_mostro: 1 });
    w.input.hold("right");
    w.step(2);
    w.input.hold("action");
    w.step(1);
    const h = hunter(w);
    expect(h.data.lungeT).toBeGreaterThan(0);
    expect(h.data.lungeCd).toBeGreaterThan(2);
    w.step(4);
    expect(w.get("mostro").body!.vx).toBeGreaterThan(8 * TS);
  });
});

describe("fantasmi e cose infestabili", () => {
  const ghostWorld = (extra: EntityData[], vars: Record<string, number> = {}) => {
    const w = world([kid("g", 5, 4), ...extra], { c_g: 1, ...vars });
    runner(w, "g").actions.makeGhost();
    w.step(60);
    expect(runner(w, "g").data.status).toBe("ghost");
    return w;
  };

  it("spegne un lampione, che poi si riaccende", () => {
    const lamp: EntityData = {
      id: "lamp",
      name: "Lampione",
      ...at(6, 4),
      tags: ["lampione"],
      blocks: [
        { type: "Body", props: { width: 8, height: 8, group: "trigger", world: false } },
        { type: "Light", props: { radius: 3 } },
        { type: "Hauntable", props: { kind: "lamp", duration: 1, cooldown: 1 } },
      ],
    };
    const w = ghostWorld([lamp]);
    w.input.hold("action");
    w.step(1);
    w.input.release("action");
    expect(w.get("lamp").get("Light")!.data.on).toBe(false);
    expect(w.get("lamp").state).toBe("off");
    w.step(100);
    expect(w.get("lamp").get("Light")!.data.on).toBe(true);
  });

  it("chiude un cancello (diventa muro) ma non addosso a qualcuno", () => {
    const gate: EntityData = {
      id: "gate",
      name: "Cancello",
      x: 8 * TS + 8,
      y: 5 * TS,
      blocks: [
        { type: "Body", props: { width: 16, height: 16, group: "trigger", world: false } },
        { type: "Hauntable", props: { kind: "gate", duration: 1 } },
      ],
    };
    const w = world([kid("g", 7, 4), kid("k", 8, 4), gate], { c_g: 1, c_k: 0 });
    runner(w, "g").actions.makeGhost();
    w.step(60);
    // Il ragazzo è proprio sul cancello: non si chiude.
    w.get("k").get("Runner")!.data.status = "run";
    const k = w.get("k");
    k.x = 8 * TS + 8;
    k.y = 5 * TS - 2;
    w.input.hold("action");
    w.step(1);
    w.input.release("action");
    expect(w.get("gate").get("Hauntable")!.data.closed).toBe(false);
    k.x = 3 * TS;
    w.step(80);
    w.input.hold("action");
    w.step(1);
    expect(w.get("gate").get("Hauntable")!.data.closed).toBe(true);
    expect(w.scene.grid.get(8, 4)).toBe(COLL.solid);
    w.step(90);
    expect(w.scene.grid.get(8, 4)).toBe(COLL.none);
  });

  it("sposta un oggetto per bloccare un passaggio", () => {
    const bin: EntityData = {
      id: "bin",
      name: "Bidone",
      x: 6 * TS + 8,
      y: 5 * TS,
      blocks: [
        { type: "Body", props: { width: 14, height: 14, group: "trigger", world: false } },
        { type: "Hauntable", props: { kind: "push", pushX: 2, pushY: 0, duration: 2 } },
      ],
    };
    const w = ghostWorld([bin]);
    expect(w.scene.grid.get(6, 4)).toBe(COLL.solid);
    w.input.hold("action");
    w.step(30);
    expect(w.scene.grid.get(6, 4)).toBe(COLL.none);
    expect(w.scene.grid.get(8, 4)).toBe(COLL.solid);
    expect(w.get("bin").x).toBeCloseTo(8 * TS + 8);
  });

  it("«Buh!» spaventa chi è vicino: rallenta per un po'", () => {
    // Anche «k» è di un giocatore (fermo): un ragazzo del computer se ne andrebbe in giro.
    const w = world([kid("g", 5, 4), kid("k", 6, 4)], { c_g: 1, c_k: 2 });
    runner(w, "g").actions.makeGhost();
    w.step(60);
    w.input.hold("action");
    w.step(1);
    const k = runner(w, "k");
    expect(k.data.scared).toBeGreaterThan(1);
    expect(w.get("k").boosts.speed).toBeLessThan(0.5);
  });

  it("la chiave apre un cancello chiuso a chiave", () => {
    const gate: EntityData = {
      id: "gate",
      name: "Cancello",
      x: 8 * TS + 8,
      y: 5 * TS,
      blocks: [
        { type: "Body", props: { width: 16, height: 16, group: "trigger", world: false } },
        { type: "Hauntable", props: { kind: "gate", locked: true } },
      ],
    };
    const w = world([kid("a", 6, 4), gate], { c_a: 1 });
    w.step(1);
    expect(w.scene.grid.get(8, 4)).toBe(COLL.solid);
    runner(w, "a").actions.giveBonus("key");
    w.input.hold("right");
    w.step(40);
    expect(w.get("gate").get("Hauntable")!.data.locked).toBe(false);
    expect(w.scene.grid.get(8, 4)).toBe(COLL.none);
    expect(runner(w, "a").data.held).toEqual([]);
  });
});

describe("Partita a squadre", () => {
  const exitGate: EntityData = {
    id: "uscita",
    name: "Cancello d'uscita",
    x: 18 * TS + 8,
    y: 5 * TS,
    tags: ["uscita"],
    blocks: [
      { type: "Body", props: { width: 16, height: 16, group: "trigger", world: false } },
      { type: "Hauntable", props: { kind: "gate", locked: true, ghosts: false } },
    ],
  };
  const match = (props: Record<string, unknown> = {}): EntityData => ({
    id: "partita",
    name: "Partita",
    x: 0,
    y: 0,
    blocks: [{ type: "PartyMatch", props: { goal: 2, duration: 30, countdown: 1, hunterDelay: 0, resultVar: "esito", ...props } }],
  });

  it("ogni partita parte da zero: le caramelle della partita prima non aprono l'uscita", () => {
    // Come tornando dalla scelta dei personaggi dopo una partita: la variabile ha ancora il vecchio conto.
    const w = world([match({ goal: 30 }), kid("a", 3, 4), exitGate], { c_a: 1, c_mostro: -1, caramelle: 24, esito: "mostro", tempo: 3 });
    w.step(1);
    expect(w.game.vars.caramelle).toBe(0);
    expect(w.game.vars.esito).toBe("");
    w.step(120);
    expect(w.get("partita").get("PartyMatch")!.data.exitOpen).toBe(false);
    expect(w.get("uscita").get("Hauntable")!.data.closed).toBe(true);
  });

  it("dopo il conto alla rovescia si gioca; con le caramelle l'uscita si apre e chi la tocca è in salvo", () => {
    const w = world([match(), kid("a", 14, 4), candy("c1", 15, 4), candy("c2", 16, 4), exitGate], { c_a: 1, c_mostro: -1, esito: "" });
    w.input.hold("right");
    w.step(30);
    // Durante il conto alla rovescia non si muove.
    expect(w.get("a").x).toBeCloseTo(14 * TS + 8);
    w.step(120);
    expect(w.game.vars.caramelle).toBe(2);
    const m = w.get("partita").get("PartyMatch")!;
    expect(m.data.exitOpen).toBe(true);
    expect(runner(w, "a").data.status).toBe("out");
    expect(m.data.phase).toBe("ended");
    expect(w.game.vars.esito).toBe("ragazzi");
  });

  it("se tutti diventano fantasmi vince il Cacciatore", () => {
    const w = world([match({ countdown: 0 }), kid("a", 5, 4), monster(5, 4)], { c_a: 1, esito: "" });
    w.step(80);
    const m = w.get("partita").get("PartyMatch")!;
    expect(m.data.phase).toBe("ended");
    expect(m.data.result).toBe("hunter");
    expect(w.game.vars.esito).toBe("mostro");
  });

  it("a mezzanotte finisce: chi è ancora fuori ha perso", () => {
    const w = world([match({ countdown: 0, duration: 10 }), kid("a", 3, 4)], { c_a: 1, c_mostro: -1, esito: "" });
    w.step(60 * 10 + 2);
    const m = w.get("partita").get("PartyMatch")!;
    expect(m.data.phase).toBe("ended");
    expect(m.data.midnight).toBe(true);
    expect(w.game.vars.esito).toBe("mostro");
    // Rivincita: il pulsante selezionato all'inizio ricomincia la scena.
    w.step(100);
    w.input.hold("action");
    w.step(1);
    expect(w.calls).toContain("restartScene");
  });
});

describe("il computer al posto dei giocatori", () => {
  it("un ragazzo del computer va a prendere tutte le caramelle", () => {
    const candies = [candy("c1", 2, 1), candy("c2", 17, 1), candy("c3", 17, 8), candy("c4", 2, 8), candy("c5", 10, 5)];
    const rows = ARENA.map((r, y) => (y === 4 ? "#.......####.......#" : r));
    const w = world([kid("a", 9, 2), ...candies], { c_a: 0, c_mostro: -1 }, rows);
    w.step(60 * 25);
    expect(w.game.vars.caramelle).toBe(5);
  });

  it("il mostro del computer trova e prende un ragazzo fermo", () => {
    const w = world([monster(2, 2), kid("a", 16, 7)], { c_a: 1, c_mostro: 0 });
    w.step(60 * 10);
    expect(runner(w, "a").data.status).not.toBe("run");
  });

  it("un fantasma del computer va a spaventare chi scappa", () => {
    const w = world([kid("g", 2, 2), kid("k", 15, 7)], { c_g: 0, c_k: 1, c_mostro: -1 });
    runner(w, "g").actions.makeGhost();
    let scared = false;
    for (let i = 0; i < 60 * 8 && !scared; i++) {
      w.step(1);
      scared = runner(w, "k").data.scared > 0;
    }
    expect(scared).toBe(true);
  });
});

describe("Scelta dei personaggi", () => {
  const select = (): EntityData => ({
    id: "scelta",
    name: "Scelta",
    x: 0,
    y: 0,
    blocks: [
      {
        type: "CharacterSelect",
        props: {
          scene: "partita",
          playersVar: "giocatori",
          kidsVar: "ragazzi",
          skillVar: "difficolta",
          characters: [
            { name: "Strega", role: "runner", variable: "c_strega" },
            { name: "Vampiro", role: "runner", variable: "c_vampiro" },
            { name: "Scheletro", role: "runner", variable: "c_scheletro" },
            { name: "Mummia", role: "runner", variable: "c_mummia" },
            { name: "Mostro", role: "hunter", variable: "c_mostro" },
          ],
        },
      },
    ],
  });
  const vars = { c_strega: 0, c_vampiro: 0, c_scheletro: 0, c_mummia: 0, ragazzi: 4, difficolta: 2 };

  it("un giocatore solo sceglie il mostro: i ragazzi sono tutti del computer", () => {
    const w = world([select()], vars);
    w.input.hold("p1.action");
    w.step(1);
    w.input.release("p1.action");
    // Il cursore parte dal primo ragazzo: quattro passi a destra arrivano al mostro.
    for (let i = 0; i < 4; i++) {
      w.input.hold("p1.right");
      w.step(1);
      w.input.release("p1.right");
      w.step(1);
    }
    w.input.hold("p1.action");
    w.step(1);
    w.input.release("p1.action");
    w.step(1);
    w.input.hold("p1.action");
    w.step(1);
    const v = w.game.vars;
    expect(v.c_mostro).toBe(1);
    expect([v.c_strega, v.c_vampiro, v.c_scheletro, v.c_mummia]).toEqual([0, 0, 0, 0]);
    expect(v.giocatori).toBe(1);
    expect(w.calls).toContain("goToScene:partita");
  });

  it("due giocatori scelgono due ragazzi; il mostro è del computer e con 3 ragazzi uno resta fuori", () => {
    const w = world([select()], { ...vars, ragazzi: 3 });
    w.input.hold("p1.action");
    w.input.hold("p2.action");
    w.step(1);
    w.input.release("p1.action");
    w.input.release("p2.action");
    w.step(1);
    w.input.hold("p1.action");
    w.input.hold("p2.action");
    w.step(1);
    w.input.release("p1.action");
    w.input.release("p2.action");
    w.step(1);
    w.input.hold("p2.action");
    w.step(1);
    const v = w.game.vars;
    expect(v.giocatori).toBe(2);
    expect(v.c_mostro).toBe(0);
    const kids = [v.c_strega, v.c_vampiro, v.c_scheletro, v.c_mummia];
    expect(kids.filter((x) => x === 1)).toHaveLength(1);
    expect(kids.filter((x) => x === 2)).toHaveLength(1);
    expect(kids.filter((x) => x === 0)).toHaveLength(1);
    expect(kids.filter((x) => x === -1)).toHaveLength(1);
  });
});

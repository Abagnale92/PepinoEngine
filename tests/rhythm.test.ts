import { describe, expect, it } from "vitest";
import type { EntityData } from "@runtime";
import { DT, FLAT, makeProject, makeWorld } from "./helpers";

/** Una canzone con quattro note scritte a mano: 120 bpm, ottavi → una nota ogni 0,25 s. */
const track = (props: Record<string, unknown> = {}): EntityData => ({
  id: "canzone",
  name: "Canzone",
  x: 0,
  y: 0,
  blocks: [
    {
      type: "RhythmTrack",
      props: {
        lanes: 4,
        bpm: 120,
        perBeat: 2,
        pattern: "1-2-3-4-",
        delay: 0,
        perfectWindow: 70,
        goodWindow: 140,
        scoreVar: "punti",
        comboVar: "combo",
        missVar: "mancate",
        ...props,
      },
    },
  ],
});

type World = ReturnType<typeof makeWorld>;
const press = (w: World, action: string) => {
  w.input.hold(action);
  w.step(1);
  w.input.release(action);
};

describe("note a tempo", () => {
  it("il disegno diventa una fila di note, una ogni mezzo battito", () => {
    const w = makeWorld(makeProject(FLAT, [track()], { variables: { punti: 0, combo: 0, mancate: 0, vita: 3 } }));
    const b = w.get("canzone").get("RhythmTrack")!;
    const notes = b.data.notes as { time: number; lane: number }[];
    expect(notes).toHaveLength(4);
    expect(notes.map((n) => n.lane)).toEqual([0, 1, 2, 3]);
    expect(notes[1].time).toBeCloseTo(0.5, 5);
  });

  it("premere a tempo dà punti e combo, sbagliare corsia no", () => {
    const w = makeWorld(makeProject(FLAT, [track()], { variables: { punti: 0, combo: 0, mancate: 0, vita: 3 } }));
    const b = w.get("canzone").get("RhythmTrack")!;
    // La prima nota è a 0 s, nella corsia 1 (tasto sinistra).
    press(w, "left");
    expect(Number(w.game.vars.punti)).toBeGreaterThan(0);
    expect(Number(w.game.vars.combo)).toBe(1);
    // La seconda nota (corsia 2) arriva a 0,5 s: premendo il tasto sbagliato non succede nulla.
    const punti = Number(w.game.vars.punti);
    w.step(Math.round(0.5 / DT) - 1);
    press(w, "up");
    expect(Number(w.game.vars.punti)).toBe(punti);
    press(w, "down");
    expect(Number(w.game.vars.punti)).toBeGreaterThan(punti);
    expect(Number(w.game.vars.combo)).toBe(2);
  });

  it("una nota lasciata passare si perde e azzera la combo", () => {
    const w = makeWorld(makeProject(FLAT, [track()], { variables: { punti: 0, combo: 0, mancate: 0, vita: 3 } }));
    press(w, "left");
    expect(Number(w.game.vars.combo)).toBe(1);
    w.step(60);
    expect(Number(w.game.vars.mancate)).toBeGreaterThanOrEqual(1);
    expect(Number(w.game.vars.combo)).toBe(0);
  });

  it("alla fine della canzone parte l'evento con il punteggio", () => {
    const w = makeWorld(makeProject(FLAT, [track()], { variables: { punti: 0, combo: 0, mancate: 0, vita: 3 } }));
    const b = w.get("canzone").get("RhythmTrack")!;
    let ended: { score: number; accuracy: number } | null = null;
    w.get("canzone").on("finished", (data) => (ended = data as { score: number; accuracy: number }));
    w.step(60 * 6);
    expect(b.data.over).toBe(true);
    expect(ended).not.toBeNull();
    expect(ended!.accuracy).toBe(0);
  });

  it("senza disegno la canzone se la inventa, sempre uguale con lo stesso seme", () => {
    const build = (seed: number) => {
      const w = makeWorld(makeProject(FLAT, [track({ pattern: "", bars: 4, density: 0.5, seed })], { variables: { punti: 0, combo: 0, mancate: 0, vita: 3 } }));
      return (w.get("canzone").get("RhythmTrack")!.data.notes as { time: number; lane: number }[]).map((n) => `${n.time}:${n.lane}`).join(",");
    };
    expect(build(3)).toBe(build(3));
    expect(build(3)).not.toBe(build(9));
    expect(build(3).length).toBeGreaterThan(0);
  });
});

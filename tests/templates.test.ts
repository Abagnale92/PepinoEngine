import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { loadScripts, validateProject, type ProjectData } from "@runtime";
import { makeWorld } from "./helpers";

const load = (id: string) => JSON.parse(readFileSync(resolve(process.cwd(), "samples", "templates", `${id}.json`), "utf8")) as ProjectData;

describe("modelli di progetto (Nuovo progetto)", () => {
  for (const id of ["platform", "topdown", "beatemup", "shmup", "towerdefense", "racing"]) {
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

  it("lo shoot'em up scorre, la navicella spara e i nemici abbattuti danno punti", () => {
    const p = load("shmup");
    const w = makeWorld(p);
    const cam = w.scene.camera;
    const y0 = cam.y;
    const ship = w.get("navicella");
    w.step(150);
    expect(cam.y).toBeLessThan(y0 - 10);
    // Il caccia scende dritto verso la navicella: i laser lo prendono prima che arrivi.
    const caccia = w.scene.spawn("caccia", ship.worldX, ship.worldY - 60)!;
    w.input.hold("jump");
    w.step(60);
    expect(caccia.destroyed).toBe(true);
    expect(Number(w.game.vars.punti)).toBeGreaterThanOrEqual(10);
    expect(w.scene.entities.some((e) => !e.destroyed && e.get("Projectile"))).toBe(true);
  });

  it("tower defense: si costruisce una torretta, gli slime camminano sul sentiero e abbatterli dà monete", () => {
    const p = load("towerdefense");
    const w = makeWorld(p);
    const spot = w.get("piazzola_1");
    Object.assign(w.input.pointer, { x: spot.worldX, y: spot.worldY - 8, pressed: true, moved: true });
    w.step(1);
    Object.assign(w.input.pointer, { pressed: false, moved: false });
    expect(w.scene.findAll("torretta")).toHaveLength(1);
    expect(w.game.vars.monete).toBe(30);
    w.step(60 * 20);
    expect(Number(w.game.vars.ondata)).toBeGreaterThanOrEqual(1);
    expect(Number(w.game.vars.monete)).toBeGreaterThan(30);
  });

  it("corse: dopo il conto alla rovescia l'auto parte, gli avversari girano e i giri si contano", () => {
    const p = load("racing");
    const w = makeWorld(p);
    const car = w.get("auto_giocatore");
    const rival = w.get("auto_rossa");
    const x0 = car.x;
    const r0 = rival.x;
    w.input.hold("up");
    w.step(90);
    // La regola blocca i comandi durante il primo passo: al massimo l'auto si sposta di una frazione di pixel.
    expect(car.x).toBeCloseTo(x0, 0);
    expect(rival.x).toBe(r0);
    w.step(60 * 5);
    expect(car.x).toBeGreaterThan(x0 + 50);
    expect(rival.x).toBeGreaterThan(r0 + 50);
    expect(w.game.vars.giro).toBe(1);
    expect([1, 2, 3, 4]).toContain(w.game.vars.posizione);
    // Un giro passando dai traguardi in ordine.
    w.input.release("up");
    for (const id of ["traguardo_1", "traguardo_2", "traguardo_3", "arrivo"]) {
      const cp = w.get(id);
      car.x = cp.worldX;
      car.y = cp.worldY;
      w.step(3);
    }
    expect(w.game.vars.giro).toBe(2);
  });

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

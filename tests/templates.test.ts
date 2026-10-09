import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it, vi } from "vitest";
import { loadScripts, validateProject, type ProjectData } from "@runtime";
import { makeWorld } from "./helpers";

const load = (id: string) => JSON.parse(readFileSync(resolve(process.cwd(), "samples", "templates", `${id}.json`), "utf8")) as ProjectData;

describe("modelli di progetto (Nuovo progetto)", () => {
  for (const id of ["vuoto", "platform", "topdown", "beatemup", "shmup", "towerdefense", "racing", "pointclick", "fps", "picchiaduro", "roguelike", "carte", "horror", "ritmo"]) {
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

  it("punta e clicca: la moneta al nonno, la chiave dal vaso, la porta si apre", () => {
    const p = load("pointclick");
    const w = makeWorld(p);
    const clickAt = (x: number, y: number, wait = 240) => {
      Object.assign(w.input.pointer, { x, y, pressed: true, moved: true });
      w.step(1);
      Object.assign(w.input.pointer, { pressed: false, moved: false });
      w.step(wait);
    };
    const on = (id: string) => {
      const e = w.get(id);
      clickAt(e.worldX, e.worldY - 4);
    };
    on("moneta_pavimento");
    expect(w.game.vars.inventario).toContain("moneta");
    clickAt(14, 14, 1); // la moneta nella prima casella dell'inventario
    on("nonno_casa");
    expect(w.game.vars.indizio).toBe(1);
    expect(w.game.vars.inventario).not.toContain("moneta");
    on("vaso");
    expect(w.game.vars.inventario).toContain("chiave");
    clickAt(14, 14, 1);
    on("porta");
    expect(w.calls).toContain("goToScene:fine");
  });

  it("prima persona: la sparasemi abbatte lo slime davanti e costa munizioni", () => {
    const p = load("fps");
    const w = makeWorld(p);
    expect(w.scene.firstPerson?.def.type).toBe("FirstPersonView");
    const player = w.get("giocatore_fp");
    // Uno slime due tile davanti (Pepino guarda a destra).
    const slime = w.scene.spawn("slime_fp", player.worldX + 32, player.worldY)!;
    for (let i = 0; i < 3; i++) {
      w.input.hold("attack");
      w.step(1);
      w.input.release("attack");
      w.step(25);
    }
    expect(slime.destroyed || slime.get("Health")!.data.dead).toBe(true);
    expect(w.game.vars.munizioni).toBe(17);
    expect(w.game.vars.punti).toBe(10);
  });

  it("prima persona: il lanciapeperoncini si raccoglie, va in mano e fa più danno", () => {
    const p = load("fps");
    const w = makeWorld(p);
    const player = w.get("giocatore_fp");
    const arms = player.get("FirstPersonWeapon")!;
    w.step(1);
    expect(arms.data.i).toBe(0);
    // Con l'arma non ancora trovata il comando di cambio non fa niente.
    w.input.hold("nextItem");
    w.step(1);
    w.input.release("nextItem");
    w.step(30);
    expect(arms.data.i).toBe(0);
    // Sopra al lanciapeperoncini: l'oggetto sblocca l'arma 2 e la Regola la mette in mano.
    const arma = w.scene.entities.find((e) => e.name === "Lanciapeperoncini")!;
    player.x = arma.worldX;
    player.y = arma.worldY;
    w.step(40);
    expect(Number(w.game.vars.arma2)).toBe(1);
    expect(Number(w.game.vars.peperoncini)).toBe(8);
    expect(arms.data.i).toBe(1);
    // Uno slime davanti: il peperoncino fa 3 di danno in un colpo solo.
    const slime = w.scene.spawn("slime_fp", player.worldX + 32, player.worldY)!;
    player.get("FirstPersonController")!.data.angle = 0;
    w.input.hold("attack");
    w.step(1);
    w.input.release("attack");
    w.step(2);
    expect(Number(w.game.vars.peperoncini)).toBe(7);
    expect(slime.destroyed || slime.get("Health")!.data.dead).toBe(true);
  });

  it("ritmo: le note arrivano a tempo di musica e premendo giusto si fanno punti", () => {
    const p = load("ritmo");
    const w = makeWorld(p);
    const song = w.get("canzone").get("RhythmTrack")!;
    const notes = song.data.notes as { time: number; lane: number }[];
    expect(notes.length).toBeGreaterThan(20);
    // Le prime due battute sono vuote: la prima nota arriva dopo due secondi.
    expect(notes[0].time).toBeCloseTo(2, 5);
    expect(notes[0].lane).toBe(0);
    // Ci si porta sulla prima nota e si preme il tasto della sua corsia.
    w.step(120);
    w.input.hold("left");
    w.step(1);
    w.input.release("left");
    expect(Number(w.game.vars.punti)).toBeGreaterThan(0);
    expect(Number(w.game.vars.combo)).toBe(1);
  });

  it("horror: la torcia consuma, l'armadio nasconde e il cancello vuole tre fusibili", () => {
    const p = load("horror");
    const w = makeWorld(p);
    const hero = w.get("giocatore_hr");
    const cancello = w.get("cancello");
    w.step(60);
    expect(Number(w.game.vars.batteria)).toBeLessThan(100);
    // Senza fusibili il cancello resta chiuso.
    hero.x = cancello.worldX;
    hero.y = cancello.worldY;
    w.step(3);
    expect(w.calls.some((c) => c.startsWith("goToScene:"))).toBe(false);
    expect(w.messages.join(" ")).toContain("bloccato");
    // Con tre fusibili si esce.
    w.game.vars.fusibili = 3;
    hero.x = cancello.worldX + 40;
    w.step(3);
    hero.x = cancello.worldX;
    w.step(3);
    expect(w.calls).toContain("goToScene:fine");
  });

  it("carte: si gioca una carta, si chiude il turno e vincendo si impara il Peperoncino", () => {
    const p = load("carte");
    const w = makeWorld(p);
    const duello = w.get("duello1_tavolo").get("CardBattle")!;
    expect(duello.data.hand).toHaveLength(4);
    expect(Number(w.game.vars.vita)).toBe(24);
    // Una zappata in mano: giocandola l'avversario perde vita.
    duello.data.hand = [{ name: "Zappata", cost: 1, effect: "attack", value: 4, color: "#c2504a" }];
    w.input.hold("action");
    w.step(1);
    w.input.release("action");
    expect(Number(w.game.vars.vita_nemico)).toBe(16);
    // Abbattuto l'avversario, la Regola insegna la carta nuova.
    duello.data.enemyHp = 3;
    duello.data.hand = [{ name: "Zappata", cost: 1, effect: "attack", value: 4, color: "#c2504a" }];
    duello.data.energy = 3;
    w.input.hold("action");
    w.step(1);
    w.input.release("action");
    expect(duello.data.result).toBe("win");
    w.step(180);
    expect(String(w.game.vars.carte)).toContain("Peperoncino");
    expect(w.calls).toContain("goToScene:duello2");
  });

  it("roguelike: la cantina si costruisce da sola e la scala porta al piano dopo", () => {
    const p = load("roguelike");
    const w = makeWorld(p);
    const hero = w.get("giocatore_rl");
    // Il generatore ha scavato: il giocatore è su un tile libero e ci sono nemici e scala.
    expect(w.scene.grid.atPixel(hero.worldX, hero.worldY)).toBe(0);
    expect(w.scene.findAll("nemico").length).toBeGreaterThanOrEqual(3);
    const scala = w.scene.findAll("scala")[0];
    expect(scala).toBeDefined();
    hero.x = scala.worldX;
    hero.y = scala.worldY;
    w.step(3);
    expect(Number(w.game.vars.piano)).toBe(2);
    expect(w.calls.some((c) => c === "goToScene:sotterraneo")).toBe(true);
  });

  it("picchiaduro: dopo l'annuncio si combatte, il rivale attacca e i round si contano", () => {
    // L'avversario decide a caso cosa fare: qui il caso è sempre lo stesso, così il test non balla.
    let seed = 7;
    const rnd = vi.spyOn(Math, "random").mockImplementation(() => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296));
    const p = load("picchiaduro");
    const w = makeWorld(p);
    const match = w.get("regia").get("FightMatch")!;
    const pepino = w.get("pepino_vs");
    const rivale = w.get("peperone_vs");
    expect(match.data.phase).toBe("intro");
    w.step(120);
    expect(match.data.phase).toBe("fight");
    expect(pepino.facingX).toBe(1);
    expect(rivale.facingX).toBe(-1);
    // Il rivale si avvicina da solo e prima o poi colpisce.
    const x0 = rivale.x;
    w.step(60 * 6);
    expect(rivale.x).toBeLessThan(x0 - 30);
    expect(Number(pepino.get("Health")!.data.hp)).toBeLessThan(10);
    // Il round finisce quando uno resta senza vita: la vita torna piena per il round dopo.
    rivale.get("Health")!.actions.kill();
    w.step(2);
    expect(match.data.phase).toBe("ko");
    w.step(200);
    expect(match.data.round).toBe(2);
    expect(Number(rivale.get("Health")!.data.hp)).toBe(10);
    rnd.mockRestore();
  });

  it("top-down: nella bottega di Zia Zucca si compra una pozione con le monete", () => {
    const p = load("topdown");
    const w = makeWorld(p);
    w.game.vars.monete = 5;
    const player = w.get("giocatore_td");
    const zia = w.get("zia_zucca");
    player.x = zia.x - 14;
    player.y = zia.y;
    w.step(2);
    w.input.hold("action");
    w.step(1);
    w.input.release("action");
    expect(w.game.panel).not.toBeNull();
    w.step(12);
    w.input.hold("action");
    w.step(1);
    w.input.release("action");
    expect(w.game.vars.monete).toBe(2);
    expect(String(w.game.vars.inventario)).toContain("pozione");
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

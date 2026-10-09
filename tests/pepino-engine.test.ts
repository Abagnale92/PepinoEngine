import { afterEach, describe, expect, it } from "vitest";
import { compilePepino, getBlockDef, loadScripts, runPepinoTests, validateProject, type EntityData, type ScriptData } from "@runtime";
import { translate } from "../src/lang";
import { ENGINE_HOST } from "../src/runtime/scripting/pepino";
import { pepTemplate } from "../src/renderer/src/pepinoTemplates";
import { FLAT, makeProject, makeWorld, rule } from "./helpers";

// Il registro dei blocchi è globale: ogni test riparte senza blocchi personalizzati.
afterEach(() => void loadScripts([]));

const pep = (id: string, code: string): ScriptData => ({ id, name: id, language: "pep", code });

const box = (type: string | string[], extra: Partial<EntityData> = {}): EntityData => ({
  id: "box",
  name: "Scatola",
  x: 20,
  y: 128,
  tags: ["scatola"],
  blocks: (Array.isArray(type) ? type : [type]).map((t) => ({ type: t, props: {} })),
  ...extra,
});

const OSCILLA = pep(
  "oscilla",
  `
blocco Oscilla "Oscilla":
    descrizione "Fa oscillare l'oggetto a destra e a sinistra."
    proprietà distanza = 2 tile, "Distanza", da 0 a 10
    proprietà giri = 0.5, "Giri al secondo"
    evento giro "Ha finito un'oscillazione"

    t = 0
    partenza = 0
    fermo = falso

    quando inizia:
        partenza = oggetto.x

    quando aggiorna:
        se fermo:
            ritorna
        prima = arrotonda_giu(t)
        t += dt * giri / 1 s
        se arrotonda_giu(t) > prima:
            emetti giro
        oggetto.x = partenza + sen(t * 360) * distanza

    azione ferma "Ferma l'oscillazione":
        fermo = vero

    azione spingi(quanto = 1) "Spingi":
        partenza += quanto * 1 tile

    condizione è_fermo "È fermo":
        ritorna fermo
`,
);

describe("blocchi in Pepino Language", () => {
  it("un blocco Pepino diventa un blocco come gli altri, con le unità dell'Inspector", () => {
    const [res] = loadScripts([OSCILLA]);
    expect(res.error).toBeUndefined();
    expect(res.blocks).toEqual(["Oscilla"]);
    const def = getBlockDef("Oscilla")!;
    expect(def.source).toBe("custom");
    expect(def.label).toBe("Oscilla");
    expect(def.description).toBe("Fa oscillare l'oggetto a destra e a sinistra.");
    expect(def.props.distanza).toEqual({ type: "number", label: "Distanza", default: 2, unit: "tile", min: 0, max: 10 });
    expect(def.props.giri).toMatchObject({ type: "number", label: "Giri al secondo", default: 0.5 });
    expect(def.events).toEqual([{ id: "giro", label: "Ha finito un'oscillazione" }]);
    expect(def.actions.spingi.params).toEqual({ quanto: { type: "number", label: "Quanto", default: 1 } });
    expect(Object.keys(def.conditions)).toEqual(["è_fermo"]);
    // 2 tile = 32 px: dopo un quarto di giro l'oggetto è 32 px più a destra.
    const w = makeWorld(makeProject(FLAT, [box("Oscilla")]));
    w.step(30);
    expect(w.get("box").x).toBeCloseTo(52, 5);
  });

  it("eventi, azioni e condizioni funzionano nelle Regole", () => {
    loadScripts([OSCILLA]);
    const p = makeProject(FLAT, [box("Oscilla")], {
      rules: [
        rule(
          "r1",
          { type: "event", params: { target: "#scatola", event: "giro" } },
          [{ type: "block.action", params: { target: "self", action: "Oscilla.ferma" } }],
          [{ type: "block.condition", params: { target: "self", condition: "Oscilla.è_fermo" }, not: true }],
        ),
      ],
    });
    const w = makeWorld(p);
    w.step(130);
    const b = w.get("box").get("Oscilla")!;
    expect(b.test("è_fermo")).toBe(true);
    const x = w.get("box").x;
    w.step(30);
    expect(w.get("box").x).toBe(x);
    b.actions.spingi(2);
    expect((b.data.$pep as { inst: { partenza: number } }).inst.partenza).toBe(20 + 32);
    expect(w.logs.filter((l) => l.level === "error")).toEqual([]);
  });

  it("aspetta: le sequenze continuano nei fotogrammi seguenti", () => {
    loadScripts([
      pep(
        "seq",
        `
block Sequence:
    event done
    on start:
        object.state = "one"
        wait 1 s
        object.state = "two"
        wait until object.x > 150
        object.state = "three"
        emit done
    on update:
        object.x += 60 px/s * dt
`,
      ),
    ]);
    const w = makeWorld(
      makeProject(FLAT, [box("Sequence")], {
        variables: { fatto: 0 },
        rules: [rule("r1", { type: "event", params: { target: "#scatola", event: "done" } }, [{ type: "var.set", params: { variable: "fatto", value: "1" } }])],
      }),
    );
    w.step(30);
    expect(w.get("box").state).toBe("one");
    w.step(31);
    expect(w.get("box").state).toBe("two");
    w.step(60);
    expect(w.get("box").state).toBe("two");
    w.step(20);
    expect(w.get("box").state).toBe("three");
    expect(w.game.vars.fatto).toBe(1);
  });

  it("scena, gioco e oggetti: trova, crea, variabili, distruggi", () => {
    loadScripts([
      pep(
        "api",
        `
blocco Contatore:
    proprietà etichetta: Etichetta = "moneta"
    quando inizia:
        gioco.imposta("monete", scena.trova_tutti(etichetta).lunghezza)
        m = scena.trova("Moneta1")
        se m != niente:
            m.distruggi()
        vicino = oggetto.più_vicino(etichetta)
        se vicino != niente:
            gioco.imposta("vicina", vicino.nome)
    quando aggiorna:
        gioco.imposta("tempo", scena.tempo / 1 s)
`,
      ),
    ]);
    const coin = (id: string, x: number): EntityData => ({ id, name: id === "c1" ? "Moneta1" : "Moneta2", x, y: 128, tags: ["moneta"], blocks: [] });
    const w = makeWorld(makeProject(FLAT, [box("Contatore"), coin("c1", 200), coin("c2", 40)], { variables: { monete: 0, vicina: "", tempo: 0 } }));
    w.step(1);
    expect(w.game.vars.monete).toBe(2);
    expect(w.game.vars.vicina).toBe("Moneta2");
    expect(w.scene.entities.some((e) => e.name === "Moneta1")).toBe(false);
    w.step(59);
    expect(w.game.vars.tempo).toBeCloseTo(1, 5);
  });

  it("il corpo può mancare: va controllato, a meno di «richiede Body»", () => {
    const senza = compilePepino(`blocco Salta:\n    quando aggiorna:\n        corpo.vy = -100 px/s`);
    expect(senza.diagnostics.map((d) => d.key)).toEqual(["type.maybeNothing"]);
    const con = compilePepino(`blocco Salta:\n    richiede Body\n    quando aggiorna:\n        se corpo.a_terra:\n            corpo.vy = -100 px/s`);
    expect(con.ok).toBe(true);
    expect(compilePepino(`blocco X:\n    richiede Bodyy`).diagnostics[0].key).toBe("block.unknownRequire");
  });

  it("errori di scrittura: lo script non parte e si sa la riga; in modifica resta l'ultima versione buona", () => {
    const [ok] = loadScripts([OSCILLA]);
    expect(ok.error).toBeUndefined();
    const broken = pep("oscilla", OSCILLA.code.replace("oggetto.x = partenza", "oggetto.x = partenzaa"));
    const [res] = loadScripts([broken], { keepOnError: true });
    expect(res.error).toMatchObject({ line: 22 });
    expect(res.error!.message).toContain("partenzaa");
    expect(res.stale).toBe(true);
    expect(getBlockDef("Oscilla")).toBeDefined();
    const [en] = loadScripts([broken], { pepinoLang: "en" });
    expect(en.error!.message).toBe(`I don't know "partenzaa": did you mean "partenza"?`);
  });

  it("un errore a gioco avviato ferma solo quel blocco e dice script e riga", () => {
    loadScripts([
      pep(
        "rotto",
        `
blocco Rotto:
    lista = [1, 2]
    quando aggiorna:
        scrivi(lista[5])
`,
      ),
    ]);
    const w = makeWorld(makeProject(FLAT, [box("Rotto")]));
    w.step(3);
    const errs = w.logs.filter((l) => l.level === "error");
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain("La posizione 5 non esiste");
    expect(errs[0].message).toContain("rotto, riga 5");
    expect(w.get("box").get("Rotto")!.enabled).toBe(false);
  });

  it("quando finisce: chiude le sequenze e distrugge i valori del blocco", () => {
    loadScripts([
      pep(
        "fine",
        `
tipo Suono:
    nome: Testo
    quando finisce:
        scrivi("stop {nome}")
blocco Musicista:
    sottofondo = Suono("pioggia")
    quando inizia:
        tamburo = Suono("tamburo")
        aspetta 10 s
    quando finisce:
        scrivi("il musicista se ne va")
`,
      ),
    ]);
    const printed: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => void printed.push(a.map(String).join(" "));
    try {
      const w = makeWorld(makeProject(FLAT, [box("Musicista")]));
      w.step(2);
      w.get("box").destroy();
      w.step(1);
    } finally {
      console.log = orig;
    }
    expect(printed.map((p) => p.replace("[Pepino] ", ""))).toEqual(["il musicista se ne va", "stop tamburo", "stop pioggia"]);
  });

  it("il controllo del progetto segnala gli script Pepino con errori", () => {
    const p = makeProject(FLAT, []);
    p.scripts = [pep("s", `blocco A:\n    quando aggiorna:\n        x = ignoto`)];
    const issues = validateProject(p).filter((i) => i.scriptId === "s");
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("Riga 3");
  });

  it("le prove di uno script si eseguono dall'editor", () => {
    const res = runPepinoTests(
      `
funzione doppio(n: Numero) -> Numero:
    ritorna n * 2
blocco A:
    quando inizia:
        scrivi(doppio(2))
prova "doppio":
    controlla doppio(3) = 6
prova "sbagliata":
    controlla doppio(3) = 7
`,
      "it",
    );
    expect(res).toEqual([
      { name: "doppio", ok: true },
      { name: "sbagliata", ok: false, message: "Il controllo è fallito (riga 10).", line: 10 },
    ]);
  });

  it("i modelli dei nuovi script funzionano in italiano e in inglese, e si traducono", () => {
    for (const lang of ["it", "en"] as const) {
      const code = pepTemplate(lang === "it" ? "Passeggia" : "Stroll", lang);
      const r = compilePepino(code, lang);
      expect(r.diagnostics).toEqual([]);
      const other = translate(code, lang === "it" ? "en" : "it", ENGINE_HOST);
      expect(compilePepino(other).diagnostics).toEqual([]);
      expect(translate(other, lang, ENGINE_HOST)).toBe(code);
    }
    loadScripts([pep("p", pepTemplate("Passeggia", "it"))]);
    const w = makeWorld(makeProject(FLAT, [box("Passeggia")]));
    const xs: number[] = [];
    for (let i = 0; i < 20; i++) {
      w.step(10);
      xs.push(w.get("box").x);
    }
    // Va a destra di 3 tile (48 px), si ferma, torna indietro.
    expect(Math.max(...xs)).toBeCloseTo(68, 5);
    expect(xs[xs.length - 1]).toBeLessThan(68);
  });
});

describe("le parole italiane nei blocchi", () => {
  it("cappuccino: parte dopo la miccia, anche ordinato da «quando aggiorna»", () => {
    loadScripts([
      pep(
        "bomba",
        `
blocco Bomba "Bomba":
    proprietà miccia = 0.5 s, "Miccia"
    evento esplosa
    conta = 0
    quando inizia:
        cappuccino miccia:
            gioco.imposta("botti", gioco.variabile("botti") + 1)
            emetti esplosa
    quando aggiorna:
        conta += 1
        se conta = 1:
            cappuccino 0.25 s:
                gioco.imposta("fotogramma", conta)
`,
      ),
    ]);
    const w = makeWorld(makeProject(FLAT, [box("Bomba")], { variables: { botti: 0, fotogramma: 0 } }));
    w.step(20);
    expect(w.game.vars.botti).toBe(0);
    expect(w.game.vars.fotogramma).toBe(16);
    w.step(20);
    expect(w.game.vars.botti).toBe(1);
    w.step(60);
    expect(w.game.vars.botti).toBe(1);
    expect(w.logs.filter((l) => l.level === "error" || l.level === "warn")).toEqual([]);
  });

  it("cappuccino: se l'oggetto sparisce prima, il cappuccino non arriva (e chiude le sue copie)", () => {
    loadScripts([
      pep(
        "lento",
        `
tipo Tazza:
    quando finisce:
        scrivi("tazza lavata")
blocco Lento:
    quando inizia:
        t = Tazza()
        cappuccino 1 s:
            scrivi("non arrivo {t}")
            gioco.imposta("arrivato", 1)
`,
      ),
    ]);
    const printed: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => void printed.push(a.map(String).join(" ").replace("[Pepino] ", ""));
    try {
      const w = makeWorld(makeProject(FLAT, [box("Lento")], { variables: { arrivato: 0 } }));
      w.step(10);
      w.get("box").destroy();
      w.step(120);
      expect(w.game.vars.arrivato).toBe(0);
    } finally {
      console.log = orig;
    }
    // La tazza di «quando inizia» e poi la sua copia, quando il cappuccino viene annullato.
    expect(printed).toEqual(["tazza lavata", "tazza lavata"]);
  });

  it("spaghetti, pizza, bravo e mamma mia! dentro un blocco", () => {
    loadScripts([
      pep(
        "cucina",
        `
blocco Cucina:
    quando inizia:
        nomi = spaghetti scena.trova_tutti("scatola"):
            trasforma(o => o.nome)
            unisci(", ")
        gioco.imposta("nomi", nomi)
        menu = pizza Mappa:
            "margherita" = 6
        tenta:
            prezzo = menu["diavola"]
        se errore e:
            gioco.imposta("errore", 1)
        bravo:
            gioco.imposta("prezzo", prezzo)
        se menu.lunghezza < 2:
            mamma mia! "il menù è troppo corto"
`,
      ),
    ]);
    const w = makeWorld(makeProject(FLAT, [box("Cucina")], { variables: { nomi: "", errore: 0, prezzo: 0 } }));
    w.step(2);
    expect(w.game.vars.nomi).toBe("Scatola");
    expect(w.game.vars.errore).toBe(1);
    expect(w.game.vars.prezzo).toBe(0);
    const errs = w.logs.filter((l) => l.level === "error");
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain("Mamma mia! il menù è troppo corto");
  });

  it("le parole italiane si scrivono anche in uno script inglese", () => {
    const r = compilePepino(`block Cafe:\n    on start:\n        cappuccino 1 s:\n            print("ready")\n        bravo = 1\n        print(bravo)`, "en");
    expect(r.diagnostics).toEqual([]);
  });
});

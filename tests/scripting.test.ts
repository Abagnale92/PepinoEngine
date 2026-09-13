import { afterEach, describe, expect, it } from "vitest";
import { getBlockDef, loadScripts, validateProject, type EntityData, type ScriptData } from "@runtime";
import { FLAT, makeProject, makeWorld, rule } from "./helpers";

const js = (id: string, code: string, name = id): ScriptData => ({ id, name, language: "js", code });
const py = (id: string, code: string, name = id): ScriptData => ({ id, name, language: "py", code });

// Il registro dei blocchi è globale: ogni test riparte senza blocchi personalizzati.
afterEach(() => void loadScripts([]));

const SPINTA = js(
  "spinta",
  `Pepino.defineBlock({
  name: "Spinta",
  label: "Spinta",
  props: { speed: { type: "number", label: "Velocità", default: 60 } },
  events: [{ id: "lontano", label: "È lontano" }],
  conditions: { veloce: { label: "È veloce", test: (self) => self.props.speed > 100 } },
  actions: {
    raddoppia: {
      label: "Moltiplica la velocità",
      params: { volte: { type: "number", label: "Volte", default: 2 } },
      run(self, volte) { self.props.speed *= volte; },
    },
  },
  update(self, dt) {
    self.entity.x += self.props.speed * dt;
    if (self.entity.x > 100 && !self.data.fired) {
      self.data.fired = true;
      self.emit("lontano");
    }
  },
});`,
);

const CONTATORE = py(
  "contatore",
  `name = "Contatore"
props = {"step": {"type": "integer", "label": "Passo", "default": 2}}
events = [{"id": "dieci", "label": "Arriva a 10"}]
conditions = {"oltre": {"label": "Ha superato", "params": {"n": {"type": "number", "label": "Quanto", "default": 5}}}}
actions = {"azzera": "Azzera"}

def init(self):
    self.data.n = 0

def update(self, dt):
    self.data.n += self.props.step
    if self.data.n == 10:
        self.emit("dieci")
    self.game.vars["contatore"] = self.data.n

def oltre(self, n):
    return self.data.n > n

def azzera(self):
    self.data.n = 0
`,
);

const box = (type: string, extra: Partial<EntityData> = {}): EntityData => ({
  id: "box",
  name: "Scatola",
  x: 20,
  y: 128,
  tags: ["scatola"],
  blocks: [{ type, props: {} }],
  ...extra,
});

describe("blocchi in codice", () => {
  it("un blocco JavaScript diventa un blocco come gli altri", () => {
    const [res] = loadScripts([SPINTA]);
    expect(res.error).toBeUndefined();
    expect(res.blocks).toEqual(["Spinta"]);
    const def = getBlockDef("Spinta")!;
    expect(def.source).toBe("custom");
    expect(def.script).toBe("spinta");
    expect(def.category).toBe("Personalizzati");
    const w = makeWorld(makeProject(FLAT, [box("Spinta")]));
    w.step(60);
    expect(w.get("box").x).toBeCloseTo(80, 3);
  });

  it("eventi, condizioni e azioni del blocco funzionano nelle Regole", () => {
    loadScripts([SPINTA]);
    const p = makeProject(FLAT, [box("Spinta")], {
      rules: [
        rule(
          "r1",
          { type: "event", params: { target: "#scatola", event: "lontano" } },
          [{ type: "block.action", params: { target: "self", action: "Spinta.raddoppia", args: { volte: 3 } } }],
          [{ type: "block.condition", params: { target: "self", condition: "Spinta.veloce" }, not: true }],
        ),
      ],
    });
    const w = makeWorld(p);
    w.step(120);
    expect(w.get("box").get("Spinta")!.props.speed).toBe(180);
    expect(w.logs.filter((l) => l.level === "error")).toEqual([]);
  });

  it("un blocco Python funziona con Regole e variabili", () => {
    const [res] = loadScripts([CONTATORE]);
    expect(res.error).toBeUndefined();
    const p = makeProject(FLAT, [box("Contatore")], {
      variables: { contatore: 0 },
      rules: [
        rule(
          "r1",
          { type: "event", params: { target: "#scatola", event: "dieci" } },
          [{ type: "block.action", params: { target: "self", action: "Contatore.azzera" } }],
          [{ type: "block.condition", params: { target: "self", condition: "Contatore.oltre", args: { n: 8 } } }],
        ),
      ],
    });
    const w = makeWorld(p);
    w.step(5);
    expect(w.game.vars.contatore).toBe(10);
    expect(w.get("box").get("Contatore")!.data.n).toBe(0);
    w.step(1);
    expect(w.game.vars.contatore).toBe(2);
    expect(w.logs.filter((l) => l.level === "error")).toEqual([]);
  });

  it("un errore a gioco avviato ferma solo quel blocco e dice script e riga", () => {
    const rotto = js(
      "rotto",
      [
        "Pepino.defineBlock({",
        '  name: "Rotto",',
        "  update(self) {",
        "    self.data.n = (self.data.n ?? 0) + 1;",
        "    if (self.data.n > 2) self.nonEsiste.boom();",
        "  },",
        "});",
      ].join("\n"),
      "Script rotto",
    );
    loadScripts([rotto, SPINTA]);
    const w = makeWorld(makeProject(FLAT, [box("Spinta", { blocks: [{ type: "Spinta", props: {} }, { type: "Rotto", props: {} }] })]));
    w.step(30);
    const errors = w.logs.filter((l) => l.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/Rotto/);
    expect(errors[0].message).toMatch(/Script rotto, riga 5/);
    expect(w.get("box").get("Rotto")!.enabled).toBe(false);
    // Il resto dell'oggetto continua a funzionare.
    expect(w.get("box").x).toBeCloseTo(50, 3);
  });

  it("gli errori del Python tradotto indicano la riga Python", () => {
    const src = 'name = "PyRotto"\n\ndef update(self, dt):\n    x = None\n    x.boom()\n';
    loadScripts([py("pyrotto", src, "Python rotto")]);
    const w = makeWorld(makeProject(FLAT, [box("PyRotto")]));
    w.step(1);
    const errors = w.logs.filter((l) => l.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/Python rotto, riga 5/);
  });

  it("gli errori di caricamento non bloccano gli altri script", () => {
    const res = loadScripts([
      js("sintassi", "Pepino.defineBlock({ name: 'X', "),
      py("pyerr", "name = 'Y'\ndef update(self, dt)\n    pass\n"),
      js("sprite", "Pepino.defineBlock({ name: 'Sprite' });"),
      js("tipo", "Pepino.defineBlock({ name: 'Z', props: { a: { type: 'vettore', label: 'A' } } });"),
      SPINTA,
      js("doppio", "Pepino.defineBlock({ name: 'Spinta' });"),
    ]);
    const byId = Object.fromEntries(res.map((r) => [r.id, r]));
    expect(byId.sintassi.error?.message).toMatch(/sintassi/);
    expect(byId.pyerr.error?.line).toBe(2);
    expect(byId.sprite.error?.message).toMatch(/già usato da un blocco di Pepino/);
    expect(byId.tipo.error?.message).toMatch(/tipo non valido/);
    expect(byId.doppio.error?.message).toMatch(/script «spinta»/);
    expect(byId.spinta.error).toBeUndefined();
    expect(getBlockDef("Spinta")?.script).toBe("spinta");
    expect(getBlockDef("Sprite")?.source).toBe("builtin");
  });

  it("ricaricando, i blocchi degli script tolti spariscono; con keepOnError restano quelli buoni", () => {
    loadScripts([SPINTA]);
    expect(getBlockDef("Spinta")).toBeDefined();
    const broken = { ...SPINTA, code: "Pepino.defineBlock({" };
    const [kept] = loadScripts([broken], { keepOnError: true });
    expect(kept.error).toBeDefined();
    expect(kept.stale).toBe(true);
    expect(getBlockDef("Spinta")).toBeDefined();
    loadScripts([broken]);
    expect(getBlockDef("Spinta")).toBeUndefined();
    loadScripts([SPINTA]);
    loadScripts([]);
    expect(getBlockDef("Spinta")).toBeUndefined();
  });

  it("il controllo del progetto segnala gli script con errori", () => {
    const p = makeProject(FLAT, [], {
      scripts: [py("pyerr", "x = 1\nclass A:\n    pass\n", "Rotto"), js("jserr", "const = 3;", "Rotto JS"), SPINTA, SPINTA],
    });
    const issues = validateProject(p).filter((i) => i.scriptId);
    const text = issues.map((i) => `${i.where}: ${i.message}`);
    expect(text).toContainEqual(expect.stringMatching(/Script «Rotto»: Riga 2: .*classi/));
    expect(text).toContainEqual(expect.stringMatching(/Script «Rotto JS»: Errore di sintassi/));
    expect(validateProject(p).some((i) => /Due script|stesso id|duplicat/i.test(i.message))).toBe(true);
  });
});

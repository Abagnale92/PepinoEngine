import { describe, expect, it } from "vitest";
import { compilePython, PythonError, PY, setScriptLogger } from "@runtime";

/** Traduce ed esegue il modulo, restituendo le variabili e le funzioni passate a definePythonBlock. */
function run(src: string) {
  const { code } = compilePython(src);
  let out: { meta: Record<string, any>; fns: Record<string, (...a: any[]) => any> } | undefined;
  new Function("Pepino", code)({ py: PY, definePythonBlock: (meta: any, fns: any) => (out = { meta, fns }) });
  return out!;
}

const call = (src: string, fn = "f", ...args: unknown[]) => run(src).fns[fn](...args);

function errorOf(src: string): PythonError {
  try {
    compilePython(src);
  } catch (e) {
    if (e instanceof PythonError) return e;
    throw e;
  }
  throw new Error("nessun errore");
}

describe("Python → JavaScript", () => {
  it("operatori con la semantica di Python", () => {
    const src = `
def f():
    return [7 // 2, -7 // 2, -7 % 3, 2 ** 10, 1 < 2 < 3, 3 < 2 < 4, 5 if True else 6, not 0, 2 ** 3 ** 2, -2 ** 2]
`;
    expect(call(src)).toEqual([3, -4, 2, 1024, true, false, 5, true, 512, -4]);
  });

  it("and / or restituiscono gli operandi, le liste vuote sono false", () => {
    const src = `
def f():
    a = [] or "vuota"
    b = 0 and 5
    c = None
    esito = "no"
    if not []:
        esito = "sì"
    return [a, b, c is None, c == None, esito]
`;
    expect(call(src)).toEqual(["vuota", 0, true, true, "sì"]);
  });

  it("cicli, liste, dizionari e metodi", () => {
    const src = `
def f():
    out = []
    for i in range(5):
        if i == 3:
            continue
        out.append(i * i)
    d = {"a": 1}
    d["b"] = 2
    total = 0
    for k in d:
        total += d[k]
    s = "Ciao Mondo"
    n = 0
    while True:
        n += 1
        if n >= 4:
            break
    return out, total, len(d), s.upper(), s.split(" "), ", ".join(["x", "y"]), d.get("z", 9), "a" in d, 3 in out, n
`;
    expect(call(src)).toEqual([[0, 1, 4, 16], 3, 2, "CIAO MONDO", ["Ciao", "Mondo"], "x, y", 9, true, false, 4]);
  });

  it("range con passo, enumerate, slice e indici negativi", () => {
    const src = `
def f():
    xs = list(range(10, 0, -3))
    pari = []
    for i, v in enumerate(["a", "b", "c"]):
        pari.append(f"{i}{v}")
    return xs, pari, xs[1:3], xs[-1], "pepino"[:3], "pepino"[3:], sum([1, 2, 3]), max(4, 9, 2), min([5, 1])
`;
    expect(call(src)).toEqual([[10, 7, 4, 1], ["0a", "1b", "2c"], [7, 4], 1, "pep", "ino", 6, 9, 1]);
  });

  it("f-string, str() e print() nella Console", () => {
    const lines: string[] = [];
    setScriptLogger((m) => lines.push(m));
    const src = `
def f(n, x):
    print("monete:", n, True, None, [1, "a"])
    return f"{n} monete, {x:.2f} secondi, {{graffe}}"
`;
    expect(call(src, "f", 3, 1.5)).toBe("3 monete, 1.50 secondi, {graffe}");
    expect(lines).toEqual(["monete: 3 True None [1, 'a']"]);
  });

  it("assegnazioni multiple, scambio e operatori composti", () => {
    const src = `
def f():
    a, b = 1, 2
    a, b = b, a
    x = y = 5
    z = 17
    z //= 5
    w = -7
    w %= 3
    return [a, b, x, y, z, w]
`;
    expect(call(src)).toEqual([2, 1, 5, 5, 3, 2]);
  });

  it("valori predefiniti e argomenti con nome", () => {
    const src = `
def g(a, b=10):
    return a + b

def f():
    return [g(1), g(1, b=5), g(b=3, a=2)]
`;
    expect(call(src)).toEqual([11, 6, 5]);
  });

  it("nomi del JavaScript e funzioni dell'utente con nomi di builtin", () => {
    const src = `
def max(a, b):
    return 99

def f():
    new = 5
    this = 1
    return [new + this, max(1, 2)]
`;
    expect(call(src)).toEqual([6, 99]);
  });

  it("import math e random", () => {
    const src = `
import math, random

def f():
    r = random.randint(3, 3)
    return [math.floor(2.7), math.pi, math.sqrt(16), r, round(2.456, 1), int("42"), abs(-3)]
`;
    expect(call(src)).toEqual([2, Math.PI, 4, 3, 2.5, 42, 3]);
  });

  it("metodi degli oggetti del gioco passano direttamente", () => {
    const src = `
def f(entity):
    return entity.get("Sprite")
`;
    const entity = { get: (t: string) => `blocco ${t}` };
    expect(call(src, "f", entity)).toBe("blocco Sprite");
  });

  it("le variabili del modulo diventano la definizione del blocco", () => {
    const mod = run(`
name = "Molla"
label = "Molla"
requires = ["Body"]
props = {"force": {"type": "number", "label": "Forza", "default": 22}}
actions = {"lancia": "Lancia"}

def update(self, dt):
    pass

def lancia(self):
    pass
`);
    expect(mod.meta.name).toBe("Molla");
    expect(mod.meta.requires).toEqual(["Body"]);
    expect(mod.meta.props.force.default).toBe(22);
    expect(Object.keys(mod.fns).sort()).toEqual(["lancia", "update"]);
  });

  it("gli errori dicono la riga e cosa non va", () => {
    expect(errorOf("x = 1\nclass A:\n    pass").line).toBe(2);
    expect(errorOf("x = 1\nclass A:\n    pass").reason).toMatch(/classi/);
    expect(errorOf("def f():\nreturn 1").reason).toMatch(/rientrata/);
    expect(errorOf("if True:\n    x = 1\n  y = 2").line).toBe(3);
    expect(errorOf("x = (1 +\n\ny = 2").reason).toMatch(/parentesi/);
    expect(errorOf("x = [i for i in range(3)]").reason).toMatch(/comprehension/);
    expect(errorOf("f = lambda x: x").reason).toMatch(/lambda/);
    expect(errorOf("import os").reason).toMatch(/math e random/);
    expect(errorOf("x = 'aperta").reason).toMatch(/non chiusa/);
    expect(errorOf("def f(*args):\n    pass").reason).toMatch(/args/);
    expect(errorOf("x = 1\ny = 2 +\n").line).toBe(2);
  });

  it("la mappa delle righe porta dal JavaScript al Python", () => {
    const src = "x = 1\n\ndef update(self, dt):\n    y = 2\n    return y\n";
    const { code, lineMap } = compilePython(src);
    const jsLines = code.split("\n");
    const ret = jsLines.findIndex((l) => l.includes("return y"));
    expect(lineMap[ret]).toBe(5);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compile, run, translate, detectLang, CLI_HOST, type Diagnostic } from "../src/lang";
import { main, type CliIO } from "../src/lang/cli";

/** Esegue un programma e restituisce quello che ha scritto (fallisce se ci sono errori). */
function out(src: string, opts: Parameters<typeof run>[1] = {}): string[] {
  const r = run(src, opts);
  if (!r.ok) throw new Error(`${r.diagnostics.map((d) => `riga ${d.line}: ${d.message}`).join("\n")}${r.error ? `\n${r.error.message} (riga ${r.error.line})` : ""}`);
  return r.output;
}

/** Gli errori (chiave del messaggio e riga). */
function errors(src: string): { key: string; line: number; message: string }[] {
  return compile(src).diagnostics.filter((d) => d.severity === "error").map((d) => ({ key: d.key, line: d.line, message: d.message }));
}
const keys = (src: string) => errors(src).map((e) => e.key);
const warnings = (src: string) => compile(src).diagnostics.filter((d: Diagnostic) => d.severity === "warning").map((d) => d.key);

describe("Pepino Language: le basi", () => {
  it("scrive, ripete, scorre le liste e conta", () => {
    expect(
      out(`
nome = "Pepe"
scrivi("Ciao, {nome}!")
ripeti 2 volte:
    scrivi("hop")
per ogni f in ["mela", "pera"]:
    scrivi(f.maiuscolo())
per i da 1 a 3:
    scrivi(i * 10)
per i da 3 a 1:
    scrivi(i)
per i da 0 a 1 passo 0.5:
    scrivi(i)
`),
    ).toEqual(["Ciao, Pepe!", "hop", "hop", "MELA", "PERA", "10", "20", "30", "3", "2", "1", "0", "0.5", "1"]);
  });

  it("le stesse cose si scrivono in inglese", () => {
    const src = `
name = "Ann"
print("Hi, {name}!")
repeat 2 times:
    print("hop")
for each n from 1 to 3:
    if n % 2 = 0 and not false:
        print("even {n}")
    else:
        print("odd {n}")
`;
    expect(detectLang(src)).toBe("en");
    expect(out(src)).toEqual(["Hi, Ann!", "hop", "hop", "odd 1", "even 2", "odd 3"]);
  });

  it("i numeri si scrivono senza gli errori dei decimali; vero/falso nella lingua del programma", () => {
    expect(out(`scrivi(0.1 + 0.2, 10 / 4, 7 % 3, -7 % 3, 2 ^ 10, vero, niente)`)).toEqual(["0.3 2.5 1 2 1024 vero niente"]);
    expect(out(`print(1 / 3, true, nothing)`)).toEqual(["0.333333333333 true nothing"]);
    expect(out(`scrivi(sen(90), cos(180), arrotonda(3.14159, 2), assoluto(-4), radice(16))`)).toEqual(["1 -1 3.14 4 4"]);
  });

  it("= nelle condizioni vuol dire «uguale»; le posizioni partono da 1", () => {
    expect(
      out(`
x = 5
se x = 5:
    scrivi("cinque")
l = [10, 20, 30]
scrivi(l[1], l[3], l[-1], "ciao"[1])
`),
    ).toEqual(["cinque", "10 30 30 c"]);
  });

  it("funzioni, valori predefiniti, argomenti con il nome e ricorsione", () => {
    expect(
      out(`
funzione saluta(nome: Testo, saluto = "Ciao") -> Testo:
    ritorna "{saluto}, {nome}"
funzione fattoriale(n):
    se n <= 1:
        ritorna 1
    ritorna n * fattoriale(n - 1)
scrivi(saluta("Anna"), saluta(saluto: "Ehi", nome: "Bo"))
scrivi(fattoriale(10))
`),
    ).toEqual(["Ciao, Anna Ehi, Bo", "3628800"]);
  });

  it("le funzioni senza tipi sono modelli: una versione per ogni tipo usato", () => {
    const r = compile(`
funzione primo(l):
    ritorna l[1]
funzione doppio(x):
    ritorna x + x
scrivi(primo([1, 2]), primo(["a"]), doppio(2), doppio("ab"))
`);
    expect(r.ok).toBe(true);
    expect(r.code).toContain("primo$1");
    expect(r.code).toContain("primo$2");
    expect(out(r.program ? `
funzione primo(l):
    ritorna l[1]
funzione doppio(x):
    ritorna x + x
scrivi(primo([1, 2]), primo(["a"]), doppio(2), doppio("ab"))
` : "")).toEqual(["1 a 4 abab"]);
  });

  it("tipi con campi e funzioni; uguaglianza e stampa", () => {
    expect(
      out(`
tipo Punto:
    x: Numero = 0
    y: Numero = 0
    funzione lunghezza() -> Numero:
        ritorna radice(x * x + y * y)
    funzione sposta_di(dx: Numero, dy: Numero):
        x += dx
        y += dy
p = Punto(x: 3, y: 4)
scrivi(p.lunghezza(), p)
p.sposta_di(1, 1)
scrivi(p == Punto(4, 5), p != Punto())
`),
    ).toEqual(["5 Punto(x: 3, y: 4)", "vero vero"]);
  });

  it("scelte e scegli/caso", () => {
    expect(
      out(`
scelta Colore: rosso, verde, blu
per ogni c in [Colore.rosso, Colore.blu]:
    scegli c:
        caso Colore.rosso:
            scrivi("R")
        caso Colore.verde, Colore.blu:
            scrivi("G o B")
scegli 3:
    caso 1:
        scrivi("uno")
    altrimenti:
        scrivi("altro")
`),
    ).toEqual(["R", "G o B", "altro"]);
  });

  it("liste, mappe e testi", () => {
    expect(
      out(`
n = [5, 3, 8, 1]
n.ordina()
scrivi(n, n.somma(), n.filtra(x => x > 2), n.trasforma(x => x * 2))
parole = ["pera", "fico", "mela"]
parole.ordina_per(p => p.lunghezza * 100 - p.lettere().conta("e"))
scrivi(parole.unisci(" "), parole.contiene("fico"), parole.posizione("mela"))
m = {"a": 1}
m["b"] = 2
scrivi(m, m.prendi("z", 0), m.contiene("a"), "b" in m, m.chiavi())
t = "  Ciao Mondo  ".pulisci()
scrivi(t.minuscolo(), t.dividi(" "), t.sostituisci("o", "0"), t.parte(1, 4), t.lunghezza)
`),
    ).toEqual(['[1, 3, 5, 8] 17 [3, 5, 8] [2, 6, 10, 16]', "pera mela fico vero 2", '{"a": 1, "b": 2} 0 vero vero ["a", "b"]', 'ciao mondo ["Ciao", "Mondo"] Cia0 M0nd0 Ciao 10']);
  });

  it("una variabile creata in tutti i rami di un se esiste anche dopo", () => {
    expect(
      out(`
se 2 > 1:
    messaggio = "sì"
altrimenti:
    messaggio = "no"
scrivi(messaggio)
`),
    ).toEqual(["sì"]);
    expect(keys(`
se vero:
    solo_qui = 1
scrivi(solo_qui)
`)).toEqual(["name.onlyIn"]);
  });

  it("tenta / se errore e fallisci", () => {
    expect(
      out(`
tenta:
    scrivi([1, 2][5])
se errore problema:
    scrivi("preso: {problema}")
funzione controlla_età(n: Numero):
    se n < 0:
        fallisci "un'età non può essere negativa"
tenta:
    controlla_età(-1)
se errore e:
    scrivi(e)
`),
    ).toEqual(["preso: La posizione 5 non esiste: la lista ha 2 elementi (le posizioni partono da 1).", "un'età non può essere negativa"]);
  });

  it("gli errori a programma avviato dicono la riga", () => {
    const r = run(`
x = 1
y = 0
scrivi(x / y)
`);
    expect(r.ok).toBe(false);
    expect(r.error).toMatchObject({ message: "Non si può dividere per zero.", line: 4 });
  });

  it("le prove: prova e controlla", () => {
    const r = run(
      `
funzione doppio(n: Numero) -> Numero:
    ritorna n * 2
prova "doppio":
    controlla doppio(2) = 4
prova "sbagliata":
    controlla doppio(2) = 5, "2 per 2 fa 4"
`,
      { tests: true },
    );
    expect(r.tests).toEqual([
      { name: "doppio", ok: true },
      { name: "sbagliata", ok: false, message: "Il controllo è fallito: 2 per 2 fa 4", line: 7, file: "programma" },
    ]);
  });
});

describe("Pepino Language: errori gentili", () => {
  it("nomi sconosciuti con il suggerimento", () => {
    const e = errors(`
punti = 3
scrivi(punto)
`);
    expect(e[0]).toMatchObject({ key: "name.unknownDid", line: 3 });
    expect(e[0].message).toBe("Non conosco «punto»: forse volevi dire «punti»?");
  });

  it("tipi sbagliati, condizioni, liste miste, funzioni senza parentesi", () => {
    expect(keys(`x = 5\nx = "cinque"`)).toEqual(["type.assign"]);
    expect(keys(`se 3:\n    passa`)).toEqual(["type.condition"]);
    expect(keys(`l = [1, "due"]`)).toEqual(["type.mixedList"]);
    expect(keys(`funzione f():\n    passa\nf`)).toEqual(["flow.callParens"]);
    expect(keys(`scrivi("a" < 3)`)).toEqual(["type.compare"]);
  });

  it("i messaggi arrivano in inglese per i programmi in inglese", () => {
    const e = compile(`count = 3\nprint(cont)`).diagnostics[0];
    expect(e.message).toBe(`I don't know "cont": did you mean "count"?`);
  });

  it("avvisi: righe mai eseguite e valori calcolati ma non usati", () => {
    expect(warnings(`funzione f() -> Numero:\n    ritorna 1\n    scrivi("mai")`)).toEqual(["flow.unreachable"]);
    expect(warnings(`punti = 1\npunti + 1`)).toEqual(["flow.unused"]);
  });

  it("nomi doppi nei tipi e funzioni che non si possono usare come valori", () => {
    expect(keys(`tipo A:\n    nome = ""\n    funzione nome() -> Testo:\n        ritorna "a"\nx = A()`)).toEqual(["name.duplicate"]);
    expect(keys(`funzione tieni(prendi l: Lista di Numero):\n    passa\nf: funzione(Lista di Numero) = tieni`)).toEqual(["mem.fnValueChange"]);
  });

  it("gli errori di scrittura si trovano tutti, anche dopo il primo", () => {
    const e = errors(`
se x > :
    passa
y = (1 +
z = 3
ripeti 3 volte
    scrivi(z)
`);
    expect(e.length).toBeGreaterThanOrEqual(2);
    expect(e[0].key).toBe("parse.expectedExpr");
  });
});

describe("Pepino Language: memoria come il C++", () => {
  it("una copia è indipendente dall'originale", () => {
    expect(
      out(`
tipo Squadra:
    nome: Testo
    giocatori: Lista di Testo = []
a = Squadra("Rossi")
a.giocatori.aggiungi("Anna")
b = a
b.giocatori.aggiungi("Bruno")
lista = [a]
a.nome = "Verdi"
scrivi(a.giocatori, b.giocatori, lista[1].nome)
`),
    ).toEqual(['["Anna"] ["Anna", "Bruno"] Rossi']);
  });

  it("sposta: il valore passa senza copia e il vecchio nome non si usa più", () => {
    expect(keys(`a = [1, 2]\nb = sposta a\nscrivi(a)`)).toEqual(["mem.moved"]);
    expect(keys(`a = [1]\nse vero:\n    b = sposta a\nscrivi(a)`)).toEqual(["mem.maybeMoved"]);
    expect(keys(`a = [1]\nripeti 2 volte:\n    b = sposta a`)).toEqual(["mem.moveInLoop"]);
    expect(out(`a = [1]\nb = sposta a\na = [2]\nscrivi(a, b)`)).toEqual(["[2] [1]"]);
    expect(keys(`funzione f(l: Lista di Numero):\n    x = sposta l`)).toEqual(["mem.moveBorrowed"]);
  });

  it("i parametri sono prestiti: si leggono ma non si cambiano, se non con «cambia»", () => {
    expect(keys(`funzione f(l: Lista di Numero):\n    l.aggiungi(1)`)).toEqual(["name.borrowed"]);
    expect(keys(`tipo C:\n    n = 0\n    funzione su():\n        n += 1\nfunzione f(c: C):\n    c.su()`)).toEqual(["name.borrowed"]);
    expect(
      out(`
funzione cresci(cambia n: Numero, cambia l: Lista di Numero):
    n += 1
    l.aggiungi(n)
x = 1
v = [0]
cresci(cambia x, cambia v)
scrivi(x, v)
lista = [5, 6]
cresci(cambia lista[2], cambia v)
scrivi(lista, v)
`),
    ).toEqual(["2 [0, 2]", "[5, 7] [0, 2, 7]"]);
    expect(keys(`funzione f(cambia n: Numero):\n    n += 1\nx = 1\nf(x)`)).toEqual(["mem.changeArg"]);
  });

  it("esclusività: la stessa variabile non si passa due volte se una la cambia", () => {
    expect(keys(`funzione s(cambia a: Numero, cambia b: Numero):\n    passa\nx = 1\ns(cambia x, cambia x)`)).toEqual(["mem.exclusive"]);
    expect(keys(`l = [1, 2]\nper ogni x in l:\n    l.aggiungi(x)`)).toEqual(["name.frozen"]);
  });

  it("«quando finisce» parte subito, in ordine inverso, come i distruttori", () => {
    expect(
      out(`
tipo Risorsa:
    nome: Testo
    quando crea:
        scrivi("+{nome}")
    quando finisce:
        scrivi("-{nome}")
funzione lavora():
    a = Risorsa("a")
    b = Risorsa("b")
    scrivi("lavoro")
lavora()
scrivi("dopo")
x = Risorsa("x")
x = Risorsa("y")
scrivi("sostituito")
lista = [Risorsa("l1"), Risorsa("l2")]
lista.togli(1)
scrivi("fine")
`),
    ).toEqual(["+a", "+b", "lavoro", "-b", "-a", "dopo", "+x", "+y", "-x", "sostituito", "+l1", "+l2", "-l1", "fine", "-l2", "-y"]);
  });

  it("si distrugge anche quando si esce prima (ritorna, errori) e mai due volte", () => {
    expect(
      out(`
tipo R:
    n: Numero
    quando finisce:
        scrivi("via {n}")
funzione crea(n: Numero) -> R:
    r = R(n)
    ritorna r
funzione esce_prima():
    r = R(1)
    se vero:
        ritorna
    scrivi("mai")
funzione sbaglia():
    r = R(2)
    fallisci "no"
esce_prima()
tenta:
    sbaglia()
se errore e:
    scrivi("errore {e}")
tenuto = crea(3)
scrivi("tenuto {tenuto.n}")
d = sposta tenuto
scrivi("spostato")
funzione usa(r: R):
    scrivi("uso {r.n}")
usa(crea(4))
scrivi("fine")
`),
    ).toEqual(["via 1", "via 2", "errore no", "tenuto 3", "spostato", "uso 4", "via 4", "fine", "via 3"]);
  });

  it("le funzioni veloci copiano quello che usano da fuori", () => {
    expect(
      out(`
funzione prova_copia() -> Numero:
    base = [1, 2]
    f: funzione(Numero) -> Numero = x => x + base.lunghezza
    base.aggiungi(3)
    ritorna f(10)
scrivi(prova_copia())
`),
    ).toEqual(["12"]);
    // (le variabili del programma invece si leggono dal vivo, come nelle funzioni)
    expect(keys(`funzione g():\n    l = [1]\n    f: funzione(Numero) -> Numero = x => l.togli_ultimo()`)).toContain("name.captured");
  });
});

describe("Pepino Language: niente e unità di misura", () => {
  it("un valore che può essere niente va controllato prima di usarlo", () => {
    expect(keys(`t: Testo? = niente\nscrivi(t.lunghezza)`)).toEqual(["type.maybeNothing"]);
    expect(keys(`x: Numero = niente`)).toEqual(["type.notNothing"]);
    expect(
      out(`
funzione cerca(n: Numero) -> Testo?:
    se n = 1:
        ritorna "uno"
    ritorna niente
funzione lung(t: Testo?) -> Numero:
    se t = niente:
        ritorna 0
    ritorna t.lunghezza
x = cerca(1)
se x != niente:
    scrivi(x.maiuscolo())
scrivi(lung(cerca(2)), lung("ciao"))
`),
    ).toEqual(["UNO", "0 4"]);
  });

  it("le unità si convertono da sole e non si mescolano grandezze diverse", () => {
    expect(out(`v = 4 tile/s\nt = 3 s\nscrivi(v * t, v * t / 1 tile, 500 ms, 2 min, 90°, 1 rad)`)).toEqual(["192 12 0.5 120 90 57.2957795131"]);
    expect(out(`scrivi(2 tile)`, { tile: 32 })).toEqual(["64"]);
    expect(errors(`t = 2 s\nd = 3 tile\nscrivi(t + d)`)[0]).toMatchObject({ key: "unit.mismatch", message: "Non puoi sommare un tempo (s) e una lunghezza (px): sono grandezze diverse." });
    expect(keys(`t = 2 s\nt = 5 px`)).toEqual(["unit.assign"]);
    expect(keys(`se 2 s > 3 px:\n    passa`)).toEqual(["unit.mismatch"]);
    expect(keys(`x = 3 s\nx += 1`)).toEqual([]);
  });
});

describe("Pepino Language: aspettare", () => {
  it("aspetta ferma la funzione (il tempo passa con sleep)", () => {
    const slept: number[] = [];
    const r = run(
      `
funzione conto(n: Numero):
    per i da n a 1:
        scrivi(i)
        aspetta 1 s
    scrivi("via!")
conto(2)
aspetta 250 ms
scrivi("fine")
`,
      { sleep: (s) => slept.push(s) },
    );
    expect(r.output).toEqual(["2", "1", "via!", "fine"]);
    expect(slept).toEqual([1, 1, 0.25]);
  });

  it("non si aspetta dove bisogna rispondere subito", () => {
    expect(keys(`funzione f():\n    aspetta 1 s\nl = [1]\ng: funzione(Numero) -> Numero = x => x\nscrivi(l.filtra(x => x > 0))`)).toEqual([]);
    expect(keys(`funzione lenta(x: Numero) -> SiNo:\n    aspetta 1 s\n    ritorna vero\nl = [1]\nscrivi(l.filtra(lenta))`)).toEqual(["flow.waitHere"]);
    expect(keys(`funzione f(cambia n: Numero):\n    aspetta 1 s`)).toEqual(["mem.changeInRoutine"]);
  });
});

describe("Pepino Language: traduzione italiano ↔ inglese", () => {
  const it1 = `# commento
tipo Punto:
    x: Numero = 0
    funzione doppio() -> Numero:
        ritorna x * 2

per ogni p in [Punto(1), Punto(2)]:
    se p.x > 1 e non falso:
        scrivi("grande {p.doppio()}")
    altrimenti:
        scrivi("piccolo")
lista: Lista di Testo = []
lista.aggiungi("a")
ripeti 2 volte:
    aspetta 1 s
m = {"a": 1}
scrivi(m.prendi("b", 0), lista.lunghezza)
`;

  it("traduce parole chiave, funzioni e metodi; i nomi scelti restano", () => {
    const en = translate(it1, "en");
    expect(en).toContain("type Punto:");
    expect(en).toContain("x: Number = 0");
    expect(en).toContain("function doppio() -> Number:");
    expect(en).toContain("for each p in [Punto(1), Punto(2)]:");
    expect(en).toContain("if p.x > 1 and not false:");
    expect(en).toContain('print("grande {p.doppio()}")');
    expect(en).toContain("lista: List of Text = []");
    expect(en).toContain('lista.add("a")');
    expect(en).toContain("repeat 2 times:");
    expect(en).toContain("wait 1 s");
    expect(en).toContain('print(m.get("b", 0), lista.length)');
    expect(en).toContain("# commento");
    expect(out(en)).toEqual(out(it1));
  });

  it("andata e ritorno danno il programma di partenza", () => {
    expect(translate(translate(it1, "en"), "it")).toBe(it1);
  });
});

describe("Pepino Language: file su più parti e comando pepino", () => {
  function fakeIO(files: Record<string, string>, input: string[] = []): CliIO & { stdout: string[]; stderr: string[]; files: Record<string, string> } {
    const norm = (f: string) => f.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "");
    const store: Record<string, string> = {};
    for (const [k, v] of Object.entries(files)) store[norm(`/prog/${k}`)] = v;
    const io = {
      stdout: [] as string[],
      stderr: [] as string[],
      files: store,
      out: (t: string) => void io.stdout.push(t),
      prompt: (t: string) => void io.stdout.push(t),
      err: (t: string) => void io.stderr.push(t),
      readFile: (f: string) => {
        const k = norm(f);
        if (!(k in store)) throw new Error(`no ${k}`);
        return store[k];
      },
      writeFile: (f: string, t: string) => void (store[norm(f)] = t),
      appendFile: (f: string, t: string) => void (store[norm(f)] = (store[norm(f)] ?? "") + t),
      exists: (f: string) => norm(f) in store,
      readLine: () => input.shift() ?? null,
      sleep: () => undefined,
      cwd: "/prog",
    };
    return io;
  }

  it("esegue un programma, con chiedi e i file", () => {
    const io = fakeIO({ "ciao.pep": `nome = chiedi("Nome? ")\nscrivi_file("saluto.txt", "Ciao {nome}")\nscrivi(leggi_file("saluto.txt"))` }, ["Anna"]);
    expect(main(["esegui", "ciao.pep"], io)).toBe(0);
    expect(io.stdout).toEqual(["Nome? ", "Ciao Anna"]);
    expect(io.files["/prog/saluto.txt"]).toBe("Ciao Anna");
  });

  it("gli errori mostrano la riga con le frecce ^^^", () => {
    const io = fakeIO({ "sbagliato.pep": `punti = 1\nscrivi(punto)` });
    expect(main(["controlla", "sbagliato.pep"], io)).toBe(1);
    expect(io.stderr[0]).toBe(["Errore alla riga 2 di sbagliato.pep:", "  2 | scrivi(punto)", "    |        ^^^^^", "  Non conosco «punto»: forse volevi dire «punti»?", ""].join("\n"));
  });

  it("usa: un programma su più file", () => {
    const io = fakeIO({
      "lib/forme.pep": `tipo Quadrato:\n    lato: Numero\nfunzione area(q: Quadrato) -> Numero:\n    ritorna q.lato ^ 2`,
      "main.pep": `usa "lib/forme"\nscrivi(area(Quadrato(3)))`,
    });
    expect(main(["esegui", "main.pep"], io)).toBe(0);
    expect(io.stdout).toEqual(["9"]);
  });

  it("gli errori nei file usati dicono il file giusto", () => {
    const io = fakeIO({ "lib.pep": `funzione f():\n    scrivi(ignoto)`, "main.pep": `usa "lib.pep"\nf()` });
    expect(main(["controlla", "main.pep"], io)).toBe(1);
    expect(io.stderr[0]).toContain("riga 2 di lib.pep");
  });

  it("prova, traduci e nuovo", () => {
    const io = fakeIO({ "p.pep": `prova "uno":\n    controlla 1 = 1\nprova "due":\n    controlla 1 = 2` });
    expect(main(["prova", "p.pep"], io)).toBe(1);
    expect(io.stdout).toEqual(["✔ uno", "✘ due (riga 4): Il controllo è fallito (riga 4).", "1 prove riuscite su 2."]);
    const io2 = fakeIO({ "p.pep": `se vero:\n    scrivi("sì")` });
    expect(main(["traduci", "p.pep", "en"], io2)).toBe(0);
    expect(io2.stdout[0]).toBe(`if true:\n    print("sì")`);
    const io3 = fakeIO({});
    expect(main(["new", "hello.pep"], io3)).toBe(0);
    expect(compile(io3.files["/prog/hello.pep"], { host: CLI_HOST }).ok).toBe(true);
    expect(main(["nuovo", "ciao.pep"], io3)).toBe(0);
    expect(compile(io3.files["/prog/ciao.pep"], { host: CLI_HOST }).ok).toBe(true);
  });

  it("fuori dal comando pepino non si chiede niente alla tastiera", () => {
    expect(keys(`x = chiedi("?")`)).toEqual(["run.noInput"]);
  });
});

describe("Pepino Language: le parole italiane di tutti", () => {
  it("mamma mia!: un errore grave che nessun tenta ferma; i «quando finisce» partono lo stesso", () => {
    const r = run(`
tipo Forno:
    quando finisce:
        scrivi("forno spento")
funzione cuoci():
    f = Forno()
    mamma mia! "il forno è bruciato"
tenta:
    cuoci()
se errore e:
    scrivi("preso: {e}")
`);
    expect(r.ok).toBe(false);
    expect(r.output).toEqual(["forno spento"]);
    expect(r.error).toMatchObject({ message: "Mamma mia! il forno è bruciato", line: 7 });
    expect(run(`scrivi("prima")\nMAMMA MIA!`).error?.message).toBe("Mamma mia! È successo qualcosa che non doveva succedere (riga 2).");
    expect(run(`print("first")\nMamma mia!`).error?.message).toBe("Mamma mia! Something happened that should never happen (line 2).");
    // fallisci resta un errore che si può gestire
    expect(out(`tenta:\n    fallisci "piano"\nse errore e:\n    scrivi(e)`)).toEqual(["piano"]);
    // «mamma» da sola è ancora un nome qualsiasi
    expect(out(`mamma = 3\nmia = mamma + 1\nscrivi(mia)`)).toEqual(["4"]);
    expect(warnings(`mamma mia! "basta"\nscrivi(1)`)).toContain("flow.unreachable");
  });

  it("il punto esclamativo da solo ha un messaggio gentile", () => {
    expect(keys(`se !vero:\n    scrivi(1)`)).toEqual(["parse.bang"]);
    expect(keys(`x = 3!`)).toEqual(["parse.bang"]);
    expect(keys(`scrivi(1 != 2)`)).toEqual([]);
  });

  it("pizza: tipi, liste e mappe un ingrediente per riga, anche una dentro l'altra", () => {
    expect(
      out(`
tipo Pizza:
    nome: Testo
    prezzo = 6
    condimenti: Lista di Testo = []
margherita = pizza Pizza:
    nome = "Margherita"
    condimenti = pizza Lista:
        "pomodoro"
        "mozzarella"
prezzi = pizza Mappa di Testo a Numero:
    "margherita" = 6
    "diavola": 7.5
funzione bianca() -> Pizza:
    ritorna pizza Pizza:
        nome = "Bianca"
        prezzo = 5
scrivi(margherita)
scrivi(prezzi)
scrivi(bianca().prezzo)
pizza = 2
scrivi(pizza + 1)
`),
    ).toEqual(['Pizza(nome: "Margherita", prezzo: 6, condimenti: ["pomodoro", "mozzarella"])', '{"margherita": 6, "diavola": 7.5}', "5", "3"]);
  });

  it("pizza: gli errori dicono che cosa manca o che cosa non va", () => {
    expect(keys(`tipo P:\n    nome: Testo\np = pizza P:\n    prezzo = 3`)).toEqual(["type.missingArg", "type.noParam"]);
    expect(keys(`l = pizza Lista di Testo:\n    "a"\n    3`)).toEqual(["type.mixedList"]);
    expect(keys(`n = pizza Numero:\n    x = 1`)).toEqual(["pizza.what"]);
    expect(keys(`x = [1] + pizza Lista:\n    2`)).toEqual(["parse.blockValuePlace"]);
  });

  it("spaghetti: ogni passo riceve il valore del passo prima; l'originale non cambia", () => {
    expect(
      out(`
funzione sconto(p: Numero, quanto: Numero) -> Numero:
    ritorna p - quanto
funzione raddoppia(cambia l: Lista di Numero):
    per ogni cambia x in l:
        x *= 2
nomi = ["Zoe", "anna", "Bo"]
titolo = spaghetti nomi:
    trasforma(n => n.maiuscolo())
    ordina()
    inverti()
    unisci(", ")
scrivi(titolo)
scrivi(nomi)
prezzi = {"a": 6, "b": 7.5}
totale = spaghetti prezzi:
    valori()
    somma()
    sconto(1.5)
scrivi(totale)
numeri = [3, 1, 2]
doppi = spaghetti numeri:
    raddoppia()
    ordina()
scrivi(doppi, numeri)
spaghetti numeri:
    scrivi()
    filtra(n => n > 1)
    scrivi()
`),
    ).toEqual(["ZOE, BO, ANNA", '["Zoe", "anna", "Bo"]', "12", "[2, 4, 6] [3, 1, 2]", "[3, 1, 2]", "[3, 2]"]);
  });

  it("spaghetti copia solo quando un passo cambia il valore (i «quando finisce» non partono per niente)", () => {
    expect(
      out(`
tipo Zaino:
    nome: Testo
    oggetti: Lista di Testo = []
    funzione aggiungi_acqua():
        oggetti.aggiungi("acqua")
    quando finisce:
        scrivi("addio {nome}")
z = Zaino("A", ["pane", "mela"])
n = spaghetti z:
    oggetti
    lunghezza
scrivi(n)
pieno = spaghetti z:
    aggiungi_acqua()
scrivi(pieno.oggetti, z.oggetti)
lista = spaghetti z:
    oggetti
    aggiungi("sale")
scrivi(lista, z.oggetti.lunghezza)
`),
    ).toEqual(["2", '["pane", "mela", "acqua"] ["pane", "mela"]', '["pane", "mela", "sale"] 2', "addio A", "addio A"]);
  });

  it("spaghetti: passi sconosciuti e valori che possono essere niente", () => {
    expect(errors(`l = [1, 2]\nx = spaghetti l:\n    ordna()`)[0]).toMatchObject({ key: "pipe.unknownStepDid", line: 3 });
    expect(keys(`l = [1, 2]\nx = spaghetti l:\n    trova(n => n > 1)\n    testo()`)).toEqual(["pipe.maybeNothing"]);
    expect(keys(`l = [1]\nx = spaghetti l:\n    scrivi()`)).toEqual(["type.void"]);
    expect(warnings(`l = [1]\nspaghetti l:\n    ordina()`)).toContain("flow.unused");
    expect(warnings(`l = [1]\nspaghetti l:\n    scrivi()`)).toEqual([]);
  });

  it("bravo: parte solo se il tentativo è andato bene, vede le sue variabili e i suoi errori non finiscono nel «se errore»", () => {
    expect(
      out(`
tipo T:
    quando finisce:
        scrivi("fine T")
per ogni testo in ["12", "ciao"]:
    tenta:
        età = numero(testo)
        t = T()
    se errore problema:
        scrivi("errore: {problema}")
    bravo:
        scrivi("tra dieci anni: {età + 10}")
    scrivi("dopo")
`),
    ).toEqual(["tra dieci anni: 22", "fine T", "dopo", "errore: «ciao» non è un numero.", "dopo"]);
    const r = run(`tenta:\n    x = 1\nse errore e:\n    scrivi("preso")\nbravo:\n    fallisci "dentro bravo"`);
    expect(r.ok).toBe(false);
    expect(r.output).toEqual([]);
    expect(r.error?.message).toBe("dentro bravo");
    expect(errors(`tenta:\n    x = 1\nse errore e:\n    passa\nbravo:\n    passa\nscrivi(x)`)[0]).toMatchObject({ key: "name.onlyIn", line: 7 });
    expect(out(`try:\n    n = number("5")\nif error e:\n    print(e)\nbravo:\n    print(n * 2)`)).toEqual(["10"]);
    // «bravo» è ancora un nome qualsiasi
    expect(out(`tenta:\n    x = 1\nse errore e:\n    passa\nbravo: Numero = 3\nscrivi(bravo)`)).toEqual(["3"]);
  });

  it("cappuccino: il blocco parte dopo (o a parte) e intanto il codice va avanti", () => {
    const slept: number[] = [];
    const r = run(
      `
funzione ordina_due():
    n = 1
    cappuccino 1 s:
        scrivi("n vale {n}")
    n = 2
    cappuccino:
        scrivi("subito, ma dopo")
        aspetta 0.5 s
        scrivi("dopo mezzo secondo")
    scrivi("intanto n = {n}")
ordina_due()
scrivi("fine del programma")
`,
      { sleep: (s) => slept.push(s) },
    );
    expect(r.ok).toBe(true);
    expect(r.output).toEqual(["intanto n = 2", "fine del programma", "subito, ma dopo", "dopo mezzo secondo", "n vale 1"]);
    expect(slept).toEqual([0.5, 0.5]);
  });

  it("cappuccino: le copie si distruggono quando finisce; le variabili di fuori non si cambiano", () => {
    expect(
      out(`
tipo T:
    nome: Testo
    quando finisce:
        scrivi("addio {nome}")
funzione f():
    t = T("a")
    cappuccino 1 s:
        scrivi("uso {t.nome}")
    scrivi("fine f")
f()
scrivi("dopo f")
`),
    ).toEqual(["fine f", "addio a", "dopo f", "uso a", "addio a"]);
    expect(keys(`funzione f():\n    n = 1\n    cappuccino:\n        n += 1`)).toEqual(["name.capturedLater"]);
    // Chi ordina non aspetta: la funzione si può usare dove bisogna rispondere subito.
    expect(keys(`funzione g(x: Numero) -> SiNo:\n    cappuccino:\n        aspetta 1 s\n    ritorna vero\nscrivi([1].filtra(g))`)).toEqual([]);
    expect(keys(`tipo P:\n    x = 0\n    funzione f():\n        cappuccino:\n            scrivi(x)`)).toEqual(["later.here"]);
    expect(keys(`cappuccino 2 tile:\n    scrivi(1)`)).toEqual(["later.delay"]);
    // cappuccino è ancora un nome qualsiasi
    expect(out(`cappuccino = 2\nscrivi(cappuccino)`)).toEqual(["2"]);
  });

  it("cappuccino: un errore dentro dice la riga; le prove aspettano i cappuccini", () => {
    const r = run(`cappuccino 1 s:\n    scrivi([1][3])\nscrivi("ok")`);
    expect(r.output).toEqual(["ok"]);
    expect(r.error).toMatchObject({ line: 2 });
    const t = run(`prova "dopo":\n    cappuccino 1 s:\n        controlla 1 = 2, "nel cappuccino"`, { tests: true });
    expect(t.tests).toEqual([{ name: "dopo", ok: false, message: "Il controllo è fallito: nel cappuccino", line: 3, file: "programma" }]);
  });

  it("le parole italiane valgono nelle due lingue e la traduzione le lascia come sono", () => {
    const src = `numeri = [3, 1, 2]
riga = spaghetti numeri:
    ordina()
    unisci(", ")
p = pizza Lista:
    1
tenta:
    x = numero(riga)
se errore e:
    scrivi(e)
bravo:
    scrivi(x)
cappuccino 1 s:
    scrivi(p)
se p.lunghezza > 3:
    MAMMA MIA! "troppi"
`;
    const en = translate(src, "en");
    expect(en).toContain('riga = spaghetti numeri:\n    sort()\n    join(", ")');
    expect(en).toContain("p = pizza List:");
    expect(en).toContain("try:\n    x = number(riga)\nif error e:\n    print(e)\nbravo:\n    print(x)");
    expect(en).toContain("cappuccino 1 s:");
    expect(en).toContain('MAMMA MIA! "troppi"');
    expect(translate(en, "it")).toBe(src);
    expect(out(src)).toEqual(["«1, 2, 3» non è un numero.", "[1]"]);
    expect(out(en)).toEqual(['"1, 2, 3" is not a number.', "[1]"]);
  });

  it("l'esempio della pizzeria (samples/pepino/pizzeria.pep) gira, anche tradotto", () => {
    const src = readFileSync(join(__dirname, "../samples/pepino/pizzeria.pep"), "utf8");
    const expected = [
      "Oggi nel menù: Diavola e Margherita",
      "Una di ciascuna: 13.5 €",
      "Arrivano 3 margherite: 18 €",
      "Intanto si mangia la pizza…",
      "Margherita in forno!",
      "Diavola in forno!",
      "Ecco il cappuccino!",
    ];
    expect(out(src)).toEqual(expected);
    expect(out(translate(src, "en"))).toEqual(expected);
  });
});

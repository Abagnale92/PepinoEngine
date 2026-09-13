import { useEffect, useMemo, useRef, useState } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { basicSetup } from "codemirror";
import { indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { HighlightStyle, ensureSyntaxTree, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import { tags as t } from "@lezer/highlight";
import { compilePython, getBlockDef, PythonError, type ProjectData, type ScriptData, type ScriptResult } from "@runtime";
import { editProject, getState, log, setState, useEditor } from "../store";
import { flattenEntities, uniqueId } from "../projectOps";
import { Icon } from "./Icon";

// ------------------------------------------------------------------ Aspetto dell'editor

const theme = EditorView.theme(
  {
    "&": { height: "100%", color: "var(--text)", backgroundColor: "var(--input)", fontSize: "12.5px" },
    ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.6" },
    ".cm-content": { caretColor: "var(--accent)", paddingBottom: "40vh" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
    ".cm-gutters": { backgroundColor: "var(--panel)", color: "var(--dim)", border: "none", borderRight: "1px solid var(--line)" },
    ".cm-activeLine": { backgroundColor: "rgba(255, 255, 255, 0.035)" },
    ".cm-activeLineGutter": { backgroundColor: "var(--panel-2)", color: "var(--muted)" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "rgba(140, 196, 128, 0.25)",
    },
    ".cm-matchingBracket": { backgroundColor: "rgba(140, 196, 128, 0.2)", outline: "1px solid rgba(140, 196, 128, 0.5)" },
    ".cm-tooltip": { backgroundColor: "var(--panel-2)", color: "var(--text)", border: "1px solid var(--line-2)" },
    ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--accent-soft)", color: "var(--text)" },
    ".cm-panels": { backgroundColor: "var(--panel)", color: "var(--text)" },
    ".cm-searchMatch": { backgroundColor: "rgba(226, 165, 90, 0.25)" },
    ".cm-foldPlaceholder": { backgroundColor: "var(--panel-3)", border: "none", color: "var(--muted)" },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword], color: "#c792ea" },
  { tag: [t.string, t.special(t.string)], color: "#c3e88d" },
  { tag: [t.number, t.bool, t.null], color: "#f78c6c" },
  { tag: t.comment, color: "#6b7a67", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))], color: "#82aaff" },
  { tag: t.propertyName, color: "#b9d7a8" },
  { tag: [t.operator, t.punctuation], color: "#89ddff" },
  { tag: [t.className, t.typeName], color: "#ffcb6b" },
  { tag: t.self, color: "#ff9cac" },
]);

// ------------------------------------------------------------------ Controllo mentre si scrive

function lineRange(view: EditorView, line: number, col = 1) {
  const doc = view.state.doc;
  const l = doc.line(Math.min(Math.max(1, line), doc.lines));
  const from = Math.min(l.from + Math.max(0, col - 1), l.to);
  return { from, to: l.to > from ? l.to : from };
}

function lintPython(view: EditorView): Diagnostic[] {
  try {
    compilePython(view.state.doc.toString());
    return [];
  } catch (e) {
    if (!(e instanceof PythonError)) return [];
    return [{ ...lineRange(view, e.line, e.col), severity: "error", message: e.reason }];
  }
}

function lintJs(view: EditorView): Diagnostic[] {
  try {
    // Solo compilazione: il codice non viene eseguito.
    new Function("Pepino", view.state.doc.toString());
    return [];
  } catch (e) {
    // Il messaggio del browser non dice dove: la posizione la dà l'albero sintattico dell'editor.
    let pos = -1;
    ensureSyntaxTree(view.state, view.state.doc.length, 200)?.iterate({
      enter: (n) => {
        if (pos >= 0) return false;
        if (n.type.isError) pos = n.from;
        return undefined;
      },
    });
    const line = pos >= 0 ? view.state.doc.lineAt(pos) : view.state.doc.line(1);
    const from = pos >= 0 ? pos : line.from;
    return [{ from, to: Math.max(from, line.to), severity: "error", message: `Errore di sintassi: ${(e as Error).message}` }];
  }
}

// ------------------------------------------------------------------ Editor

interface EditorHandle {
  jump(line: number): void;
}

function CodeEditor({
  script,
  onChange,
  handle,
}: {
  script: ScriptData;
  onChange: (code: string) => void;
  handle: { current: EditorHandle | null };
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    const py = script.language === "py";
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: script.code,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          indentUnit.of(py ? "    " : "  "),
          EditorState.tabSize.of(py ? 4 : 2),
          py ? python() : javascript(),
          linter(py ? lintPython : lintJs, { delay: 300 }),
          lintGutter(),
          theme,
          syntaxHighlighting(highlight),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) change.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    handle.current = {
      jump(line) {
        const r = lineRange(v, line);
        v.dispatch({ selection: { anchor: r.from }, scrollIntoView: true });
        v.focus();
      },
    };
    return () => {
      v.destroy();
      view.current = null;
      handle.current = null;
    };
    // Si ricrea solo cambiando script: il testo lo segue l'effetto qui sotto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script.id, script.language]);

  // Il testo cambia da fuori (Annulla dell'editor, progetto riaperto): allinea senza perdere il cursore se possibile.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const now = v.state.doc.toString();
    if (now !== script.code) v.dispatch({ changes: { from: 0, to: now.length, insert: script.code } });
  }, [script.code]);

  return <div className="code-editor" ref={host} />;
}

// ------------------------------------------------------------------ Modelli per i nuovi script

function jsTemplate(name: string): string {
  return `// Blocco scritto in JavaScript. Lo trovi nell'Inspector, in "Aggiungi blocco" → Personalizzati;
// le sue azioni, condizioni ed eventi compaiono nelle Regole.
Pepino.defineBlock({
  name: "${name}",
  label: "Oscilla",
  description: "Fa oscillare l'oggetto a destra e a sinistra.",
  props: {
    distance: { type: "number", label: "Distanza", unit: "tile", default: 2, min: 0 },
    speed: { type: "number", label: "Velocità", unit: "giri/s", default: 0.5, min: 0, step: 0.1 },
  },
  events: [{ id: "giro", label: "Ha finito un'oscillazione" }],
  conditions: {
    fermo: { label: "È fermo", test: (self) => self.data.paused },
  },
  actions: {
    ferma: { label: "Ferma l'oscillazione", run: (self) => (self.data.paused = true) },
    riparti: { label: "Fai ripartire l'oscillazione", run: (self) => (self.data.paused = false) },
  },

  init(self) {
    self.data.startX = self.entity.x;
    self.data.t = 0;
    self.data.paused = false;
  },

  update(self, dt) {
    if (self.data.paused) return;
    const before = Math.floor(self.data.t);
    self.data.t += dt * self.props.speed;
    if (Math.floor(self.data.t) > before) self.emit("giro");
    const offset = Math.sin(self.data.t * Math.PI * 2) * self.props.distance * self.scene.tileSize;
    self.entity.x = self.data.startX + offset;
  },
});
`;
}

function pyTemplate(name: string): string {
  return `# Blocco scritto in Python (versione ridotta: Pepino lo traduce in JavaScript).
# Lo trovi nell'Inspector, in "Aggiungi blocco" → Personalizzati.
name = "${name}"
label = "Lampeggia"
description = "Fa lampeggiare l'oggetto."
props = {
    "interval": {"type": "number", "label": "Ogni", "unit": "s", "default": 0.3, "min": 0.05, "step": 0.05},
}
events = [{"id": "lampo", "label": "Si accende o si spegne"}]
conditions = {"acceso": "È visibile"}
actions = {"ferma": "Smetti di lampeggiare", "riparti": "Ricomincia a lampeggiare"}


def init(self):
    self.data.t = 0
    self.data.attivo = True


def update(self, dt):
    if not self.data.attivo:
        return
    self.data.t += dt
    if self.data.t >= self.props.interval:
        self.data.t = 0
        self.entity.visible = not self.entity.visible
        self.emit("lampo")


def acceso(self):
    return self.entity.visible


def ferma(self):
    self.data.attivo = False
    self.entity.visible = True


def riparti(self):
    self.data.attivo = True
`;
}

function uniqueBlockName(base: string): string {
  let n = base;
  for (let k = 2; getBlockDef(n); k++) n = `${base}${k}`;
  return n;
}

/** Quanti oggetti e modelli usano i blocchi indicati. */
function usesOf(p: ProjectData, types: string[]): number {
  if (!types.length) return 0;
  const set = new Set(types);
  let n = p.prefabs.filter((pf) => pf.blocks.some((b) => set.has(b.type))).length;
  for (const s of p.scenes) for (const f of flattenEntities(s.entities)) if (f.data.blocks.some((b) => set.has(b.type))) n++;
  return n;
}

// ------------------------------------------------------------------ Vista

type Side = "guide" | "js" | null;

/** Scheda Codice: blocchi scritti a mano in JavaScript o in Python ridotto. */
export function CodeView() {
  const project = useEditor((s) => s.project)!;
  const results = useEditor((s) => s.scriptResults);
  const selId = useEditor((s) => s.codeScriptId);
  const [side, setSide] = useState<Side>("guide");
  const handle = useRef<EditorHandle | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const sized = useRef(false);

  // Con poco spazio la guida diventa un pannello sopra l'editor (e parte chiusa), così il codice resta leggibile.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const isNarrow = entry.contentRect.width < 820;
      setNarrow(isNarrow);
      if (!sized.current) {
        sized.current = true;
        if (isNarrow) setSide(null);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scripts = project.scripts ?? [];
  const sel = scripts.find((s) => s.id === selId) ?? scripts[0];
  const result = sel ? results.find((r) => r.id === sel.id) : undefined;
  const uses = usesOf(project, result?.blocks ?? []);

  const add = (language: "js" | "py") => {
    const id = uniqueId(language === "py" ? "script_py" : "script_js", new Set(scripts.map((s) => s.id)));
    const code = language === "py" ? pyTemplate(uniqueBlockName("Lampeggia")) : jsTemplate(uniqueBlockName("Oscilla"));
    const name = language === "py" ? "Nuovo script Python" : "Nuovo script JavaScript";
    editProject((p) => void (p.scripts ??= []).push({ id, name, language, code }));
    setState({ codeScriptId: id });
  };

  const setCode = (code: string) => {
    if (!sel) return;
    // Evita un passo di Annulla vuoto quando il testo viene riallineato da fuori.
    if (getState().project?.scripts?.find((s) => s.id === sel.id)?.code === code) return;
    editProject((p) => {
      const s = p.scripts?.find((x) => x.id === sel.id);
      if (s) s.code = code;
    }, `code:${sel.id}`);
  };

  const rename = (name: string) =>
    editProject((p) => {
      const s = p.scripts?.find((x) => x.id === sel?.id);
      if (s) s.name = name;
    }, `sname:${sel?.id}`);

  const remove = () => {
    if (!sel) return;
    editProject((p) => void (p.scripts = (p.scripts ?? []).filter((s) => s.id !== sel.id)));
    setState({ codeScriptId: "" });
    if (uses > 0) log("warn", `Eliminato lo script «${sel.name}»: ${uses} oggetti usavano i suoi blocchi. Annulla (Ctrl+Z) per recuperarlo.`);
  };

  return (
    <div className={`code-view${narrow ? " narrow" : ""}`} ref={root}>
      <aside className="code-list">
        <div className="tree-h">
          <span>Script · {scripts.length}</span>
        </div>
        <div className="code-new">
          <button type="button" className="btn small" onClick={() => add("js")} title="Nuovo script in JavaScript">
            <Icon name="plus" size={12} /> JavaScript
          </button>
          <button type="button" className="btn small" onClick={() => add("py")} title="Nuovo script in Python">
            <Icon name="plus" size={12} /> Python
          </button>
        </div>
        {scripts.map((s) => {
          const r = results.find((x) => x.id === s.id);
          return (
            <button type="button" key={s.id} className={`tree-row${sel?.id === s.id ? " on" : ""}`} onClick={() => setState({ codeScriptId: s.id })}>
              <span className={`lang-badge ${s.language}`}>{s.language === "py" ? "PY" : "JS"}</span>
              <span className="tree-name">{s.name}</span>
              {r?.error && <span className="dot-err" title={r.error.message} />}
            </button>
          );
        })}
        {scripts.length === 0 && <p className="empty-hint">Nessuno script. Con uno script crei blocchi nuovi, scritti a mano.</p>}
      </aside>

      <section className="code-main">
        {sel ? (
          <>
            <div className="code-head">
              <span className={`lang-badge ${sel.language}`}>{sel.language === "py" ? "Python" : "JavaScript"}</span>
              <input className="title-input" value={sel.name} onChange={(e) => rename(e.target.value)} />
              <span className="dim">
                usato da {uses} {uses === 1 ? "oggetto" : "oggetti"}
              </span>
              <div className="spacer" />
              {sel.language === "py" && (
                <button type="button" className={`btn small${side === "js" ? " on" : ""}`} onClick={() => setSide(side === "js" ? null : "js")}>
                  <Icon name="code" size={13} /> JavaScript generato
                </button>
              )}
              <button type="button" className={`btn small${side === "guide" ? " on" : ""}`} onClick={() => setSide(side === "guide" ? null : "guide")}>
                <Icon name="book" size={13} /> Guida
              </button>
              <button type="button" className="btn small danger" onClick={remove}>
                <Icon name="trash" size={13} /> Elimina
              </button>
            </div>
            <CodeEditor key={sel.id} script={sel} onChange={setCode} handle={handle} />
            <Status result={result} onJump={(line) => handle.current?.jump(line)} />
          </>
        ) : (
          <div className="rules-empty">
            <h3>Blocchi in codice</h3>
            <p>
              Quando i blocchi pronti non bastano, scrivine uno tuo in <b>JavaScript</b> o in <b>Python</b>. Il nuovo blocco compare
              nell'Inspector come tutti gli altri, e le sue azioni e condizioni si usano nelle Regole.
            </p>
            <div className="row-btns">
              <button type="button" className="btn primary" onClick={() => add("js")}>
                <Icon name="plus" size={13} /> Script JavaScript
              </button>
              <button type="button" className="btn primary" onClick={() => add("py")}>
                <Icon name="plus" size={13} /> Script Python
              </button>
            </div>
          </div>
        )}
      </section>

      {sel && side && (
        <aside className="code-side">
          {narrow && (
            <button type="button" className="icon-btn code-side-close" title="Chiudi" onClick={() => setSide(null)}>
              <Icon name="close" size={13} />
            </button>
          )}
          {side === "js" && sel.language === "py" ? <GeneratedJs code={sel.code} /> : <Guide language={sel.language} />}
        </aside>
      )}
    </div>
  );
}

function Status({ result, onJump }: { result?: ScriptResult; onJump: (line: number) => void }) {
  if (!result) return <div className="code-status dim">Controllo in corso…</div>;
  const err = result.error;
  if (err) {
    return (
      <div className="code-status bad">
        <Icon name="bug" size={13} />
        <span>
          {err.line ? (
            <button type="button" className="linkish" onClick={() => onJump(err.line!)}>
              Riga {err.line}
            </button>
          ) : (
            "Errore"
          )}
          : {err.message}
          {result.stale && <span className="dim"> · nel frattempo resta in uso l'ultima versione che funzionava</span>}
        </span>
      </div>
    );
  }
  const labels = result.blocks.map((b) => getBlockDef(b)?.label ?? b);
  return (
    <div className="code-status ok">
      <Icon name="cube" size={13} />
      {labels.length ? (
        <span>
          {labels.length === 1 ? "Blocco pronto" : "Blocchi pronti"}: <b>{labels.join(", ")}</b>
          <span className="dim"> · Inspector → Aggiungi blocco → Personalizzati</span>
        </span>
      ) : (
        <span className="dim">Lo script non definisce blocchi.</span>
      )}
    </div>
  );
}

function GeneratedJs({ code }: { code: string }) {
  const out = useMemo(() => {
    try {
      return compilePython(code).code;
    } catch (e) {
      return e instanceof PythonError ? `// Riga ${e.line}: ${e.reason}` : String(e);
    }
  }, [code]);
  return (
    <>
      <h4>JavaScript generato</h4>
      <p>È il codice che gira davvero nel gioco (anche nella build WebGL, senza Python). Sola lettura.</p>
      <pre className="gen-js">{out}</pre>
    </>
  );
}

function Guide({ language }: { language: "js" | "py" }) {
  const py = language === "py";
  return (
    <>
      <h4>Come funziona</h4>
      {py ? (
        <p>
          Scrivi le variabili <code>name</code>, <code>label</code>, <code>props</code>… e le funzioni <code>init(self)</code>,{" "}
          <code>update(self, dt)</code>. Pepino le traduce in JavaScript, così il gioco esportato non ha bisogno di Python.
        </p>
      ) : (
        <p>
          Uno script definisce uno o più blocchi con <code>Pepino.defineBlock({"{ … }"})</code>. Ogni modifica si applica da sola dopo un
          attimo.
        </p>
      )}

      <h4>Funzioni del blocco</h4>
      <dl>
        <dt>init(self)</dt>
        <dd>all'avvio della scena</dd>
        <dt>update(self, dt)</dt>
        <dd>ogni fotogramma; dt = secondi passati</dd>
        <dt>physics(self, dt)</dt>
        <dd>passo di fisica, dopo update</dd>
        <dt>late(self, dt)</dt>
        <dd>dopo fisica e contatti</dd>
        <dt>destroy(self)</dt>
        <dd>quando l'oggetto sparisce</dd>
      </dl>

      <h4>Cosa c'è in self</h4>
      <dl>
        <dt>self.props</dt>
        <dd>i valori scelti nell'Inspector</dd>
        <dt>self.data</dt>
        <dd>memoria del blocco (timer, contatori…)</dd>
        <dt>self.entity</dt>
        <dd>
          l'oggetto: <code>x</code>, <code>y</code>, <code>visible</code>, <code>state</code>, <code>facingX</code>, <code>tags</code>,{" "}
          <code>get("Blocco")</code>, <code>destroy()</code>
        </dd>
        <dt>self.body</dt>
        <dd>
          il Corpo, se c'è: <code>vx</code>, <code>vy</code>, <code>onGround</code>, <code>touching("etichetta")</code>
        </dd>
        <dt>self.scene</dt>
        <dd>
          <code>tileSize</code>, <code>time</code>, <code>find("nome")</code>, <code>findAll("etichetta")</code>,{" "}
          <code>spawn("modello", x, y)</code>
        </dd>
        <dt>self.game</dt>
        <dd>
          <code>vars</code> (variabili), <code>audio.play("suono")</code>, <code>input.isDown("jump")</code>, <code>goToScene("id")</code>
        </dd>
        <dt>self.emit("evento")</dt>
        <dd>le Regole lo vedono in «Quando»</dd>
      </dl>

      <h4>Proprietà</h4>
      <p>
        Tipi: number, integer, boolean, string, text, select, color, image, audio, scene, tag, group, groups, variable, prefab, dialogue,
        input.
      </p>
      <pre>
        {py
          ? `props = {\n    "speed": {"type": "number", "label": "Velocità",\n              "unit": "tile/s", "default": 4},\n}`
          : `props: {\n  speed: { type: "number", label: "Velocità",\n           unit: "tile/s", default: 4 },\n},`}
      </pre>

      <h4>Azioni e condizioni per le Regole</h4>
      {py ? (
        <>
          <p>
            Ogni voce collega una funzione con lo stesso nome. Con parametri, al posto del testo usa <code>{'{"label": …, "params": {…}}'}</code>.
          </p>
          <pre>{`actions = {"salta": "Salta subito"}\nconditions = {"stanco": "È stanco"}\n\ndef salta(self):\n    ...\n\ndef stanco(self):\n    return self.data.fatica > 3`}</pre>
        </>
      ) : (
        <pre>{`actions: {\n  salta: { label: "Salta subito",\n          run: (self) => { ... } },\n},\nconditions: {\n  stanco: { label: "È stanco",\n            test: (self) => self.data.fatica > 3 },\n},`}</pre>
      )}

      <h4>Aiuti</h4>
      {py ? (
        <p>
          <code>print(…)</code> scrive nella Console. Ci sono <code>import math</code>, <code>import random</code>, <code>len</code>,{" "}
          <code>range</code>, <code>min</code>, <code>max</code>, <code>abs</code>, <code>round</code>, <code>int</code>, <code>str</code>.
        </p>
      ) : (
        <p>
          <code>Pepino.log(…)</code> scrive nella Console. Poi <code>Pepino.clamp</code>, <code>Pepino.lerp</code>,{" "}
          <code>Pepino.approach</code>, <code>Pepino.lineOfSight</code>, <code>Pepino.findPath</code>.
        </p>
      )}

      {py && (
        <>
          <h4>Il Python di Pepino</h4>
          <p>
            Ci sono <code>if/elif/else</code>, <code>for</code>, <code>while</code>, <code>def</code>, liste, dizionari, f-string e slice. Non
            ci sono classi, <code>try</code>, <code>with</code>, <code>lambda</code>, comprehension e <code>global</code>: per ricordare
            valori usa <code>self.data</code>. I dizionari si leggono anche con il punto: <code>self.data.timer</code>.
          </p>
        </>
      )}

      <h4>Se qualcosa va storto</h4>
      <p>
        Gli errori di scrittura sono sottolineati mentre scrivi. Se un blocco sbaglia a gioco avviato, si ferma solo quel blocco e la Console
        dice script e riga.
      </p>
    </>
  );
}

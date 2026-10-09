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
import { compilePepino, compilePython, ENGINE_HOST, getBlockDef, PythonError, runPepinoTests, type ProjectData, type ScriptData, type ScriptResult } from "@runtime";
import { detectLang, translate } from "../../../lang";
import { pepinoLanguage } from "../pepinoLang";
import { pepTemplate } from "../pepinoTemplates";
import { editProject, getState, log, setState, useEditor } from "../store";
import { flattenEntities, uniqueId } from "../projectOps";
import { Icon } from "./Icon";
import { getEditorLang, T } from "../i18n";
import { useSettings } from "../settings";
import { Splitter, usePanel, usePanelVar } from "./Splitter";

// ------------------------------------------------------------------ Aspetto dell'editor

const makeTheme = (fontSize: number) =>
  EditorView.theme(
  {
    "&": { height: "100%", color: "var(--text)", backgroundColor: "var(--input)", fontSize: `${fontSize}px` },
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
  // Le parole italiane di tutti: mamma mia!, pizza, spaghetti, bravo, cappuccino.
  { tag: t.special(t.keyword), color: "#ff7b63", fontWeight: "bold" },
  { tag: [t.string, t.special(t.string)], color: "#c3e88d" },
  { tag: [t.number, t.bool, t.null], color: "#f78c6c" },
  { tag: t.comment, color: "#6b7a67", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName))], color: "#82aaff" },
  { tag: t.propertyName, color: "#b9d7a8" },
  { tag: [t.operator, t.punctuation], color: "#89ddff" },
  { tag: [t.className, t.typeName], color: "#ffcb6b" },
  { tag: t.self, color: "#ff9cac" },
  { tag: t.atom, color: "#f78c6c" },
  { tag: t.unit, color: "#f5a97f", fontStyle: "italic" },
  { tag: t.special(t.variableName), color: "#ff9cac" },
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
    return [{ from, to: Math.max(from, line.to), severity: "error", message: T("Errore di sintassi: {0}", (e as Error).message) }];
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
  const fontSize = useSettings((s) => s.codeFontSize);

  useEffect(() => {
    const py = script.language === "py";
    const pep = script.language === "pep";
    const four = py || pep;
    const lang = pep ? pepinoLanguage() : [py ? python() : javascript(), linter(py ? lintPython : lintJs, { delay: 300 })];
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: script.code,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          indentUnit.of(four ? "    " : "  "),
          EditorState.tabSize.of(four ? 4 : 2),
          lang,
          lintGutter(),
          makeTheme(fontSize),
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
  }, [script.id, script.language, fontSize]);

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
  const [width, setWidth] = useState(Infinity);
  const sized = useRef(false);
  // Larghezze dell'elenco e della guida scelte trascinando i divisori.
  const listW = usePanel("codeList");
  const sideW = usePanel("codeSide");
  const panelVars = { ...usePanelVar("--list-w", "codeList"), ...usePanelVar("--side-w", "codeSide") };
  // Sotto questa larghezza la guida non sta accanto al codice (310 = spazio minimo dell'editor).
  const minWide = useRef(820);
  minWide.current = listW + sideW + 310;
  const narrow = width < minWide.current;

  // Con poco spazio la guida diventa un pannello sopra l'editor (e parte chiusa), così il codice resta leggibile.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
      if (!sized.current) {
        sized.current = true;
        if (entry.contentRect.width < minWide.current) setSide(null);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scripts = project.scripts ?? [];
  const sel = scripts.find((s) => s.id === selId) ?? scripts[0];
  const result = sel ? results.find((r) => r.id === sel.id) : undefined;
  const uses = usesOf(project, result?.blocks ?? []);

  const add = (language: "js" | "py" | "pep") => {
    const id = uniqueId(language === "py" ? "script_py" : language === "pep" ? "script_pep" : "script_js", new Set(scripts.map((s) => s.id)));
    const code =
      language === "py"
        ? pyTemplate(uniqueBlockName("Lampeggia"))
        : language === "pep"
          ? pepTemplate(uniqueBlockName(getEditorLang() === "en" ? "Stroll" : "Passeggia"), getEditorLang())
          : jsTemplate(uniqueBlockName("Oscilla"));
    const name = language === "py" ? T("Nuovo script Python") : language === "pep" ? T("Nuovo script Pepino") : T("Nuovo script JavaScript");
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

  /** Esegue le «prova» dello script Pepino e scrive i risultati nella Console. */
  const runTests = () => {
    if (!sel || sel.language !== "pep") return;
    const results = runPepinoTests(sel.code, getEditorLang(), (t) => log("info", t));
    setState({ bottomTab: "console" });
    if (!results) {
      log("error", T("Lo script «{0}» ha degli errori: correggili prima di provarlo.", sel.name));
      return;
    }
    if (!results.length) {
      log("info", T("Lo script «{0}» non ha prove: scrivile con «prova \"nome\":».", sel.name));
      return;
    }
    for (const r of results) {
      if (r.ok) log("info", T("✔ Prova «{0}» riuscita", r.name));
      else log("error", r.name ? T("✘ Prova «{0}» fallita{1}: {2}", r.name, r.line ? T(" (riga {0})", r.line) : "", r.message ?? "") : (r.message ?? ""));
    }
    const ok = results.filter((r) => r.ok).length;
    log(ok === results.length ? "info" : "warn", T("Prove riuscite: {0} su {1}", ok, results.length));
  };

  /** Riscrive lo script Pepino con le parole dell'altra lingua (italiano ↔ inglese). */
  const translateScript = () => {
    if (!sel || sel.language !== "pep") return;
    const to = detectLang(sel.code) === "it" ? "en" : "it";
    editProject((p) => {
      const s = p.scripts?.find((x) => x.id === sel.id);
      if (s) s.code = translate(s.code, to, ENGINE_HOST);
    });
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
    if (uses > 0) log("warn", T("Eliminato lo script «{0}»: {1} oggetti usavano i suoi blocchi. Annulla (Ctrl+Z) per recuperarlo.", sel.name, uses));
  };

  return (
    <div className={`code-view${narrow ? " narrow" : ""}`} ref={root} style={panelVars}>
      <Splitter id="codeList" />
      {sel && side && <Splitter id="codeSide" edge="end" />}
      <aside className="code-list">
        <div className="tree-h">
          <span>{T("Script · ")}{scripts.length}</span>
        </div>
        <div className="code-new">
          <button type="button" className="btn small" onClick={() => add("js")} title={T("Nuovo script in JavaScript")}>
            <Icon name="plus" size={12} />{T(" JavaScript")}</button>
          <button type="button" className="btn small" onClick={() => add("py")} title={T("Nuovo script in Python")}>
            <Icon name="plus" size={12} />{T(" Python")}</button>
          <button type="button" className="btn small" onClick={() => add("pep")} title={T("Nuovo script in Pepino Language")}>
            <Icon name="plus" size={12} />{T(" Pepino")}</button>
        </div>
        {scripts.map((s) => {
          const r = results.find((x) => x.id === s.id);
          return (
            <button type="button" key={s.id} className={`tree-row${sel?.id === s.id ? " on" : ""}`} onClick={() => setState({ codeScriptId: s.id })}>
              <span className={`lang-badge ${s.language}`}>{s.language === "py" ? T("PY") : s.language === "pep" ? T("PEP") : T("JS")}</span>
              <span className="tree-name">{s.name}</span>
              {r?.error && <span className="dot-err" title={r.error.message} />}
            </button>
          );
        })}
        {scripts.length === 0 && <p className="empty-hint">{T("Nessuno script. Con uno script crei blocchi nuovi, scritti a mano.")}</p>}
      </aside>

      <section className="code-main">
        {sel ? (
          <>
            <div className="code-head">
              <span className={`lang-badge ${sel.language}`}>{sel.language === "py" ? T("Python") : sel.language === "pep" ? T("Pepino") : T("JavaScript")}</span>
              <input className="title-input" value={sel.name} onChange={(e) => rename(e.target.value)} />
              <span className="dim">{T("usato da ")}{uses} {uses === 1 ? T("oggetto") : T("oggetti")}
              </span>
              <div className="spacer" />
              {sel.language === "pep" && (
                <button type="button" className="btn small" onClick={translateScript} title={T("Riscrive lo script con le parole dell'altra lingua")}>
                  <Icon name="globe" size={13} />
                  {detectLang(sel.code) === "it" ? T(" In inglese") : T(" In italiano")}
                </button>
              )}
              {sel.language === "pep" && /^\s*(prova|test)\s+["']/m.test(sel.code) && (
                <button type="button" className="btn small" onClick={runTests} title={T("Esegue le prove scritte nello script")}>
                  <Icon name="play" size={12} />{T(" Prove")}</button>
              )}
              {sel.language !== "js" && (
                <button type="button" className={`btn small${side === "js" ? " on" : ""}`} onClick={() => setSide(side === "js" ? null : "js")}>
                  <Icon name="code" size={13} />{T(" JavaScript generato")}</button>
              )}
              <button type="button" className={`btn small${side === "guide" ? " on" : ""}`} onClick={() => setSide(side === "guide" ? null : "guide")}>
                <Icon name="book" size={13} />{T(" Guida")}</button>
              <button type="button" className="btn small danger" onClick={remove}>
                <Icon name="trash" size={13} />{T(" Elimina")}</button>
            </div>
            <CodeEditor key={sel.id} script={sel} onChange={setCode} handle={handle} />
            <Status result={result} onJump={(line) => handle.current?.jump(line)} />
          </>
        ) : (
          <div className="rules-empty">
            <h3>{T("Blocchi in codice")}</h3>
            <p>{T("Quando i blocchi pronti non bastano, scrivine uno tuo in ")}<b>{T("Pepino Language")}</b>, <b>{T("JavaScript")}</b>{T(" o in ")}<b>{T("Python")}</b>{T(". Il nuovo blocco compare nell'Inspector come tutti gli altri, e le sue azioni e condizioni si usano nelle Regole.")}</p>
            <div className="row-btns">
              <button type="button" className="btn primary" onClick={() => add("pep")}>
                <Icon name="plus" size={13} />{T(" Script Pepino")}</button>
              <button type="button" className="btn primary" onClick={() => add("js")}>
                <Icon name="plus" size={13} />{T(" Script JavaScript")}</button>
              <button type="button" className="btn primary" onClick={() => add("py")}>
                <Icon name="plus" size={13} />{T(" Script Python")}</button>
            </div>
          </div>
        )}
      </section>

      {sel && side && (
        <aside className="code-side">
          {narrow && (
            <button type="button" className="icon-btn code-side-close" title={T("Chiudi")} onClick={() => setSide(null)}>
              <Icon name="close" size={13} />
            </button>
          )}
          {side === "js" && sel.language !== "js" ? (
            <GeneratedJs code={sel.code} language={sel.language} />
          ) : sel.language === "pep" ? (
            <PepinoGuide />
          ) : (
            <Guide language={sel.language} />
          )}
        </aside>
      )}
    </div>
  );
}

function Status({ result, onJump }: { result?: ScriptResult; onJump: (line: number) => void }) {
  if (!result) return <div className="code-status dim">{T("Controllo in corso…")}</div>;
  const err = result.error;
  if (err) {
    return (
      <div className="code-status bad">
        <Icon name="bug" size={13} />
        <span>
          {err.line ? (
            <button type="button" className="linkish" onClick={() => onJump(err.line!)}>{T("Riga ")}{err.line}
            </button>
          ) : (
            T("Errore")
          )}
          : {T(err.message)}
          {result.stale && <span className="dim">{T(" · nel frattempo resta in uso l'ultima versione che funzionava")}</span>}
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
          {labels.length === 1 ? T("Blocco pronto") : T("Blocchi pronti")}: <b>{labels.join(", ")}</b>
          <span className="dim">{T(" · Inspector → Aggiungi blocco → Personalizzati")}</span>
        </span>
      ) : (
        <span className="dim">{T("Lo script non definisce blocchi.")}</span>
      )}
    </div>
  );
}

function GeneratedJs({ code, language }: { code: string; language: ScriptData["language"] }) {
  const out = useMemo(() => {
    if (language === "pep") {
      const r = compilePepino(code, getEditorLang());
      if (r.ok && r.code) return r.code;
      return r.diagnostics
        .filter((d) => d.severity === "error")
        .map((d) => `// ${T("Riga ")}${d.line}: ${d.message}`)
        .join("\n");
    }
    try {
      return compilePython(code).code;
    } catch (e) {
      return e instanceof PythonError ? `// Riga ${e.line}: ${e.reason}` : String(e);
    }
  }, [code, language]);
  return (
    <>
      <h4>{T("JavaScript generato")}</h4>
      <p>{T("È il codice che gira davvero nel gioco (anche nella build WebGL, senza Python). Sola lettura.")}</p>
      <pre className="gen-js">{out}</pre>
    </>
  );
}

function Guide({ language }: { language: ScriptData["language"] }) {
  const py = language === "py";
  return (
    <>
      <h4>{T("Come funziona")}</h4>
      {py ? (
        <p>{T("Scrivi le variabili ")}<code>name</code>, <code>label</code>, <code>props</code>{T("… e le funzioni ")}<code>init(self)</code>,{" "}
          <code>update(self, dt)</code>{T(". Pepino le traduce in JavaScript, così il gioco esportato non ha bisogno di Python.")}</p>
      ) : (
        <p>{T("Uno script definisce uno o più blocchi con ")}<code>Pepino.defineBlock({"{ … }"})</code>{T(". Ogni modifica si applica da sola dopo un attimo.")}</p>
      )}

      <h4>{T("Funzioni del blocco")}</h4>
      <dl>
        <dt>init(self)</dt>
        <dd>{T("all'avvio della scena")}</dd>
        <dt>update(self, dt)</dt>
        <dd>{T("ogni fotogramma; dt = secondi passati")}</dd>
        <dt>physics(self, dt)</dt>
        <dd>{T("passo di fisica, dopo update")}</dd>
        <dt>late(self, dt)</dt>
        <dd>{T("dopo fisica e contatti")}</dd>
        <dt>destroy(self)</dt>
        <dd>{T("quando l'oggetto sparisce")}</dd>
      </dl>

      <h4>{T("Cosa c'è in self")}</h4>
      <dl>
        <dt>self.props</dt>
        <dd>{T("i valori scelti nell'Inspector")}</dd>
        <dt>self.data</dt>
        <dd>{T("memoria del blocco (timer, contatori…)")}</dd>
        <dt>self.entity</dt>
        <dd>{T("l'oggetto: ")}<code>x</code>, <code>y</code>, <code>visible</code>, <code>state</code>, <code>facingX</code>, <code>tags</code>,{" "}
          <code>get("Blocco")</code>, <code>destroy()</code>
        </dd>
        <dt>self.body</dt>
        <dd>{T("il Corpo, se c'è: ")}<code>vx</code>, <code>vy</code>, <code>onGround</code>, <code>touching("etichetta")</code>
        </dd>
        <dt>self.scene</dt>
        <dd>
          <code>tileSize</code>, <code>time</code>, <code>find("nome")</code>, <code>findAll("etichetta")</code>,{" "}
          <code>spawn("modello", x, y)</code>
        </dd>
        <dt>self.game</dt>
        <dd>
          <code>vars</code>{T(" (variabili), ")}<code>audio.play("suono")</code>, <code>input.isDown("jump")</code>, <code>goToScene("id")</code>
        </dd>
        <dt>self.emit("evento")</dt>
        <dd>{T("le Regole lo vedono in «Quando»")}</dd>
      </dl>

      <h4>{T("Proprietà")}</h4>
      <p>{T("Tipi: number, integer, boolean, string, text, select, color, image, audio, scene, tag, group, groups, variable, prefab, dialogue, input.")}</p>
      <pre>
        {py
          ? `props = {\n    "speed": {"type": "number", "label": "Velocità",\n              "unit": "tile/s", "default": 4},\n}`
          : `props: {\n  speed: { type: "number", label: "Velocità",\n           unit: "tile/s", default: 4 },\n},`}
      </pre>

      <h4>{T("Azioni e condizioni per le Regole")}</h4>
      {py ? (
        <>
          <p>{T("Ogni voce collega una funzione con lo stesso nome. Con parametri, al posto del testo usa ")}<code>{'{"label": …, "params": {…}}'}</code>.
          </p>
          <pre>{`actions = {"salta": "Salta subito"}\nconditions = {"stanco": "È stanco"}\n\ndef salta(self):\n    ...\n\ndef stanco(self):\n    return self.data.fatica > 3`}</pre>
        </>
      ) : (
        <pre>{`actions: {\n  salta: { label: "Salta subito",\n          run: (self) => { ... } },\n},\nconditions: {\n  stanco: { label: "È stanco",\n            test: (self) => self.data.fatica > 3 },\n},`}</pre>
      )}

      <h4>{T("Aiuti")}</h4>
      {py ? (
        <p>
          <code>print(…)</code>{T(" scrive nella Console. Ci sono ")}<code>import math</code>, <code>import random</code>, <code>len</code>,{" "}
          <code>range</code>, <code>min</code>, <code>max</code>, <code>abs</code>, <code>round</code>, <code>int</code>, <code>str</code>.
        </p>
      ) : (
        <p>
          <code>Pepino.log(…)</code>{T(" scrive nella Console. Poi ")}<code>Pepino.clamp</code>, <code>Pepino.lerp</code>,{" "}
          <code>Pepino.approach</code>, <code>Pepino.lineOfSight</code>, <code>Pepino.findPath</code>.
        </p>
      )}

      {py && (
        <>
          <h4>{T("Il Python di Pepino")}</h4>
          <p>{T("Ci sono ")}<code>if/elif/else</code>, <code>for</code>, <code>while</code>, <code>def</code>{T(", liste, dizionari, f-string e slice. Non ci sono classi, ")}<code>try</code>, <code>with</code>, <code>lambda</code>{T(", comprehension e ")}<code>global</code>{T(": per ricordare valori usa ")}<code>self.data</code>{T(". I dizionari si leggono anche con il punto: ")}<code>self.data.timer</code>.
          </p>
        </>
      )}

      <h4>{T("Se qualcosa va storto")}</h4>
      <p>{T("Gli errori di scrittura sono sottolineati mentre scrivi. Se un blocco sbaglia a gioco avviato, si ferma solo quel blocco e la Console dice script e riga.")}</p>
    </>
  );
}

/** Guida veloce di Pepino Language (gli esempi nella lingua dell'editor). */
function PepinoGuide() {
  const en = getEditorLang() === "en";
  const code = (it: string, eng: string) => <pre>{en ? eng : it}</pre>;
  return (
    <>
      <h4>{T("Pepino Language")}</h4>
      <p>{T("Il linguaggio di Pepino: si scrive con parole italiane o inglesi (il pulsante in alto riscrive lo script nell'altra lingua), controlla i tipi e le unità di misura mentre scrivi, e il gioco esportato non ha bisogno di niente in più.")}</p>

      <h4>{T("Un blocco")}</h4>
      {code(
        `blocco Salto "Salto":\n    proprietà forza = 6 tile/s\n    evento saltato\n\n    quando aggiorna:\n        se gioco.appena_premuto("jump"):\n            se corpo != niente:\n                corpo.vy = -forza\n                emetti saltato`,
        `block Jump "Jump":\n    property force = 6 tile/s\n    event jumped\n\n    on update:\n        if game.pressed("jump"):\n            if body != nothing:\n                body.vy = -force\n                emit jumped`,
      )}
      <dl className="stack">
        <dt>{en ? "on start / update / end" : "quando inizia / aggiorna / finisce"}</dt>
        <dd>{T("all'avvio, a ogni fotogramma, quando l'oggetto sparisce")}</dd>
        <dt>{en ? "on touch other" : "quando tocca altro"}</dt>
        <dd>{T("quando il Corpo tocca un altro oggetto")}</dd>
        <dt>{en ? "on event name" : "quando evento nome"}</dt>
        <dd>{T("quando l'oggetto riceve quell'evento")}</dd>
        <dt>{en ? "property / event / action / condition" : "proprietà / evento / azione / condizione"}</dt>
        <dd>{T("campi dell'Inspector e voci delle Regole")}</dd>
      </dl>

      <h4>{T("Nomi pronti")}</h4>
      <dl className="stack">
        <dt>{en ? "object" : "oggetto"}</dt>
        <dd>
          <code>x</code>, <code>y</code>, <code>{en ? "visible" : "visibile"}</code>, <code>{en ? "state" : "stato"}</code>, <code>{en ? "facing" : "direzione"}</code>, <code>{en ? "has_tag(…)" : "ha_etichetta(…)"}</code>, <code>{en ? "destroy()" : "distruggi()"}</code>
        </dd>
        <dt>{en ? "body" : "corpo"}</dt>
        <dd>
          <code>vx</code>, <code>vy</code>, <code>{en ? "on_ground" : "a_terra"}</code>, <code>{en ? "touches(…)" : "tocca(…)"}</code>
          {T(" (può essere niente: scrivi «richiede Body» nel blocco per averlo sempre)")}
        </dd>
        <dt>{en ? "scene" : "scena"}</dt>
        <dd>
          <code>{en ? "find(…)" : "trova(…)"}</code>, <code>{en ? "find_all(…)" : "trova_tutti(…)"}</code>, <code>{en ? "spawn(…)" : "crea(…)"}</code>, <code>{en ? "time" : "tempo"}</code>
        </dd>
        <dt>{en ? "game" : "gioco"}</dt>
        <dd>
          <code>{en ? "variable(…)" : "variabile(…)"}</code>, <code>{en ? "set(…)" : "imposta(…)"}</code>, <code>{en ? "is_down(…)" : "premuto(…)"}</code>, <code>{en ? "play(…)" : "suona(…)"}</code>, <code>{en ? "message(…)" : "messaggio(…)"}</code>
        </dd>
        <dt>dt</dt>
        <dd>{T("i secondi del fotogramma")}</dd>
      </dl>

      <h4>{T("Unità di misura")}</h4>
      <p>
        <code>3 tile</code>, <code>2 tile/s</code>, <code>0.5 s</code>, <code>200 ms</code>, <code>90°</code>
        {T(": i conti si fanno da soli (un tile diventa pixel) e Pepino avvisa se sommi un tempo e una distanza.")}
      </p>

      <h4>{T("Aspettare")}</h4>
      {code(
        `quando inizia:\n    ripeti 3 volte:\n        oggetto.visibile = falso\n        aspetta 0.2 s\n        oggetto.visibile = vero\n        aspetta 0.2 s\n    aspetta finché oggetto.x > 100`,
        `on start:\n    repeat 3 times:\n        object.visible = false\n        wait 0.2 s\n        object.visible = true\n        wait 0.2 s\n    wait until object.x > 100`,
      )}

      <h4>{T("Le parole italiane")}</h4>
      <p>{T("Cinque parole che si scrivono uguali in italiano e in inglese:")}</p>
      <dl className="stack">
        <dt>mamma mia! "…"</dt>
        <dd>{T("un errore grave: ferma tutto e nessun «tenta» lo copre")}</dd>
        <dt>pizza Tipo:</dt>
        <dd>{T("crea un valore un ingrediente per riga: i campi di un tipo, gli elementi di una Lista, le coppie di una Mappa")}</dd>
        <dt>spaghetti valore:</dt>
        <dd>{T("una catena di passi: ogni riga riceve il risultato della riga prima (l'originale non cambia)")}</dd>
        <dt>bravo:</dt>
        <dd>{T("dopo «tenta … se errore»: parte solo se è andato tutto bene, e vede le variabili del tentativo")}</dd>
        <dt>cappuccino 2 s:</dt>
        <dd>{T("fa il blocco più tardi (o in parallelo) e intanto il codice va avanti; se l'oggetto sparisce, non arriva")}</dd>
      </dl>
      {code(
        `quando tocca altro:\n    cappuccino 1 s:\n        oggetto.distruggi()\n    nomi = spaghetti scena.trova_tutti("nemico"):\n        trasforma(n => n.nome)\n        unisci(", ")\n    se nomi = "":\n        mamma mia! "non ci sono nemici"`,
        `on touch other:\n    cappuccino 1 s:\n        object.destroy()\n    names = spaghetti scene.find_all("enemy"):\n        map(n => n.name)\n        join(", ")\n    if names = "":\n        mamma mia! "there are no enemies"`,
      )}

      <h4>{T("Memoria")}</h4>
      <p>{T("b = a fa una copia; «sposta» passa il valore senza copiarlo; i parametri sono prestiti (si leggono), con «cambia» la funzione li può modificare; «quando finisce» in un tipo parte nel momento esatto in cui il valore sparisce.")}</p>

      <h4>{T("Fuori dall'engine")}</h4>
      <p>
        {T("Lo stesso linguaggio si usa anche da solo, con il comando ")}
        <code>pepino</code>
        {T(": programmi da terminale, file, prove. Guida completa: docs/pepino.html.")}
      </p>
    </>
  );
}

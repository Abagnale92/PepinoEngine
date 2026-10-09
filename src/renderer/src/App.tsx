import { useEffect } from "react";
import { currentScene, getState, redo, reloadScripts, setState, undo, useEditor } from "./store";
import { deleteSelection, duplicateSelection, newProject, openProjectDialog, openSample, saveProject, togglePlay } from "./commands";
import { TEMPLATES } from "./templates";
import { api } from "./api";
import { Toolbar } from "./components/Toolbar";
import { Hierarchy } from "./components/Hierarchy";
import { SceneView } from "./components/SceneView";
import { Inspector } from "./components/Inspector";
import { BottomPanel } from "./components/BottomPanel";
import { PlayView } from "./components/PlayView";
import { RulesView } from "./components/RulesView";
import { Icon } from "./components/Icon";
import { PanelBoundary } from "./components/PanelBoundary";
import { Splitter, usePanelVar } from "./components/Splitter";
import { bilingual, loadSamples, useSamples } from "./samples";
import { DialoguesView } from "./components/DialoguesView";
import { CodeView } from "./components/CodeView";
import { TextsView } from "./components/TextsView";
import { PixelEditor } from "./components/PixelEditor";
import { MusicView } from "./components/MusicView";
import { CutscenesView } from "./components/CutscenesView";
import { ItemsView } from "./components/ItemsView";
import { getPixelState, pixelKey, saveDoc } from "./pixel/store";
import { SettingsDialog } from "./components/SettingsDialog";
import { getSettings, useSettings } from "./settings";
import { T } from "./i18n";

function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = getState();
      // .cm-editor = editor del codice: lì Ctrl+Z, Ctrl+D e Canc sono dell'editor di testo.
      const typing = !!(e.target as HTMLElement | null)?.closest?.("input, textarea, select, .cm-editor");
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (e.key === "F5") {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (s.playing || !s.project) return;
      if (mod && key === "s") {
        e.preventDefault();
        // Nel Disegno Ctrl+S salva anche l'immagine.
        if (s.centerTab === "paint" && getPixelState().doc) void saveDoc().then(() => saveProject());
        else saveProject();
        return;
      }
      if (typing) return;
      // Nel Disegno i tasti sono quelli della pixel art (strumenti, Annulla del disegno…).
      if (s.centerTab === "paint") {
        if (pixelKey(e)) e.preventDefault();
        return;
      }
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && key === "y") {
        e.preventDefault();
        redo();
      } else if (mod && key === "d") {
        e.preventDefault();
        duplicateSelection();
      } else if (e.key === "Delete") {
        deleteSelection();
      } else if (!mod && !e.altKey) {
        if (key === "v") setState({ tool: "select" });
        else if (key === "b") setState({ tool: "paint" });
        else if (key === "e") setState({ tool: "erase" });
        else if (key === "g") setState({ showGrid: !s.showGrid });
        else if (key === "c") setState({ showCollisions: !s.showCollisions });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function Welcome() {
  const samples = useSamples();
  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="brand big">
          <span className="brand-mark" aria-hidden="true" />{T("Pepino")}</div>
        <p>{T("Engine 2D a blocchi: crea l'oggetto, aggiungi i blocchi, premi Prova.")}</p>
        <div className="welcome-templates">
          {TEMPLATES.map((t) => (
            <button type="button" key={t.id} className="welcome-template" onClick={() => void newProject(t.id)}>
              <Icon name={t.icon} size={18} />
              <b>{T(t.label)}</b>
              <span>{T(t.description)}</span>
            </button>
          ))}
        </div>
        <div className="row-btns">
          {samples.map((s, i) => (
            <button type="button" key={s.id} className={`btn${i === 0 ? " primary" : ""}`} onClick={() => void openSample(s.id)}>
              {T("Apri «{0}»", bilingual(s.name))}
            </button>
          ))}
          <button type="button" className="btn" onClick={openProjectDialog}>{T("Apri un progetto…")}</button>
          <button type="button" className="btn ghost" onClick={() => setState({ settingsOpen: true })}>
            <Icon name="settings" size={13} /> {T("Impostazioni")}
          </button>
        </div>
        {!api.desktop && (
          <p className="dim small">{T("Editor nel browser: salvataggio, importazione ed esportazione sono nell'app desktop.")}</p>
        )}
      </div>
    </div>
  );
}

export function App() {
  const project = useEditor((s) => s.project);
  const playing = useEditor((s) => s.playing);
  const centerTab = useEditor((s) => s.centerTab);
  const sceneRules = useEditor((s) => currentScene(s)?.rules?.length ?? 0);
  const globalRules = useEditor((s) => s.project?.rules?.length ?? 0);
  const dialogueCount = useEditor((s) => s.project?.dialogues?.length ?? 0);
  const languageCount = useEditor((s) => s.project?.languages?.length ?? 0);
  const scripts = useEditor((s) => s.project?.scripts);
  const scriptErrors = useEditor((s) => s.scriptResults.filter((r) => r.error).length);
  useHotkeys();
  // Cambiando lingua tutto l'editor si ridisegna con i testi nuovi.
  useSettings((s) => s.language);
  const autosave = useSettings((s) => s.autosave);
  // Dimensioni dei pannelli scelte trascinando i divisori.
  const panelVars = {
    ...usePanelVar("--left-w", "left"),
    ...usePanelVar("--right-w", "right"),
    ...usePanelVar("--bottom-h", "bottom"),
  };

  // Salvataggio automatico (app desktop): solo se ci sono modifiche e non si sta provando il gioco.
  useEffect(() => {
    if (!autosave || !api.desktop) return;
    const iv = window.setInterval(() => {
      const s = getState();
      if (s.dirty && !s.playing && getSettings().autosave) void saveProject();
    }, autosave * 60_000);
    return () => window.clearInterval(iv);
  }, [autosave]);

  // Mentre si scrive, gli script si ricaricano appena ci si ferma un attimo.
  useEffect(() => {
    const t = window.setTimeout(() => reloadScripts(), 350);
    return () => window.clearTimeout(t);
  }, [scripts]);

  useEffect(() => {
    // All'avvio si apre il primo gioco di esempio, se c'è; altrimenti la schermata iniziale.
    void loadSamples().then(([first]) => first && openSample(first.id));
    const guard = (e: BeforeUnloadEvent) => {
      if (getState().dirty && api.desktop) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);

  if (!project) {
    return (
      <>
        <Welcome />
        <SettingsDialog />
      </>
    );
  }
  return (
    <div className={`app${playing ? " is-playing" : ""}`} style={panelVars}>
      <SettingsDialog />
      <Toolbar />
      <PanelBoundary name="Gerarchia" area="left">
        <Hierarchy />
      </PanelBoundary>
      <Splitter id="left" grid className="splitter-left" />
      <Splitter id="right" edge="end" grid className="splitter-right" />
      <Splitter id="bottom" axis="y" edge="end" grid className="splitter-bottom" />
      <main className="center">
        <div className="center-tabs">
          <button type="button" className={`ctab${centerTab === "scene" ? " on" : ""}`} onClick={() => setState({ centerTab: "scene" })}>
            <Icon name="image" size={13} />{T(" Scena")}</button>
          <button type="button" className={`ctab${centerTab === "rules" ? " on" : ""}`} onClick={() => setState({ centerTab: "rules" })}>
            <Icon name="rules" size={13} />{T(" Regole")}<span className="ctab-count" title={T("Regole della scena + regole globali")}>
              {sceneRules + globalRules}
            </span>
          </button>
          <button type="button" className={`ctab${centerTab === "dialogues" ? " on" : ""}`} onClick={() => setState({ centerTab: "dialogues" })}>
            <Icon name="chat" size={13} />{T(" Dialoghi")}<span className="ctab-count">{dialogueCount}</span>
          </button>
          <button type="button" className={`ctab${centerTab === "texts" ? " on" : ""}`} onClick={() => setState({ centerTab: "texts" })}>
            <Icon name="text" size={13} />{T(" Testi")}<span className="ctab-count" title={T("Lingue del gioco")}>
              {Math.max(1, languageCount)}
            </span>
          </button>
          <button type="button" className={`ctab${centerTab === "code" ? " on" : ""}`} onClick={() => setState({ centerTab: "code" })}>
            <Icon name="code" size={13} />{T(" Codice")}<span className={`ctab-count${scriptErrors ? " err" : ""}`} title={scriptErrors ? T("{0} script con errori", scriptErrors) : T("Script del progetto")}>
              {scripts?.length ?? 0}
            </span>
          </button>
          <button type="button" className={`ctab${centerTab === "paint" ? " on" : ""}`} onClick={() => setState({ centerTab: "paint" })}>
            <Icon name="paint" size={13} />{T(" Disegno")}</button>
          <button type="button" className={`ctab${centerTab === "music" ? " on" : ""}`} onClick={() => setState({ centerTab: "music" })}>
            <Icon name="music" size={13} />{T(" Musica")}</button>
          <button type="button" className={`ctab${centerTab === "cutscenes" ? " on" : ""}`} onClick={() => setState({ centerTab: "cutscenes" })}>
            <Icon name="film" size={13} />{T(" Filmati")}<span className="ctab-count">{project.cutscenes?.length ?? 0}</span>
          </button>
          <button type="button" className={`ctab${centerTab === "items" ? " on" : ""}`} onClick={() => setState({ centerTab: "items" })}>
            <Icon name="coin" size={13} />
            {T(" Oggetti")}
            <span className="ctab-count">{project.items?.length ?? 0}</span>
          </button>
        </div>
        <div className="center-body">
          <PanelBoundary name="Scena" fill>
            <SceneView hidden={playing || centerTab !== "scene"} />
          </PanelBoundary>
          {centerTab === "rules" && !playing && (
            <PanelBoundary name="Regole" fill>
              <RulesView />
            </PanelBoundary>
          )}
          {centerTab === "dialogues" && !playing && (
            <PanelBoundary name="Dialoghi" fill>
              <DialoguesView />
            </PanelBoundary>
          )}
          {centerTab === "texts" && !playing && (
            <PanelBoundary name="Testi" fill>
              <TextsView />
            </PanelBoundary>
          )}
          {centerTab === "code" && !playing && (
            <PanelBoundary name="Codice" fill>
              <CodeView />
            </PanelBoundary>
          )}
          {centerTab === "paint" && !playing && (
            <PanelBoundary name="Disegno" fill>
              <PixelEditor />
            </PanelBoundary>
          )}
          {centerTab === "music" && !playing && (
            <PanelBoundary name="Musica" fill>
              <MusicView />
            </PanelBoundary>
          )}
          {centerTab === "cutscenes" && !playing && (
            <PanelBoundary name="Filmati" fill>
              <CutscenesView />
            </PanelBoundary>
          )}
          {centerTab === "items" && !playing && (
            <PanelBoundary name="Oggetti" fill>
              <ItemsView />
            </PanelBoundary>
          )}
          {playing && (
            <PanelBoundary name="Anteprima" fill>
              <PlayView />
            </PanelBoundary>
          )}
        </div>
      </main>
      <PanelBoundary name="Inspector" area="right">
        <Inspector />
      </PanelBoundary>
      <PanelBoundary name="Pannello in basso" area="bottom">
        <BottomPanel />
      </PanelBoundary>
    </div>
  );
}

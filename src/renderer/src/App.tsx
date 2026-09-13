import { useEffect } from "react";
import { currentScene, getState, redo, setState, undo, useEditor } from "./store";
import { deleteSelection, duplicateSelection, openProjectDialog, openSample, saveProject, togglePlay } from "./commands";
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

function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = getState();
      const typing = !!(e.target as HTMLElement | null)?.closest?.("input, textarea, select");
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
        saveProject();
        return;
      }
      if (typing) return;
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
  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="brand big">
          <span className="brand-mark" aria-hidden="true" />
          Pepino
        </div>
        <p>Engine 2D a blocchi: crea l'oggetto, aggiungi i blocchi, premi Prova.</p>
        <div className="row-btns">
          <button type="button" className="btn primary" onClick={openSample}>
            Apri il progetto demo
          </button>
          <button type="button" className="btn" onClick={openProjectDialog}>
            Apri un progetto…
          </button>
        </div>
        {!api.desktop && (
          <p className="dim small">Editor nel browser: salvataggio, importazione ed esportazione sono nell'app desktop.</p>
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
  useHotkeys();

  useEffect(() => {
    openSample();
    const guard = (e: BeforeUnloadEvent) => {
      if (getState().dirty && api.desktop) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);

  if (!project) return <Welcome />;
  return (
    <div className={`app${playing ? " is-playing" : ""}`}>
      <Toolbar />
      <PanelBoundary name="Gerarchia" area="left">
        <Hierarchy />
      </PanelBoundary>
      <main className="center">
        <div className="center-tabs">
          <button type="button" className={`ctab${centerTab === "scene" ? " on" : ""}`} onClick={() => setState({ centerTab: "scene" })}>
            <Icon name="image" size={13} /> Scena
          </button>
          <button type="button" className={`ctab${centerTab === "rules" ? " on" : ""}`} onClick={() => setState({ centerTab: "rules" })}>
            <Icon name="rules" size={13} /> Regole
            <span className="ctab-count" title="Regole della scena + regole globali">
              {sceneRules + globalRules}
            </span>
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

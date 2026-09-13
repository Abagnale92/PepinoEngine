import { redo, setState, undo, useEditor, type Tool } from "../store";
import { exportWeb, openProjectDialog, openSample, saveProject, togglePlay } from "../commands";
import { api } from "../api";
import { Icon } from "./Icon";

const TOOLS: [Tool, string, string, string][] = [
  ["select", "select", "Seleziona e sposta", "V"],
  ["paint", "paint", "Pennello tile", "B"],
  ["erase", "erase", "Gomma", "E"],
];

export function Toolbar() {
  const project = useEditor((s) => s.project);
  const path = useEditor((s) => s.path);
  const dirty = useEditor((s) => s.dirty);
  const tool = useEditor((s) => s.tool);
  const showGrid = useEditor((s) => s.showGrid);
  const showCollisions = useEditor((s) => s.showCollisions);
  const snap = useEditor((s) => s.snap);
  const playing = useEditor((s) => s.playing);
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        Pepino
      </div>
      <div className="proj-name" title={path}>
        {project?.name}
        {dirty && (
          <span className="dirty" title="Modifiche non salvate">
            ●
          </span>
        )}
      </div>
      <div className="sep" />
      <button type="button" className="btn ghost" onClick={openProjectDialog} title="Apri un progetto">
        <Icon name="folder" /> Apri
      </button>
      <button type="button" className="btn ghost" onClick={openSample} title="Apri il progetto demo">
        Demo
      </button>
      <button type="button" className="btn ghost" onClick={saveProject} disabled={!dirty || !api.desktop} title={api.desktop ? "Salva (Ctrl+S)" : "Salvataggio disponibile nell'app desktop"}>
        <Icon name="save" /> Salva
      </button>
      <div className="sep" />
      <div className="seg">
        {TOOLS.map(([id, icon, label, key]) => (
          <button
            type="button"
            key={id}
            className={`btn${tool === id ? " on" : ""}`}
            disabled={playing}
            onClick={() => setState({ tool: id })}
            title={`${label} (${key})`}
          >
            <Icon name={icon} />
          </button>
        ))}
      </div>
      <div className="sep" />
      <button type="button" className={`btn ghost${showGrid ? " on" : ""}`} onClick={() => setState({ showGrid: !showGrid })} title="Griglia (G)">
        <Icon name="grid" />
      </button>
      <button
        type="button"
        className={`btn ghost${showCollisions ? " on" : ""}`}
        onClick={() => setState({ showCollisions: !showCollisions })}
        title="Mostra cosa è muro, piattaforma, scala o pericolo (C)"
      >
        <Icon name="collision" /> Collisioni
      </button>
      <button type="button" className={`btn ghost${snap ? " on" : ""}`} onClick={() => setState({ snap: !snap })} title="Aggancia gli oggetti alla griglia">
        <Icon name="snap" />
      </button>
      <div className="sep" />
      <button type="button" className="btn ghost" onClick={undo} disabled={!canUndo || playing} title="Annulla (Ctrl+Z)">
        <Icon name="undo" />
      </button>
      <button type="button" className="btn ghost" onClick={redo} disabled={!canRedo || playing} title="Ripeti (Ctrl+Y)">
        <Icon name="redo" />
      </button>
      <div className="spacer" />
      <button type="button" className={`btn run-btn${playing ? " stop" : " primary"}`} onClick={togglePlay} title="Prova il gioco (F5)">
        <Icon name={playing ? "stop" : "play"} />
        {playing ? "Ferma" : "Prova"}
      </button>
      <button type="button" className="btn" onClick={exportWeb} disabled={playing} title="Crea la build WebGL da pubblicare">
        <Icon name="export" /> Esporta WebGL
      </button>
    </header>
  );
}

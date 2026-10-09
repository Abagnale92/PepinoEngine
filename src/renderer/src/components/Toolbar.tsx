import { useEffect, useRef, useState } from "react";
import { redo, setState, undo, useEditor, type Tool } from "../store";
import { exportWeb, newProject, openProjectDialog, openSample, saveProject, togglePlay } from "../commands";
import { api } from "../api";
import { TEMPLATES } from "../templates";
import { bilingual, useSamples } from "../samples";
import { Icon } from "./Icon";
import { N, T } from "../i18n";

/** «Nuovo»: sceglie il modello di genere da cui partire. */
function NewProjectMenu({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div className="tb-menu" ref={ref}>
      <button type="button" className={`btn ghost${open ? " on" : ""}`} disabled={disabled} onClick={() => setOpen(!open)} title={T("Nuovo progetto da un modello")}>
        <Icon name="plus" />{T(" Nuovo")}</button>
      {open && (
        <div className="popover">
          <div className="group-label">{T("Parti da un modello")}</div>
          {TEMPLATES.map((t) => (
            <button
              type="button"
              key={t.id}
              className="menu-item"
              onClick={() => {
                setOpen(false);
                void newProject(t.id);
              }}
            >
              <b>{T(t.label)}</b>
              <span>{T(t.description)}</span>
            </button>
          ))}
          <p className="empty-hint">{api.desktop ? T("Ti chiederò una cartella vuota dove crearlo.") : T("Nel browser il modello si apre senza salvarlo.")}</p>
        </div>
      )}
    </div>
  );
}

/** «Esempi»: apre uno dei giochi di esempio (c'è solo se ce ne sono). */
function SamplesMenu({ disabled }: { disabled: boolean }) {
  const samples = useSamples();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);
  if (!samples.length) return null;
  return (
    <div className="tb-menu" ref={ref}>
      <button type="button" className={`btn ghost${open ? " on" : ""}`} disabled={disabled} onClick={() => setOpen(!open)} title={T("Apri un gioco di esempio")}>{T("Esempi")}</button>
      {open && (
        <div className="popover">
          <div className="group-label">{T("Giochi fatti con Pepino")}</div>
          {samples.map((s) => (
            <button
              type="button"
              key={s.id}
              className="menu-item"
              onClick={() => {
                setOpen(false);
                void openSample(s.id);
              }}
            >
              <b>{bilingual(s.name)}</b>
              {s.description && <span>{bilingual(s.description)}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const TOOLS: [Tool, string, string, string][] = [
  ["select", "select", N("Seleziona e sposta"), "V"],
  ["paint", "paint", N("Pennello tile"), "B"],
  ["erase", "erase", N("Gomma"), "E"],
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
        <span className="brand-mark" aria-hidden="true" />{T("Pepino")}</div>
      <div className="proj-name" title={path}>
        {project?.name}
        {dirty && (
          <span className="dirty" title={T("Modifiche non salvate")}>
            ●
          </span>
        )}
      </div>
      <div className="sep" />
      <NewProjectMenu disabled={playing} />
      <button type="button" className="btn ghost" onClick={openProjectDialog} title={T("Apri un progetto")}>
        <Icon name="folder" />{T(" Apri")}</button>
      <SamplesMenu disabled={playing} />
      <button type="button" className="btn ghost" onClick={saveProject} disabled={!dirty || !api.desktop} title={api.desktop ? T("Salva (Ctrl+S)") : T("Salvataggio disponibile nell'app desktop")}>
        <Icon name="save" />{T(" Salva")}</button>
      <div className="sep" />
      <div className="seg">
        {TOOLS.map(([id, icon, label, key]) => (
          <button
            type="button"
            key={id}
            className={`btn${tool === id ? " on" : ""}`}
            disabled={playing}
            onClick={() => setState({ tool: id })}
            title={`${T(label)} (${key})`}
          >
            <Icon name={icon} />
          </button>
        ))}
      </div>
      <div className="sep" />
      <button type="button" className={`btn ghost${showGrid ? " on" : ""}`} onClick={() => setState({ showGrid: !showGrid })} title={T("Griglia (G)")}>
        <Icon name="grid" />
      </button>
      <button
        type="button"
        className={`btn ghost${showCollisions ? " on" : ""}`}
        onClick={() => setState({ showCollisions: !showCollisions })}
        title={T("Mostra cosa è muro, piattaforma, scala o pericolo (C)")}
      >
        <Icon name="collision" />{T(" Collisioni")}</button>
      <button type="button" className={`btn ghost${snap ? " on" : ""}`} onClick={() => setState({ snap: !snap })} title={T("Aggancia gli oggetti alla griglia")}>
        <Icon name="snap" />
      </button>
      <div className="sep" />
      <button type="button" className="btn ghost" onClick={undo} disabled={!canUndo || playing} title={T("Annulla (Ctrl+Z)")}>
        <Icon name="undo" />
      </button>
      <button type="button" className="btn ghost" onClick={redo} disabled={!canRedo || playing} title={T("Ripeti (Ctrl+Y)")}>
        <Icon name="redo" />
      </button>
      <div className="spacer" />
      <button type="button" className="btn ghost" onClick={() => setState({ settingsOpen: true })} title={T("Impostazioni")}>
        <Icon name="settings" />
      </button>
      <button type="button" className={`btn run-btn${playing ? " stop" : " primary"}`} onClick={togglePlay} title={T("Prova il gioco (F5)")}>
        <Icon name={playing ? "stop" : "play"} />
        {playing ? T("Ferma") : T("Prova")}
      </button>
      <button type="button" className="btn" onClick={exportWeb} disabled={playing} title={T("Crea la build WebGL da pubblicare")}>
        <Icon name="export" />{T(" Esporta WebGL")}</button>
    </header>
  );
}

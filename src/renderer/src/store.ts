import { useSyncExternalStore } from "react";
import { loadScripts, setScriptLogger, type LogLevel, type ProjectData, type SceneData, type ScriptResult } from "@runtime";
import type { OpenedProject } from "./api";
import { findEntity } from "./projectOps";

export type Selection =
  | { kind: "entity"; id: string }
  | { kind: "layer"; id: string }
  | { kind: "prefab"; id: string }
  | { kind: "asset"; id: string }
  | null;

export type Tool = "select" | "paint" | "erase";
export type BottomTab = "tiles" | "prefabs" | "assets" | "console";
export type CenterTab = "scene" | "rules" | "dialogues" | "code";
export type RulesScope = "scene" | "global";

/** A cosa si riferisce un messaggio della Console: con un clic l'editor ci porta lì. */
export interface LogTarget {
  sceneId?: string;
  entityId?: string;
  prefabId?: string;
  ruleId?: string;
  scriptId?: string;
}

export interface LogEntry {
  id: number;
  level: LogLevel;
  message: string;
  time: number;
  target?: LogTarget;
}

export interface EditorState {
  project: ProjectData | null;
  path: string;
  baseUrl: string;
  dirty: boolean;
  sceneId: string;
  /** null = impostazioni di scena e progetto. */
  selection: Selection;
  tool: Tool;
  layerId: string;
  tile: number;
  showGrid: boolean;
  showCollisions: boolean;
  snap: boolean;
  playing: boolean;
  logs: LogEntry[];
  canUndo: boolean;
  canRedo: boolean;
  bottomTab: BottomTab;
  centerTab: CenterTab;
  rulesScope: RulesScope;
  /** Esito dell'ultimo caricamento degli script del progetto. */
  scriptResults: ScriptResult[];
  /** Cresce quando cambiano i blocchi personalizzati: Inspector e Regole si ridisegnano. */
  blocksVersion: number;
  /** Script aperto nella scheda Codice. */
  codeScriptId: string;
}

let state: EditorState = {
  project: null,
  path: "",
  baseUrl: "",
  dirty: false,
  sceneId: "",
  selection: null,
  tool: "select",
  layerId: "",
  tile: 0,
  showGrid: true,
  showCollisions: false,
  snap: true,
  playing: false,
  logs: [],
  canUndo: false,
  canRedo: false,
  bottomTab: "tiles",
  centerTab: "scene",
  rulesScope: "scene",
  scriptResults: [],
  blocksVersion: 0,
  codeScriptId: "",
};

const listeners = new Set<() => void>();
const past: ProjectData[] = [];
const future: ProjectData[] = [];
let lastMerge: string | null = null;
let logId = 0;

/** Centro della vista scena, aggiornato dalla SceneView (per piazzare nuovi oggetti). */
export const viewInfo = { cx: 0, cy: 0 };

export const getState = () => state;

export function setState(patch: Partial<EditorState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Il selettore deve restituire valori stabili (campi dello stato, non oggetti nuovi). */
export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

export function currentScene(s: EditorState): SceneData | undefined {
  return s.project?.scenes.find((x) => x.id === s.sceneId) ?? s.project?.scenes[0];
}

/** Riallinea scena, layer e selezione dopo un cambio (annulla, eliminazioni…). */
function sanitize(p: ProjectData, s: EditorState): Partial<EditorState> {
  const patch: Partial<EditorState> = {};
  const scene = p.scenes.find((x) => x.id === s.sceneId) ?? p.scenes[0];
  if (scene && scene.id !== s.sceneId) patch.sceneId = scene.id;
  if (scene && !scene.layers.some((l) => l.id === s.layerId)) {
    patch.layerId = (scene.layers.find((l) => l.collides) ?? scene.layers[0])?.id ?? "";
  }
  const sel = s.selection;
  if (sel) {
    const ok =
      sel.kind === "entity"
        ? !!scene && !!findEntity(scene.entities, sel.id)
        : sel.kind === "layer"
          ? !!scene?.layers.some((l) => l.id === sel.id)
          : sel.kind === "prefab"
            ? p.prefabs.some((x) => x.id === sel.id)
            : p.assets.some((a) => a.id === sel.id);
    if (!ok) patch.selection = null;
  }
  return patch;
}

/**
 * Modifica il progetto registrando la storia per Annulla/Ripeti.
 * Modifiche consecutive con la stessa `merge` (trascinamento, pennellata, digitazione) diventano un solo passo.
 */
export function editProject(fn: (p: ProjectData) => void, merge?: string): void {
  if (!state.project) return;
  const next = structuredClone(state.project);
  fn(next);
  if (!merge || merge !== lastMerge) {
    past.push(state.project);
    if (past.length > 200) past.shift();
  }
  lastMerge = merge ?? null;
  future.length = 0;
  setState({ project: next, dirty: true, canUndo: true, canRedo: false, ...sanitize(next, state) });
}

export function undo(): void {
  const prev = past.pop();
  if (!prev || !state.project) return;
  future.push(state.project);
  lastMerge = null;
  setState({ project: prev, dirty: true, canUndo: past.length > 0, canRedo: true, ...sanitize(prev, state) });
}

export function redo(): void {
  const next = future.pop();
  if (!next || !state.project) return;
  past.push(state.project);
  lastMerge = null;
  setState({ project: next, dirty: true, canUndo: true, canRedo: future.length > 0, ...sanitize(next, state) });
}

export function loadProject(o: OpenedProject): void {
  past.length = 0;
  future.length = 0;
  lastMerge = null;
  const p = o.data;
  const scene = p.scenes.find((s) => s.id === p.settings.startScene) ?? p.scenes[0];
  setState({
    project: p,
    path: o.path,
    baseUrl: o.baseUrl,
    dirty: false,
    sceneId: scene?.id ?? "",
    layerId: (scene?.layers.find((l) => l.collides) ?? scene?.layers[0])?.id ?? "",
    selection: null,
    tool: "select",
    tile: 0,
    playing: false,
    canUndo: false,
    canRedo: false,
    codeScriptId: p.scripts?.[0]?.id ?? "",
  });
  reloadScripts(true);
}

let scriptsKey: string | null = null;

/**
 * Ricarica i blocchi scritti negli script del progetto, se il codice è cambiato.
 * `fresh` = progetto appena aperto: non si tengono blocchi del progetto precedente.
 */
export function reloadScripts(fresh = false): void {
  const scripts = state.project?.scripts ?? [];
  const key = JSON.stringify(scripts);
  if (!fresh && key === scriptsKey) return;
  scriptsKey = key;
  setScriptLogger((m) => log("info", m));
  const results = loadScripts(scripts, { keepOnError: !fresh });
  setState({ scriptResults: results, blocksVersion: state.blocksVersion + 1 });
}

export function log(level: LogLevel, message: string, target?: LogTarget): void {
  setState({ logs: [...state.logs.slice(-299), { id: ++logId, level, message, time: Date.now(), target }] });
}

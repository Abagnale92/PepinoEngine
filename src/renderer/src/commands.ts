import { validateProject, type BlockData, type EntityData } from "@runtime";
import { api } from "./api";
import { currentScene, editProject, getState, loadProject, log, setState, viewInfo } from "./store";
import { assetUses, collectIds, effectiveBlocks, findEntity, prefabUses, removeEntity, replaceAssetRefs, sceneOf, uniqueId } from "./projectOps";
import { T, Twhere } from "./i18n";
import { getSettings } from "./settings";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function openSample(id: string): Promise<void> {
  try {
    const p = await api.openSample(id);
    if (p) {
      loadProject(p);
      log("info", T("Aperto il progetto «{0}»", p.data.name));
    }
  } catch (e) {
    log("error", message(e));
  }
}

export async function newProject(template: string): Promise<void> {
  try {
    const p = await api.newProject(template);
    if (p) {
      loadProject(p);
      log(
        "info",
        api.desktop ? T("Creato il progetto «{0}» in {1}", p.data.name, p.path) : T("Aperto il modello «{0}» (nel browser non si salva)", p.data.name),
      );
    }
  } catch (e) {
    log("error", message(e));
  }
}

export async function openProjectDialog(): Promise<void> {
  try {
    const p = await api.openProject();
    if (p) {
      loadProject(p);
      log("info", T("Aperto il progetto «{0}»", p.data.name));
    }
  } catch (e) {
    log("error", message(e));
  }
}

export async function saveProject(): Promise<boolean> {
  const s = getState();
  if (!s.project) return false;
  try {
    const res = await api.saveProject(s.project);
    if (res.ok) {
      setState({ dirty: false });
      log("info", T("Progetto salvato"));
      return true;
    }
    log("warn", T(res.message ?? "Salvataggio non riuscito"));
  } catch (e) {
    log("error", message(e));
  }
  return false;
}

/** Controlla il progetto e scrive i problemi in Console. Restituisce il numero di errori. */
export function checkProject(report = true): number {
  const p = getState().project;
  if (!p) return 0;
  const issues = validateProject(p);
  for (const i of issues) {
    log(i.level, `${Twhere(i.where)}: ${T(i.message)}`, {
      sceneId: i.sceneId,
      entityId: i.entityId,
      prefabId: i.prefabId,
      ruleId: i.ruleId,
      scriptId: i.scriptId,
      language: i.language,
    });
  }
  const errors = issues.filter((i) => i.level === "error").length;
  if (report) {
    log(
      "info",
      issues.length ? T("Controllo completato: {0} errori, {1} avvisi.", errors, issues.length - errors) : T("Controllo completato: nessun problema."),
    );
  }
  return errors;
}

export function togglePlay(): void {
  const s = getState();
  if (!s.project) return;
  if (!s.playing && getSettings().checkBeforePlay) {
    const errors = checkProject(false);
    if (errors > 0) {
      log("warn", T("Il progetto ha {0} errori: l'anteprima parte lo stesso, ma qualcosa potrebbe non funzionare.", errors));
      setState({ bottomTab: "console" });
    }
  }
  setState({ playing: !s.playing });
}

export async function exportWeb(): Promise<void> {
  const s = getState();
  if (!s.project) return;
  if (s.dirty && !(await saveProject())) return;
  try {
    const res = await api.exportWeb(getState().project!);
    if (!res) return;
    if (res.error) log("error", T(res.error));
    else if (res.dir) {
      for (const src of res.skipped ?? []) log("warn", T("Asset non copiato nella build (file mancante o fuori dal progetto): {0}", src));
      log("info", T("Build WebGL pronta in {0}. Caricala su itch.io o aprila con un server web.", res.dir));
      api.reveal(res.dir);
    }
  } catch (e) {
    log("error", message(e));
  }
}

export async function importAssets(): Promise<void> {
  if (!api.desktop) {
    log("warn", T("L'importazione di file è disponibile nell'app desktop."));
    return;
  }
  try {
    const list = await api.importAssets();
    if (!list?.length) return;
    editProject((p) => {
      const ids = new Set(p.assets.map((a) => a.id));
      for (const a of list) {
        const id = uniqueId(a.id, ids);
        ids.add(id);
        p.assets.push({ id, type: a.type, src: a.src });
      }
    });
    log("info", T("Importati {0} file", list.length));
  } catch (e) {
    log("error", message(e));
  }
}

export function switchScene(id: string): void {
  const scene = getState().project?.scenes.find((s) => s.id === id);
  if (!scene) return;
  setState({
    sceneId: id,
    selection: null,
    layerId: (scene.layers.find((l) => l.collides) ?? scene.layers[0])?.id ?? "",
  });
}

export function addScene(): void {
  const p = getState().project;
  if (!p) return;
  const id = uniqueId("scena", new Set(p.scenes.map((s) => s.id)));
  const w = 40;
  const h = 17;
  editProject((d) => {
    d.scenes.push({
      id,
      name: T("Nuova scena {0}", d.scenes.length + 1),
      width: w,
      height: h,
      background: d.settings.background,
      layers: [
        {
          id: "terreno",
          name: "Terreno",
          tileset: d.tilesets[0]?.id ?? "",
          width: w,
          height: h,
          data: new Array(w * h).fill(-1),
          z: 0,
          collides: true,
          visible: true,
          locked: false,
          parallax: 1,
        },
      ],
      entities: [],
    });
  });
  switchScene(id);
}

export function addLayer(): void {
  const s = getState();
  const scene = currentScene(s);
  if (!scene || !s.project) return;
  const id = uniqueId("layer", new Set(scene.layers.map((l) => l.id)));
  editProject((p) => {
    const sc = sceneOf(p, scene.id)!;
    sc.layers.push({
      id,
      name: `Layer ${sc.layers.length + 1}`,
      tileset: p.tilesets[0]?.id ?? "",
      width: sc.width,
      height: sc.height,
      data: new Array(sc.width * sc.height).fill(-1),
      z: Math.max(0, ...sc.layers.map((l) => l.z)) + 1,
      collides: false,
      visible: true,
      locked: false,
      parallax: 1,
    });
  });
  setState({ layerId: id, selection: { kind: "layer", id } });
}

export function addEntityAt(x: number, y: number, name: string, blocks: BlockData[], prefab?: string): void {
  const scene = currentScene(getState());
  if (!scene) return;
  const id = uniqueId(name, collectIds(scene));
  editProject((p) => {
    const e: EntityData = { id, name, x: Math.round(x), y: Math.round(y), blocks };
    if (prefab) e.prefab = prefab;
    sceneOf(p, scene.id)!.entities.push(e);
  });
  setState({ selection: { kind: "entity", id }, tool: "select" });
}

export function addEmptyEntity(): void {
  const ts = getState().project?.settings.tileSize ?? 16;
  addEntityAt(Math.round(viewInfo.cx / ts) * ts, Math.round(viewInfo.cy / ts) * ts, T("Oggetto"), []);
}

export function deleteSelection(): void {
  const s = getState();
  const sel = s.selection;
  const scene = currentScene(s);
  if (!sel || !scene || !s.project) return;
  if (sel.kind === "entity") {
    editProject((p) => removeEntity(sceneOf(p, scene.id)!.entities, sel.id));
    setState({ selection: null });
  } else if (sel.kind === "layer") {
    if (scene.layers.length <= 1) return log("warn", T("Una scena deve avere almeno un layer."));
    editProject((p) => {
      const sc = sceneOf(p, scene.id)!;
      sc.layers = sc.layers.filter((l) => l.id !== sel.id);
    });
    setState({ selection: null });
  } else if (sel.kind === "prefab") {
    const uses = prefabUses(s.project, sel.id);
    if (uses > 0) return log("warn", T("Il modello è usato da {0} oggetti: scollegali prima di eliminarlo.", uses));
    editProject((p) => {
      p.prefabs = p.prefabs.filter((x) => x.id !== sel.id);
    });
    setState({ selection: null });
  } else if (sel.kind === "asset") {
    deleteAsset(sel.id);
  }
}

/**
 * Toglie un asset dal progetto (il file resta nella cartella). Se qualcosa lo usa lo chiede prima,
 * poi svuota quei campi; l'immagine di un tileset non si può togliere.
 */
export function deleteAsset(id: string): boolean {
  const s = getState();
  const a = s.project?.assets.find((x) => x.id === id);
  if (!s.project || !a) return false;
  if (a.type === "image" && s.project.tilesets.some((t) => t.image === id)) {
    log("warn", T("L'immagine «{0}» è usata da un tileset: non si può eliminare.", id));
    return false;
  }
  const uses = assetUses(s.project, id);
  if (uses > 0 && !window.confirm(T("«{0}» è usato in {1} punti del progetto: quei campi resteranno vuoti. Eliminarlo lo stesso?", id, uses))) return false;
  editProject((p) => {
    replaceAssetRefs(p, a.type, id, "");
    p.assets = p.assets.filter((x) => x.id !== id);
  });
  if (getState().selection?.kind === "asset" && getState().selection?.id === id) setState({ selection: null });
  log("info", T("Asset «{0}» tolto dal progetto (il file resta nella cartella del progetto).", id));
  return true;
}

export function duplicateSelection(): void {
  const s = getState();
  const sel = s.selection;
  const scene = currentScene(s);
  if (sel?.kind !== "entity" || !scene) return;
  const src = findEntity(scene.entities, sel.id);
  if (!src) return;
  const taken = collectIds(scene);
  const copy = structuredClone(src);
  const reId = (e: EntityData) => {
    e.id = uniqueId(e.name, taken);
    taken.add(e.id);
    e.children?.forEach(reId);
  };
  reId(copy);
  copy.x += s.project?.settings.tileSize ?? 16;
  editProject((p) => sceneOf(p, scene.id)!.entities.push(copy));
  setState({ selection: { kind: "entity", id: copy.id } });
}

/** Trasforma l'oggetto in un modello riutilizzabile (come un Prefab di Unity). */
export function createPrefabFromEntity(id: string): void {
  const s = getState();
  const scene = currentScene(s);
  if (!scene || !s.project) return;
  const e = findEntity(scene.entities, id);
  if (!e) return;
  const pid = uniqueId(e.name, new Set(s.project.prefabs.map((p) => p.id)));
  const blocks = structuredClone(effectiveBlocks(s.project, e));
  editProject((p) => {
    p.prefabs.push({ id: pid, name: e.name, tags: e.tags ?? [], z: e.z, blocks });
    const ent = findEntity(sceneOf(p, scene.id)!.entities, id)!;
    ent.prefab = pid;
    ent.blocks = [];
    delete ent.tags;
  });
  log("info", T("Creato il modello «{0}»: trascinalo dal pannello Modelli per piazzarne altri.", e.name));
}

/** L'oggetto smette di seguire il modello e ne copia i blocchi. */
export function unlinkPrefab(id: string): void {
  const s = getState();
  const scene = currentScene(s);
  if (!scene || !s.project) return;
  const e = findEntity(scene.entities, id);
  if (!e?.prefab) return;
  const prefab = s.project.prefabs.find((p) => p.id === e.prefab);
  const blocks = structuredClone(effectiveBlocks(s.project, e));
  editProject((p) => {
    const ent = findEntity(sceneOf(p, scene.id)!.entities, id)!;
    ent.blocks = blocks;
    ent.tags = [...new Set([...(prefab?.tags ?? []), ...(ent.tags ?? [])])];
    delete ent.prefab;
  });
}

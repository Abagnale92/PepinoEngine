import { currentScene, editProject, setState, useEditor } from "../store";
import { entityKind, flattenEntities, sceneOf, type EntityKind } from "../projectOps";
import { addEmptyEntity, addLayer, addScene, switchScene } from "../commands";
import { Icon } from "./Icon";
import { T } from "../i18n";

const KIND_ICON: Record<EntityKind, string> = {
  player: "person",
  enemy: "enemy",
  item: "coin",
  text: "text",
  exit: "door",
  object: "cube",
};

export function Hierarchy() {
  const project = useEditor((s) => s.project)!;
  const scene = useEditor(currentScene);
  const selection = useEditor((s) => s.selection);
  const layerId = useEditor((s) => s.layerId);
  if (!scene) return <aside className="panel hierarchy" />;
  const items = flattenEntities(scene.entities);

  const toggleLayer = (id: string, key: "visible" | "locked") =>
    editProject((p) => {
      const l = sceneOf(p, scene.id)!.layers.find((x) => x.id === id)!;
      if (key === "visible") l.visible = l.visible === false;
      else l.locked = !l.locked;
    });

  return (
    <aside className="panel hierarchy">
      <div className="panel-h">
        <Icon name="layers" size={13} />{T("Gerarchia")}</div>
      <div className="panel-body">
        <div className="scene-picker">
          <select value={scene.id} onChange={(e) => switchScene(e.target.value)} title={T("Scena aperta")}>
            {project.scenes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.id === project.settings.startScene ? T("  (iniziale)") : ""}
              </option>
            ))}
          </select>
          <button type="button" className="icon-btn" title={T("Nuova scena")} onClick={addScene}>
            <Icon name="plus" size={14} />
          </button>
        </div>
        <button type="button" className={`tree-row settings${selection === null ? " on" : ""}`} onClick={() => setState({ selection: null })}>
          <Icon name="settings" size={13} />
          <span className="tree-name">{T("Impostazioni scena e progetto")}</span>
        </button>

        <div className="tree-h">
          <span>{T("Layer")}</span>
          <button type="button" className="icon-btn" title={T("Nuovo layer")} onClick={addLayer}>
            <Icon name="plus" size={13} />
          </button>
        </div>
        {[...scene.layers]
          .sort((a, b) => b.z - a.z)
          .map((l) => (
            <div
              key={l.id}
              className={`tree-row layer${selection?.kind === "layer" && selection.id === l.id ? " on" : ""}${l.id === layerId ? " active" : ""}${l.visible === false ? " hidden-layer" : ""}`}
              onClick={() => setState({ layerId: l.id, selection: { kind: "layer", id: l.id } })}
              title={l.id === layerId ? T("Il pennello dipinge su questo layer") : T("Clic per dipingere su questo layer")}
            >
              <button
                type="button"
                className="icon-btn"
                title={l.visible === false ? T("Mostra") : T("Nascondi")}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLayer(l.id, "visible");
                }}
              >
                <Icon name={l.visible === false ? "eyeOff" : "eye"} size={13} />
              </button>
              <button
                type="button"
                className={`icon-btn${l.locked ? " warn" : ""}`}
                title={l.locked ? T("Sblocca") : T("Blocca")}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLayer(l.id, "locked");
                }}
              >
                <Icon name={l.locked ? "lock" : "unlock"} size={13} />
              </button>
              <span className="tree-name">{l.name}</span>
              {l.collides && (
                <span className="badge coll" title={T("I tile di questo layer contano per le collisioni")}>{T("collide")}</span>
              )}
              {l.id === layerId && <Icon name="paint" size={12} className="active-mark" />}
            </div>
          ))}

        <div className="tree-h">
          <span>{T("Oggetti · ")}{items.length}</span>
          <button type="button" className="icon-btn" title={T("Nuovo oggetto vuoto")} onClick={addEmptyEntity}>
            <Icon name="plus" size={13} />
          </button>
        </div>
        {items.map(({ data, depth }) => {
          const kind = entityKind(project, data);
          return (
            <div
              key={data.id}
              className={`tree-row${selection?.kind === "entity" && selection.id === data.id ? " on" : ""}`}
              style={{ paddingLeft: 10 + depth * 14 }}
              onClick={() => setState({ selection: { kind: "entity", id: data.id } })}
            >
              <span className={`kind-dot ${kind}`}>
                <Icon name={KIND_ICON[kind]} size={12} />
              </span>
              <span className="tree-name">{data.name}</span>
              {data.prefab && (
                <span className="badge" title={T("Istanza di un modello")}>{T("modello")}</span>
              )}
            </div>
          );
        })}
        {items.length === 0 && <p className="empty-hint">{T("Scena vuota. Trascina un modello dal pannello Modelli.")}</p>}
      </div>
    </aside>
  );
}

import { useEffect, useRef } from "react";
import { COLLISION_TYPES, type CollisionType, type TilesetData } from "@runtime";
import { currentScene, editProject, setState, useEditor, type BottomTab } from "../store";
import { assetUrl, prefabUses, spriteOf, uniqueId } from "../projectOps";
import { checkProject, importAssets, switchScene } from "../commands";
import type { LogTarget } from "../store";
import { api } from "../api";
import { Icon } from "./Icon";
import { FrameThumb, loadImage } from "./thumbs";

const TABS: [BottomTab, string, string][] = [
  ["tiles", "Tileset", "grid"],
  ["prefabs", "Modelli", "link"],
  ["assets", "Asset", "image"],
  ["console", "Console", "bug"],
];

export function BottomPanel() {
  const tab = useEditor((s) => s.bottomTab);
  const logs = useEditor((s) => s.logs);
  const errors = logs.filter((l) => l.level === "error").length;
  return (
    <section className="panel bottom">
      <div className="tabs">
        {TABS.map(([id, label, icon]) => (
          <button type="button" key={id} className={`tab${tab === id ? " on" : ""}`} onClick={() => setState({ bottomTab: id })}>
            <Icon name={icon} size={13} />
            {label}
            {id === "console" && errors > 0 && <span className="count">{errors}</span>}
          </button>
        ))}
      </div>
      <div className="tab-body">
        {tab === "tiles" && <TilesetTab />}
        {tab === "prefabs" && <PrefabsTab />}
        {tab === "assets" && <AssetsTab />}
        {tab === "console" && <ConsoleTab />}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ Tileset

const SCALE = 3;

function TilePalette({ url, tileset, selected, onSelect }: { url: string; tileset: TilesetData; selected: number; onSelect: (i: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    loadImage(url)
      .then((img) => {
        const c = ref.current;
        if (!alive || !c) return;
        const s = tileset.tileSize;
        const cols = tileset.columns;
        const rows = Math.ceil(tileset.count / cols);
        const cell = s * SCALE;
        c.width = cols * cell;
        c.height = rows * cell;
        const g = c.getContext("2d")!;
        g.imageSmoothingEnabled = false;
        for (let i = 0; i < cols * rows; i++) {
          const x = (i % cols) * cell;
          const y = Math.floor(i / cols) * cell;
          g.fillStyle = (Math.floor(i / cols) + i) % 2 ? "#1d241d" : "#232b23";
          g.fillRect(x, y, cell, cell);
        }
        g.drawImage(img, 0, 0, cols * s, rows * s, 0, 0, cols * cell, rows * cell);
        for (let i = 0; i < tileset.count; i++) {
          const x = (i % cols) * cell;
          const y = Math.floor(i / cols) * cell;
          const coll = tileset.tiles[i]?.collision;
          const info = coll && coll !== "none" ? COLLISION_TYPES.find((t) => t.id === coll) : undefined;
          if (info) {
            g.fillStyle = info.color;
            g.fillRect(x + 2, y + cell - 6, cell - 4, 4);
          }
          if (i === selected) {
            g.strokeStyle = "#8cc480";
            g.lineWidth = 3;
            g.strokeRect(x + 1.5, y + 1.5, cell - 3, cell - 3);
          }
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url, tileset, selected]);
  return (
    <canvas
      ref={ref}
      className="palette"
      onClick={(e) => {
        const c = ref.current!;
        const rect = c.getBoundingClientRect();
        const cell = tileset.tileSize * SCALE;
        const col = Math.floor(((e.clientX - rect.left) * (c.width / rect.width)) / cell);
        const row = Math.floor(((e.clientY - rect.top) * (c.height / rect.height)) / cell);
        const i = row * tileset.columns + col;
        if (i >= 0 && i < tileset.count) onSelect(i);
      }}
    />
  );
}

function TilesetTab() {
  const project = useEditor((s) => s.project)!;
  const scene = useEditor(currentScene);
  const baseUrl = useEditor((s) => s.baseUrl);
  const layerId = useEditor((s) => s.layerId);
  const tile = useEditor((s) => s.tile);
  const tool = useEditor((s) => s.tool);
  const layer = scene?.layers.find((l) => l.id === layerId);
  const tileset = project.tilesets.find((t) => t.id === (layer?.tileset ?? project.tilesets[0]?.id));
  if (!tileset || !scene) return <p className="empty-hint">Il progetto non ha tileset.</p>;
  const img = project.assets.find((a) => a.id === tileset.image);
  const coll: CollisionType = tileset.tiles[tile]?.collision ?? "none";

  const setCollision = (type: CollisionType) =>
    editProject((p) => {
      const t = p.tilesets.find((x) => x.id === tileset.id)!;
      if (type === "none") delete t.tiles[tile];
      else t.tiles[tile] = { ...t.tiles[tile], collision: type };
    });

  return (
    <div className="tiles-tab">
      <div className="tiles-side">
        <label className="mini-label">Dipingi sul layer</label>
        <select value={layerId} onChange={(e) => setState({ layerId: e.target.value })}>
          {[...scene.layers]
            .sort((a, b) => b.z - a.z)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.collides ? " (collide)" : ""}
              </option>
            ))}
        </select>
        <div className="seg">
          <button type="button" className={`btn small${tool === "paint" ? " on" : ""}`} onClick={() => setState({ tool: "paint" })}>
            <Icon name="paint" size={13} /> Pennello
          </button>
          <button type="button" className={`btn small${tool === "erase" ? " on" : ""}`} onClick={() => setState({ tool: "erase" })}>
            <Icon name="erase" size={13} /> Gomma
          </button>
        </div>
        {layer && !layer.collides && (
          <p className="empty-hint">Questo layer è solo decorativo: i suoi tile non bloccano nessuno.</p>
        )}
      </div>
      <div className="palette-wrap">
        {img && <TilePalette url={assetUrl(baseUrl, img.src)} tileset={tileset} selected={tile} onSelect={(i) => setState({ tile: i, tool: "paint" })} />}
      </div>
      <div className="tiles-info">
        <div className="mini-label">
          Tile n° {tile} · cosa fa quando lo tocchi
        </div>
        <div className="coll-options">
          {COLLISION_TYPES.map((c) => (
            <button type="button" key={c.id} className={`coll-opt${coll === c.id ? " on" : ""}`} onClick={() => setCollision(c.id)}>
              <i style={{ background: c.id === "none" ? "transparent" : c.color }} />
              {c.label}
            </button>
          ))}
        </div>
        <p className="empty-hint">
          Il colore sotto ogni tile dice cosa fa. Nella scena attiva <b>Collisioni</b> (C) per vederlo sui livelli.
        </p>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Modelli

function PrefabsTab() {
  const project = useEditor((s) => s.project)!;
  const baseUrl = useEditor((s) => s.baseUrl);
  const selection = useEditor((s) => s.selection);
  const newPrefab = () => {
    const id = uniqueId("modello", new Set(project.prefabs.map((p) => p.id)));
    editProject((p) => void p.prefabs.push({ id, name: "Nuovo modello", tags: [], blocks: [{ type: "Sprite", props: {} }] }));
    setState({ selection: { kind: "prefab", id } });
  };
  return (
    <div className="cards">
      {project.prefabs.map((pf) => {
        const sp = spriteOf(project, pf.blocks);
        const a = sp?.asset;
        return (
          <div
            key={pf.id}
            className={`card${selection?.kind === "prefab" && selection.id === pf.id ? " on" : ""}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/x-pepino-prefab", pf.id);
              e.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => setState({ selection: { kind: "prefab", id: pf.id } })}
            title="Trascina nella scena per piazzarlo"
          >
            <div className="card-thumb checker">
              {a ? (
                <FrameThumb url={assetUrl(baseUrl, a.src)} sw={a.frameWidth} sh={a.frameHeight} frame={sp.frame} size={44} />
              ) : (
                <Icon name="cube" size={24} />
              )}
            </div>
            <span className="card-name">{pf.name}</span>
            <span className="card-sub">{prefabUses(project, pf.id)} in scena</span>
          </div>
        );
      })}
      <button type="button" className="card add" onClick={newPrefab}>
        <Icon name="plus" size={20} />
        <span className="card-name">Nuovo modello</span>
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ Asset

function AssetsTab() {
  const project = useEditor((s) => s.project)!;
  const baseUrl = useEditor((s) => s.baseUrl);
  const selection = useEditor((s) => s.selection);
  return (
    <div className="cards">
      {project.assets.map((a) => (
        <div
          key={a.id}
          className={`card${selection?.kind === "asset" && selection.id === a.id ? " on" : ""}`}
          draggable={a.type === "image"}
          onDragStart={(e) => {
            e.dataTransfer.setData("application/x-pepino-image", a.id);
            e.dataTransfer.effectAllowed = "copy";
          }}
          onClick={() => setState({ selection: { kind: "asset", id: a.id } })}
        >
          <div className="card-thumb checker">
            {a.type === "image" ? (
              <FrameThumb url={assetUrl(baseUrl, a.src)} sw={a.frameWidth} sh={a.frameHeight} frame={0} size={44} />
            ) : (
              <Icon name="sound" size={24} />
            )}
          </div>
          <span className="card-name">{a.id}</span>
          <span className="card-sub">
            {a.type === "image" ? (a.animations ? `${Object.keys(a.animations).length} animazioni` : "immagine") : "audio"}
          </span>
        </div>
      ))}
      <button type="button" className="card add" onClick={importAssets} title={api.desktop ? "" : "Disponibile nell'app desktop"}>
        <Icon name="plus" size={20} />
        <span className="card-name">Importa…</span>
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ Console

/** Porta l'editor all'oggetto, al modello o alla regola a cui si riferisce un messaggio. */
function goTo(t?: LogTarget) {
  if (!t) return;
  if (t.prefabId && !t.sceneId) {
    setState({ selection: { kind: "prefab", id: t.prefabId } });
    return;
  }
  if (t.sceneId) switchScene(t.sceneId);
  if (t.entityId) setState({ selection: { kind: "entity", id: t.entityId }, centerTab: "scene" });
  else if (t.ruleId) setState({ centerTab: "rules", rulesScope: t.sceneId ? "scene" : "global" });
}

function ConsoleTab() {
  const logs = useEditor((s) => s.logs);
  const end = useRef<HTMLDivElement>(null);
  // Corpo a blocco: scrollIntoView nei browser recenti restituisce una Promise,
  // e React la scambierebbe per la funzione di pulizia dell'effetto.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [logs.length]);
  return (
    <div className="console">
      <div className="console-bar">
        <span className="dim">{logs.length} messaggi</span>
        <div className="spacer" />
        <button type="button" className="btn small" onClick={() => checkProject()} title="Cerca riferimenti rotti e regole incomplete">
          <Icon name="bug" size={13} /> Controlla progetto
        </button>
        <button type="button" className="btn small ghost" onClick={() => setState({ logs: [] })}>
          Pulisci
        </button>
      </div>
      <div className="console-list">
        {logs.map((l) => (
          <div
            key={l.id}
            className={`log ${l.level}${l.target ? " link" : ""}`}
            onClick={() => goTo(l.target)}
            title={l.target ? "Clic per andare lì" : undefined}
          >
            <span className="log-time mono">{new Date(l.time).toLocaleTimeString("it-IT")}</span>
            <span className="log-level">{l.level === "error" ? "errore" : l.level === "warn" ? "avviso" : "info"}</span>
            <span className="log-msg">{l.message}</span>
          </div>
        ))}
        {logs.length === 0 && <p className="empty-hint">Qui compaiono i messaggi dell'editor e del gioco in anteprima.</p>}
        <div ref={end} />
      </div>
    </div>
  );
}

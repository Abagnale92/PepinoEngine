import { useEffect, useRef } from "react";
import {
  Assets,
  COLL,
  COLLISION_TYPES,
  Renderer,
  buildCollisionGrid,
  drawSpriteFrame,
  drawTileLayer,
  hexColor,
  interpolate,
  packColor,
  parseColor,
  spriteBounds,
  type BlockData,
  type CollisionGrid,
  type ProjectData,
  type SceneData,
  type TileLayerData,
  type TilesetData,
} from "@runtime";
import { currentScene, editProject, getState, log, setState, useEditor, viewInfo } from "../store";
import { blockProps, effectiveBlocks, findEntity, flattenEntities, sceneOf, spriteOf, type FlatEntity } from "../projectOps";
import { addEntityAt } from "../commands";
import { N, T } from "../i18n";
import { getSettings } from "../settings";

interface View {
  x: number;
  y: number;
  zoom: number;
}

type Drag =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "move"; id: string; wx: number; wy: number; ox: number; oy: number; key: string; moved: boolean }
  | { kind: "paint"; key: string; last: string };

const COLL_FILL: Record<number, number> = Object.fromEntries(
  COLLISION_TYPES.filter((c) => c.id !== "none").map((c) => [COLL[c.id], hexColor(c.color, 0.42)]),
);
const ACCENT = hexColor("#8cc480");
const BODY = hexColor("#5dff8a", 0.9);
const BOUNDS = hexColor("#8cc480", 0.8);
const SCREEN = hexColor("#7fb4d9", 0.55);
const ERASE = hexColor("#e5695f");
const PLACEHOLDER = packColor(0.55, 0.77, 0.5, 0.25);
const TOOL_LABEL = { select: N("Seleziona"), paint: N("Pennello"), erase: N("Gomma") };

function entityBounds(project: ProjectData, assets: Assets, it: FlatEntity, blocks: BlockData[]) {
  const sp = spriteOf(project, blocks);
  if (sp) return spriteBounds(assets.image(sp.image), it.wx + sp.offsetX, it.wy + sp.offsetY, sp.origin);
  const text = blocks.find((b) => b.type === "Text" && b.enabled !== false);
  if (text) {
    const p = blockProps(text);
    const str = interpolate(String(p.text), project.variables);
    const w = Math.max(8, str.length * p.size * 0.55);
    const x = p.align === "center" ? it.wx - w / 2 : p.align === "right" ? it.wx - w : it.wx;
    return { x, y: it.wy, w, h: p.size * 1.3 };
  }
  return { x: it.wx - 6, y: it.wy - 12, w: 12, h: 12 };
}

function bodyBox(blocks: BlockData[], it: FlatEntity, origin: string) {
  const b = blocks.find((x) => x.type === "Body" && x.enabled !== false);
  if (!b) return null;
  const p = blockProps(b);
  let ox = -p.width / 2;
  let oy = -p.height;
  if (origin === "center") oy = -p.height / 2;
  else if (origin === "topleft") ox = oy = 0;
  return { x: it.wx + ox + p.offsetX, y: it.wy + oy + p.offsetY, w: p.width, h: p.height };
}

export function SceneView({ hidden }: { hidden: boolean }) {
  const tool = useEditor((s) => s.tool);
  const showCollisions = useEditor((s) => s.showCollisions);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ x: -24, y: -24, zoom: 2 });
  const drag = useRef<Drag | null>(null);
  const hover = useRef<{ wx: number; wy: number } | null>(null);
  const space = useRef(false);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const gpu = useRef<{
    r: Renderer;
    assets: Assets;
    assetsKey: string;
    sceneId: string;
    grid?: { scene: SceneData; tilesets: TilesetData[]; grid: CollisionGrid };
    status: string;
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const r = new Renderer(canvas, 1, 1);
    gpu.current = { r, assets: new Assets("", r), assetsKey: "", sceneId: "", status: "" };
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!hiddenRef.current) draw();
    };
    raf = requestAnimationFrame(loop);
    const isTyping = (e: KeyboardEvent) => !!(e.target as HTMLElement | null)?.closest?.("input, textarea, select");
    const kd = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e)) space.current = true;
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === "Space") space.current = false;
    };
    const blur = () => (space.current = false);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur);
      gpu.current?.assets.dispose();
      r.dispose();
      gpu.current = null;
    };
  }, []);

  function ensureAssets(project: ProjectData, baseUrl: string) {
    const g = gpu.current!;
    const list = project.assets.filter((a) => a.type === "image" || a.type === "font");
    const key = `${baseUrl}|${JSON.stringify(list)}`;
    if (key === g.assetsKey) return;
    g.assetsKey = key;
    g.assets.baseUrl = baseUrl;
    for (const a of list) {
      if (a.type === "image") g.assets.loadImage(a).catch(() => log("error", T("Immagine non caricata: {0}", a.src)));
      else if (a.type === "font") g.assets.loadFont(a).catch(() => log("error", T("Carattere non caricato: {0}", a.src)));
    }
  }

  function fit(project: ProjectData, scene: SceneData) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const ts = project.settings.tileSize;
    const H = scene.height * ts;
    const z = rect.height / (H + ts * 2);
    const zoom = z >= 2 ? Math.floor(z) : z >= 1 ? Math.floor(z * 2) / 2 : Math.max(0.25, z);
    view.current = { zoom, x: -ts, y: (H - rect.height / zoom) / 2 };
  }

  function collisionGrid(project: ProjectData, scene: SceneData): CollisionGrid {
    const g = gpu.current!;
    if (!g.grid || g.grid.scene !== scene || g.grid.tilesets !== project.tilesets) {
      g.grid = { scene, tilesets: project.tilesets, grid: buildCollisionGrid(project, scene) };
    }
    return g.grid.grid;
  }

  function drawList(project: ProjectData, scene: SceneData) {
    type D = { z: number; y: number; order: number; layer?: TileLayerData; item?: FlatEntity };
    const draws: D[] = [];
    scene.layers.forEach((l, i) => l.visible !== false && draws.push({ z: l.z, y: 0, order: i, layer: l }));
    flattenEntities(scene.entities).forEach((it, i) => {
      const prefab = it.data.prefab ? project.prefabs.find((p) => p.id === it.data.prefab) : undefined;
      draws.push({ z: it.data.z ?? prefab?.z ?? 0, y: scene.ySort ? it.wy : 0, order: 1000 + i, item: it });
    });
    draws.sort((a, b) => a.z - b.z || (a.layer ? 0 : 1) - (b.layer ? 0 : 1) || a.y - b.y || a.order - b.order);
    return draws;
  }

  function draw() {
    const g = gpu.current;
    if (!g) return;
    const s = getState();
    const r = g.r;
    r.resize();
    r.beginCanvas(parseColor("#0c100c"));
    const project = s.project;
    const scene = currentScene(s);
    if (!project || !scene) return r.endFrame();
    ensureAssets(project, s.baseUrl);
    r.defaultFont = project.settings.font ?? "";
    if (scene.id !== g.sceneId) {
      g.sceneId = scene.id;
      fit(project, scene);
    }
    const dpr = window.devicePixelRatio || 1;
    const v = view.current;
    const z = v.zoom * dpr;
    const ts = project.settings.tileSize;
    const W = scene.width * ts;
    const H = scene.height * ts;
    const vw = r.canvas.width / z;
    const vh = r.canvas.height / z;
    viewInfo.cx = v.x + vw / 2;
    viewInfo.cy = v.y + vh / 2;

    r.setView(v.x, v.y, z);
    r.rect(0, 0, W, H, hexColor(scene.background || project.settings.background));

    let hasHud = false;
    for (const d of drawList(project, scene)) {
      if (d.layer) {
        const tileset = project.tilesets.find((t) => t.id === d.layer!.tileset);
        if (!tileset) continue;
        const dim = s.tool !== "select" && d.layer.id !== s.layerId;
        drawTileLayer(r, g.assets, tileset, d.layer, ts, v.x, v.y, vw, vh, dim ? 0.3 : (d.layer.opacity ?? 1));
        continue;
      }
      const it = d.item!;
      const blocks = effectiveBlocks(project, it.data);
      const alpha = it.data.visible === false ? 0.35 : 1;
      let drawn = false;
      const sp = spriteOf(project, blocks);
      const img = sp && g.assets.image(sp.image);
      if (sp && img) {
        drawSpriteFrame(r, img, sp.frame, it.wx + sp.offsetX, it.wy + sp.offsetY, sp.origin, false, packColor(1, 1, 1, alpha));
        drawn = true;
      }
      const text = blocks.find((b) => b.type === "Text" && b.enabled !== false);
      if (text) {
        const p = blockProps(text);
        if (p.screen) hasHud = true;
        const prev = r.pixelScale;
        r.pixelScale = z;
        r.text(interpolate(String(p.text), project.variables), it.wx, it.wy, {
          size: p.size,
          color: p.color,
          align: p.align,
          shadow: p.shadow,
          outline: p.outline,
          font: p.font,
        });
        r.pixelScale = prev;
        drawn = true;
      }
      if (!drawn) {
        r.rect(it.wx - 6, it.wy - 12, 12, 12, PLACEHOLDER);
        r.strokeRect(it.wx - 6, it.wy - 12, 12, 12, 1 / z, ACCENT);
      }
    }

    if (s.showCollisions) {
      const grid = collisionGrid(project, scene);
      const c0 = Math.max(0, Math.floor(v.x / ts));
      const c1 = Math.min(grid.cols - 1, Math.floor((v.x + vw) / ts));
      const r0 = Math.max(0, Math.floor(v.y / ts));
      const r1 = Math.min(grid.rows - 1, Math.floor((v.y + vh) / ts));
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const color = COLL_FILL[grid.get(col, row)];
          if (color) r.rect(col * ts, row * ts, ts, ts, color);
        }
      }
    }

    if (s.showGrid && z * ts >= 5) {
      const gs = getSettings();
      const GRID = hexColor(gs.gridColor, gs.gridOpacity * 0.55);
      const GRID_MAJOR = hexColor(gs.gridColor, gs.gridOpacity);
      const t = 1 / z;
      const y0 = Math.max(0, v.y);
      const y1 = Math.min(H, v.y + vh);
      const x0 = Math.max(0, v.x);
      const x1 = Math.min(W, v.x + vw);
      for (let c = Math.max(0, Math.floor(v.x / ts)); c <= Math.min(scene.width, Math.ceil((v.x + vw) / ts)); c++) {
        r.rect(c * ts, y0, t, y1 - y0, c % 4 === 0 ? GRID_MAJOR : GRID);
      }
      for (let row = Math.max(0, Math.floor(v.y / ts)); row <= Math.min(scene.height, Math.ceil((v.y + vh) / ts)); row++) {
        r.rect(x0, row * ts, x1 - x0, t, row % 4 === 0 ? GRID_MAJOR : GRID);
      }
    }
    r.strokeRect(0, 0, W, H, 1.5 / z, BOUNDS);
    if (hasHud) {
      const res = project.settings.resolution;
      r.strokeRect(0, 0, res.width, res.height, 1 / z, SCREEN);
    }

    const h = hover.current;
    let cellLabel = "";
    if (h) {
      const col = Math.floor(h.wx / ts);
      const row = Math.floor(h.wy / ts);
      cellLabel = `tile ${col}, ${row}`;
      if (s.tool !== "select" && col >= 0 && row >= 0 && col < scene.width && row < scene.height) {
        const layer = scene.layers.find((l) => l.id === s.layerId);
        const tileset = layer && project.tilesets.find((t) => t.id === layer.tileset);
        const img = tileset && g.assets.image(tileset.image);
        if (s.tool === "paint" && tileset && img) {
          const cols = Math.max(1, tileset.columns);
          const src = tileset.tileSize;
          r.draw(img.tex, (s.tile % cols) * src, Math.floor(s.tile / cols) * src, src, src, col * ts, row * ts, ts, ts, packColor(1, 1, 1, 0.65));
        }
        r.strokeRect(col * ts, row * ts, ts, ts, 1.5 / z, s.tool === "erase" ? ERASE : ACCENT);
      }
    }

    const sel = s.selection;
    if (sel?.kind === "entity") {
      const it = flattenEntities(scene.entities).find((f) => f.data.id === sel.id);
      if (it) {
        const blocks = effectiveBlocks(project, it.data);
        const b = entityBounds(project, g.assets, it, blocks);
        const p = 1 / z;
        r.strokeRect(b.x - 2 * p, b.y - 2 * p, b.w + 4 * p, b.h + 4 * p, 1.5 * p, ACCENT);
        const body = bodyBox(blocks, it, spriteOf(project, blocks)?.origin ?? "bottom");
        if (body) r.strokeRect(body.x, body.y, body.w, body.h, p, BODY);
        r.rect(it.wx - 4 * p, it.wy - 0.5 * p, 8 * p, p, ACCENT);
        r.rect(it.wx - 0.5 * p, it.wy - 4 * p, p, 8 * p, ACCENT);
      }
    }
    r.endFrame();

    const layer = scene.layers.find((l) => l.id === s.layerId);
    const status = [
      T(TOOL_LABEL[s.tool]),
      s.tool !== "select" ? `layer: ${layer?.name ?? "—"}` : "",
      `zoom ${Math.round(v.zoom * 100)}%`,
      cellLabel,
    ]
      .filter(Boolean)
      .join("   ·   ");
    if (status !== g.status && statusRef.current) {
      g.status = status;
      statusRef.current.textContent = status;
    }
  }

  const toWorld = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const v = view.current;
    return { wx: v.x + (e.clientX - rect.left) / v.zoom, wy: v.y + (e.clientY - rect.top) / v.zoom };
  };

  function pick(wx: number, wy: number): FlatEntity | undefined {
    const s = getState();
    const project = s.project;
    const scene = currentScene(s);
    const g = gpu.current;
    if (!project || !scene || !g) return undefined;
    const items = drawList(project, scene)
      .filter((d) => d.item)
      .map((d) => d.item!)
      .reverse();
    return items.find((it) => {
      const b = entityBounds(project, g.assets, it, effectiveBlocks(project, it.data));
      return wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h;
    });
  }

  function paintAt(wx: number, wy: number) {
    const d = drag.current;
    if (d?.kind !== "paint") return;
    const s = getState();
    const project = s.project;
    const scene = currentScene(s);
    if (!project || !scene) return;
    const layer = scene.layers.find((l) => l.id === s.layerId);
    if (!layer) return;
    if (layer.locked) {
      if (d.last !== "locked") log("warn", T("Il layer «{0}» è bloccato: sbloccalo nella Gerarchia.", layer.name));
      d.last = "locked";
      return;
    }
    const ts = project.settings.tileSize;
    const col = Math.floor(wx / ts);
    const row = Math.floor(wy / ts);
    if (col < 0 || row < 0 || col >= layer.width || row >= layer.height) return;
    const cell = `${col},${row}`;
    if (d.last === cell) return;
    d.last = cell;
    const value = s.tool === "erase" ? -1 : s.tile;
    if (layer.data[row * layer.width + col] === value) return;
    editProject((p) => {
      const l = sceneOf(p, scene.id)!.layers.find((x) => x.id === layer.id)!;
      l.data[row * l.width + col] = value;
    }, d.key);
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    canvas.setPointerCapture(e.pointerId);
    const s = getState();
    const { wx, wy } = toWorld(e);
    const v = view.current;
    if (e.button === 1 || e.button === 2 || space.current) {
      drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y };
      return;
    }
    if (e.button !== 0 || !s.project) return;
    if (s.tool === "select") {
      const hit = pick(wx, wy);
      if (hit) {
        setState({ selection: { kind: "entity", id: hit.data.id } });
        drag.current = { kind: "move", id: hit.data.id, wx, wy, ox: hit.data.x, oy: hit.data.y, key: `move-${Date.now()}`, moved: false };
      } else {
        if (s.selection?.kind === "entity") setState({ selection: null });
        drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y };
      }
    } else {
      drag.current = { kind: "paint", key: `paint-${Date.now()}`, last: "" };
      paintAt(wx, wy);
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const { wx, wy } = toWorld(e);
    hover.current = { wx, wy };
    const d = drag.current;
    if (!d) return;
    const v = view.current;
    if (d.kind === "pan") {
      v.x = d.vx - (e.clientX - d.sx) / v.zoom;
      v.y = d.vy - (e.clientY - d.sy) / v.zoom;
    } else if (d.kind === "move") {
      if (!d.moved && Math.hypot(wx - d.wx, wy - d.wy) * v.zoom < 3) return;
      d.moved = true;
      const s = getState();
      let nx = d.ox + (wx - d.wx);
      let ny = d.oy + (wy - d.wy);
      if (s.snap && !e.altKey) {
        const step = (s.project?.settings.tileSize ?? 16) / (getSettings().snapStep === "full" ? 1 : 2);
        nx = Math.round(nx / step) * step;
        ny = Math.round(ny / step) * step;
      } else {
        nx = Math.round(nx);
        ny = Math.round(ny);
      }
      const scene = currentScene(s)!;
      editProject((p) => {
        const ent = findEntity(sceneOf(p, scene.id)!.entities, d.id);
        if (ent) {
          ent.x = nx;
          ent.y = ny;
        }
      }, d.key);
    } else {
      paintAt(wx, wy);
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    canvasRef.current?.releasePointerCapture(e.pointerId);
    drag.current = null;
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    const v = view.current;
    const { wx, wy } = toWorld(e);
    const nz = Math.min(16, Math.max(0.25, v.zoom * Math.pow(1.0015, -e.deltaY)));
    v.x = wx - ((wx - v.x) * v.zoom) / nz;
    v.y = wy - ((wy - v.y) * v.zoom) / nz;
    v.zoom = nz;
  }

  function onDrop(e: React.DragEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const s = getState();
    const project = s.project;
    if (!project) return;
    const ts = project.settings.tileSize;
    const { wx, wy } = toWorld(e);
    const col = Math.floor(wx / ts);
    const row = Math.floor(wy / ts);
    const prefabId = e.dataTransfer.getData("application/x-pepino-prefab");
    const imageId = e.dataTransfer.getData("application/x-pepino-image");
    if (prefabId) {
      const pf = project.prefabs.find((p) => p.id === prefabId);
      if (!pf) return;
      const origin = spriteOf(project, pf.blocks)?.origin ?? "bottom";
      const x = origin === "topleft" ? col * ts : col * ts + ts / 2;
      const y = origin === "bottom" ? (row + 1) * ts : origin === "center" ? row * ts + ts / 2 : row * ts;
      addEntityAt(x, y, pf.name, [], pf.id);
    } else if (imageId) {
      addEntityAt(col * ts + ts / 2, (row + 1) * ts, imageId, [{ type: "Sprite", props: { image: imageId } }]);
    }
  }

  return (
    <div className="scene-view" style={{ display: hidden ? "none" : undefined }}>
      <canvas
        ref={canvasRef}
        className={`scene-canvas tool-${tool}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => (hover.current = null)}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={onDrop}
      />
      <div className="scene-status" ref={statusRef} />
      {showCollisions && (
        <div className="coll-legend">
          {COLLISION_TYPES.filter((c) => c.id !== "none").map((c) => (
            <span key={c.id}>
              <i style={{ background: c.color }} />
              {T(c.label)}
            </span>
          ))}
        </div>
      )}
      <div className="scene-help">{T("Rotella: zoom · Tasto destro o Spazio + trascina: sposta la vista · Alt: senza aggancio")}</div>
    </div>
  );
}

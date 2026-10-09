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
  type EntityData,
  type ProjectData,
  type SceneData,
  type TileLayerData,
  type TilesetData,
} from "@runtime";
import { currentScene, editProject, getState, log, setState, useEditor, viewInfo } from "../store";
import { blockProps, effectiveBlocks, findEntity, flattenEntities, normalizeDegrees, sceneOf, spriteOf, type FlatEntity } from "../projectOps";
import { addEntityAt } from "../commands";
import { N, T } from "../i18n";
import { getSettings } from "../settings";

interface View {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Ridimensionamento con le maniglie: l'angolo opposto resta fermo. Le posizioni «rel» sono gli angoli
 * rispetto al punto di origine dello sprite, a scala 1.
 */
interface ScaleDrag {
  kind: "scale";
  id: string;
  key: string;
  sx0: number;
  sy0: number;
  x0: number;
  y0: number;
  ax0: number;
  ay0: number;
  relHx: number;
  relHy: number;
  relOx: number;
  relOy: number;
  /** Rotazione dell'oggetto (radianti): le maniglie lavorano negli assi dello sprite ruotato. */
  rot: number;
}

/** Rotazione con il rombo sopra l'oggetto: si gira attorno al punto di origine dello sprite. */
interface RotateDrag {
  kind: "rotate";
  id: string;
  key: string;
  ax: number;
  ay: number;
  a0: number;
  deg0: number;
}

type Drag =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "move"; id: string; wx: number; wy: number; ox: number; oy: number; key: string; moved: boolean }
  | ScaleDrag
  | RotateDrag
  | { kind: "paint"; key: string; last: string };

/** Grandezza delle maniglie, in pixel dello schermo. */
const HANDLE = 7;
const scaleOf = (e: EntityData) => ({ sx: e.scaleX ?? 1, sy: e.scaleY ?? 1 });
/** Rotazione dell'oggetto in radianti (nel progetto è in gradi). */
const rotOf = (e: EntityData) => ((e.rotation ?? 0) * Math.PI) / 180;
/** Distanza del rombo di rotazione dal bordo alto, in pixel dello schermo. */
const ROT_HANDLE = 16;

/** Ruota il punto (x, y) attorno a (ax, ay) di `a` radianti. */
function turn(x: number, y: number, ax: number, ay: number, a: number): [number, number] {
  if (!a) return [x, y];
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = x - ax;
  const dy = y - ay;
  return [ax + dx * c - dy * s, ay + dx * s + dy * c];
}

/** Segmento spesso `t` (per i contorni ruotati). */
function segment(r: Renderer, x0: number, y0: number, x1: number, y1: number, t: number, color: number) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = ((-dy / len) * t) / 2;
  const ny = ((dx / len) * t) / 2;
  r.drawQuad(r.white, 0, 0, 1, 1, x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny, color);
}

const COLL_FILL: Record<number, number> = Object.fromEntries(
  COLLISION_TYPES.filter((c) => c.id !== "none").map((c) => [COLL[c.id], hexColor(c.color, 0.42)]),
);
const ACCENT = hexColor("#8cc480");
const BODY = hexColor("#5dff8a", 0.9);
const BOUNDS = hexColor("#8cc480", 0.8);
const SCREEN = hexColor("#7fb4d9", 0.55);
const ERASE = hexColor("#e5695f");
const PLACEHOLDER = packColor(0.55, 0.77, 0.5, 0.25);
const HANDLE_FILL = packColor(0.05, 0.07, 0.05, 0.9);
const TOOL_LABEL = { select: N("Seleziona"), paint: N("Pennello"), erase: N("Gomma") };

/** Oggetto da raccogliere senza Sprite: nella scena si vede l'icona dell'oggetto scelto nell'archivio. */
function pickupIcon(project: ProjectData, blocks: BlockData[]) {
  const b = blocks.find((x) => x.type === "ItemPickup" && x.enabled !== false);
  if (!b || blocks.some((x) => x.type === "Sprite" && x.enabled !== false)) return null;
  const def = project.items?.find((i) => i.id === blockProps(b).item);
  return def?.icon ? { image: def.icon, frame: def.frame ?? 0 } : null;
}

function entityBounds(project: ProjectData, assets: Assets, it: FlatEntity, blocks: BlockData[]) {
  const icon = pickupIcon(project, blocks);
  if (icon) return spriteBounds(assets.image(icon.image), it.wx, it.wy, "bottom");
  const sp = spriteOf(project, blocks);
  if (sp) {
    // Lo sprite cresce attorno al suo punto di origine (piedi, centro o angolo).
    const ax = it.wx + sp.offsetX;
    const ay = it.wy + sp.offsetY;
    const b = spriteBounds(assets.image(sp.image), ax, ay, sp.origin);
    const { sx, sy } = scaleOf(it.data);
    return { x: ax + (b.x - ax) * sx, y: ay + (b.y - ay) * sy, w: b.w * sx, h: b.h * sy };
  }
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
  // Come nel gioco: il corpo cresce con la scala dell'oggetto.
  const kx = Math.abs(it.data.scaleX ?? 1);
  const ky = Math.abs(it.data.scaleY ?? 1);
  const w = p.width * kx;
  const h = p.height * ky;
  let ox = -w / 2;
  let oy = -h;
  if (origin === "center") oy = -h / 2;
  else if (origin === "topleft") ox = oy = 0;
  return { x: it.wx + ox + p.offsetX * kx, y: it.wy + oy + p.offsetY * ky, w, h };
}

/** Punto di origine dello sprite: lì si scala e si ruota (come nel gioco). */
function anchorOf(project: ProjectData, it: FlatEntity, blocks: BlockData[]) {
  const sp = spriteOf(project, blocks);
  return sp ? { x: it.wx + sp.offsetX, y: it.wy + sp.offsetY } : { x: it.wx, y: it.wy };
}

/** Rotazione da usare per un oggetto: ruota solo chi ha uno Sprite. */
function spriteRot(project: ProjectData, it: FlatEntity, blocks: BlockData[]) {
  return spriteOf(project, blocks) ? rotOf(it.data) : 0;
}

/**
 * Angoli dell'oggetto selezionato (in senso orario dall'alto a sinistra, già ruotati), solo se ha uno Sprite
 * da ridimensionare. `local` = senza la rotazione.
 */
function cornersOf(project: ProjectData, assets: Assets, it: FlatEntity, blocks: BlockData[], local = false) {
  if (!spriteOf(project, blocks)) return null;
  const b = entityBounds(project, assets, it, blocks);
  const a = local ? 0 : rotOf(it.data);
  const o = anchorOf(project, it, blocks);
  const box: [number, number][] = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ];
  return box.map(([x, y]) => turn(x, y, o.x, o.y, a));
}

/** Il rombo di rotazione: sopra il bordo alto dello sprite (ruotato con lui) e il punto da cui parte la sua asta. */
function rotateHandleOf(corners: [number, number][], rot: number, zoom: number) {
  const mx = (corners[0][0] + corners[1][0]) / 2;
  const my = (corners[0][1] + corners[1][1]) / 2;
  const d = ROT_HANDLE / zoom;
  return { x: mx + Math.sin(rot) * d, y: my - Math.cos(rot) * d, mx, my };
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
      // La tela resta nel documento (React può rieseguire l'effetto sulla stessa): il contesto non va perso.
      r.dispose(false);
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
        const { sx, sy } = scaleOf(it.data);
        const rot = rotOf(it.data);
        const tf = sx === 1 && sy === 1 && !rot ? undefined : { sx, sy, rot, skew: 0 };
        drawSpriteFrame(r, img, sp.frame, it.wx + sp.offsetX, it.wy + sp.offsetY, sp.origin, false, packColor(1, 1, 1, alpha), 0, tf);
        drawn = true;
      }
      const icon = !drawn ? pickupIcon(project, blocks) : null;
      const iconImg = icon && g.assets.image(icon.image);
      if (icon && iconImg) {
        drawSpriteFrame(r, iconImg, icon.frame, it.wx, it.wy, "bottom", false, packColor(1, 1, 1, alpha));
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
        const rot = spriteRot(project, it, blocks);
        if (!rot) r.strokeRect(b.x - 2 * p, b.y - 2 * p, b.w + 4 * p, b.h + 4 * p, 1.5 * p, ACCENT);
        else {
          // Contorno ruotato con lo sprite.
          const c = cornersOf(project, g.assets, it, blocks)!;
          for (let i = 0; i < 4; i++) segment(r, c[i][0], c[i][1], c[(i + 1) % 4][0], c[(i + 1) % 4][1], 1.5 * p, ACCENT);
        }
        const body = bodyBox(blocks, it, spriteOf(project, blocks)?.origin ?? "bottom");
        if (body) r.strokeRect(body.x, body.y, body.w, body.h, p, BODY);
        r.rect(it.wx - 4 * p, it.wy - 0.5 * p, 8 * p, p, ACCENT);
        r.rect(it.wx - 0.5 * p, it.wy - 4 * p, p, 8 * p, ACCENT);
        const corners = s.tool === "select" ? cornersOf(project, g.assets, it, blocks) : null;
        const hs = HANDLE * p;
        for (const [cx, cy] of corners ?? []) {
          r.rect(cx - hs / 2, cy - hs / 2, hs, hs, HANDLE_FILL);
          r.strokeRect(cx - hs / 2, cy - hs / 2, hs, hs, p, ACCENT);
        }
        if (corners) {
          // Il rombo di rotazione con la sua asta (le maniglie della scala sono quadrate).
          const h = rotateHandleOf(corners, rot, z);
          segment(r, h.mx, h.my, h.x, h.y, p, ACCENT);
          const k = hs * 0.75;
          r.drawQuad(r.white, 0, 0, 1, 1, h.x, h.y - k, h.x + k, h.y, h.x, h.y + k, h.x - k, h.y, ACCENT);
          const k2 = k * 0.5;
          r.drawQuad(r.white, 0, 0, 1, 1, h.x, h.y - k2, h.x + k2, h.y, h.x, h.y + k2, h.x - k2, h.y, HANDLE_FILL);
        }
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
      const blocks = effectiveBlocks(project, it.data);
      const b = entityBounds(project, g.assets, it, blocks);
      // Un oggetto ruotato si prova riportando il punto negli assi dello sprite.
      const o = anchorOf(project, it, blocks);
      const [px, py] = turn(wx, wy, o.x, o.y, -spriteRot(project, it, blocks));
      return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
    });
  }

  /** La maniglia dell'oggetto selezionato sotto il puntatore (indice dell'angolo), se c'è. */
  function handleAt(wx: number, wy: number): { it: FlatEntity; corners: [number, number][]; i: number } | null {
    const s = getState();
    const project = s.project;
    const scene = currentScene(s);
    const g = gpu.current;
    if (!project || !scene || !g || s.tool !== "select" || s.selection?.kind !== "entity") return null;
    const sel = s.selection.id;
    const it = flattenEntities(scene.entities).find((f) => f.data.id === sel);
    if (!it) return null;
    const corners = cornersOf(project, g.assets, it, effectiveBlocks(project, it.data));
    if (!corners) return null;
    const tol = (HANDLE / 2 + 2) / view.current.zoom;
    const i = corners.findIndex(([cx, cy]) => Math.abs(wx - cx) <= tol && Math.abs(wy - cy) <= tol);
    return i >= 0 ? { it, corners, i } : null;
  }

  /** Il rombo di rotazione dell'oggetto selezionato è sotto il puntatore? */
  function rotateHandleAt(wx: number, wy: number): FlatEntity | null {
    const s = getState();
    const project = s.project;
    const scene = currentScene(s);
    const g = gpu.current;
    if (!project || !scene || !g || s.tool !== "select" || s.selection?.kind !== "entity") return null;
    const sel = s.selection.id;
    const it = flattenEntities(scene.entities).find((f) => f.data.id === sel);
    if (!it) return null;
    const corners = cornersOf(project, g.assets, it, effectiveBlocks(project, it.data));
    if (!corners) return null;
    const h = rotateHandleOf(corners, rotOf(it.data), view.current.zoom);
    const tol = (HANDLE / 2 + 3) / view.current.zoom;
    return Math.hypot(wx - h.x, wy - h.y) <= tol ? it : null;
  }

  function startRotate(it: FlatEntity, wx: number, wy: number): RotateDrag {
    const project = getState().project!;
    const o = anchorOf(project, it, effectiveBlocks(project, it.data));
    return { kind: "rotate", id: it.data.id, key: `rotate-${Date.now()}`, ax: o.x, ay: o.y, a0: Math.atan2(wy - o.y, wx - o.x), deg0: it.data.rotation ?? 0 };
  }

  function rotateTo(d: RotateDrag, wx: number, wy: number, coarse: boolean) {
    const scene = currentScene(getState());
    if (!scene) return;
    const a = Math.atan2(wy - d.ay, wx - d.ax);
    let deg = d.deg0 + ((a - d.a0) * 180) / Math.PI;
    deg = coarse ? Math.round(deg / 15) * 15 : Math.round(deg);
    const value = normalizeDegrees(deg);
    editProject((p) => {
      const ent = findEntity(sceneOf(p, scene.id)!.entities, d.id);
      if (!ent) return;
      if (value) ent.rotation = value;
      else delete ent.rotation;
    }, d.key);
  }

  function startScale(h: { it: FlatEntity; corners: [number, number][]; i: number }): ScaleDrag {
    const project = getState().project!;
    const blocks = effectiveBlocks(project, h.it.data);
    const sp = spriteOf(project, blocks)!;
    const { sx, sy } = scaleOf(h.it.data);
    const ax0 = h.it.wx + sp.offsetX;
    const ay0 = h.it.wy + sp.offsetY;
    // I conti si fanno negli assi dello sprite: si usano gli angoli senza rotazione.
    const local = cornersOf(project, gpu.current!.assets, h.it, blocks, true)!;
    const [hx, hy] = local[h.i];
    const [ox, oy] = local[(h.i + 2) % 4];
    return {
      kind: "scale",
      id: h.it.data.id,
      key: `scale-${Date.now()}`,
      sx0: sx,
      sy0: sy,
      x0: h.it.data.x,
      y0: h.it.data.y,
      ax0,
      ay0,
      relHx: (hx - ax0) / sx,
      relHy: (hy - ay0) / sy,
      relOx: (ox - ax0) / sx,
      relOy: (oy - ay0) / sy,
      rot: rotOf(h.it.data),
    };
  }

  function scaleTo(d: ScaleDrag, wx: number, wy: number, uniform: boolean, snap: boolean) {
    const scene = currentScene(getState());
    if (!scene) return;
    // L'angolo opposto resta dov'era (con la rotazione si lavora negli assi dello sprite ruotato).
    const c = Math.cos(d.rot);
    const sn = Math.sin(d.rot);
    const ox = d.ax0 + d.relOx * d.sx0 * c - d.relOy * d.sy0 * sn;
    const oy = d.ay0 + d.relOx * d.sx0 * sn + d.relOy * d.sy0 * c;
    const lx = (wx - ox) * c + (wy - oy) * sn;
    const ly = -(wx - ox) * sn + (wy - oy) * c;
    const w = d.relHx - d.relOx;
    const h = d.relHy - d.relOy;
    let sx = Math.abs(w) > 0.01 ? lx / w : d.sx0;
    let sy = Math.abs(h) > 0.01 ? ly / h : d.sy0;
    if (uniform) {
      const k = Math.abs(sx / d.sx0 - 1) > Math.abs(sy / d.sy0 - 1) ? sx / d.sx0 : sy / d.sy0;
      sx = d.sx0 * k;
      sy = d.sy0 * k;
    }
    const step = snap ? 0.05 : 0.01;
    sx = Math.max(0.05, Math.round(sx / step) * step);
    sy = Math.max(0.05, Math.round(sy / step) * step);
    const ax = ox - (d.relOx * sx * c - d.relOy * sy * sn);
    const ay = oy - (d.relOx * sx * sn + d.relOy * sy * c);
    editProject((p) => {
      const ent = findEntity(sceneOf(p, scene.id)!.entities, d.id);
      if (!ent) return;
      ent.scaleX = Math.round(sx * 100) / 100;
      ent.scaleY = Math.round(sy * 100) / 100;
      ent.x = Math.round((d.x0 + ax - d.ax0) * 10) / 10;
      ent.y = Math.round((d.y0 + ay - d.ay0) * 10) / 10;
    }, d.key);
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
      const rotHit = rotateHandleAt(wx, wy);
      if (rotHit) {
        drag.current = startRotate(rotHit, wx, wy);
        canvas.style.cursor = "grabbing";
        return;
      }
      const handle = handleAt(wx, wy);
      if (handle) {
        drag.current = startScale(handle);
        return;
      }
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
    const canvas = canvasRef.current!;
    if (!d) {
      // Sopra una maniglia il puntatore mostra le frecce del ridimensionamento (o la mano per ruotare).
      if (rotateHandleAt(wx, wy)) {
        canvas.style.cursor = "grab";
        return;
      }
      const h = handleAt(wx, wy);
      canvas.style.cursor = h ? (h.i % 2 === 0 ? "nwse-resize" : "nesw-resize") : "";
      return;
    }
    const v = view.current;
    if (d.kind === "rotate") {
      rotateTo(d, wx, wy, e.shiftKey);
    } else if (d.kind === "scale") {
      scaleTo(d, wx, wy, e.shiftKey, getState().snap && !e.altKey);
    } else if (d.kind === "pan") {
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
    if (drag.current?.kind === "rotate" && canvasRef.current) canvasRef.current.style.cursor = "";
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
      <div className="scene-help">
        {T("Rotella: zoom · Tasto destro o Spazio + trascina: sposta la vista · Angoli: ridimensiona (Maiusc in proporzione) · Rombo in alto: ruota (Maiusc a scatti di 15°) · Alt: senza aggancio")}
      </div>
    </div>
  );
}

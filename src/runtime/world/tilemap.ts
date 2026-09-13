import type { Assets } from "../assets/assets";
import { packColor, WHITE } from "../math";
import { CollisionGrid, codeOf } from "../physics/collision";
import type { ProjectData, SceneData, TileLayerData, TilesetData } from "../project/format";
import type { Renderer } from "../render/renderer";

/**
 * Disegna i tile visibili di un layer. (x0, y0) = angolo in alto a sinistra della vista,
 * viewW/viewH = dimensioni visibili in pixel del mondo.
 */
export function drawTileLayer(
  r: Renderer,
  assets: Assets,
  tileset: TilesetData,
  layer: TileLayerData,
  tileSize: number,
  x0: number,
  y0: number,
  viewW: number,
  viewH: number,
  alpha = 1,
): void {
  const img = assets.image(tileset.image);
  if (!img) return;
  const s = tileSize;
  const src = tileset.tileSize;
  const cols = Math.max(1, tileset.columns);
  const c0 = Math.max(0, Math.floor(x0 / s));
  const c1 = Math.min(layer.width - 1, Math.floor((x0 + viewW) / s));
  const r0 = Math.max(0, Math.floor(y0 / s));
  const r1 = Math.min(layer.height - 1, Math.floor((y0 + viewH) / s));
  const color = alpha >= 1 ? WHITE : packColor(1, 1, 1, alpha);
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const t = layer.data[row * layer.width + col];
      if (t === undefined || t < 0) continue;
      r.draw(img.tex, (t % cols) * src, Math.floor(t / cols) * src, src, src, col * s, row * s, s, s, color);
    }
  }
}

/** Unisce i layer "che collidono" in un'unica griglia: è quella che usa la fisica. */
export function buildCollisionGrid(project: ProjectData, scene: SceneData): CollisionGrid {
  const grid = new CollisionGrid(scene.width, scene.height, project.settings.tileSize);
  grid.openBottom = !!scene.openBottom;
  for (const layer of scene.layers) {
    if (!layer.collides) continue;
    const ts = project.tilesets.find((t) => t.id === layer.tileset);
    if (!ts) continue;
    for (let row = 0; row < layer.height; row++) {
      for (let col = 0; col < layer.width; col++) {
        const t = layer.data[row * layer.width + col];
        if (t === undefined || t < 0) continue;
        const code = codeOf(ts.tiles[t]?.collision);
        if (code) grid.merge(col, row, code);
      }
    }
  }
  return grid;
}

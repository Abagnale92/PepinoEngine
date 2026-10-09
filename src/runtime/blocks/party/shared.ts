import type { BlockInstance, PropSchema } from "../../core/block";
import type { Entity, Intent } from "../../core/entity";
import type { Scene } from "../../core/scene";
import { COLL, type CollisionGrid } from "../../physics/collision";
import { walkable, type Cell } from "../../world/pathfinding";
import { bodyCenter } from "../targets";

/**
 * Cose comuni ai blocchi dei giochi di gruppo (più giocatori sullo stesso schermo, o il computer al loro posto):
 * chi comanda un personaggio, i bonus, i percorsi dei personaggi comandati dal computer, la luce che protegge.
 */

/** Colori dei giocatori 1-4: etichette sopra la testa, cornici nella scelta dei personaggi. */
export const PLAYER_COLORS = ["#ff6b5e", "#55b6ff", "#86e35e", "#ffd447"];

/** I bonus che un Fuggitivo porta in tasca, nell'ordine dei fotogrammi del foglio delle icone (0-4). */
export const BONUS_KINDS = ["flashlight", "turbo", "cloak", "pumpkin", "key"] as const;
export type BonusKind = (typeof BONUS_KINDS)[number];

export const BONUS_LABELS: Record<BonusKind, string> = {
  flashlight: "Torcia",
  turbo: "Caramella turbo",
  cloak: "Mantello",
  pumpkin: "Zucca esplosiva",
  key: "Chiave",
};

export const BONUS_COLORS: Record<BonusKind, string> = {
  flashlight: "#fff3b0",
  turbo: "#5ee0ff",
  cloak: "#c58bff",
  pumpkin: "#ff9a3c",
  key: "#ffd447",
};

export const BONUS_OPTIONS = BONUS_KINDS.map((k) => ({ value: k, label: BONUS_LABELS[k] }));

export const isBonus = (k: string): k is BonusKind => (BONUS_KINDS as readonly string[]).includes(k);

// ------------------------------------------------------------------ chi comanda

/** Proprietà comuni a chi può essere comandato da un giocatore o dal computer. */
export const CONTROL_PROPS: Record<string, PropSchema> = {
  control: {
    type: "variable",
    label: "Comandato da (variabile)",
    default: "",
    optional: true,
    group: "Comandi",
    help: "Valore della variabile: 0 = il computer, da 1 a 4 = il giocatore con quei tasti, -1 = non gioca (l'oggetto sparisce). Vuoto = il computer.",
  },
  players: {
    type: "variable",
    label: "Numero di giocatori (variabile)",
    default: "",
    optional: true,
    group: "Comandi",
    help: "Con un solo giocatore valgono tutti i tasti (frecce, WASD, gamepad); con di più ognuno usa i suoi. Vuoto = un solo giocatore.",
  },
  skill: {
    type: "variable",
    label: "Bravura del computer (variabile)",
    default: "",
    optional: true,
    group: "Comandi",
    help: "1 = facile, 2 = normale, 3 = difficile. Vuoto = normale.",
  },
};

const varNum = (self: BlockInstance, key: string, fallback: number): number => {
  const name = String(self.props[key] ?? "");
  if (!name) return fallback;
  const n = Number(self.game.vars[name]);
  return Number.isFinite(n) ? n : fallback;
};

/** 0 = il computer, da 1 a 4 = il giocatore con quei tasti, -1 = non partecipa. */
export const controlOf = (self: BlockInstance): number => Math.round(varNum(self, "control", 0));

/** Un solo giocatore: valgono tutti i tasti di sempre. */
export const soloGame = (self: BlockInstance): boolean => varNum(self, "players", 1) <= 1;

/** Bravura del computer: 1 facile, 2 normale, 3 difficile. */
export const skillOf = (self: BlockInstance): number => Math.max(1, Math.min(3, Math.round(varNum(self, "skill", 2))));

/** Legge i comandi del giocatore `slot` nell'intenzione dell'oggetto. Vero se ha appena premuto Azione. */
export function readHuman(self: BlockInstance, slot: number, it: Intent): boolean {
  const input = self.game.input;
  const solo = soloGame(self);
  input.readPlayerIntent(it, solo ? "" : `p${slot}.`);
  // Da soli va bene qualsiasi tasto «grande»: Azione, Salto, Attacco, Usa oggetto.
  if (solo) return it.actionPressed || input.pressed("jump") || input.pressed("attack") || input.pressed("item");
  return it.actionPressed;
}

export const stopIntent = (it: Intent): void => {
  it.x = it.y = 0;
  it.jump = it.jumpPressed = it.dashPressed = it.actionPressed = false;
};

/** Etichetta da mostrare per chi comanda: «P2», «TU» (da soli) o niente (il computer). */
export function controlLabel(self: BlockInstance, slot: number): string {
  if (slot <= 0) return "";
  return soloGame(self) ? self.game.t("TU") : `P${slot}`;
}

// ------------------------------------------------------------------ partita

/** Il blocco Partita a squadre della scena, se c'è (cercato una volta per fotogramma). */
const matchCache = new WeakMap<Scene, { time: number; block: BlockInstance | undefined }>();

export function matchOf(scene: Scene): BlockInstance | undefined {
  const c = matchCache.get(scene);
  if (c && c.time === scene.time) return c.block;
  const e = scene.entities.find((x) => !x.destroyed && x.get("PartyMatch")?.enabled);
  const block = e?.get("PartyMatch");
  matchCache.set(scene, { time: scene.time, block });
  return block;
}

/** Si gioca: niente conto alla rovescia, partita non ancora finita (senza Partita si gioca sempre). */
export function playing(scene: Scene): boolean {
  const m = matchOf(scene);
  return !m || m.data.phase === "play";
}

/** Il Cacciatore può muoversi (alla partenza aspetta qualche secondo). */
export function huntersFree(scene: Scene): boolean {
  const m = matchOf(scene);
  return !m || (m.data.phase === "play" && m.data.elapsed >= Number(m.props.hunterDelay ?? 0));
}

const blocksOf = (scene: Scene, type: string): BlockInstance[] => {
  const out: BlockInstance[] = [];
  for (const e of scene.entities) {
    if (e.destroyed) continue;
    const b = e.get(type);
    if (b?.enabled) out.push(b);
  }
  return out;
};

export const runnersOf = (scene: Scene) => blocksOf(scene, "Runner");
export const huntersOf = (scene: Scene) => blocksOf(scene, "Hunter");
export const itemsOf = (scene: Scene) => blocksOf(scene, "PartyItem");
export const hauntablesOf = (scene: Scene) => blocksOf(scene, "Hauntable");

/** Un Fuggitivo che scappa ancora (non fantasma, non fuggito). */
export const isRunning = (r: BlockInstance): boolean => r.data.status === "run";

// ------------------------------------------------------------------ luce

/** Il punto è nella luce di un lampione acceso (oggetti con l'etichetta e una Luce accesa)? */
export function litAt(scene: Scene, x: number, y: number, tag: string): boolean {
  if (!tag) return false;
  const ts = scene.tileSize;
  for (const e of scene.entities) {
    if (e.destroyed || !e.tags.has(tag)) continue;
    const l = e.get("Light");
    if (!l || !l.enabled || !l.data.on) continue;
    const lx = e.worldX + Number(l.props.offsetX ?? 0);
    // La luce scende a terra: conta la base del lampione, non la lanterna in alto.
    const ly = e.worldY;
    const rad = Number(l.props.radius ?? 0) * ts * 0.62;
    if ((x - lx) ** 2 + (y - ly) ** 2 < rad * rad) return true;
  }
  return false;
}

// ------------------------------------------------------------------ percorsi (personaggi del computer)

export interface Field {
  dist: Int16Array;
  prev: Int32Array;
  cols: number;
  rows: number;
  start: number;
}

export const cellIndex = (grid: CollisionGrid, x: number, y: number): number => {
  const cx = Math.max(0, Math.min(grid.cols - 1, Math.floor(x / grid.size)));
  const cy = Math.max(0, Math.min(grid.rows - 1, Math.floor(y / grid.size)));
  return cy * grid.cols + cx;
};

export const cellCenter = (grid: CollisionGrid, i: number) => ({
  x: ((i % grid.cols) + 0.5) * grid.size,
  y: (Math.floor(i / grid.cols) + 0.5) * grid.size,
});

/** Distanze a passi (4 direzioni) da una cella a tutte le altre raggiungibili: -1 = irraggiungibile. */
export function flood(grid: CollisionGrid, start: number, maxSteps = 400): Field {
  const W = grid.cols;
  const N = W * grid.rows;
  const dist = new Int16Array(N).fill(-1);
  const prev = new Int32Array(N).fill(-1);
  const q = new Int32Array(N);
  let head = 0;
  let tail = 0;
  dist[start] = 0;
  q[tail++] = start;
  while (head < tail) {
    const c = q[head++];
    const d = dist[c];
    if (d >= maxSteps) continue;
    const cx = c % W;
    const cy = (c - cx) / W;
    for (let k = 0; k < 4; k++) {
      const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (!walkable(grid, nx, ny)) continue;
      const ni = ny * W + nx;
      if (dist[ni] >= 0) continue;
      dist[ni] = d + 1;
      prev[ni] = c;
      q[tail++] = ni;
    }
  }
  return { dist, prev, cols: W, rows: grid.rows, start };
}

/** Percorso dalla partenza del campo fino alla cella `target` (esclusa la partenza). */
export function pathTo(f: Field, target: number): Cell[] | null {
  if (target < 0 || f.dist[target] < 0) return null;
  const out: Cell[] = [];
  for (let i = target; i !== f.start && i >= 0; i = f.prev[i]) out.push({ x: i % f.cols, y: Math.floor(i / f.cols) });
  return out.reverse();
}

/** Da un punto all'altro passa una scatola larga 2·hw × 2·hh senza toccare muri? */
export function clearLine(grid: CollisionGrid, x0: number, y0: number, x1: number, y1: number, hw: number, hh: number): boolean {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(dist / 3));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    if (
      grid.atPixel(x - hw, y - hh) === COLL.solid ||
      grid.atPixel(x + hw, y - hh) === COLL.solid ||
      grid.atPixel(x - hw, y + hh) === COLL.solid ||
      grid.atPixel(x + hw, y + hh) === COLL.solid
    )
      return false;
  }
  return true;
}

/**
 * Guida di un personaggio del computer: segue un percorso di celle tagliando gli angoli quando si può,
 * si accorge se resta incastrato e prova a liberarsi.
 */
export class Nav {
  path: Cell[] | null = null;
  /** Cella d'arrivo del percorso attuale (-1 = nessuna). */
  goal = -1;
  private lastX = 0;
  private lastY = 0;
  private still = 0;
  private wiggle = 0;
  private wx = 0;
  private wy = 0;
  stuck = false;

  set(path: Cell[] | null, goal: number): void {
    this.path = path;
    this.goal = path ? goal : -1;
  }

  clear(): void {
    this.path = null;
    this.goal = -1;
  }

  /** Scrive l'intenzione per seguire il percorso. Vero se è arrivato (o non ha un percorso). */
  follow(e: Entity, it: Intent, dt: number): boolean {
    const b = e.body;
    const path = this.path;
    if (!b || !path) {
      it.x = it.y = 0;
      return true;
    }
    const grid = e.scene.grid;
    const ts = grid.size;
    const c = bodyCenter(e);
    // Incastrato contro un angolo: per un attimo si sposta di lato.
    const moved = Math.hypot(c.x - this.lastX, c.y - this.lastY);
    this.lastX = c.x;
    this.lastY = c.y;
    if (this.wiggle > 0) {
      this.wiggle -= dt;
      it.x = this.wx;
      it.y = this.wy;
      return false;
    }
    this.still = moved < 0.2 && (it.x !== 0 || it.y !== 0) ? this.still + dt : 0;
    this.stuck = false;
    if (this.still > 0.45) {
      this.still = 0;
      this.stuck = true;
      const a = Math.random() * Math.PI * 2;
      this.wx = Math.cos(a);
      this.wy = Math.sin(a);
      this.wiggle = 0.25;
    }
    const ctr = (p: Cell) => ({ x: (p.x + 0.5) * ts, y: (p.y + 0.5) * ts });
    while (path.length && Math.hypot(ctr(path[0]).x - c.x, ctr(path[0]).y - c.y) < ts * 0.3) path.shift();
    if (!path.length) {
      it.x = it.y = 0;
      return true;
    }
    // Punta alla cella più lontana (fino a 5 avanti) che si raggiunge in linea retta.
    let k = Math.min(path.length - 1, 5);
    for (; k > 0; k--) {
      const t = ctr(path[k]);
      if (clearLine(grid, c.x, c.y, t.x, t.y, b.w / 2 + 0.5, b.h / 2 + 0.5)) break;
    }
    if (k > 0) path.splice(0, k);
    const t = ctr(path[0]);
    const vx = t.x - c.x;
    const vy = t.y - c.y;
    const len = Math.hypot(vx, vy) || 1;
    it.x = vx / len;
    it.y = vy / len;
    return false;
  }
}

/** Celle d'arrivo che altri personaggi del computer hanno già scelto (per non andare tutti nello stesso posto). */
const claims = new WeakMap<Scene, Map<number, Entity>>();

export function claimsOf(scene: Scene): Map<number, Entity> {
  let m = claims.get(scene);
  if (!m) claims.set(scene, (m = new Map()));
  return m;
}

/** Un oggetto con il Corpo tocca il rettangolo (allargato di `pad` pixel)? */
export function bodyTouches(a: Entity, b: Entity, pad = 0): boolean {
  const ra = a.body;
  const rb = b.body;
  if (!ra || !rb) return false;
  return ra.left - pad < rb.right && ra.right + pad > rb.left && ra.top - pad < rb.bottom && ra.bottom + pad > rb.top;
}

/** Posizione sullo schermo (HUD) di un punto del mondo. */
export function toScreen(scene: Scene, x: number, y: number): { x: number; y: number } {
  const cam = scene.camera;
  return { x: (x - cam.left) * cam.zoom, y: (y - cam.top) * cam.zoom };
}

import {
  Scene,
  registerBuiltinBlocks,
  type DialogueData,
  type EntityData,
  type Intent,
  type PrefabData,
  type ProjectData,
  type RuleData,
  type SceneData,
  type ScriptData,
  type VariableValue,
} from "@runtime";

registerBuiltinBlocks();

export const TS = 16;
export const DT = 1 / 60;

/** Input finto: si "tiene premuto" un'azione e i test avanzano un passo alla volta. */
export class FakeInput {
  private held = new Set<string>();
  private justPressed = new Set<string>();
  readonly pointer = { x: -1, y: -1, down: false, pressed: false, moved: false };

  hold(action: string) {
    if (!this.held.has(action)) this.justPressed.add(action);
    this.held.add(action);
  }
  release(action: string) {
    this.held.delete(action);
  }
  isDown(a: string) {
    return this.held.has(a);
  }
  pressed(a: string) {
    return this.justPressed.has(a);
  }
  axis(neg: string, pos: string) {
    return (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0);
  }
  keyPressed() {
    return false;
  }
  readIntent(it: Intent) {
    it.x = this.axis("left", "right");
    it.y = this.axis("up", "down");
    it.jump = this.isDown("jump");
    it.jumpPressed = this.pressed("jump");
    it.dashPressed = this.pressed("dash");
    it.actionPressed = this.pressed("action");
  }
  endStep() {
    this.justPressed.clear();
  }
}

/** Mappa ASCII: '#' muro, '=' piattaforma attraversabile, 'H' scala, '^' pericolo, '.' vuoto. */
export function tilesFromAscii(rows: string[]) {
  const map: Record<string, number> = { "#": 0, "=": 1, H: 2, "^": 3 };
  const width = Math.max(...rows.map((r) => r.length));
  const height = rows.length;
  const data = new Array(width * height).fill(-1);
  rows.forEach((r, y) => [...r].forEach((c, x) => c in map && (data[y * width + x] = map[c])));
  return { width, height, data };
}

export interface ProjectOptions {
  rules?: RuleData[];
  globalRules?: RuleData[];
  prefabs?: PrefabData[];
  variables?: Record<string, VariableValue>;
  extraScenes?: SceneData[];
  dialogues?: DialogueData[];
  scripts?: ScriptData[];
}

export function makeProject(rows: string[], entities: EntityData[], opts: ProjectOptions = {}): ProjectData {
  const { width, height, data } = tilesFromAscii(rows);
  return {
    format: "pepino",
    version: 1,
    name: "Test",
    settings: {
      resolution: { width: 320, height: 180 },
      pixelPerfect: true,
      tileSize: TS,
      startScene: "s",
      background: "#000000",
      collisionGroups: ["giocatore", "nemici", "raccoglibili", "trigger"],
    },
    input: {},
    variables: opts.variables ?? { monete: 0, vita: 3 },
    assets: [{ id: "tiles", type: "image", src: "tiles.png" }],
    tilesets: [
      {
        id: "t",
        name: "T",
        image: "tiles",
        tileSize: TS,
        columns: 4,
        count: 4,
        tiles: { 0: { collision: "solid" }, 1: { collision: "oneway" }, 2: { collision: "ladder" }, 3: { collision: "hazard" } },
      },
    ],
    prefabs: opts.prefabs ?? [],
    scenes: [
      {
        id: "s",
        name: "Test",
        width,
        height,
        layers: [{ id: "l", name: "L", tileset: "t", width, height, data, z: 0, collides: true }],
        entities,
        rules: opts.rules,
      },
      ...(opts.extraScenes ?? []),
    ],
    rules: opts.globalRules,
    dialogues: opts.dialogues,
    scripts: opts.scripts,
  };
}

/** Scena vera con un "gioco" finto intorno: niente WebGL, niente audio, niente finestra. */
export function makeWorld(project: ProjectData) {
  const input = new FakeInput();
  const logs: { level: string; message: string }[] = [];
  const messages: string[] = [];
  const calls: string[] = [];
  const game: any = {
    project,
    vars: structuredClone(project.variables),
    input,
    audio: { play() {}, playMusic() {}, stopMusic() {} },
    assets: { image: () => undefined },
    renderer: { toVirtual: (x: number, y: number) => ({ x, y }) },
    log: (message: string, level = "info") => logs.push({ level, message }),
    goToScene: (id: string) => calls.push(`goToScene:${id}`),
    restartScene: () => calls.push("restartScene"),
    showMessage: (text: string) => messages.push(text),
    saveGame: () => calls.push("saveGame"),
    loadGame: () => calls.push("loadGame"),
    hasSave: () => false,
    startDialogue: (id: string) => {
      calls.push(`dialogue:${id}`);
      return true;
    },
    dialogue: { active: false },
    isBlocked: false,
  };
  const scene = new Scene(game, project.scenes[0]);
  game.scene = scene;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      scene.update(DT);
      input.endStep();
    }
  };
  const get = (id: string) => scene.entities.find((e) => e.id === id)!;
  return { game, scene, input, logs, messages, calls, step, get };
}

/** Pavimento piatto a riga 8 (y = 128), 16 colonne. */
export const FLAT = [...Array(8).fill("................"), "################"];

export const player = (x: number, y: number, controller: Record<string, unknown> = {}, extra: Partial<EntityData> = {}): EntityData => ({
  id: "p",
  name: "Pepino",
  x,
  y,
  tags: ["giocatore"],
  blocks: [
    { type: "Body", props: { width: 10, height: 16, group: "giocatore", collidesWith: ["nemici", "raccoglibili", "trigger"] } },
    { type: "PlatformController", props: controller },
    ...(extra.blocks ?? []),
  ],
  ...(extra.children ? { children: extra.children } : {}),
});

export const rule = (id: string, when: RuleData["when"], actions: RuleData["actions"], conditions: RuleData["conditions"] = [], extra: Partial<RuleData> = {}): RuleData => ({
  id,
  when,
  conditions,
  actions,
  ...extra,
});

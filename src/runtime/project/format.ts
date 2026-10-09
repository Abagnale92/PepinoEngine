import type { SfxData, SongData } from "../audio/synth";

/**
 * Formato del progetto Pepino (project.json).
 * Tutto è testo JSON, così i progetti funzionano con Git e si leggono a occhio.
 */

export type CollisionType = "none" | "solid" | "oneway" | "ladder" | "hazard";

export interface CollisionTypeInfo {
  id: CollisionType;
  label: string;
  color: string;
}

export const COLLISION_TYPES: CollisionTypeInfo[] = [
  { id: "none", label: "Nessuna", color: "#00000000" },
  { id: "solid", label: "Muro / pavimento", color: "#e2554b" },
  { id: "oneway", label: "Attraversabile dal basso", color: "#f0b43c" },
  { id: "ladder", label: "Scala", color: "#4aa6e0" },
  { id: "hazard", label: "Pericolo", color: "#b452e0" },
];

export interface AnimationData {
  frames: number[];
  fps: number;
  loop: boolean;
}

export interface ImageAsset {
  id: string;
  type: "image";
  src: string;
  /** Se presenti, l'immagine è uno sprite sheet a griglia. */
  frameWidth?: number;
  frameHeight?: number;
  animations?: Record<string, AnimationData>;
  /** Cresce a ogni salvataggio dal Disegno: così editor e anteprima ricaricano l'immagine. */
  rev?: number;
  /** File con livelli e fotogrammi del Disegno, per riaprirlo e continuare a modificarlo. */
  pixel?: string;
}

export interface AudioAsset {
  id: string;
  type: "audio";
  /** File del suono; vuoto per brani ed effetti creati nella scheda Musica. */
  src: string;
  /** Brano creato nella scheda Musica: il gioco lo calcola all'avvio. */
  song?: SongData;
  /** Effetto sonoro creato nella scheda Musica. */
  sfx?: SfxData;
}

/** Carattere importato (.ttf, .otf, .woff, .woff2). */
export interface FontAsset {
  id: string;
  type: "font";
  src: string;
}

export type AssetData = ImageAsset | AudioAsset | FontAsset;

export interface TilesetData {
  id: string;
  name: string;
  image: string;
  tileSize: number;
  columns: number;
  count: number;
  /** Proprietà per tile, indicizzate per numero di tile. */
  tiles: Record<string, { collision?: CollisionType }>;
}

export interface TileLayerData {
  id: string;
  name: string;
  tileset: string;
  width: number;
  height: number;
  /** Indici dei tile riga per riga, -1 = vuoto. */
  data: number[];
  z: number;
  /** Se vero, i tile di questo layer contano per le collisioni. */
  collides: boolean;
  visible?: boolean;
  locked?: boolean;
  /** 1 = si muove con la camera, 0.5 = parallasse a metà velocità. */
  parallax?: number;
  opacity?: number;
}

export interface BlockData {
  type: string;
  enabled?: boolean;
  props: Record<string, unknown>;
}

export interface EntityData {
  id: string;
  name: string;
  x: number;
  y: number;
  z?: number;
  tags?: string[];
  /** Id del modello (prefab) da cui deriva; i blocchi qui sovrascrivono quelli del modello. */
  prefab?: string;
  visible?: boolean;
  /** Scala dell'oggetto (1 = grandezza originale): ingrandisce lo sprite e il corpo di collisione. */
  scaleX?: number;
  scaleY?: number;
  /** Rotazione dello sprite in gradi, in senso orario, attorno al suo punto di origine (il corpo di collisione non ruota). */
  rotation?: number;
  blocks: BlockData[];
  children?: EntityData[];
}

export interface PrefabData {
  id: string;
  name: string;
  tags?: string[];
  z?: number;
  blocks: BlockData[];
}

/** Un elemento di una regola: evento ("Quando"), condizione ("e se") o azione ("Allora"). */
export interface RuleItem {
  type: string;
  params: Record<string, unknown>;
  /** Solo condizioni: inverte il risultato ("non"). */
  not?: boolean;
}

/**
 * Regola "Quando → Allora". Riferimenti agli oggetti nei parametri:
 * "self" = l'oggetto dell'evento, "other" = l'altro oggetto, "#etichetta", "@id", "*" = qualsiasi.
 */
export interface RuleData {
  id: string;
  comment?: string;
  enabled?: boolean;
  /** Scatta al massimo una volta per scena. */
  once?: boolean;
  when: RuleItem;
  conditions: RuleItem[];
  actions: RuleItem[];
}

/** Valore speciale di `goto`: il dialogo termina. */
export const DIALOGUE_END = "fine";

export interface DialogueChoice {
  text: string;
  /** Dove andare: "" = battuta successiva, "fine" = termina, altrimenti l'id di una battuta. */
  goto?: string;
  /** Se indicata, scegliendo si imposta questa variabile globale (da usare poi nelle Regole). */
  setVar?: string;
  setValue?: string;
}

export interface DialogueLine {
  id: string;
  speaker?: string;
  /** Immagine del ritratto e fotogramma da mostrare. */
  portrait?: string;
  portraitFrame?: number;
  text: string;
  choices?: DialogueChoice[];
  /** Solo senza scelte: "" = battuta successiva, "fine" = termina, altrimenti l'id di una battuta. */
  goto?: string;
}

export interface DialogueData {
  id: string;
  name: string;
  lines: DialogueLine[];
}

/**
 * Filmato: una sequenza di passi (azioni delle Regole) eseguiti uno dopo l'altro. Chi dura (spostamenti,
 * dialoghi, dissolvenze) si aspetta prima di andare avanti; intanto il giocatore non comanda il personaggio.
 */
export interface CutsceneData {
  id: string;
  name: string;
  steps: RuleItem[];
  /** Il giocatore può saltarlo con Esc / Start (vale anche se manca). */
  skippable?: boolean;
  /** Barre nere sopra e sotto mentre scorre (vale anche se manca). */
  bars?: boolean;
}

/** Uno script del progetto: definisce blocchi personalizzati in JavaScript o in Python ridotto. */
export interface ScriptData {
  id: string;
  name: string;
  /** js = JavaScript, py = Python ridotto, pep = Pepino Language. */
  language: "js" | "py" | "pep";
  code: string;
}

export interface SceneData {
  id: string;
  name: string;
  rules?: RuleData[];
  /** Dimensioni in tile. */
  width: number;
  height: number;
  background?: string;
  /** Disegna davanti chi sta più in basso (top-down, beat 'em up). */
  ySort?: boolean;
  /** Se vero, sotto la scena non c'è pavimento: si può cadere fuori. */
  openBottom?: boolean;
  music?: string;
  /** Colore della luce ambiente: se c'è, la scena è al buio e la illuminano i blocchi Luce. */
  ambient?: string;
  /** Effetto a tutto schermo: "vignette", "crt", "gameboy", "grayscale", "sepia". */
  effect?: string;
  /** Intensità dell'effetto, 0..1. */
  effectStrength?: number;
  layers: TileLayerData[];
  entities: EntityData[];
}

export interface ProjectSettings {
  resolution: { width: number; height: number };
  pixelPerfect: boolean;
  tileSize: number;
  startScene: string;
  background: string;
  /** Carattere di messaggi, dialoghi, pausa e dei testi che non ne scelgono uno: "pixel", "sans"… o l'id di un asset. */
  font?: string;
  collisionGroups: string[];
  /** Controlli touch sullo schermo (joystick e pulsanti) nel gioco esportato. */
  touch?: TouchSettings;
}

export interface TouchSettings {
  /** "auto" = solo su telefoni e tablet. */
  mode: "auto" | "always" | "off";
  /** Comandi da mostrare come pulsanti (al massimo 4). */
  buttons: string[];
}

export const DEFAULT_TOUCH: TouchSettings = { mode: "auto", buttons: ["jump", "attack", "action", "dash"] };

export type VariableValue = number | string | boolean;

/** Cosa succede quando si usa un oggetto dell'archivio. */
export interface ItemEffect {
  /** none = niente (ci pensano le Regole), heal = cura, variable = somma a una variabile, powerup = potenziamento a tempo. */
  type: "none" | "heal" | "variable" | "powerup";
  amount?: number;
  variable?: string;
  powerup?: string;
  seconds?: number;
  /** Intensità del potenziamento (0 = quella normale). */
  strength?: number;
}

/** Un oggetto dell'archivio (scheda Oggetti): si raccoglie, si compra nei negozi, finisce nell'inventario. */
export interface ItemData {
  id: string;
  name: string;
  /** Immagine dell'icona e fotogramma. */
  icon?: string;
  frame?: number;
  description?: string;
  /** consumable = si usa e sparisce; key = resta (chiavi, oggetti delle missioni); instant = fa effetto appena preso. */
  kind: "consumable" | "key" | "instant";
  /** Prezzo nei negozi. */
  price?: number;
  /** Quanti se ne possono tenere (0 = senza limite). */
  max?: number;
  effect?: ItemEffect;
}

export interface ProjectData {
  format: "pepino";
  version: 1;
  name: string;
  settings: ProjectSettings;
  input: Record<string, string[]>;
  variables: Record<string, VariableValue>;
  assets: AssetData[];
  tilesets: TilesetData[];
  prefabs: PrefabData[];
  scenes: SceneData[];
  /** Regole globali: valgono in tutte le scene. */
  rules?: RuleData[];
  dialogues?: DialogueData[];
  /** Filmati, avviati dalla Regola «Avvia un filmato». */
  cutscenes?: CutsceneData[];
  /** Archivio degli oggetti (scheda Oggetti): inventario, raccolta, negozi, potenziamenti. */
  items?: ItemData[];
  scripts?: ScriptData[];
  /** Lingue del gioco: la prima è quella in cui sono scritti i testi. */
  languages?: LanguageInfo[];
  /** Traduzioni: lingua → testo originale → testo tradotto. */
  translations?: Record<string, Record<string, string>>;
}

export interface LanguageInfo {
  /** Codice breve: it, en, es… (serve anche a scegliere da solo la lingua del browser). */
  id: string;
  name: string;
}

export const LANGUAGE_PRESETS: LanguageInfo[] = [
  { id: "it", name: "Italiano" },
  { id: "en", name: "English" },
  { id: "es", name: "Español" },
  { id: "fr", name: "Français" },
  { id: "de", name: "Deutsch" },
  { id: "pt", name: "Português" },
  { id: "ja", name: "日本語" },
];

export const DEFAULT_INPUT: Record<string, string[]> = {
  left: ["Key:ArrowLeft", "Key:KeyA", "Pad:DPadLeft", "Pad:LeftStickLeft"],
  right: ["Key:ArrowRight", "Key:KeyD", "Pad:DPadRight", "Pad:LeftStickRight"],
  up: ["Key:ArrowUp", "Key:KeyW", "Pad:DPadUp", "Pad:LeftStickUp"],
  down: ["Key:ArrowDown", "Key:KeyS", "Pad:DPadDown", "Pad:LeftStickDown"],
  jump: ["Key:Space", "Key:KeyZ", "Pad:A"],
  dash: ["Key:ShiftLeft", "Key:KeyX", "Pad:RB", "Pad:B"],
  action: ["Key:KeyC", "Key:Enter", "Pad:X"],
  attack: ["Key:KeyV", "Key:KeyJ", "Pad:Y"],
  item: ["Key:KeyQ", "Pad:LB"],
  nextItem: ["Key:KeyE", "Pad:RT"],
  pause: ["Key:Escape", "Pad:Start"],
};

/**
 * Tasti di ogni giocatore quando si gioca in più sullo stesso schermo: le azioni si chiamano "p1.left", "p2.action"…
 * Ognuno ha anche il suo gamepad ("Pad2:A" = il secondo gamepad collegato).
 */
export const PLAYER_KEYS: { left: string; right: string; up: string; down: string; action: string[] }[] = [
  { left: "KeyA", right: "KeyD", up: "KeyW", down: "KeyS", action: ["Space", "KeyQ", "KeyE"] },
  { left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown", action: ["Enter", "ControlRight", "ShiftRight"] },
  { left: "KeyJ", right: "KeyL", up: "KeyI", down: "KeyK", action: ["KeyU", "KeyO"] },
  { left: "Numpad4", right: "Numpad6", up: "Numpad8", down: "Numpad5", action: ["Numpad0", "NumpadEnter", "Numpad7"] },
];

/** Comandi dei giocatori da 1 a `count` (al massimo 4), da aggiungere a quelli del progetto. */
export function playerInput(count = 4): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  PLAYER_KEYS.slice(0, count).forEach((k, i) => {
    const p = `p${i + 1}.`;
    const pad = `Pad${i + 1}`;
    out[`${p}left`] = [`Key:${k.left}`, `${pad}:DPadLeft`, `${pad}:LeftStickLeft`];
    out[`${p}right`] = [`Key:${k.right}`, `${pad}:DPadRight`, `${pad}:LeftStickRight`];
    out[`${p}up`] = [`Key:${k.up}`, `${pad}:DPadUp`, `${pad}:LeftStickUp`];
    out[`${p}down`] = [`Key:${k.down}`, `${pad}:DPadDown`, `${pad}:LeftStickDown`];
    out[`${p}action`] = [...k.action.map((a) => `Key:${a}`), `${pad}:A`, `${pad}:X`];
  });
  return out;
}

export const INPUT_LABELS: Record<string, string> = {
  left: "Sinistra",
  right: "Destra",
  up: "Su",
  down: "Giù",
  jump: "Salto",
  dash: "Dash",
  action: "Azione",
  attack: "Attacco",
  item: "Usa oggetto",
  nextItem: "Oggetto successivo",
  pause: "Pausa",
};

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
  language: "js" | "py";
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
  pause: ["Key:Escape", "Pad:Start"],
};

export const INPUT_LABELS: Record<string, string> = {
  left: "Sinistra",
  right: "Destra",
  up: "Su",
  down: "Giù",
  jump: "Salto",
  dash: "Dash",
  action: "Azione",
  attack: "Attacco",
  pause: "Pausa",
};

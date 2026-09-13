import { Emitter } from "./events";
import { Scene } from "./scene";
import { Renderer, type TextStyle } from "../render/renderer";
import { Input } from "../input/input";
import { AudioSystem } from "../audio/audio";
import { Assets } from "../assets/assets";
import { packColor, parseColor } from "../math";
import { DEFAULT_INPUT, type ProjectData, type VariableValue } from "../project/format";
import { registerBuiltinBlocks } from "../blocks";
import { interpolate } from "../blocks/text";
import { frameRect } from "../assets/assets";
import { DialogueRunner } from "../dialogue/dialogue";
import type { Entity } from "./entity";

export type LogLevel = "info" | "warn" | "error";

export interface GameOptions {
  /** Indirizzo da cui risolvere i percorsi degli asset (di solito quello di project.json). */
  baseUrl: string;
  debug?: boolean;
  startScene?: string;
  onLog?: (level: LogLevel, message: string) => void;
}

export interface DebugState {
  overlay: boolean;
  paused: boolean;
  step: boolean;
  timeScale: number;
  fps: number;
}

interface Message {
  text: string;
  /** Secondi a schermo dopo che il testo è comparso; 0 = finché il giocatore preme Azione. */
  duration: number;
  /** Ferma il gioco mentre il messaggio è visibile. */
  pause: boolean;
}

interface ActiveMessage extends Message {
  shown: number;
  time: number;
  lines?: string[];
}

const MESSAGE_STYLE: TextStyle = { size: 8, color: "#f2f7ee", bold: false };

/**
 * Il gioco: carica gli asset, gestisce le scene e fa girare il loop a passo fisso (60 Hz).
 * È lo stesso codice nell'anteprima dell'editor e nella build WebGL.
 */
export class Game {
  static readonly STEP = 1 / 60;
  readonly renderer: Renderer;
  readonly input: Input;
  readonly audio = new AudioSystem();
  readonly assets: Assets;
  readonly events = new Emitter();
  readonly debug: DebugState = { overlay: false, paused: false, step: false, timeScale: 1, fps: 60 };
  vars: Record<string, VariableValue>;
  scene?: Scene;
  /** Pausa chiesta dal giocatore (Esc / Start). */
  paused = false;

  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;
  private fade = { alpha: 1, target: 0, duration: 0.35, pending: null as null | (() => void) };
  private messages: Message[] = [];
  private message: ActiveMessage | null = null;
  /** Variabili com'erano all'ingresso nella scena: "Riavvia scena" le ripristina. */
  private sceneStartVars: Record<string, VariableValue> = {};
  private stopped = false;
  /** Dialoghi con scelte: mentre uno è aperto il gioco resta fermo. */
  readonly dialogue: DialogueRunner;
  private dialogueWrap: { key: string; lines: string[] } | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly project: ProjectData,
    private opts: GameOptions,
  ) {
    registerBuiltinBlocks();
    const res = project.settings.resolution;
    this.renderer = new Renderer(canvas, res.width, res.height);
    this.input = new Input({ ...DEFAULT_INPUT, ...project.input });
    this.input.attachPointer(canvas);
    this.assets = new Assets(opts.baseUrl, this.renderer, this.audio);
    this.vars = structuredClone(project.variables ?? {});
    this.debug.overlay = !!opts.debug;
    this.dialogue = new DialogueRunner(
      () => this.project.dialogues ?? [],
      () => this.vars,
      (id, speaker) => this.onDialogueEnd(id, speaker),
    );
  }

  /** Apre un dialogo del progetto. `speaker` = chi parla (per le Regole: "questo oggetto"). */
  startDialogue(id: string, speaker?: Entity): boolean {
    if (this.dialogue.active) return false;
    const ok = this.dialogue.start(id, speaker);
    if (!ok) this.log(`Il dialogo "${id}" non esiste o non ha battute`, "warn");
    return ok;
  }

  private onDialogueEnd(id: string, speaker?: Entity) {
    const payload = { dialogue: id };
    if (speaker && !speaker.destroyed) speaker.emit("dialogueEnd", payload);
    else this.scene?.events.emit("dialogueEnd", { entity: undefined, data: payload });
  }

  get settings() {
    return this.project.settings;
  }

  async start(onProgress?: (p: number) => void): Promise<void> {
    await this.assets.loadAll(this.project, onProgress);
    // Fermato mentre caricava (es. "Ferma" premuto subito nell'editor): non partire.
    if (this.stopped) return;
    for (const err of this.assets.errors) this.log(`Asset non caricato: ${err}`, "error");
    this.loadScene(this.opts.startScene || this.settings.startScene);
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  loadScene(id: string, restoreVars = false): void {
    const data = this.project.scenes.find((s) => s.id === id) ?? this.project.scenes[0];
    if (!data) throw new Error("Il progetto non contiene scene.");
    this.scene?.dispose();
    this.paused = false;
    this.dialogue.cancel();
    if (restoreVars) this.vars = structuredClone(this.sceneStartVars);
    else this.sceneStartVars = structuredClone(this.vars);
    this.scene = new Scene(this, data);
    if (data.music) this.audio.playMusic(data.music);
    else this.audio.stopMusic();
    this.events.emit("sceneLoaded", data.id);
    this.log(`Scena "${data.name}" caricata`);
  }

  /** Cambia scena con una dissolvenza al nero. */
  goToScene(id: string, fade = 0.35, restart = false): void {
    if (this.fade.pending) return;
    if (!this.project.scenes.some((s) => s.id === id)) {
      this.log(`Scena "${id}" inesistente`, "warn");
      return;
    }
    this.fade.duration = Math.max(0.01, fade);
    this.fade.target = 1;
    this.fade.pending = () => {
      this.loadScene(id, restart);
      this.fade.target = 0;
    };
  }

  /** Ricomincia la scena com'era all'ingresso, variabili comprese (niente monete "raddoppiate"). */
  restartScene(fade = 0.35): void {
    if (this.scene) this.goToScene(this.scene.data.id, fade, true);
  }

  // ---------- messaggi ----------

  showMessage(text: string, duration = 3, pause = false): void {
    if (text) this.messages.push({ text, duration, pause });
  }

  /** Vero se il gioco è fermo per la pausa, un messaggio o un dialogo. */
  get isBlocked(): boolean {
    return this.paused || !!this.message?.pause || this.dialogue.active;
  }

  // ---------- salvataggi ----------

  private get saveKey() {
    return `pepino:${this.project.name}:partita`;
  }

  saveGame(): boolean {
    try {
      localStorage.setItem(this.saveKey, JSON.stringify({ scene: this.scene?.data.id, vars: this.vars, time: Date.now() }));
      this.log("Partita salvata");
      return true;
    } catch {
      this.log("Non è stato possibile salvare la partita", "warn");
      return false;
    }
  }

  hasSave(): boolean {
    try {
      return !!localStorage.getItem(this.saveKey);
    } catch {
      return false;
    }
  }

  loadGame(): boolean {
    try {
      const raw = localStorage.getItem(this.saveKey);
      if (!raw) return false;
      const save = JSON.parse(raw) as { scene?: string; vars?: Record<string, VariableValue> };
      this.vars = { ...this.vars, ...save.vars };
      if (save.scene) this.goToScene(save.scene);
      this.log("Partita caricata");
      return true;
    } catch {
      this.log("Salvataggio illeggibile", "warn");
      return false;
    }
  }

  stop(): void {
    this.stopped = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.input.detach();
    this.audio.dispose();
    this.scene?.dispose();
    this.scene = undefined;
    this.assets.dispose();
    this.renderer.dispose();
  }

  log(message: string, level: LogLevel = "info"): void {
    this.opts.onLog?.(level, message);
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn("[Pepino]", message);
  }

  private frame = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    if (dt > 0) this.debug.fps += (1 / dt - this.debug.fps) * 0.05;

    if (this.debug.step) {
      this.debug.step = false;
      this.tick(Game.STEP);
    } else if (!this.debug.paused) {
      this.acc += dt * this.debug.timeScale;
      let steps = 0;
      while (this.acc >= Game.STEP && steps < 5) {
        this.tick(Game.STEP);
        this.acc -= Game.STEP;
        steps++;
      }
      if (steps === 5) this.acc = 0;
    }
    this.render();
  };

  private tick(dt: number): void {
    this.input.beginStep();
    if (this.input.keyPressed("F1")) this.debug.overlay = !this.debug.overlay;
    if (this.input.pressed("pause") && !this.message?.pause && !this.dialogue.active && !this.fade.pending) this.paused = !this.paused;
    if (!this.isBlocked) this.scene?.update(dt);
    // Il dialogo si aggiorna dal passo dopo quello in cui è partito (lo protegge anche la sua breve attesa).
    if (this.dialogue.active) this.dialogue.update(dt, this.input);
    else this.updateMessage(dt);
    this.input.endStep();

    const f = this.fade;
    if (f.alpha !== f.target) {
      const delta = dt / f.duration;
      f.alpha = f.alpha < f.target ? Math.min(f.target, f.alpha + delta) : Math.max(f.target, f.alpha - delta);
    }
    if (f.alpha >= 1 && f.pending) {
      const run = f.pending;
      f.pending = null;
      run();
    }
  }

  private updateMessage(dt: number): void {
    if (!this.message) {
      const next = this.messages.shift();
      // Il messaggio compare dal passo successivo: il tasto che l'ha aperto non lo chiude subito.
      if (next) this.message = { ...next, shown: 0, time: 0 };
      return;
    }
    const m = this.message;
    const interactive = m.pause || m.duration <= 0;
    const confirm = interactive && (this.input.pressed("action") || this.input.pressed("jump"));
    if (m.shown < m.text.length) {
      m.shown = confirm ? m.text.length : Math.min(m.text.length, m.shown + dt * 45);
      return;
    }
    m.time += dt;
    if (m.duration > 0 ? m.time >= m.duration : confirm) this.message = null;
  }

  private render(): void {
    const r = this.renderer;
    r.resize();
    const bg = parseColor(this.scene?.data.background || this.settings.background, [0.08, 0.09, 0.1, 1]);
    r.beginVirtual(bg);
    this.scene?.render(r, this.debug.overlay);
    r.present(this.settings.pixelPerfect);
    this.scene?.renderScreen(r);
    if (this.dialogue.active) this.renderDialogue(r);
    else this.renderMessage(r);
    if (this.paused) this.renderPause(r);
    if (this.fade.alpha > 0) r.rect(0, 0, r.width, r.height, packColor(0, 0, 0, this.fade.alpha));
    if (this.debug.overlay) this.renderDebugHud(r);
    r.endFrame();
  }

  private wrap(r: Renderer, text: string, maxW: number): string[] {
    const out: string[] = [];
    for (const para of text.split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const test = line ? `${line} ${word}` : word;
        if (line && r.measureText(test, MESSAGE_STYLE) > maxW) {
          out.push(line);
          line = word;
        } else line = test;
      }
      out.push(line);
    }
    return out;
  }

  private renderMessage(r: Renderer): void {
    const m = this.message;
    if (!m) return;
    const W = r.width;
    const H = r.height;
    const pad = 8;
    m.lines ??= this.wrap(r, m.text, W - pad * 4);
    const lineH = 11;
    const boxH = m.lines.length * lineH + 12;
    const y = H - boxH - pad;
    const t = Math.max(1 / r.pixelScale, 0.5);
    r.rect(pad, y, W - pad * 2, boxH, packColor(0.04, 0.06, 0.04, 0.9));
    r.strokeRect(pad, y, W - pad * 2, boxH, t, packColor(0.55, 0.77, 0.5, 1));
    let left = Math.floor(m.shown);
    m.lines.forEach((line, i) => {
      if (left <= 0) return;
      r.text(line.slice(0, left), pad * 2, y + 6 + i * lineH, MESSAGE_STYLE);
      left -= line.length + 1;
    });
    const interactive = m.pause || m.duration <= 0;
    if (interactive && m.shown >= m.text.length && Math.floor(performance.now() / 400) % 2 === 0) {
      r.text("▼", W - pad * 2 - 6, y + boxH - 12, { size: 7, color: "#8cc480" });
    }
  }

  private renderDialogue(r: Renderer): void {
    const d = this.dialogue.current;
    const line = this.dialogue.line;
    if (!d || !line) return;
    const W = r.width;
    const H = r.height;
    const pad = 8;
    const img = line.portrait ? this.assets.image(line.portrait) : undefined;
    const pSize = img ? 36 : 0;
    const textX = pad * 2 + (img ? pSize + 8 : 0);
    const key = `${d.data.id}:${d.index}:${d.text}`;
    if (this.dialogueWrap?.key !== key) this.dialogueWrap = { key, lines: this.wrap(r, d.text, W - textX - pad * 2) };
    const lines = this.dialogueWrap.lines;
    const lineH = 11;
    const nameH = line.speaker ? 12 : 0;
    const choices = this.dialogue.choices;
    const showChoices = this.dialogue.fullyShown && choices.length > 0;
    const bodyH = nameH + lines.length * lineH + (showChoices ? choices.length * lineH + 4 : 0);
    const boxH = Math.max(pSize + 12, bodyH + 12);
    const y = H - boxH - pad;
    const t = Math.max(1 / r.pixelScale, 0.5);
    const accent = packColor(0.55, 0.77, 0.5, 1);
    r.rect(pad, y, W - pad * 2, boxH, packColor(0.04, 0.06, 0.04, 0.92));
    r.strokeRect(pad, y, W - pad * 2, boxH, t, accent);
    if (img) {
      const f = frameRect(img, line.portraitFrame ?? 0);
      r.rect(pad * 2 - 1, y + 5, pSize + 2, pSize + 2, accent);
      r.rect(pad * 2, y + 6, pSize, pSize, packColor(0.1, 0.13, 0.1, 1));
      r.draw(img.tex, f.sx, f.sy, f.fw, f.fh, pad * 2, y + 6, pSize, pSize);
    }
    let ty = y + 6;
    if (line.speaker) {
      r.text(line.speaker, textX, ty, { size: 8, color: "#8cc480" });
      ty += nameH;
    }
    let left = Math.floor(d.shown);
    lines.forEach((ln, i) => {
      if (left <= 0) return;
      r.text(ln.slice(0, left), textX, ty + i * lineH, MESSAGE_STYLE);
      left -= ln.length + 1;
    });
    ty += lines.length * lineH + 4;
    if (showChoices) {
      choices.forEach((c, i) => {
        const on = i === d.choice;
        r.text(`${on ? "▶" : "  "} ${interpolate(c.text, this.vars)}`, textX, ty + i * lineH, {
          size: 8,
          bold: on,
          color: on ? "#ffffff" : "#9aa894",
        });
      });
    } else if (this.dialogue.fullyShown && Math.floor(performance.now() / 400) % 2 === 0) {
      r.text("▼", W - pad * 2 - 6, y + boxH - 12, { size: 7, color: "#8cc480" });
    }
  }

  private renderPause(r: Renderer): void {
    const W = r.width;
    const H = r.height;
    r.rect(0, 0, W, H, packColor(0, 0, 0, 0.55));
    r.text("Pausa", W / 2, H / 2 - 14, { size: 16, align: "center", shadow: true });
    r.text("Premi Esc (o Start) per riprendere", W / 2, H / 2 + 6, { size: 7, align: "center", color: "#c8d8c0", bold: false });
  }

  private renderDebugHud(r: Renderer): void {
    const s = this.scene;
    const lines = [
      `${Math.round(this.debug.fps)} FPS · ${r.drawCalls} draw call`,
      `${s?.entities.length ?? 0} oggetti · ${s?.data.name ?? "-"}`,
      this.debug.paused ? "IN PAUSA" : this.debug.timeScale !== 1 ? `velocità ×${this.debug.timeScale}` : "",
    ].filter(Boolean);
    const w = Math.max(...lines.map((l) => r.measureText(l, { size: 6 }))) + 6;
    r.rect(2, 2, w, lines.length * 8 + 4, packColor(0, 0, 0, 0.6));
    lines.forEach((l, i) => r.text(l, 5, 4 + i * 8, { size: 6, color: "#c8f7a8" }));
  }
}

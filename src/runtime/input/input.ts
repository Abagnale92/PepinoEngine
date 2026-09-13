import type { Intent } from "../core/entity";

/** Tasti del gamepad secondo la mappatura standard del browser. */
const PAD_BUTTONS: Record<string, number> = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  Select: 8,
  Start: 9,
  DPadUp: 12,
  DPadDown: 13,
  DPadLeft: 14,
  DPadRight: 15,
};

const PAD_STICK: Record<string, [axis: number, dir: number]> = {
  LeftStickLeft: [0, -1],
  LeftStickRight: [0, 1],
  LeftStickUp: [1, -1],
  LeftStickDown: [1, 1],
};

const STICK_DEADZONE = 0.4;

function isEditable(t: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}

function padActive(pad: Gamepad, name: string): boolean {
  const b = PAD_BUTTONS[name];
  if (b !== undefined) return !!pad.buttons[b]?.pressed;
  const s = PAD_STICK[name];
  if (s) return (pad.axes[s[0]] ?? 0) * s[1] > STICK_DEADZONE;
  return false;
}

/**
 * Mappa dei comandi: il gioco chiede "salto premuto?" e non "Spazio premuto?".
 * Ogni azione può avere più tasti: tastiera ("Key:Space"), gamepad ("Pad:A") o tocco (virtuale).
 */
export class Input {
  private keys = new Set<string>();
  /** Tasti premuti dall'ultimo passo di gioco: così nessun tocco rapido va perso. */
  private keyQueue = new Set<string>();
  private down = new Set<string>();
  private prev = new Set<string>();
  private pressedNow = new Set<string>();
  private virtual = new Map<string, boolean>();
  private boundKeys = new Set<string>();
  /** Mouse o tocco, in pixel CSS relativi al canvas. `pressed` e `moved` valgono per un solo passo. */
  readonly pointer = { x: -1, y: -1, down: false, pressed: false, moved: false };
  private pointerPressQ = false;
  private pointerMoveQ = false;
  private pointerEl?: HTMLElement;

  constructor(private bindings: Record<string, string[]>) {
    for (const list of Object.values(bindings)) {
      for (const b of list) if (b.startsWith("Key:")) this.boundKeys.add(b.slice(4));
    }
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    // Chi scrive in un campo di testo (es. l'Inspector durante l'anteprima) non sta giocando.
    if (isEditable(e.target)) return;
    if (this.boundKeys.has(e.code) || e.code === "F1") e.preventDefault();
    if (!this.keys.has(e.code)) this.keyQueue.add(e.code);
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => {
    this.keys.clear();
  };

  attachPointer(el: HTMLElement): void {
    this.pointerEl = el;
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointerup", this.onPointerUp);
  }

  private onPointerMove = (e: PointerEvent) => {
    const r = this.pointerEl!.getBoundingClientRect();
    this.pointer.x = e.clientX - r.left;
    this.pointer.y = e.clientY - r.top;
    this.pointerMoveQ = true;
  };

  private onPointerDown = (e: PointerEvent) => {
    this.onPointerMove(e);
    this.pointer.down = true;
    this.pointerPressQ = true;
  };

  private onPointerUp = () => {
    this.pointer.down = false;
  };

  /** Da chiamare all'inizio di ogni passo di gioco. */
  beginStep(): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.down.clear();
    this.pressedNow.clear();
    this.pointer.pressed = this.pointerPressQ;
    this.pointer.moved = this.pointerMoveQ;
    for (const [action, list] of Object.entries(this.bindings)) {
      let isDown = !!this.virtual.get(action);
      let queued = false;
      for (const b of list) {
        const sep = b.indexOf(":");
        const kind = b.slice(0, sep);
        const name = b.slice(sep + 1);
        if (kind === "Key") {
          if (this.keys.has(name)) isDown = true;
          if (this.keyQueue.has(name)) queued = true;
        } else if (kind === "Pad") {
          for (const p of pads) if (p && padActive(p, name)) isDown = true;
        }
      }
      if (isDown) this.down.add(action);
      if ((isDown && !this.prev.has(action)) || queued) this.pressedNow.add(action);
    }
  }

  /** Da chiamare alla fine di ogni passo di gioco. */
  endStep(): void {
    this.prev = new Set(this.down);
    this.keyQueue.clear();
    this.pointerPressQ = false;
    this.pointerMoveQ = false;
  }

  isDown(action: string): boolean {
    return this.down.has(action);
  }

  /** Vero solo nel passo in cui l'azione è stata premuta. */
  pressed(action: string): boolean {
    return this.pressedNow.has(action);
  }

  axis(negative: string, positive: string): number {
    return (this.isDown(positive) ? 1 : 0) - (this.isDown(negative) ? 1 : 0);
  }

  /** Tasto fisico premuto in questo passo (per scorciatoie di debug). */
  keyPressed(code: string): boolean {
    return this.keyQueue.has(code);
  }

  /** Per i controlli touch sullo schermo. */
  setVirtual(action: string, down: boolean): void {
    this.virtual.set(action, down);
  }

  readIntent(it: Intent): void {
    it.x = this.axis("left", "right");
    it.y = this.axis("up", "down");
    it.jump = this.isDown("jump");
    it.jumpPressed = this.pressed("jump");
    it.dashPressed = this.pressed("dash");
    it.actionPressed = this.pressed("action");
  }

  detach(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.pointerEl?.removeEventListener("pointermove", this.onPointerMove);
    this.pointerEl?.removeEventListener("pointerdown", this.onPointerDown);
  }
}

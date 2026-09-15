import type { Input } from "./input";
import { DEFAULT_TOUCH, INPUT_LABELS, type TouchSettings } from "../project/format";

/** Vero se, con queste impostazioni, sul dispositivo vanno mostrati i controlli touch. */
export function wantsTouch(s?: TouchSettings): boolean {
  const mode = s?.mode ?? "auto";
  if (mode === "off") return false;
  if (mode === "always") return true;
  if (typeof matchMedia === "undefined") return false;
  return matchMedia("(pointer: coarse)").matches;
}

const CSS = `
.pepino-touch { position: absolute; inset: 0; z-index: 10; pointer-events: none; user-select: none; -webkit-user-select: none;
  font: 600 12px/1 "Segoe UI", system-ui, sans-serif; }
.pepino-touch > * { pointer-events: auto; touch-action: none; -webkit-tap-highlight-color: transparent; }
.pt-stick { position: absolute; left: 20px; bottom: 22px; width: 128px; height: 128px; border-radius: 50%;
  background: rgba(255,255,255,.08); border: 2px solid rgba(255,255,255,.22); }
.pt-knob { position: absolute; left: 50%; top: 50%; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%;
  background: rgba(255,255,255,.3); pointer-events: none; }
.pt-buttons { position: absolute; right: 20px; bottom: 22px; display: grid; grid-template-columns: repeat(2, 66px); gap: 12px; direction: rtl; }
.pt-btn { direction: ltr; width: 66px; height: 66px; border-radius: 50%; border: 2px solid rgba(255,255,255,.3);
  background: rgba(255,255,255,.12); color: rgba(255,255,255,.88); font: inherit; padding: 0; }
.pt-btn.on, .pt-pause.on { background: rgba(140,196,128,.5); }
.pt-pause { position: absolute; right: 14px; top: 12px; width: 44px; height: 32px; border-radius: 8px; border: 2px solid rgba(255,255,255,.25);
  background: rgba(0,0,0,.25); color: rgba(255,255,255,.85); font: inherit; letter-spacing: 1px; padding: 0; }
`;

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

/** Collega un pulsante a un'azione: premuto finché il dito resta giù. */
function holdButton(b: HTMLElement, input: Input, action: string): void {
  const on = (e: PointerEvent) => {
    e.preventDefault();
    b.setPointerCapture?.(e.pointerId);
    b.classList.add("on");
    input.setVirtual(action, true);
  };
  const off = () => {
    b.classList.remove("on");
    input.setVirtual(action, false);
  };
  b.addEventListener("pointerdown", on);
  b.addEventListener("pointerup", off);
  b.addEventListener("pointercancel", off);
  b.addEventListener("lostpointercapture", off);
  b.addEventListener("contextmenu", (e) => e.preventDefault());
}

/**
 * Joystick a sinistra e pulsanti a destra, sopra il gioco. Premono le stesse azioni della tastiera
 * (sinistra, destra, salto…), quindi funzionano con tutti i blocchi e le Regole.
 * Restituisce la funzione che li toglie.
 */
export function mountTouchControls(root: HTMLElement, input: Input, settings: TouchSettings = DEFAULT_TOUCH): () => void {
  if (!document.getElementById("pepino-touch-css")) {
    const style = document.createElement("style");
    style.id = "pepino-touch-css";
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  const layer = el("div", "pepino-touch");

  const stick = el("div", "pt-stick");
  const knob = el("div", "pt-knob");
  stick.appendChild(knob);
  let stickId = -1;
  const setDirs = (x: number, y: number) => {
    input.setVirtual("left", x < -0.35);
    input.setVirtual("right", x > 0.35);
    input.setVirtual("up", y < -0.35);
    input.setVirtual("down", y > 0.35);
  };
  const moveStick = (e: PointerEvent) => {
    const r = stick.getBoundingClientRect();
    const rad = r.width / 2;
    let dx = (e.clientX - (r.left + rad)) / rad;
    let dy = (e.clientY - (r.top + rad)) / rad;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    knob.style.transform = `translate(${dx * rad * 0.55}px, ${dy * rad * 0.55}px)`;
    setDirs(dx, dy);
  };
  const releaseStick = (e: PointerEvent) => {
    if (e.pointerId !== stickId) return;
    stickId = -1;
    knob.style.transform = "";
    setDirs(0, 0);
  };
  stick.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    stickId = e.pointerId;
    stick.setPointerCapture?.(e.pointerId);
    moveStick(e);
  });
  stick.addEventListener("pointermove", (e) => e.pointerId === stickId && moveStick(e));
  stick.addEventListener("pointerup", releaseStick);
  stick.addEventListener("pointercancel", releaseStick);

  const pad = el("div", "pt-buttons");
  const actions = settings.buttons.slice(0, 4);
  for (const action of actions) {
    const b = el("button", "pt-btn");
    (b as HTMLButtonElement).type = "button";
    b.textContent = INPUT_LABELS[action] ?? action;
    holdButton(b, input, action);
    pad.appendChild(b);
  }

  const pause = el("button", "pt-pause");
  (pause as HTMLButtonElement).type = "button";
  pause.textContent = "II";
  pause.title = "Pausa";
  holdButton(pause, input, "pause");

  layer.append(stick, pad, pause);
  root.appendChild(layer);
  return () => {
    layer.remove();
    for (const a of ["left", "right", "up", "down", "pause", ...actions]) input.setVirtual(a, false);
  };
}

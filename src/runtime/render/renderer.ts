import { clamp, WHITE, type RGBA } from "../math";
import { screenEffectIndex, type ScreenEffect } from "./effects";
import {
  bitmapFont,
  bitmapUnit,
  canDrawBitmap,
  DEFAULT_FONT_ID,
  drawBitmapText,
  fontCss,
  measureBitmapText,
  SANS_CSS,
  type BitmapFont,
} from "./fonts";

export interface Texture {
  tex: WebGLTexture;
  width: number;
  height: number;
}

export interface TextStyle {
  size?: number;
  color?: string;
  align?: "left" | "center" | "right";
  shadow?: boolean;
  bold?: boolean;
  /** Id del carattere: "pixel", "sans"… o l'id di un asset carattere. Vuoto = quello del progetto. */
  font?: string;
  /** Contorno intorno alle lettere: true = scuro, oppure un colore. */
  outline?: boolean | string;
}

/** "normal" = sovrapposizione, "add" = i colori si sommano (luci, scintille). */
export type BlendMode = "normal" | "add";

const VERT = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in vec2 a_uv;
layout(location=2) in vec4 a_color;
layout(location=3) in vec4 a_extra;
uniform vec4 u_view;
out vec2 v_uv;
out vec4 v_color;
out float v_flash;
out vec3 v_flashColor;
void main() {
  v_uv = a_uv;
  v_color = a_color;
  v_flash = a_extra.x;
  // Il colore del lampo è salvato "al contrario": 0 = bianco, così chi non lo indica ottiene il lampo bianco.
  v_flashColor = vec3(1.0) - a_extra.yzw;
  gl_Position = vec4(a_pos * u_view.xy + u_view.zw, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
in vec4 v_color;
in float v_flash;
in vec3 v_flashColor;
uniform sampler2D u_tex;
out vec4 o;
void main() {
  vec4 c = texture(u_tex, v_uv) * v_color;
  c.rgb = mix(c.rgb, v_flashColor * c.a, v_flash);
  o = c;
}`;

/** Shader dell'ultimo passaggio (immagine di gioco → schermo): gli effetti a tutto schermo. */
const FRAG_POST = `#version 300 es
precision mediump float;
in vec2 v_uv;
in vec4 v_color;
in float v_flash;
uniform sampler2D u_tex;
uniform int u_effect;
uniform float u_strength;
uniform vec2 u_res;
out vec4 o;
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float vignette(vec2 uv) { return 1.0 - smoothstep(0.3, 0.78, length((uv - 0.5) * vec2(1.1, 1.0))); }
void main() {
  vec2 uv = v_uv;
  float s = u_strength;
  if (u_effect == 2) {
    vec2 c = uv * 2.0 - 1.0;
    c *= 1.0 + s * 0.07 * vec2(c.y * c.y, c.x * c.x);
    uv = c * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  }
  vec3 col = texture(u_tex, uv).rgb;
  if (u_effect == 1) {
    col *= mix(1.0, vignette(uv), s);
  } else if (u_effect == 2) {
    float line = 0.5 + 0.5 * cos(uv.y * u_res.y * 6.28318);
    col *= mix(1.0, 0.7 + 0.3 * line, s);
    col *= mix(1.0, vignette(uv), s * 0.8);
    col = mix(col, col * vec3(1.06, 1.0, 0.94), s);
  } else if (u_effect == 3) {
    float l = lum(col);
    vec3 g = l < 0.25 ? vec3(0.06, 0.22, 0.06) : l < 0.5 ? vec3(0.19, 0.38, 0.19) : l < 0.75 ? vec3(0.55, 0.67, 0.06) : vec3(0.61, 0.74, 0.06);
    col = mix(col, g, s);
  } else if (u_effect == 4) {
    col = mix(col, vec3(lum(col)), s);
  } else if (u_effect == 5) {
    float l = lum(col);
    col = mix(col, vec3(l * 1.07, l * 0.87, l * 0.62), s);
  }
  o = vec4(col, 1.0);
}`;

const MAX_QUADS = 4096;
const STRIDE = 24; // x, y, u, v (float32) + colore RGBA (u8) + extra (u8)
const WORDS = STRIDE / 4;
const OUTLINE_COLOR = "#0d140e";
const OUTLINE_DIRS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const;

interface TextEntry {
  tex: Texture;
  w: number;
  h: number;
  /** Pixel dal bordo sinistro della texture all'inizio del testo, e dal bordo alto al punto (x, y) del testo. */
  offX: number;
  offY: number;
  textW: number;
  used: number;
}

interface Prog {
  program: WebGLProgram;
  uView: WebGLUniformLocation;
}

interface PostProg extends Prog {
  uEffect: WebGLUniformLocation;
  uStrength: WebGLUniformLocation;
  uRes: WebGLUniformLocation;
}

interface Target {
  fbo: WebGLFramebuffer;
  tex: Texture;
}

/**
 * Renderer 2D su WebGL2: tutti gli sprite finiscono in un unico buffer e vengono disegnati a lotti.
 * Il gioco disegna in una texture alla risoluzione virtuale (es. 320×180), poi `present()`
 * la ingrandisce sul canvas: con il pixel-perfect la scala è intera e i pixel restano nitidi.
 */
export class Renderer {
  readonly gl: WebGL2RenderingContext;
  readonly white: Texture;
  width: number;
  height: number;
  /** Pixel reali per pixel virtuale (dopo `present`). Serve per disegnare testo nitido. */
  pixelScale = 1;
  drawCalls = 0;

  private main: Prog;
  private post: PostProg;
  private prog: Prog;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private data = new ArrayBuffer(MAX_QUADS * 4 * STRIDE);
  private f32 = new Float32Array(this.data);
  private u32 = new Uint32Array(this.data);
  private quads = 0;
  private currentTex: Texture | null = null;
  private view = new Float32Array(4);
  private blend: BlendMode = "normal";
  private scene: Target | null = null;
  private lights: Target | null = null;
  private radialTex: Texture | null = null;
  private targetW = 1;
  private targetH = 1;
  private texts = new Map<string, TextEntry>();
  private frameNo = 0;
  /** Dove è finita l'immagine di gioco sul canvas nell'ultima `present` (pixel reali). */
  private shown = { ox: 0, oy: 0, scale: 1 };
  private measureCtx: CanvasRenderingContext2D | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    width: number,
    height: number,
  ) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, premultipliedAlpha: true });
    if (!gl) throw new Error("WebGL2 non è disponibile in questo browser.");
    this.gl = gl;
    this.width = width;
    this.height = height;

    const mainProgram = this.link(VERT, FRAG);
    this.main = { program: mainProgram, uView: gl.getUniformLocation(mainProgram, "u_view")! };
    const postProgram = this.link(VERT, FRAG_POST);
    this.post = {
      program: postProgram,
      uView: gl.getUniformLocation(postProgram, "u_view")!,
      uEffect: gl.getUniformLocation(postProgram, "u_effect")!,
      uStrength: gl.getUniformLocation(postProgram, "u_strength")!,
      uRes: gl.getUniformLocation(postProgram, "u_res")!,
    };
    this.prog = this.main;

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, STRIDE, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, STRIDE, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, STRIDE, 16);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, STRIDE, 20);

    const indices = new Uint16Array(MAX_QUADS * 6);
    for (let q = 0, v = 0; q < indices.length; q += 6, v += 4) {
      indices.set([v, v + 1, v + 2, v, v + 2, v + 3], q);
    }
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    this.setParams();
    this.white = { tex, width: 1, height: 1 };
  }

  private link(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "shader");
      return sh;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "program");
    return p;
  }

  private setParams(filter: number = this.gl.NEAREST): void {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // ---------- texture ----------

  createTexture(source: TexImageSource): Texture {
    this.flush();
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.setParams();
    const s = source as { width: number; height: number };
    return { tex, width: s.width, height: s.height };
  }

  deleteTexture(t: Texture): void {
    this.flush();
    if (this.currentTex === t) this.currentTex = null;
    this.gl.deleteTexture(t.tex);
  }

  /** Cerchio bianco sfumato verso i bordi: luci, ombre a terra, particelle morbide. */
  get radial(): Texture {
    if (!this.radialTex) {
      const size = 64;
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const ctx = c.getContext("2d")!;
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.35, "rgba(255,255,255,0.7)");
      g.addColorStop(0.7, "rgba(255,255,255,0.22)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      this.radialTex = this.createTexture(c);
      this.setParams(this.gl.LINEAR);
    }
    return this.radialTex;
  }

  // ---------- frame ----------

  /** Allinea la dimensione del canvas a quella sullo schermo. */
  resize(): boolean {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width === w && this.canvas.height === h) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    return true;
  }

  private bindTarget(t: Target | null, w: number, h: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    gl.viewport(0, 0, w, h);
    this.targetW = w;
    this.targetH = h;
  }

  /** Texture della dimensione virtuale in cui disegnare (ricreata se cambia la risoluzione). */
  private ensureTarget(t: Target | null): Target {
    const gl = this.gl;
    if (t && t.tex.width === this.width && t.tex.height === this.height) return t;
    if (t) {
      gl.deleteTexture(t.tex.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.setParams();
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fbo, tex: { tex, width: this.width, height: this.height } };
  }

  /** Inizia a disegnare nella texture a risoluzione virtuale. */
  beginVirtual(clear: RGBA): void {
    this.flush();
    this.frameNo++;
    this.drawCalls = 0;
    const gl = this.gl;
    this.scene = this.ensureTarget(this.scene);
    this.bindTarget(this.scene, this.width, this.height);
    this.pixelScale = 1;
    gl.clearColor(clear[0] * clear[3], clear[1] * clear[3], clear[2] * clear[3], clear[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Inizia a disegnare direttamente sul canvas (usato dall'editor). */
  beginCanvas(clear: RGBA): void {
    this.flush();
    this.frameNo++;
    this.drawCalls = 0;
    const gl = this.gl;
    this.bindTarget(null, this.canvas.width, this.canvas.height);
    this.pixelScale = 1;
    gl.clearColor(clear[0] * clear[3], clear[1] * clear[3], clear[2] * clear[3], clear[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /**
   * Luci 2D: da qui a `endLights()` si disegnano le luci (si sommano tra loro) su una texture
   * che parte dal colore della luce ambiente. Poi quella texture moltiplica la scena.
   */
  beginLights(ambient: RGBA): void {
    this.flush();
    const gl = this.gl;
    this.lights = this.ensureTarget(this.lights);
    this.bindTarget(this.lights, this.width, this.height);
    gl.clearColor(ambient[0], ambient[1], ambient[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.setBlend("add");
  }

  endLights(): void {
    this.flush();
    if (!this.lights || !this.scene) return;
    const gl = this.gl;
    this.bindTarget(this.scene, this.width, this.height);
    this.setView(0, 0, 1);
    gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    this.drawUV(this.lights.tex, 0, 1, 1, 0, 0, 0, this.width, this.height);
    this.flush();
    this.blend = "normal";
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  setBlend(mode: BlendMode): void {
    if (mode === this.blend) return;
    this.flush();
    this.blend = mode;
    const gl = this.gl;
    if (mode === "add") gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /**
   * Copia la texture virtuale sul canvas, centrata e scalata, con l'eventuale effetto a tutto schermo.
   * Dopo la chiamata le coordinate restano virtuali ma si disegna a piena risoluzione (HUD, testi).
   */
  present(pixelPerfect: boolean, effect?: ScreenEffect): void {
    this.flush();
    this.setBlend("normal");
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    this.bindTarget(null, cw, ch);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    let scale = Math.min(cw / this.width, ch / this.height);
    if (pixelPerfect && scale >= 1) scale = Math.floor(scale);
    const w = this.width * scale;
    const h = this.height * scale;
    const ox = Math.floor((cw - w) / 2);
    const oy = Math.floor((ch - h) / 2);
    this.setView(0, 0, 1);
    if (this.scene) {
      const idx = effect ? screenEffectIndex(effect.id) : 0;
      if (idx > 0 && effect!.strength > 0) {
        this.prog = this.post;
        gl.useProgram(this.post.program);
        gl.uniform1i(this.post.uEffect, idx);
        gl.uniform1f(this.post.uStrength, clamp(effect!.strength, 0, 1));
        gl.uniform2f(this.post.uRes, this.width, this.height);
        this.drawUV(this.scene.tex, 0, 1, 1, 0, ox, oy, w, h);
        this.flush();
        this.prog = this.main;
      } else {
        this.drawUV(this.scene.tex, 0, 1, 1, 0, ox, oy, w, h);
      }
    }
    this.flush();
    // HUD e testi restano dentro l'area di gioco, senza sconfinare nelle bande nere.
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(ox, ch - oy - Math.round(h), Math.round(w), Math.round(h));
    this.shown = { ox, oy, scale };
    this.pixelScale = scale;
    this.setViewRaw((scale * 2) / cw, (-scale * 2) / ch, (ox * 2) / cw - 1, 1 - (oy * 2) / ch);
  }

  /** Converte una posizione in pixel CSS sul canvas in coordinate dello schermo di gioco. */
  toVirtual(cssX: number, cssY: number): { x: number; y: number } {
    const k = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    return { x: (cssX * k - this.shown.ox) / this.shown.scale, y: (cssY * k - this.shown.oy) / this.shown.scale };
  }

  endFrame(): void {
    this.flush();
    this.setBlend("normal");
    this.gl.disable(this.gl.SCISSOR_TEST);
    if (this.frameNo % 60 === 0) {
      for (const [key, e] of this.texts) {
        if (this.frameNo - e.used > 120) {
          this.gl.deleteTexture(e.tex.tex);
          this.texts.delete(key);
        }
      }
    }
  }

  // ---------- vista ----------

  private setViewRaw(sx: number, sy: number, ox: number, oy: number): void {
    const v = this.view;
    if (v[0] === sx && v[1] === sy && v[2] === ox && v[3] === oy) return;
    this.flush();
    v[0] = sx;
    v[1] = sy;
    v[2] = ox;
    v[3] = oy;
  }

  /** Imposta la vista: (x0, y0) è il punto del mondo che appare in alto a sinistra. */
  setView(x0: number, y0: number, zoom = 1): void {
    const W = this.targetW;
    const H = this.targetH;
    this.setViewRaw((zoom * 2) / W, (-zoom * 2) / H, (-x0 * zoom * 2) / W - 1, 1 + (y0 * zoom * 2) / H);
  }

  // ---------- disegno ----------

  flush(): void {
    if (this.quads === 0 || !this.currentTex) {
      this.quads = 0;
      return;
    }
    const gl = this.gl;
    gl.useProgram(this.prog.program);
    gl.bindVertexArray(this.vao);
    gl.uniform4fv(this.prog.uView, this.view);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.currentTex.tex);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.f32, 0, this.quads * 4 * WORDS);
    gl.drawElements(gl.TRIANGLES, this.quads * 6, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
    this.quads = 0;
    this.drawCalls++;
  }

  drawUV(
    tex: Texture,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    x: number,
    y: number,
    w: number,
    h: number,
    color = WHITE,
    flash = 0,
    flashColor = 0xffffff,
  ): void {
    this.drawQuad(tex, u0, v0, u1, v1, x, y, x + w, y, x + w, y + h, x, y + h, color, flash, flashColor);
  }

  /**
   * Quadrilatero qualsiasi: angoli in ordine alto-sinistra, alto-destra, basso-destra, basso-sinistra.
   * Serve per sprite schiacciate, ruotate o inclinate (effetti animati) e per le scie dei colpi.
   * `flashColor` (0xRRGGBB) è il colore verso cui va lo sprite quando lampeggia.
   */
  drawQuad(
    tex: Texture,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    color = WHITE,
    flash = 0,
    flashColor = 0xffffff,
  ): void {
    if (this.currentTex !== tex) {
      this.flush();
      this.currentTex = tex;
    }
    if (this.quads >= MAX_QUADS) this.flush();
    const f = this.f32;
    const u = this.u32;
    const extra =
      (Math.round(clamp(flash, 0, 1) * 255) |
        ((255 - ((flashColor >> 16) & 255)) << 8) |
        ((255 - ((flashColor >> 8) & 255)) << 16) |
        ((255 - (flashColor & 255)) << 24)) >>>
      0;
    let i = this.quads * 4 * WORDS;
    f[i] = x0; f[i + 1] = y0; f[i + 2] = u0; f[i + 3] = v0; u[i + 4] = color; u[i + 5] = extra; i += WORDS;
    f[i] = x1; f[i + 1] = y1; f[i + 2] = u1; f[i + 3] = v0; u[i + 4] = color; u[i + 5] = extra; i += WORDS;
    f[i] = x2; f[i + 1] = y2; f[i + 2] = u1; f[i + 3] = v1; u[i + 4] = color; u[i + 5] = extra; i += WORDS;
    f[i] = x3; f[i + 1] = y3; f[i + 2] = u0; f[i + 3] = v1; u[i + 4] = color; u[i + 5] = extra;
    this.quads++;
  }

  /** Disegna una porzione (sx, sy, sw, sh) di una texture nel rettangolo (dx, dy, dw, dh). */
  draw(
    tex: Texture,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    color = WHITE,
    flipX = false,
    flash = 0,
    flashColor = 0xffffff,
  ): void {
    // Piccolo margine interno: evita che il campionamento "sbordi" nel tile vicino.
    const inset = 0.01;
    let u0 = (sx + inset) / tex.width;
    let u1 = (sx + sw - inset) / tex.width;
    const v0 = (sy + inset) / tex.height;
    const v1 = (sy + sh - inset) / tex.height;
    if (flipX) [u0, u1] = [u1, u0];
    this.drawUV(tex, u0, v0, u1, v1, dx, dy, dw, dh, color, flash, flashColor);
  }

  rect(x: number, y: number, w: number, h: number, color: number): void {
    this.drawUV(this.white, 0, 0, 1, 1, x, y, w, h, color);
  }

  strokeRect(x: number, y: number, w: number, h: number, t: number, color: number): void {
    this.rect(x, y, w, t, color);
    this.rect(x, y + h - t, w, t, color);
    this.rect(x, y + t, t, h - 2 * t, color);
    this.rect(x + w - t, y + t, t, h - 2 * t, color);
  }

  // ---------- testo ----------

  /** Carattere dei testi che non ne scelgono uno: quello del progetto. Vuoto = Moderno. */
  defaultFont = "";
  /** Caratteri importati: id dell'asset → famiglia registrata nel browser. */
  private fontFamilies = new Map<string, string>();

  /** Rende disponibile un carattere importato: i testi già pronti vengono rifatti con il carattere giusto. */
  registerFont(id: string, family: string): void {
    this.fontFamilies.set(id, family);
    for (const e of this.texts.values()) this.gl.deleteTexture(e.tex.tex);
    this.texts.clear();
  }

  private fontId(style: TextStyle): string {
    return style.font || this.defaultFont || DEFAULT_FONT_ID;
  }

  private cssFont(px: number, style: TextStyle): string {
    const id = this.fontId(style);
    const family = this.fontFamilies.get(id);
    const css = family ? `"${family}", ${SANS_CSS}` : (fontCss(id) ?? SANS_CSS);
    return `${style.bold === false ? "" : "600 "}${px}px ${css}`;
  }

  /** Carattere a punti del testo, se è scelto un carattere Pixel che ha tutte le sue lettere. */
  private bitmapOf(str: string, style: TextStyle): BitmapFont | undefined {
    const f = bitmapFont(this.fontId(style));
    return f && canDrawBitmap(f, str) ? f : undefined;
  }

  /** Larghezza del testo in unità della vista corrente. */
  measureText(str: string, style: TextStyle = {}): number {
    const size = style.size ?? 10;
    const bm = this.bitmapOf(str, style);
    if (bm) return (measureBitmapText(bm, str, bm.bold || style.bold === true) * bitmapUnit(bm, size, this.pixelScale)) / this.pixelScale;
    const px = Math.max(4, Math.round(size * this.pixelScale));
    this.measureCtx ??= document.createElement("canvas").getContext("2d");
    if (!this.measureCtx) return str.length * size * 0.6;
    this.measureCtx.font = this.cssFont(px, style);
    return this.measureCtx.measureText(str).width / this.pixelScale;
  }

  /** Scrive un testo con (x, y) = angolo in alto a sinistra (o centro/destra secondo `align`). */
  text(str: string, x: number, y: number, style: TextStyle = {}): void {
    if (!str) return;
    const scale = this.pixelScale;
    const size = style.size ?? 10;
    const color = style.color ?? "#ffffff";
    const outline = style.outline === true ? OUTLINE_COLOR : style.outline || "";
    const bm = this.bitmapOf(str, style);
    const key = `${this.fontId(style)}|${bm ? "px" : ""}|${Math.round(size * scale * 100)}|${style.bold ?? ""}|${color}|${style.shadow ? 1 : 0}|${outline}|${str}`;
    let e = this.texts.get(key);
    if (!e) {
      e = bm ? this.bakeBitmapText(str, size, color, outline, style, bm) : this.bakeCssText(str, size, color, outline, style);
      this.texts.set(key, e);
    }
    e.used = this.frameNo;
    const tw = e.textW / scale;
    const align = style.align ?? "left";
    const ax = align === "center" ? x - tw / 2 : align === "right" ? x - tw : x;
    // Allineato ai pixel dello schermo: le lettere non si sfocano tra un pixel e l'altro.
    const dx = Math.round(ax * scale - e.offX) / scale;
    const dy = Math.round(y * scale - e.offY) / scale;
    this.draw(e.tex, 0, 0, e.w, e.h, dx, dy, e.w / scale, e.h / scale);
  }

  private bakeCssText(str: string, size: number, color: string, outline: string, style: TextStyle): TextEntry {
    const px = Math.max(4, Math.round(size * this.pixelScale));
    const font = this.cssFont(px, style);
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d")!;
    ctx.font = font;
    const textW = ctx.measureText(str).width;
    const so = style.shadow ? Math.max(1, Math.round(px / 10)) : 0;
    const ol = outline ? Math.max(1, Math.round(px / 9)) : 0;
    const pad = Math.ceil(px * 0.15) + so + ol;
    c.width = Math.max(1, Math.ceil(textW) + pad * 2);
    c.height = Math.ceil(px * 1.3) + pad * 2;
    ctx.font = font;
    ctx.textBaseline = "top";
    if (so) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillText(str, pad + so, pad + so);
    }
    if (ol) {
      ctx.lineJoin = "round";
      ctx.lineWidth = ol * 2;
      ctx.strokeStyle = outline;
      ctx.strokeText(str, pad, pad);
    }
    ctx.fillStyle = color;
    ctx.fillText(str, pad, pad);
    return { tex: this.createTexture(c), w: c.width, h: c.height, offX: pad, offY: pad, textW, used: 0 };
  }

  /** Testo con un carattere a punti: ogni punto è un quadratino di `u` pixel, quindi resta nitido. */
  private bakeBitmapText(str: string, size: number, color: string, outline: string, style: TextStyle, bm: BitmapFont): TextEntry {
    const scale = this.pixelScale;
    const u = bitmapUnit(bm, size, scale);
    const bold = bm.bold || style.bold === true;
    const textW = measureBitmapText(bm, str, bold) * u;
    const so = style.shadow ? u : 0;
    const ol = outline ? u : 0;
    const left = u + ol;
    // Sopra la cima delle maiuscole ci sono gli accenti (À, È…), sotto le code di g, p, q, y.
    const top = 3 * u + ol;
    const c = document.createElement("canvas");
    c.width = Math.max(1, textW + left * 2 + so);
    c.height = top + (bm.cap + 3) * u + ol + so;
    const ctx = c.getContext("2d")!;
    if (so) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      drawBitmapText(ctx, bm, str, left + so, top + so, u, bold);
    }
    if (ol) {
      ctx.fillStyle = outline;
      for (const [dx, dy] of OUTLINE_DIRS) drawBitmapText(ctx, bm, str, left + dx * ol, top + dy * ol, u, bold);
    }
    ctx.fillStyle = color;
    drawBitmapText(ctx, bm, str, left, top, u, bold);
    // Come nei caratteri normali, le maiuscole cominciano un po' sotto il punto (x, y).
    const capY = Math.round(size * 0.2 * scale);
    return { tex: this.createTexture(c), w: c.width, h: c.height, offX: left, offY: top - capY, textW, used: 0 };
  }

  dispose(): void {
    for (const e of this.texts.values()) this.gl.deleteTexture(e.tex.tex);
    this.texts.clear();
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

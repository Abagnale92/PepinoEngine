import { clamp, WHITE, type RGBA } from "../math";

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
  font?: string;
}

const VERT = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in vec2 a_uv;
layout(location=2) in vec4 a_color;
layout(location=3) in vec4 a_extra;
uniform vec4 u_view;
out vec2 v_uv;
out vec4 v_color;
out float v_flash;
void main() {
  v_uv = a_uv;
  v_color = a_color;
  v_flash = a_extra.x;
  gl_Position = vec4(a_pos * u_view.xy + u_view.zw, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec2 v_uv;
in vec4 v_color;
in float v_flash;
uniform sampler2D u_tex;
out vec4 o;
void main() {
  vec4 c = texture(u_tex, v_uv) * v_color;
  c.rgb = mix(c.rgb, vec3(c.a), v_flash);
  o = c;
}`;

const MAX_QUADS = 4096;
const STRIDE = 24; // x, y, u, v (float32) + colore RGBA (u8) + extra (u8)
const WORDS = STRIDE / 4;
const DEFAULT_FONT = '"Segoe UI", system-ui, sans-serif';

interface TextEntry {
  tex: Texture;
  w: number;
  h: number;
  pad: number;
  textW: number;
  used: number;
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

  private program: WebGLProgram;
  private uView: WebGLUniformLocation;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private data = new ArrayBuffer(MAX_QUADS * 4 * STRIDE);
  private f32 = new Float32Array(this.data);
  private u32 = new Uint32Array(this.data);
  private quads = 0;
  private currentTex: Texture | null = null;
  private view = new Float32Array(4);
  private viewDirty = true;
  private fbo: WebGLFramebuffer | null = null;
  private fboTex: Texture | null = null;
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

    this.program = this.link(VERT, FRAG);
    this.uView = gl.getUniformLocation(this.program, "u_view")!;

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

  private setParams(): void {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
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

  /** Inizia a disegnare nella texture a risoluzione virtuale. */
  beginVirtual(clear: RGBA): void {
    this.flush();
    this.frameNo++;
    this.drawCalls = 0;
    const gl = this.gl;
    this.ensureFbo();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.width, this.height);
    this.targetW = this.width;
    this.targetH = this.height;
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.targetW = this.canvas.width;
    this.targetH = this.canvas.height;
    this.pixelScale = 1;
    gl.clearColor(clear[0] * clear[3], clear[1] * clear[3], clear[2] * clear[3], clear[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /**
   * Copia la texture virtuale sul canvas, centrata e scalata.
   * Dopo la chiamata le coordinate restano virtuali ma si disegna a piena risoluzione (HUD, testi).
   */
  present(pixelPerfect: boolean): void {
    this.flush();
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    this.targetW = cw;
    this.targetH = ch;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    let scale = Math.min(cw / this.width, ch / this.height);
    if (pixelPerfect && scale >= 1) scale = Math.floor(scale);
    const w = this.width * scale;
    const h = this.height * scale;
    const ox = Math.floor((cw - w) / 2);
    const oy = Math.floor((ch - h) / 2);
    this.setView(0, 0, 1);
    if (this.fboTex) this.drawUV(this.fboTex, 0, 1, 1, 0, ox, oy, w, h);
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

  private ensureFbo(): void {
    const gl = this.gl;
    if (this.fboTex && this.fboTex.width === this.width && this.fboTex.height === this.height) return;
    if (this.fboTex) gl.deleteTexture(this.fboTex.tex);
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.setParams();
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    this.fboTex = { tex, width: this.width, height: this.height };
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
    this.viewDirty = true;
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
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    if (this.viewDirty) {
      gl.uniform4fv(this.uView, this.view);
      this.viewDirty = false;
    }
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
  ): void {
    if (this.currentTex !== tex) {
      this.flush();
      this.currentTex = tex;
    }
    if (this.quads >= MAX_QUADS) this.flush();
    const f = this.f32;
    const u = this.u32;
    const extra = Math.round(clamp(flash, 0, 1) * 255);
    let i = this.quads * 4 * WORDS;
    f[i] = x; f[i + 1] = y; f[i + 2] = u0; f[i + 3] = v0; u[i + 4] = color; u[i + 5] = extra; i += WORDS;
    f[i] = x + w; f[i + 1] = y; f[i + 2] = u1; f[i + 3] = v0; u[i + 4] = color; u[i + 5] = extra; i += WORDS;
    f[i] = x + w; f[i + 1] = y + h; f[i + 2] = u1; f[i + 3] = v1; u[i + 4] = color; u[i + 5] = extra; i += WORDS;
    f[i] = x; f[i + 1] = y + h; f[i + 2] = u0; f[i + 3] = v1; u[i + 4] = color; u[i + 5] = extra;
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
  ): void {
    // Piccolo margine interno: evita che il campionamento "sbordi" nel tile vicino.
    const inset = 0.01;
    let u0 = (sx + inset) / tex.width;
    let u1 = (sx + sw - inset) / tex.width;
    const v0 = (sy + inset) / tex.height;
    const v1 = (sy + sh - inset) / tex.height;
    if (flipX) [u0, u1] = [u1, u0];
    this.drawUV(tex, u0, v0, u1, v1, dx, dy, dw, dh, color, flash);
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

  private fontOf(px: number, style: TextStyle): string {
    return `${style.bold === false ? "" : "600 "}${px}px ${style.font ?? DEFAULT_FONT}`;
  }

  /** Larghezza del testo in unità della vista corrente. */
  measureText(str: string, style: TextStyle = {}): number {
    const px = Math.max(4, Math.round((style.size ?? 10) * this.pixelScale));
    this.measureCtx ??= document.createElement("canvas").getContext("2d");
    if (!this.measureCtx) return str.length * (style.size ?? 10) * 0.6;
    this.measureCtx.font = this.fontOf(px, style);
    return this.measureCtx.measureText(str).width / this.pixelScale;
  }

  /** Scrive un testo con (x, y) = angolo in alto a sinistra (o centro/destra secondo `align`). */
  text(str: string, x: number, y: number, style: TextStyle = {}): void {
    if (!str) return;
    const scale = this.pixelScale;
    const px = Math.max(4, Math.round((style.size ?? 10) * scale));
    const color = style.color ?? "#ffffff";
    const font = this.fontOf(px, style);
    const key = `${font}|${color}|${style.shadow ? 1 : 0}|${str}`;
    let e = this.texts.get(key);
    if (!e) {
      const c = document.createElement("canvas");
      const ctx = c.getContext("2d")!;
      ctx.font = font;
      const textW = ctx.measureText(str).width;
      const so = style.shadow ? Math.max(1, Math.round(px / 10)) : 0;
      const pad = Math.ceil(px * 0.15) + so;
      c.width = Math.max(1, Math.ceil(textW) + pad * 2);
      c.height = Math.ceil(px * 1.3) + pad * 2;
      ctx.font = font;
      ctx.textBaseline = "top";
      if (so) {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillText(str, pad + so, pad + so);
      }
      ctx.fillStyle = color;
      ctx.fillText(str, pad, pad);
      e = { tex: this.createTexture(c), w: c.width, h: c.height, pad, textW, used: 0 };
      this.texts.set(key, e);
    }
    e.used = this.frameNo;
    const tw = e.textW / scale;
    const align = style.align ?? "left";
    const ax = align === "center" ? x - tw / 2 : align === "right" ? x - tw : x;
    this.draw(e.tex, 0, 0, e.w, e.h, ax - e.pad / scale, y - e.pad / scale, e.w / scale, e.h / scale);
  }

  dispose(): void {
    for (const e of this.texts.values()) this.gl.deleteTexture(e.tex.tex);
    this.texts.clear();
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

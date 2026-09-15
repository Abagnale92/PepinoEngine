import type { AudioSystem } from "../audio/audio";
import { renderSfx, renderSong, SAMPLE_RATE } from "../audio/synth";
import type { FontAsset, ImageAsset, ProjectData } from "../project/format";
import { fontFamilyName } from "../render/fonts";
import type { Renderer, Texture } from "../render/renderer";

export interface LoadedImage {
  data: ImageAsset;
  tex: Texture;
  width: number;
  height: number;
  /** Dimensione di un fotogramma (tutta l'immagine se non è uno sprite sheet). */
  fw: number;
  fh: number;
  cols: number;
  frames: number;
}

export class Assets {
  private images = new Map<string, LoadedImage>();
  /** Caratteri importati già registrati nel browser. */
  private fonts = new Map<string, { src: string; face: FontFace }>();
  errors: string[] = [];

  constructor(
    public baseUrl: string,
    private renderer: Renderer,
    private audio?: AudioSystem,
  ) {}

  resolve(src: string): string {
    return new URL(src, this.baseUrl).href;
  }

  async loadAll(project: ProjectData, onProgress?: (p: number) => void): Promise<void> {
    const list = project.assets;
    let done = 0;
    await Promise.all(
      list.map(async (a) => {
        try {
          if (a.type === "image") await this.loadImage(a);
          else if (a.type === "font") await this.loadFont(a);
          else if (this.audio) {
            // Brani ed effetti della scheda Musica non hanno un file: si calcolano qui.
            if (a.song) this.audio.setSamples(a.id, renderSong(a.song), SAMPLE_RATE);
            else if (a.sfx) this.audio.setSamples(a.id, renderSfx(a.sfx), SAMPLE_RATE);
            else await this.audio.load(a.id, this.resolve(a.src));
          }
        } catch (err) {
          this.errors.push(`${a.src}: ${(err as Error).message}`);
        }
        onProgress?.(++done / Math.max(1, list.length));
      }),
    );
  }

  async loadImage(a: ImageAsset): Promise<LoadedImage> {
    const src = this.resolve(a.src);
    // Un'immagine ridisegnata ha lo stesso nome: la revisione evita di ricevere quella vecchia dalla cache.
    const res = await fetch(a.rev && !src.startsWith("data:") ? `${src}${src.includes("?") ? "&" : "?"}v=${a.rev}` : src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const url = URL.createObjectURL(await res.blob());
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } finally {
      URL.revokeObjectURL(url);
    }
    const old = this.images.get(a.id);
    if (old) this.renderer.deleteTexture(old.tex);
    const fw = a.frameWidth || img.width;
    const fh = a.frameHeight || img.height;
    const cols = Math.max(1, Math.floor(img.width / fw));
    const rows = Math.max(1, Math.floor(img.height / fh));
    const loaded: LoadedImage = {
      data: a,
      tex: this.renderer.createTexture(img),
      width: img.width,
      height: img.height,
      fw,
      fh,
      cols,
      frames: cols * rows,
    };
    this.images.set(a.id, loaded);
    return loaded;
  }

  /** Carica un carattere (.ttf, .otf, .woff, .woff2): i testi lo usano scegliendo l'id dell'asset. */
  async loadFont(a: FontAsset): Promise<void> {
    if (typeof FontFace === "undefined" || typeof document === "undefined") return;
    const src = this.resolve(a.src);
    const old = this.fonts.get(a.id);
    if (old?.src === src) return;
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const family = fontFamilyName(a.id);
    const face = await new FontFace(family, await res.arrayBuffer()).load();
    if (old) document.fonts.delete(old.face);
    document.fonts.add(face);
    this.fonts.set(a.id, { src, face });
    this.renderer.registerFont(a.id, family);
  }

  image(id: string): LoadedImage | undefined {
    return this.images.get(id);
  }

  dispose(): void {
    for (const i of this.images.values()) this.renderer.deleteTexture(i.tex);
    this.images.clear();
  }
}

export function frameRect(img: LoadedImage, frame: number) {
  const f = ((Math.floor(frame) % img.frames) + img.frames) % img.frames;
  return { sx: (f % img.cols) * img.fw, sy: Math.floor(f / img.cols) * img.fh, fw: img.fw, fh: img.fh };
}

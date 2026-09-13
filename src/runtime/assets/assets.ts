import type { AudioSystem } from "../audio/audio";
import type { ImageAsset, ProjectData } from "../project/format";
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
          else if (this.audio) await this.audio.load(a.id, this.resolve(a.src));
        } catch (err) {
          this.errors.push(`${a.src}: ${(err as Error).message}`);
        }
        onProgress?.(++done / Math.max(1, list.length));
      }),
    );
  }

  async loadImage(a: ImageAsset): Promise<LoadedImage> {
    const res = await fetch(this.resolve(a.src));
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

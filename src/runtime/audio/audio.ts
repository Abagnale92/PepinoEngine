export type Bus = "music" | "sfx";

interface MusicTrack {
  id: string;
  src: AudioBufferSourceNode;
  gain: GainNode;
}

/** Audio con Web Audio API: due canali (musica ed effetti) con volumi separati e dissolvenza tra brani. */
export class AudioSystem {
  private ctx?: AudioContext;
  private master?: GainNode;
  private buses: Partial<Record<Bus, GainNode>> = {};
  private buffers = new Map<string, AudioBuffer>();
  private music?: MusicTrack;
  readonly volumes: Record<"master" | Bus, number> = { master: 1, music: 0.5, sfx: 0.8 };

  constructor() {
    window.addEventListener("pointerdown", this.unlock);
    window.addEventListener("keydown", this.unlock);
  }

  /** I browser sbloccano l'audio solo dopo un gesto dell'utente. */
  private unlock = () => {
    this.context()
      .resume()
      .catch(() => {});
  };

  context(): AudioContext {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.master = ctx.createGain();
      this.master.gain.value = this.volumes.master;
      this.master.connect(ctx.destination);
      for (const bus of ["music", "sfx"] as Bus[]) {
        const g = ctx.createGain();
        g.gain.value = this.volumes[bus];
        g.connect(this.master);
        this.buses[bus] = g;
      }
      this.ctx = ctx;
    }
    return this.ctx;
  }

  async load(id: string, url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const data = await res.arrayBuffer();
    this.buffers.set(id, await this.context().decodeAudioData(data));
  }

  has(id: string): boolean {
    return this.buffers.has(id);
  }

  play(id: string, opts: { volume?: number; rate?: number } = {}): void {
    if (!id) return;
    const buf = this.buffers.get(id);
    if (!buf) return;
    const ctx = this.context();
    if (ctx.state !== "running") return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate ?? 1;
    const g = ctx.createGain();
    g.gain.value = opts.volume ?? 1;
    src.connect(g).connect(this.buses.sfx!);
    src.start();
  }

  playMusic(id: string, fade = 0.6): void {
    if (this.music?.id === id) return;
    this.stopMusic(fade);
    const buf = this.buffers.get(id);
    if (!buf) return;
    const ctx = this.context();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, ctx.currentTime + Math.max(0.01, fade));
    src.connect(gain).connect(this.buses.music!);
    src.start();
    this.music = { id, src, gain };
  }

  stopMusic(fade = 0.4): void {
    const m = this.music;
    if (!m || !this.ctx) return;
    this.music = undefined;
    const t = this.ctx.currentTime;
    m.gain.gain.cancelScheduledValues(t);
    m.gain.gain.setValueAtTime(m.gain.gain.value, t);
    m.gain.gain.linearRampToValueAtTime(0, t + Math.max(0.01, fade));
    m.src.stop(t + Math.max(0.01, fade) + 0.05);
  }

  setVolume(channel: "master" | Bus, value: number): void {
    this.volumes[channel] = value;
    const node = channel === "master" ? this.master : this.buses[channel];
    if (node) node.gain.value = value;
  }

  dispose(): void {
    window.removeEventListener("pointerdown", this.unlock);
    window.removeEventListener("keydown", this.unlock);
    this.music = undefined;
    this.ctx?.close().catch(() => {});
    this.ctx = undefined;
  }
}

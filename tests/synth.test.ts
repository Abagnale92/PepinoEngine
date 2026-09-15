import { describe, expect, it } from "vitest";
import { DEFAULT_SFX, SFX_PRESETS, createSong, makeSfx, renderSfx, renderSong, rng, sfxSeconds, songSeconds, stepSeconds } from "@runtime";

const energy = (a: Float32Array, from = 0, to = a.length) => {
  let e = 0;
  for (let i = Math.round(from); i < Math.round(to); i++) e += a[i] * a[i];
  return e / Math.max(1, to - from);
};

const peak = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe("sintetizzatore 8 bit", () => {
  it("un effetto dura salita + tenuta + sfumatura e resta tra -1 e 1", () => {
    const s = { ...DEFAULT_SFX, attack: 0.01, sustain: 0.1, decay: 0.2 };
    const out = renderSfx(s, 8000);
    expect(out.length).toBe(Math.round(0.31 * 8000));
    expect(peak(out)).toBeLessThanOrEqual(1);
    expect(energy(out)).toBeGreaterThan(0.01);
    expect(Math.abs(out[out.length - 1])).toBeLessThan(0.05);
  });

  it("i tipi di effetto sono ripetibili con lo stesso seme e suonano", () => {
    for (const p of SFX_PRESETS) {
      const a = makeSfx(p.id, rng(3));
      expect(makeSfx(p.id, rng(3))).toEqual(a);
      expect(sfxSeconds(a)).toBeGreaterThan(0.05);
      expect(energy(renderSfx(a, 8000)), p.id).toBeGreaterThan(0.001);
    }
    const jump = makeSfx("jump", rng(1));
    expect(jump.freqEnd).toBeGreaterThan(jump.freq);
    const laser = makeSfx("laser", rng(1));
    expect(laser.freqEnd).toBeLessThan(laser.freq);
  });

  it("un brano dura esattamente i suoi passi e ogni nota suona al suo posto", () => {
    const song = createSong();
    song.echo = 0;
    song.length = 16;
    song.channels[0].notes.push({ step: 4, len: 2, pitch: 69 });
    const sr = 8000;
    const out = renderSong(song, sr);
    const stepN = stepSeconds(song) * sr;
    expect(out.length).toBe(Math.round(songSeconds(song) * sr));
    expect(energy(out, 0, 4 * stepN)).toBe(0);
    expect(energy(out, 4 * stepN, 6 * stepN)).toBeGreaterThan(0.005);
    expect(energy(out, 8 * stepN, 16 * stepN)).toBe(0);
    expect(peak(out)).toBeLessThanOrEqual(1);
  });

  it("batteria ed eco", () => {
    const song = createSong();
    song.length = 16;
    song.echo = 0;
    song.channels[3].notes.push({ step: 0, len: 1, pitch: 36 }, { step: 8, len: 1, pitch: 38 });
    const sr = 8000;
    const stepN = stepSeconds(song) * sr;
    const dry = renderSong(song, sr);
    expect(energy(dry, 0, stepN)).toBeGreaterThan(0.001);
    expect(energy(dry, 8 * stepN, 9 * stepN)).toBeGreaterThan(0.001);
    expect(energy(dry, 4 * stepN, 7 * stepN)).toBe(0);
    song.echo = 0.8;
    expect(energy(renderSong(song, sr), 4 * stepN, 7 * stepN)).toBeGreaterThan(0);
  });
});

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  DRUMS,
  SAMPLE_RATE,
  SFX_PRESETS,
  WAVES,
  createSong,
  makeSfx,
  renderSfx,
  renderSong,
  songSeconds,
  stepSeconds,
  type AudioAsset,
  type SfxData,
  type SongChannel,
  type SongData,
  type Wave,
} from "@runtime";
import { editProject, getState, useEditor } from "../store";
import { uniqueId } from "../projectOps";
import { T, getEditorLang } from "../i18n";
import { Icon } from "./Icon";
import { playOnce, playSamples, playbackTime, previewNote, selectSound, stopSamples, usePlaying, useSelectedSound } from "../music/player";

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function audioAsset(id: string): AudioAsset | undefined {
  const a = getState().project?.assets.find((x) => x.id === id);
  return a?.type === "audio" ? a : undefined;
}

function updSong(id: string, fn: (s: SongData) => void, merge?: string): void {
  editProject((p) => {
    const a = p.assets.find((x) => x.id === id);
    if (a?.type === "audio" && a.song) fn(a.song);
  }, merge);
}

function updSfx(id: string, fn: (s: SfxData) => void, merge?: string): void {
  editProject((p) => {
    const a = p.assets.find((x) => x.id === id);
    if (a?.type === "audio" && a.sfx) fn(a.sfx);
  }, merge);
}

function Slider(p: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="mu-slider">
      <span className="mu-label">{p.label}</span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
      <span className="mu-val">
        {p.value < 10 ? p.value.toFixed(2) : Math.round(p.value)}
        {p.unit ? ` ${p.unit}` : ""}
      </span>
    </label>
  );
}

/** Scheda Musica: brani chiptune a 4 canali ed effetti sonori, salvati nel progetto come suoni. */
export function MusicView() {
  const project = useEditor((s) => s.project)!;
  const sel = useSelectedSound();
  const [name, setName] = useState("");
  const sounds = project.assets.filter((a): a is AudioAsset => a.type === "audio" && !!(a.song || a.sfx));
  const current = sounds.find((a) => a.id === sel) ?? null;

  useEffect(() => () => stopSamples(), []);

  const create = (kind: "song" | "sfx") => {
    const id = uniqueId(slug(name) || (kind === "song" ? "brano" : "effetto"), new Set(project.assets.map((a) => a.id)));
    editProject((p) => {
      p.assets.push(
        kind === "song"
          ? { id, type: "audio", src: "", song: createSong([T("Melodia"), T("Armonia"), T("Basso"), T("Batteria")]) }
          : { id, type: "audio", src: "", sfx: makeSfx("coin") },
      );
    });
    selectSound(id);
    setName("");
  };

  const remove = (id: string) => {
    stopSamples();
    editProject((p) => void (p.assets = p.assets.filter((a) => a.id !== id)));
  };

  return (
    <div className="mu-view">
      <aside className="mu-list">
        <div className="px-h">{T("Suoni creati")}</div>
        <input placeholder={T("Nome del nuovo suono")} value={name} onChange={(e) => setName(e.target.value)} />
        <div className="mu-new">
          <button type="button" className="px-btn" onClick={() => create("song")}>
            <Icon name="music" size={13} />
            {T(" Nuovo brano")}
          </button>
          <button type="button" className="px-btn" onClick={() => create("sfx")}>
            <Icon name="sound" size={13} />
            {T(" Nuovo effetto")}
          </button>
        </div>
        {sounds.length === 0 && <p className="empty-hint">{T("Nessun suono creato.")}</p>}
        {sounds.map((a) => (
          <div key={a.id} className={`mu-item${a.id === current?.id ? " on" : ""}`} onClick={() => selectSound(a.id)}>
            <Icon name={a.song ? "music" : "sound"} size={13} />
            <span className="mu-item-name">{a.id}</span>
            <span className="dim">{a.song ? T("brano") : T("effetto")}</span>
          </div>
        ))}
      </aside>
      <section className="mu-main">
        {current ? (
          <>
            <div className="mu-title">
              <Icon name={current.song ? "music" : "sound"} />
              <b>{current.id}</b>
              <span className="px-spacer" />
              <button type="button" className="icon-btn" title={T("Elimina il suono")} onClick={() => remove(current.id)}>
                <Icon name="trash" size={13} />
              </button>
            </div>
            {current.song ? <SongEditor key={current.id} asset={current} /> : <SfxEditor key={current.id} asset={current} />}
            <p className="empty-hint">{T("Scegli questo suono nei campi audio dei blocchi (Suono salto, Suono…) o come Musica della scena.")}</p>
          </>
        ) : (
          <div className="mu-intro">
            <Icon name="music" size={28} />
            <p>{T("Crea brani chiptune ed effetti sonori a 8 bit: diventano suoni del progetto, da usare come musica della scena o nei campi audio dei blocchi.")}</p>
            <p className="dim">{T("Scegli un suono a sinistra o creane uno nuovo.")}</p>
          </div>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ brano

const CELL = 16;
const TOP = 84;
const BOTTOM = 36;
const COLORS = ["#e5695f", "#f0b43c", "#4a8fd6", "#8cc480"];
const NOTE_IT = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"];
const NOTE_EN = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const noteName = (p: number) => `${(getEditorLang() === "en" ? NOTE_EN : NOTE_IT)[p % 12]}${Math.floor(p / 12) - 1}`;
const isBlack = (p: number) => [1, 3, 6, 8, 10].includes(p % 12);
const isDrums = (ch: SongChannel) => ch.wave === "drums";
const rowsOf = (ch: SongChannel) => (isDrums(ch) ? DRUMS.map((d) => d.pitch) : Array.from({ length: TOP - BOTTOM + 1 }, (_, i) => TOP - i));
const rowHeight = (ch: SongChannel) => (isDrums(ch) ? 22 : 12);

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Prepara un canvas nitido anche sugli schermi ad alta densità. */
function setup(c: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  const g = c.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}

function SongEditor({ asset }: { asset: AudioAsset }) {
  const song = asset.song!;
  const [chi, setChi] = useState(0);
  const [noteLen, setNoteLen] = useState(2);
  const playing = usePlaying();
  const [playStep, setPlayStep] = useState<number | null>(null);
  const ch = song.channels[chi] ?? song.channels[0];
  const upd = (fn: (s: SongData) => void, merge?: string) => updSong(asset.id, fn, merge);

  useEffect(() => {
    if (!playing) return setPlayStep(null);
    let raf = 0;
    const tick = () => {
      const t = playbackTime();
      setPlayStep(t === null ? null : t / stepSeconds(song));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [playing, song.bpm]);

  useEffect(() => () => stopSamples(), []);

  return (
    <div className="mu-editor">
      <div className="mu-bar">
        <button type="button" className={`px-btn${playing ? " on" : ""}`} onClick={() => (playing ? stopSamples() : playSamples(renderSong(song), SAMPLE_RATE, song.loop))}>
          <Icon name={playing ? "stop" : "play"} size={13} />
          {playing ? T(" Ferma") : T(" Ascolta")}
        </button>
        <label className="mu-num">
          {T("BPM")}
          <input
            type="number"
            min={40}
            max={300}
            value={song.bpm}
            onChange={(e) => upd((s) => void (s.bpm = clamp(Number(e.target.value) || 120, 40, 300)), `bpm:${asset.id}`)}
          />
        </label>
        <label className="mu-num">
          {T("Battute")}
          <input
            type="number"
            min={1}
            max={32}
            value={song.length / 16}
            onChange={(e) => upd((s) => void (s.length = clamp(Math.round(Number(e.target.value) || 1), 1, 32) * 16), `len:${asset.id}`)}
          />
        </label>
        <label className="mu-check">
          <input type="checkbox" checked={song.loop} onChange={(e) => upd((s) => void (s.loop = e.target.checked))} />
          {T("Loop")}
        </label>
        <Slider label={T("Eco")} value={song.echo} min={0} max={1} step={0.05} onChange={(v) => upd((s) => void (s.echo = v), `echo:${asset.id}`)} />
        <span className="dim">{T("{0} secondi", songSeconds(song).toFixed(1))}</span>
      </div>

      <div className="mu-channels">
        {song.channels.map((c, i) => (
          <button
            key={i}
            type="button"
            className={`mu-ch${i === chi ? " on" : ""}`}
            style={{ "--ch": COLORS[i % COLORS.length] } as CSSProperties}
            onClick={() => setChi(i)}
          >
            <span className="mu-dot" />
            {c.name}
            <span className="dim">{c.notes.length}</span>
          </button>
        ))}
      </div>

      <div className="mu-bar">
        {!isDrums(ch) && (
          <label className="mu-num">
            {T("Onda")}
            <select value={ch.wave} onChange={(e) => upd((s) => void (s.channels[chi].wave = e.target.value as Wave))}>
              {WAVES.map((w) => (
                <option key={w.id} value={w.id}>
                  {T(w.label)}
                </option>
              ))}
            </select>
          </label>
        )}
        <Slider label={T("Volume")} value={ch.volume} min={0} max={1} step={0.05} onChange={(v) => upd((s) => void (s.channels[chi].volume = v), `vol:${asset.id}:${chi}`)} />
        {!isDrums(ch) && (
          <>
            <Slider
              label={T("Attacco")}
              value={ch.attack}
              min={0}
              max={0.3}
              step={0.005}
              unit="s"
              onChange={(v) => upd((s) => void (s.channels[chi].attack = v), `att:${asset.id}:${chi}`)}
            />
            <Slider
              label={T("Rilascio")}
              value={ch.release}
              min={0}
              max={1}
              step={0.01}
              unit="s"
              onChange={(v) => upd((s) => void (s.channels[chi].release = v), `rel:${asset.id}:${chi}`)}
            />
          </>
        )}
        <label className="mu-num">
          {T("Durata nota")}
          <select value={noteLen} onChange={(e) => setNoteLen(Number(e.target.value))}>
            {[1, 2, 4, 8, 16].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="px-btn" disabled={!ch.notes.length} onClick={() => upd((s) => void (s.channels[chi].notes = []))}>
          {T("Svuota canale")}
        </button>
      </div>

      <PianoRoll song={song} chi={chi} noteLen={noteLen} playStep={playStep} assetId={asset.id} />
    </div>
  );
}

let gestureId = 0;

function PianoRoll({ song, chi, noteLen, playStep, assetId }: { song: SongData; chi: number; noteLen: number; playStep: number | null; assetId: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLCanvasElement>(null);
  const keys = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ index: number; gesture: string } | null>(null);
  const ch = song.channels[chi];
  const rows = rowsOf(ch);
  const rh = rowHeight(ch);
  const W = song.length * CELL;
  const H = rows.length * rh;
  const keysW = isDrums(ch) ? 120 : 44;
  const lang = getEditorLang();

  useEffect(() => {
    const g = setup(grid.current!, W, H);
    rows.forEach((p, r) => {
      g.fillStyle = isDrums(ch) ? (r % 2 ? "#1b221b" : "#202820") : isBlack(p) ? "#161c16" : p % 12 === 0 ? "#243024" : "#1e261e";
      g.fillRect(0, r * rh, W, rh);
    });
    for (let s = 0; s <= song.length; s++) {
      g.fillStyle = s % 16 === 0 ? "rgba(255,255,255,0.3)" : s % 4 === 0 ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)";
      g.fillRect(s * CELL, 0, 1, H);
    }
    // Le note degli altri canali, in trasparenza, per scrivere l'armonia sopra la melodia.
    song.channels.forEach((o, oi) => {
      if (oi === chi || isDrums(o) !== isDrums(ch)) return;
      g.fillStyle = hexA(COLORS[oi % COLORS.length], 0.28);
      for (const n of o.notes) {
        const r = rows.indexOf(n.pitch);
        if (r >= 0) g.fillRect(n.step * CELL + 1, r * rh + 1, Math.max(1, n.len) * CELL - 2, rh - 2);
      }
    });
    g.fillStyle = COLORS[chi % COLORS.length];
    g.strokeStyle = "rgba(0,0,0,0.55)";
    for (const n of ch.notes) {
      const r = rows.indexOf(n.pitch);
      if (r < 0) continue;
      const w = Math.max(1, n.len) * CELL;
      g.fillRect(n.step * CELL + 1, r * rh + 1, w - 2, rh - 2);
      g.strokeRect(n.step * CELL + 1.5, r * rh + 1.5, w - 3, rh - 3);
    }
    if (playStep !== null) {
      g.fillStyle = "#ffffff";
      g.fillRect(Math.floor(playStep * CELL), 0, 2, H);
    }
  }, [song, chi, playStep, W, H]);

  useEffect(() => {
    const g = setup(keys.current!, keysW, H);
    rows.forEach((p, r) => {
      const dark = isDrums(ch) || isBlack(p);
      g.fillStyle = isDrums(ch) ? "#263026" : isBlack(p) ? "#141914" : "#dfe8da";
      g.fillRect(0, r * rh, keysW, rh - 1);
      g.fillStyle = dark ? "#c8d4c2" : "#1d2819";
      g.font = `${isDrums(ch) ? 11 : 9}px system-ui, sans-serif`;
      g.textBaseline = "middle";
      const label = isDrums(ch) ? T(DRUMS.find((d) => d.pitch === p)?.label ?? "") : isBlack(p) ? "" : noteName(p);
      g.fillText(label, 5, r * rh + rh / 2);
    });
  }, [chi, H, keysW, lang, ch.wave]);

  // Parte dalla zona centrale della tastiera (Do4) quando si cambia canale.
  useEffect(() => {
    if (wrap.current) wrap.current.scrollTop = isDrums(ch) ? 0 : Math.max(0, (TOP - 76) * rh - 20);
  }, [chi, ch.wave]);

  const at = (e: React.PointerEvent) => {
    const r = grid.current!.getBoundingClientRect();
    const step = clamp(Math.floor((e.clientX - r.left) / CELL), 0, song.length - 1);
    const row = clamp(Math.floor((e.clientY - r.top) / rh), 0, rows.length - 1);
    return { step, pitch: rows[row] };
  };
  const hit = (step: number, pitch: number) => ch.notes.findIndex((n) => n.pitch === pitch && step >= n.step && step < n.step + Math.max(1, n.len));

  return (
    <div className="mu-roll-wrap" ref={wrap}>
      <div className="mu-roll">
        <canvas ref={keys} className="mu-keys" />
        <canvas
          ref={grid}
          className="mu-grid"
          title={T("Clic: aggiungi una nota (trascina per allungarla) · clic destro: cancella")}
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            e.preventDefault();
            const { step, pitch } = at(e);
            const i = hit(step, pitch);
            if (e.button === 2) {
              if (i >= 0) updSong(assetId, (s) => void s.channels[chi].notes.splice(i, 1));
              return;
            }
            grid.current!.setPointerCapture(e.pointerId);
            const gesture = `roll:${++gestureId}`;
            if (i >= 0) {
              drag.current = { index: i, gesture };
              previewNote(ch, pitch);
              return;
            }
            drag.current = { index: ch.notes.length, gesture };
            updSong(assetId, (s) => void s.channels[chi].notes.push({ step, len: noteLen, pitch }), gesture);
            previewNote(ch, pitch);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const { step } = at(e);
            const n = ch.notes[d.index];
            if (!n || Math.max(1, step - n.step + 1) === n.len) return;
            updSong(
              assetId,
              (s) => {
                const note = s.channels[chi].notes[d.index];
                if (note) note.len = Math.max(1, step - note.step + 1);
              },
              d.gesture,
            );
          }}
          onPointerUp={() => (drag.current = null)}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ effetto sonoro

function Waveform({ samples }: { samples: Float32Array }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const w = c.clientWidth || 600;
    const h = 90;
    const g = setup(c, w, h);
    c.style.width = "100%";
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#8cc480";
    const per = samples.length / w;
    for (let x = 0; x < w; x++) {
      let lo = 1;
      let hi = -1;
      for (let i = Math.floor(x * per); i < Math.floor((x + 1) * per); i++) {
        lo = Math.min(lo, samples[i]);
        hi = Math.max(hi, samples[i]);
      }
      if (hi >= lo) g.fillRect(x, h / 2 - (hi * h) / 2, 1, Math.max(1, ((hi - lo) * h) / 2));
    }
  }, [samples]);
  return <canvas ref={ref} className="mu-wave" />;
}

function SfxEditor({ asset }: { asset: AudioAsset }) {
  const s = asset.sfx!;
  const timer = useRef(0);
  const preview = useMemo(() => renderSfx(s, 22050), [s]);

  useEffect(() => () => clearTimeout(timer.current), []);

  /** Ogni modifica si ascolta subito (come in sfxr), aspettando che il cursore si fermi un attimo. */
  const upd = (fn: (x: SfxData) => void, merge: string) => {
    updSfx(asset.id, fn, merge);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const cur = audioAsset(asset.id)?.sfx;
      if (cur) playOnce(renderSfx(cur));
    }, 250);
  };

  const P = (key: keyof SfxData, label: string, min: number, max: number, step: number, unit = "") => (
    <Slider
      key={key}
      label={label}
      value={Number(s[key])}
      min={min}
      max={max}
      step={step}
      unit={unit}
      onChange={(v) => upd((x) => void ((x as unknown as Record<string, number>)[key] = v), `sfx:${asset.id}:${key}`)}
    />
  );

  return (
    <div className="mu-editor">
      <div className="mu-bar">
        <button type="button" className="px-btn primary" onClick={() => playOnce(renderSfx(s))}>
          <Icon name="play" size={13} />
          {T(" Ascolta")}
        </button>
        <span className="mu-num">{T("Genera")}</span>
        <div className="mu-presets">
          {SFX_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="px-btn"
              onClick={() => {
                const next = makeSfx(p.id);
                updSfx(asset.id, (x) => void Object.assign(x, next));
                playOnce(renderSfx(next));
              }}
            >
              {T(p.label)}
            </button>
          ))}
        </div>
      </div>
      <p className="empty-hint">{T("Ogni pulsante crea un effetto nuovo di quel tipo, ogni volta un po' diverso. Poi lo ritocchi con i cursori.")}</p>
      <Waveform samples={preview} />
      <div className="mu-sfx">
        <label className="mu-slider">
          <span className="mu-label">{T("Onda")}</span>
          <select value={s.wave} onChange={(e) => upd((x) => void (x.wave = e.target.value as Wave), `sfx:${asset.id}:wave`)}>
            {WAVES.map((w) => (
              <option key={w.id} value={w.id}>
                {T(w.label)}
              </option>
            ))}
          </select>
        </label>
        {P("volume", T("Volume"), 0, 1, 0.05)}
        {P("freq", T("Frequenza"), 20, 2000, 1, "Hz")}
        {P("freqEnd", T("Frequenza finale"), 20, 2000, 1, "Hz")}
        {P("attack", T("Salita"), 0, 0.5, 0.005, "s")}
        {P("sustain", T("Tenuta"), 0, 1, 0.01, "s")}
        {P("decay", T("Sfumatura"), 0, 2, 0.01, "s")}
        {P("vibrato", T("Vibrato"), 0, 1, 0.05)}
        {P("vibratoSpeed", T("Velocità del vibrato"), 0, 30, 0.5, "Hz")}
        {P("jump", T("Salto di nota"), 0.5, 2, 0.05, "×")}
        {P("jumpAt", T("Dopo"), 0, 1, 0.01, "s")}
        {P("crush", T("Sporco"), 0, 1, 0.05)}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Game, type VariableValue } from "@runtime";
import { getState, log } from "../store";
import { togglePlay } from "../commands";
import { Icon } from "./Icon";

/** Anteprima: lo stesso runtime della build WebGL, con i controlli di debug accanto. */
export function PlayView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [vars, setVars] = useState<Record<string, VariableValue>>({});
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [overlay, setOverlay] = useState(false);
  const [fps, setFps] = useState(0);
  const [info, setInfo] = useState({ scene: "", entities: 0 });
  const [error, setError] = useState("");

  useEffect(() => {
    const s = getState();
    if (!s.project || !canvasRef.current) return;
    let game: Game;
    try {
      game = new Game(canvasRef.current, structuredClone(s.project), {
        baseUrl: s.baseUrl,
        startScene: s.sceneId,
        onLog: (level, message) => log(level, message),
      });
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    gameRef.current = game;
    game
      .start()
      .then(() => canvasRef.current?.focus())
      .catch((e: Error) => {
        setError(e.message);
        log("error", e.message);
      });
    const iv = window.setInterval(() => {
      setVars({ ...game.vars });
      setFps(Math.round(game.debug.fps));
      setOverlay(game.debug.overlay);
      setInfo({ scene: game.scene?.data.name ?? "", entities: game.scene?.entities.length ?? 0 });
    }, 250);
    return () => {
      clearInterval(iv);
      game.stop();
      gameRef.current = null;
    };
  }, []);

  const g = () => gameRef.current;

  return (
    <div className="play">
      <div className="play-bar">
        <span className="live-dot" />
        <b>Anteprima</b>
        <span className="dim">{info.scene}</span>
        <div className="spacer" />
        <button
          type="button"
          className="btn small"
          onClick={() => {
            const game = g();
            if (!game) return;
            game.debug.paused = !game.debug.paused;
            setPaused(game.debug.paused);
          }}
        >
          <Icon name={paused ? "play" : "pause"} size={13} />
          {paused ? "Riprendi" : "Pausa"}
        </button>
        <button type="button" className="btn small" disabled={!paused} onClick={() => g() && (g()!.debug.step = true)} title="Avanza di un solo fotogramma">
          <Icon name="step" size={13} /> Un frame
        </button>
        <select
          className="speed"
          value={speed}
          onChange={(e) => {
            const v = Number(e.target.value);
            setSpeed(v);
            if (g()) g()!.debug.timeScale = v;
          }}
        >
          {[0.25, 0.5, 1, 2].map((v) => (
            <option key={v} value={v}>
              velocità ×{v}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`btn small${overlay ? " on" : ""}`}
          onClick={() => {
            const game = g();
            if (!game) return;
            game.debug.overlay = !game.debug.overlay;
            setOverlay(game.debug.overlay);
          }}
          title="Mostra collisioni e corpi (F1)"
        >
          <Icon name="collision" size={13} /> Collisioni
        </button>
        <button type="button" className="btn small" onClick={() => g()?.restartScene(0.2)}>
          <Icon name="restart" size={13} /> Riavvia scena
        </button>
        <button type="button" className="btn small danger" onClick={togglePlay} title="Torna all'editor (F5)">
          <Icon name="stop" size={13} /> Ferma
        </button>
      </div>
      <div className="play-main">
        <div className="play-stage">
          <canvas ref={canvasRef} className="play-canvas" tabIndex={0} />
          {error && <div className="play-error">{error}</div>}
        </div>
        <aside className="debug-side">
          <div className="debug-h">Debug</div>
          <div className="debug-stat">
            <span>FPS</span>
            <b className={fps < 50 ? "warn" : ""}>{fps}</b>
          </div>
          <div className="debug-stat">
            <span>Oggetti in scena</span>
            <b>{info.entities}</b>
          </div>
          <div className="debug-h">Variabili</div>
          {Object.entries(vars).map(([k, v]) => (
            <div className="debug-stat" key={k}>
              <span>{k}</span>
              <b>{String(v)}</b>
            </div>
          ))}
          <div className="debug-h">Comandi</div>
          <p className="debug-keys">
            <kbd>←</kbd> <kbd>→</kbd> muovi · <kbd>Z</kbd> salta · <kbd>X</kbd> dash · <kbd>↑</kbd> <kbd>↓</kbd> scale · <kbd>F1</kbd> collisioni
          </p>
          <p className="dim small">I messaggi del gioco finiscono nella Console.</p>
        </aside>
      </div>
    </div>
  );
}

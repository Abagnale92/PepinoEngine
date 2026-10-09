import { useEffect, useRef, useState } from "react";
import { DEFAULT_TOUCH, Game, mountTouchControls, type VariableValue } from "@runtime";
import { getState, log } from "../store";
import { getSettings } from "../settings";
import { togglePlay } from "../commands";
import { Icon } from "./Icon";
import { T } from "../i18n";
import { Splitter, usePanelVar } from "./Splitter";

/** Lingua scelta nell'anteprima: resta tra un «Prova» e l'altro. */
let previewLanguage = "";

/** Anteprima: lo stesso runtime della build WebGL, con i controlli di debug accanto. */
export function PlayView() {
  const sideVar = usePanelVar("--side-w", "playDebug");
  const languages = getState().project?.languages ?? [];
  const [language, setLanguage] = useState(languages.some((l) => l.id === previewLanguage) ? previewLanguage : (languages[0]?.id ?? ""));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [vars, setVars] = useState<Record<string, VariableValue>>({});
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(() => getSettings().previewSpeed);
  const [overlay, setOverlay] = useState(false);
  const [fps, setFps] = useState(0);
  const [info, setInfo] = useState({ scene: "", entities: 0 });
  const [error, setError] = useState("");
  const [touch, setTouch] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  // Controlli touch sopra l'anteprima: per provarli con il mouse (o su un PC con lo schermo touch).
  useEffect(() => {
    const game = gameRef.current;
    if (!touch || !game || !stageRef.current) return;
    return mountTouchControls(stageRef.current, game.input, { ...DEFAULT_TOUCH, ...getState().project?.settings.touch });
  }, [touch]);

  useEffect(() => {
    const s = getState();
    if (!s.project || !canvasRef.current) return;
    let game: Game;
    try {
      game = new Game(canvasRef.current, structuredClone(s.project), {
        baseUrl: s.baseUrl,
        startScene: s.sceneId,
        onLog: (level, message) => log(level, T(message)),
        language: language || undefined,
      });
      // Per il debug dalla console del browser (come window.game nel gioco esportato).
      (window as unknown as { pepinoGame?: Game }).pepinoGame = game;
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    gameRef.current = game;
    game.debug.overlay = getSettings().previewCollisions;
    game.debug.timeScale = getSettings().previewSpeed;
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
        <b>{T("Anteprima")}</b>
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
          {paused ? T("Riprendi") : T("Pausa")}
        </button>
        <button type="button" className="btn small" disabled={!paused} onClick={() => g() && (g()!.debug.step = true)} title={T("Avanza di un solo fotogramma")}>
          <Icon name="step" size={13} />{T(" Un frame")}</button>
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
            <option key={v} value={v}>{T("velocità ×")}{v}
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
          title={T("Mostra collisioni e corpi (F1)")}
        >
          <Icon name="collision" size={13} />{T(" Collisioni")}</button>
        {languages.length > 1 && (
          <select
            className="speed"
            value={language}
            title={T("Lingua del gioco")}
            onChange={(e) => {
              previewLanguage = e.target.value;
              setLanguage(e.target.value);
              g()?.setLanguage(e.target.value);
            }}
          >
            {languages.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <button type="button" className={`btn small${touch ? " on" : ""}`} onClick={() => setTouch(!touch)} title={T("Mostra joystick e pulsanti touch")}>{T("Touch")}</button>
        <button type="button" className="btn small" onClick={() => g()?.restartScene(0.2)}>
          <Icon name="restart" size={13} />{T(" Riavvia scena")}</button>
        <button type="button" className="btn small danger" onClick={togglePlay} title={T("Torna all'editor (F5)")}>
          <Icon name="stop" size={13} />{T(" Ferma")}</button>
      </div>
      <div className="play-main" style={sideVar}>
        <Splitter id="playDebug" edge="end" />
        <div className="play-stage" ref={stageRef} style={{ position: "relative" }}>
          <canvas ref={canvasRef} className="play-canvas" tabIndex={0} />
          {error && <div className="play-error">{error}</div>}
        </div>
        <aside className="debug-side">
          <div className="debug-h">{T("Debug")}</div>
          <div className="debug-stat">
            <span>{T("FPS")}</span>
            <b className={fps < 50 ? "warn" : ""}>{fps}</b>
          </div>
          <div className="debug-stat">
            <span>{T("Oggetti in scena")}</span>
            <b>{info.entities}</b>
          </div>
          <div className="debug-h">{T("Variabili")}</div>
          {Object.entries(vars).map(([k, v]) => (
            <div className="debug-stat" key={k}>
              <span>{k}</span>
              <b>{String(v)}</b>
            </div>
          ))}
          <div className="debug-h">{T("Comandi")}</div>
          <p className="debug-keys">
            <kbd>←</kbd> <kbd>→</kbd>{T(" muovi · ")}<kbd>Z</kbd>{T(" salta · ")}<kbd>X</kbd>{T(" dash · ")}<kbd>↑</kbd> <kbd>↓</kbd>{T(" scale · ")}<kbd>F1</kbd>{T(" collisioni")}</p>
          <p className="dim small">{T("I messaggi del gioco finiscono nella Console.")}</p>
        </aside>
      </div>
    </div>
  );
}

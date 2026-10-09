import { Fragment, useEffect } from "react";
import { setState, useEditor } from "../store";
import { resetSettings, updateSettings, useSettings, type EditorSettings } from "../settings";
import { api } from "../api";
import { N, T } from "../i18n";
import { Field, NumberField, Toggle } from "./fields";
import { Icon } from "./Icon";

const SHORTCUTS: [string, string][] = [
  ["F5", N("Prova / Ferma il gioco")],
  ["Ctrl+S", N("Salva")],
  ["Ctrl+Z · Ctrl+Y", N("Annulla · Ripeti")],
  ["Ctrl+D", N("Duplica l'oggetto")],
  [N("Canc"), N("Elimina la selezione")],
  ["V · B · E", N("Seleziona · Pennello · Gomma")],
  ["G · C", N("Griglia · Collisioni")],
  [N("Spazio + trascina"), N("Sposta la vista")],
  [N("Alt + trascina"), N("Sposta senza aggancio")],
  ["F1", N("Nel gioco: collisioni e debug")],
  [N("Trascina un bordo"), N("Ridimensiona i pannelli (doppio clic: dimensione iniziale)")],
];

const close = () => setState({ settingsOpen: false });

/** Impostazioni dell'editor: valgono per tutti i progetti. */
export function SettingsDialog() {
  const open = useEditor((s) => s.settingsOpen);
  const s = useSettings((x) => x);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  const set = (patch: Partial<EditorSettings>) => updateSettings(patch);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal settings" role="dialog" aria-label={T("Impostazioni")}>
        <div className="modal-h">
          <Icon name="settings" />
          <b>{T("Impostazioni")}</b>
          <div className="spacer" />
          <button type="button" className="icon-btn" title={T("Chiudi")} onClick={close}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="modal-body">
          <section className="set-section">
            <h4>{T("Generale")}</h4>
            <Field label="Lingua dell'editor" help="Menù e pannelli. La lingua del gioco si sceglie nella scheda Testi.">
              <select value={s.language} onChange={(e) => set({ language: e.target.value as EditorSettings["language"] })}>
                <option value="it">Italiano</option>
                <option value="en">English</option>
              </select>
            </Field>
            <Field label="Tema">
              <select value={s.theme} onChange={(e) => set({ theme: e.target.value as EditorSettings["theme"] })}>
                <option value="dark">{T("Scuro")}</option>
                <option value="light">{T("Chiaro")}</option>
              </select>
            </Field>
            <Field label="Dimensione dell'interfaccia" help={api.desktop ? undefined : "Nel browser usa Ctrl + e Ctrl − del browser."}>
              <select value={String(s.uiScale)} disabled={!api.desktop} onChange={(e) => set({ uiScale: Number(e.target.value) })}>
                {[0.8, 0.9, 1, 1.1, 1.25, 1.4].map((v) => (
                  <option key={v} value={v}>
                    {Math.round(v * 100)}%
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Salvataggio automatico" help="Salva da solo le modifiche. Solo nell'app desktop.">
              <select value={String(s.autosave)} disabled={!api.desktop} onChange={(e) => set({ autosave: Number(e.target.value) })}>
                <option value="0">{T("Mai")}</option>
                <option value="1">{T("Ogni minuto")}</option>
                <option value="2">{T("Ogni 2 minuti")}</option>
                <option value="5">{T("Ogni 5 minuti")}</option>
              </select>
            </Field>
          </section>

          <section className="set-section">
            <h4>{T("Vista scena")}</h4>
            <Field label="Colore della griglia">
              <input type="color" value={s.gridColor} onChange={(e) => set({ gridColor: e.target.value })} />
            </Field>
            <Field label="Opacità della griglia">
              <NumberField value={s.gridOpacity} min={0} max={1} step={0.02} onChange={(v) => set({ gridOpacity: Math.min(1, Math.max(0, v)) })} />
            </Field>
            <Field label="Aggancio degli oggetti" help="Trascinando, gli oggetti si fermano ogni mezzo tile o ogni tile.">
              <select value={s.snapStep} onChange={(e) => set({ snapStep: e.target.value as EditorSettings["snapStep"] })}>
                <option value="half">{T("Mezzo tile")}</option>
                <option value="full">{T("Tile intero")}</option>
              </select>
            </Field>
          </section>

          <section className="set-section">
            <h4>{T("Anteprima")}</h4>
            <Field label="Controlla il progetto prima di provare" help="Scrive in Console riferimenti rotti e regole incomplete a ogni «Prova».">
              <Toggle checked={s.checkBeforePlay} onChange={(v) => set({ checkBeforePlay: v })} />
            </Field>
            <Field label="Parti con le collisioni visibili">
              <Toggle checked={s.previewCollisions} onChange={(v) => set({ previewCollisions: v })} />
            </Field>
            <Field label="Velocità iniziale">
              <select value={String(s.previewSpeed)} onChange={(e) => set({ previewSpeed: Number(e.target.value) })}>
                {[0.25, 0.5, 1, 2].map((v) => (
                  <option key={v} value={v}>
                    ×{v}
                  </option>
                ))}
              </select>
            </Field>
          </section>

          <section className="set-section">
            <h4>{T("Codice")}</h4>
            <Field label="Dimensione del carattere">
              <NumberField value={s.codeFontSize} min={9} max={24} step={0.5} unit="px" onChange={(v) => set({ codeFontSize: Math.min(24, Math.max(9, v)) })} />
            </Field>
          </section>

          <section className="set-section">
            <h4>{T("Scorciatoie da tastiera")}</h4>
            <dl className="shortcuts">
              {SHORTCUTS.map(([keys, what]) => (
                <Fragment key={keys}>
                  <dt>
                    <kbd>{T(keys)}</kbd>
                  </dt>
                  <dd>{T(what)}</dd>
                </Fragment>
              ))}
            </dl>
          </section>
        </div>
        <div className="modal-f">
          <button type="button" className="btn small ghost" onClick={resetSettings}>
            {T("Ripristina le impostazioni predefinite")}
          </button>
          <div className="spacer" />
          <button type="button" className="btn primary" onClick={close}>
            {T("Fatto")}
          </button>
        </div>
      </div>
    </div>
  );
}

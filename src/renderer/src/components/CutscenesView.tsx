import { useState } from "react";
import { getRuleItemDef, type CutsceneData } from "@runtime";
import { currentScene, editProject, useEditor } from "../store";
import { uniqueId } from "../projectOps";
import { defaultParams, type RuleCtxInfo } from "../ruleOps";
import { CommitInput } from "./fields";
import { Icon } from "./Icon";
import { ItemPicker, ItemRow } from "./RulesView";
import { T } from "../i18n";

/** Filmato aperto l'ultima volta (resta scelto cambiando scheda). */
let lastId = "";

/**
 * Scheda Filmati: sequenze di passi (le azioni delle Regole più quelle che aspettano: spostamenti,
 * camera, dialoghi, dissolvenze) che si avviano dalle Regole.
 */
export function CutscenesView() {
  const project = useEditor((s) => s.project)!;
  const scene = useEditor(currentScene);
  useEditor((s) => s.blocksVersion);
  const list = project.cutscenes ?? [];
  const [sel, setSel] = useState(lastId);
  const [open, setOpen] = useState<number | null>(null);
  const current = list.find((c) => c.id === sel) ?? list[0];
  if (current) lastId = current.id;

  const edit = (fn: (c: CutsceneData) => void, merge?: string) =>
    editProject((p) => {
      const c = p.cutscenes?.find((x) => x.id === current?.id);
      if (c) fn(c);
    }, merge);

  const add = () => {
    const id = uniqueId("filmato", new Set(list.map((c) => c.id)));
    editProject((p) => void (p.cutscenes ??= []).push({ id, name: T("Nuovo filmato"), steps: [], skippable: true, bars: true }));
    setSel(id);
    setOpen(null);
  };

  const remove = (id: string) => {
    setOpen(null);
    editProject((p) => void (p.cutscenes = (p.cutscenes ?? []).filter((c) => c.id !== id)));
  };

  // Niente evento: gli oggetti si scelgono per etichetta o tra quelli della scena aperta.
  const rc: RuleCtxInfo = { project, scene, trigger: { type: "cutscene.play", params: {} }, triggerDef: undefined };

  return (
    <div className="rules-view">
      <div className="rules-top">
        {list.length > 0 && (
          <select
            value={current?.id ?? ""}
            onChange={(e) => {
              setSel(e.target.value);
              setOpen(null);
            }}
          >
            {list.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <span className="dim">{T("I filmati valgono in tutte le scene: gli oggetti si scelgono da quella aperta.")}</span>
        <div className="spacer" />
        <button type="button" className="btn small primary" onClick={add}>
          <Icon name="plus" size={13} />
          {T(" Nuovo filmato")}
        </button>
      </div>
      <div className="rules-list">
        {!current ? (
          <div className="rules-empty">
            <h3>{T("Nessun filmato")}</h3>
            <p>
              {T(
                "Un filmato è una scena animata: gli oggetti si muovono, la camera li segue, i personaggi parlano. Mentre scorre il giocatore non comanda il personaggio e con Esc lo può saltare.",
              )}
            </p>
            <button type="button" className="btn primary" onClick={add}>
              <Icon name="plus" size={13} />
              {T(" Crea il primo filmato")}
            </button>
          </div>
        ) : (
          <div className="cs-card">
            <div className="cs-head">
              <Icon name="film" />
              <CommitInput value={current.name} onCommit={(v) => edit((c) => void (c.name = v.trim() || c.name))} />
              <label className="cs-flag">
                <input type="checkbox" checked={current.skippable !== false} onChange={(e) => edit((c) => void (c.skippable = e.target.checked))} />
                {T("si può saltare (Esc)")}
              </label>
              <label className="cs-flag">
                <input type="checkbox" checked={current.bars !== false} onChange={(e) => edit((c) => void (c.bars = e.target.checked))} />
                {T("barre del cinema")}
              </label>
              <span className="spacer" />
              <button type="button" className="icon-btn" title={T("Elimina il filmato")} onClick={() => remove(current.id)}>
                <Icon name="trash" size={13} />
              </button>
            </div>
            <div className="rule-col then">
              <div className="rule-label">{T("Passi")}</div>
              {current.steps.map((st, i) => (
                <ItemRow
                  key={i}
                  prefix={`${i + 1}.`}
                  item={st}
                  kind="action"
                  rc={rc}
                  open={open === i}
                  onToggle={() => setOpen(open === i ? null : i)}
                  onChange={(it) => edit((c) => void (c.steps[i] = it), `cs:${current.id}:${i}`)}
                  onMove={(dir) => {
                    const j = i + dir;
                    if (j < 0 || j >= current.steps.length) return;
                    setOpen(null);
                    edit((c) => void ([c.steps[i], c.steps[j]] = [c.steps[j], c.steps[i]]));
                  }}
                  onRemove={() => {
                    setOpen(null);
                    edit((c) => void c.steps.splice(i, 1));
                  }}
                />
              ))}
              {current.steps.length === 0 && (
                <p className="field-note">
                  {T("Aggiungi i passi in ordine: il filmato li esegue uno dopo l'altro e aspetta quelli che durano (spostamenti, dialoghi, dissolvenze).")}
                </p>
              )}
              <ItemPicker
                kind="action"
                label={T("passo")}
                onPick={(type) => {
                  edit((c) => void c.steps.push({ type, params: defaultParams(getRuleItemDef(type)!, rc) }));
                  setOpen(current.steps.length);
                }}
              />
            </div>
            <p className="field-note">{T("Per farlo partire usa la Regola «Avvia un filmato»; quando finisce scatta «Un filmato finisce».")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

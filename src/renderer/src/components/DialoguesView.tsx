import { useState } from "react";
import { DIALOGUE_END, type DialogueData, type DialogueLine } from "@runtime";
import { editProject, useEditor } from "../store";
import { assetUrl, dialogueUses, uniqueId } from "../projectOps";
import { NumberField } from "./fields";
import { Icon } from "./Icon";
import { FrameThumb } from "./thumbs";

type EditDialogue = (fn: (d: DialogueData) => void, merge?: string) => void;

/** Editor dei dialoghi: battute con nome e ritratto, scelte che portano altrove o impostano variabili. */
export function DialoguesView() {
  const project = useEditor((s) => s.project)!;
  const dialogues = project.dialogues ?? [];
  const [selId, setSelId] = useState(dialogues[0]?.id ?? "");
  const sel = dialogues.find((d) => d.id === selId) ?? dialogues[0];

  const add = () => {
    const id = uniqueId("dialogo", new Set(dialogues.map((d) => d.id)));
    editProject((p) => void (p.dialogues ??= []).push({ id, name: "Nuovo dialogo", lines: [{ id: "b1", speaker: "", text: "Ciao!" }] }));
    setSelId(id);
  };
  const edit: EditDialogue = (fn, merge) => {
    if (!sel) return;
    editProject((p) => {
      const d = p.dialogues?.find((x) => x.id === sel.id);
      if (d) fn(d);
    }, merge);
  };
  const remove = () => {
    if (!sel) return;
    editProject((p) => void (p.dialogues = (p.dialogues ?? []).filter((d) => d.id !== sel.id)));
    setSelId("");
  };
  const speakers = [...new Set(dialogues.flatMap((d) => d.lines.map((l) => l.speaker ?? "")).filter(Boolean))];

  return (
    <div className="dlg-view">
      <aside className="dlg-list">
        <div className="tree-h">
          <span>Dialoghi · {dialogues.length}</span>
          <button type="button" className="icon-btn" title="Nuovo dialogo" onClick={add}>
            <Icon name="plus" size={13} />
          </button>
        </div>
        {dialogues.map((d) => (
          <button type="button" key={d.id} className={`tree-row${sel?.id === d.id ? " on" : ""}`} onClick={() => setSelId(d.id)}>
            <Icon name="chat" size={13} />
            <span className="tree-name">{d.name}</span>
            <span className="badge">{d.lines.length}</span>
          </button>
        ))}
        {dialogues.length === 0 && <p className="empty-hint">Nessun dialogo ancora.</p>}
      </aside>
      <section className="dlg-main">
        {sel ? (
          <DialogueEditor key={sel.id} d={sel} edit={edit} remove={remove} />
        ) : (
          <div className="rules-empty">
            <h3>Nessun dialogo</h3>
            <p>
              I dialoghi sono conversazioni con battute, ritratti e scelte. Collegali a un personaggio con il blocco <b>Personaggio che parla</b>,
              oppure avviali da una Regola.
            </p>
            <button type="button" className="btn primary" onClick={add}>
              <Icon name="plus" size={13} /> Crea il primo dialogo
            </button>
          </div>
        )}
      </section>
      <datalist id="dlg-speakers">
        {speakers.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}

function DialogueEditor({ d, edit, remove }: { d: DialogueData; edit: EditDialogue; remove: () => void }) {
  const project = useEditor((s) => s.project)!;
  const uses = dialogueUses(project, d.id);
  const addLine = () => {
    const ids = new Set(d.lines.map((l) => l.id));
    let n = d.lines.length + 1;
    while (ids.has(`b${n}`)) n++;
    const last = d.lines[d.lines.length - 1];
    edit((x) => void x.lines.push({ id: `b${n}`, speaker: last?.speaker ?? "", portrait: last?.portrait, portraitFrame: last?.portraitFrame, text: "" }));
  };
  return (
    <div className="dlg-editor">
      <div className="dlg-head">
        <Icon name="chat" />
        <input className="title-input" value={d.name} onChange={(e) => edit((x) => void (x.name = e.target.value), `dname:${d.id}`)} />
        <span className="dim">
          id <span className="mono">{d.id}</span> · usato da {uses} {uses === 1 ? "personaggio" : "personaggi"}
        </span>
        <div className="spacer" />
        <button type="button" className="btn small danger" onClick={remove}>
          <Icon name="trash" size={13} /> Elimina
        </button>
      </div>
      <p className="dlg-help">
        Le battute scorrono in ordine. Con le <b>scelte</b> decide il giocatore, e una scelta può impostare una variabile da usare poi nelle
        Regole. Nei testi puoi scrivere <code>{"{monete}"}</code>.
      </p>
      <div className="dlg-lines">
        {d.lines.map((l, i) => (
          <LineCard key={l.id} d={d} line={l} index={i} edit={edit} />
        ))}
        <button type="button" className="rule-add" onClick={addLine}>
          <Icon name="plus" size={12} /> battuta
        </button>
      </div>
    </div>
  );
}

function gotoOptions(d: DialogueData) {
  return [
    { value: "", label: "continua con la battuta dopo" },
    { value: DIALOGUE_END, label: "termina il dialogo" },
    ...d.lines.map((l, i) => ({ value: l.id, label: `vai alla battuta ${i + 1}` })),
  ];
}

function LineCard({ d, line, index, edit }: { d: DialogueData; line: DialogueLine; index: number; edit: EditDialogue }) {
  const project = useEditor((s) => s.project)!;
  const baseUrl = useEditor((s) => s.baseUrl);
  const images = project.assets.filter((a) => a.type === "image");
  const portrait = images.find((a) => a.id === line.portrait);
  const upd = (fn: (l: DialogueLine) => void, merge?: string) =>
    edit((x) => {
      const l = x.lines.find((q) => q.id === line.id);
      if (l) fn(l);
    }, merge);
  const move = (dir: number) =>
    edit((x) => {
      const i = x.lines.findIndex((q) => q.id === line.id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= x.lines.length) return;
      [x.lines[i], x.lines[j]] = [x.lines[j], x.lines[i]];
    });
  const choices = line.choices ?? [];
  const opts = gotoOptions(d);
  const key = `${d.id}:${line.id}`;

  return (
    <div className="dlg-line">
      <div className="dlg-line-h">
        <span className="rule-num">{index + 1}</span>
        <input
          className="dlg-speaker"
          list="dlg-speakers"
          placeholder="Chi parla"
          value={line.speaker ?? ""}
          onChange={(e) => upd((l) => void (l.speaker = e.target.value), `sp:${key}`)}
        />
        <select
          className="dlg-portrait"
          value={line.portrait ?? ""}
          onChange={(e) =>
            upd((l) => {
              l.portrait = e.target.value || undefined;
              if (!e.target.value) delete l.portraitFrame;
            })
          }
        >
          <option value="">— nessun ritratto —</option>
          {images.map((a) => (
            <option key={a.id} value={a.id}>
              {a.id}
            </option>
          ))}
        </select>
        {portrait && (
          <>
            <div className="dlg-frame" title="Fotogramma del ritratto">
              <NumberField integer min={0} value={line.portraitFrame ?? 0} onChange={(v) => upd((l) => void (l.portraitFrame = Math.max(0, v)), `pf:${key}`)} />
            </div>
            <div className="dlg-thumb checker">
              <FrameThumb url={assetUrl(baseUrl, portrait.src)} sw={portrait.frameWidth} sh={portrait.frameHeight} frame={line.portraitFrame ?? 0} size={32} />
            </div>
          </>
        )}
        <div className="spacer" />
        <button type="button" className="icon-btn" disabled={index === 0} onClick={() => move(-1)} title="Sposta su">
          ↑
        </button>
        <button type="button" className="icon-btn" disabled={index === d.lines.length - 1} onClick={() => move(1)} title="Sposta giù">
          ↓
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Elimina la battuta"
          disabled={d.lines.length === 1}
          onClick={() => edit((x) => void (x.lines = x.lines.filter((q) => q.id !== line.id)))}
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
      <textarea className="dlg-text" rows={2} placeholder="Cosa dice…" value={line.text} onChange={(e) => upd((l) => void (l.text = e.target.value), `tx:${key}`)} />
      {choices.length === 0 && (
        <div className="dlg-after">
          <span className="dim">Dopo questa battuta:</span>
          <select value={line.goto ?? ""} onChange={(e) => upd((l) => void (l.goto = e.target.value || undefined))}>
            {opts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {choices.map((c, j) => (
        <div className="dlg-choice" key={j}>
          <span className="rule-bullet choice" />
          <input placeholder="Testo della scelta" value={c.text} onChange={(e) => upd((l) => void (l.choices![j].text = e.target.value), `ch:${key}:${j}`)} />
          <span className="dim">→</span>
          <select value={c.goto ?? ""} onChange={(e) => upd((l) => void (l.choices![j].goto = e.target.value || undefined))}>
            {opts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="dim">imposta</span>
          <input
            list="pepino-vars"
            placeholder="variabile"
            value={c.setVar ?? ""}
            onChange={(e) => upd((l) => void (l.choices![j].setVar = e.target.value || undefined), `cv:${key}:${j}`)}
          />
          <span className="dim">=</span>
          <input placeholder="valore" value={c.setValue ?? ""} onChange={(e) => upd((l) => void (l.choices![j].setValue = e.target.value), `cx:${key}:${j}`)} />
          <button
            type="button"
            className="icon-btn"
            title="Rimuovi la scelta"
            onClick={() =>
              upd((l) => {
                l.choices!.splice(j, 1);
                if (!l.choices!.length) delete l.choices;
              })
            }
          >
            <Icon name="trash" size={12} />
          </button>
        </div>
      ))}
      <button type="button" className="rule-add" onClick={() => upd((l) => void (l.choices ??= []).push({ text: "", goto: "" }))}>
        <Icon name="plus" size={12} /> scelta
      </button>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import {
  COMPARE_OPTIONS,
  INPUT_LABELS,
  RULE_CATEGORIES,
  RULE_ITEMS,
  getRuleItemDef,
  type PropSchema,
  type RuleData,
  type RuleItem,
  type RuleItemDef,
  type RuleKind,
} from "@runtime";
import { currentScene, editProject, setState, useEditor } from "../store";
import { flattenEntities, projectTags, sceneOf, uniqueId } from "../projectOps";
import {
  actionChoices,
  argSchemas,
  blockChoices,
  blocksForRef,
  conditionChoices,
  defaultParams,
  describeRef,
  eventChoices,
  formatToken,
  stateChoices,
  type Choice,
  type RuleCtxInfo,
} from "../ruleOps";
import { CommitInput, Field, PropField } from "./fields";
import { Icon } from "./Icon";

type EditList = (fn: (list: RuleData[]) => void, merge?: string) => void;

/** Editor delle Regole "Quando → Allora" della scena o globali. */
export function RulesView() {
  const project = useEditor((s) => s.project)!;
  const scene = useEditor(currentScene);
  const scope = useEditor((s) => s.rulesScope);
  // Azioni e condizioni dei blocchi personalizzati cambiano quando si modifica il codice.
  useEditor((s) => s.blocksVersion);
  if (!scene) return null;
  const rules = (scope === "global" ? project.rules : scene.rules) ?? [];

  const edit: EditList = (fn, merge) =>
    editProject((p) => {
      let list: RuleData[];
      if (scope === "global") list = p.rules ??= [];
      else {
        const sc = sceneOf(p, scene.id)!;
        list = sc.rules ??= [];
      }
      fn(list);
    }, merge);

  const addRule = () =>
    edit((list) =>
      list.push({ id: uniqueId("regola", new Set(list.map((r) => r.id))), when: { type: "scene.start", params: {} }, conditions: [], actions: [] }),
    );

  return (
    <div className="rules-view">
      <div className="rules-top">
        <div className="seg">
          <button type="button" className={`btn small${scope === "scene" ? " on" : ""}`} onClick={() => setState({ rulesScope: "scene" })}>
            Scena: {scene.name}
          </button>
          <button type="button" className={`btn small${scope === "global" ? " on" : ""}`} onClick={() => setState({ rulesScope: "global" })}>
            Globali
          </button>
        </div>
        <span className="dim">{scope === "global" ? "Valgono in tutte le scene." : "Valgono solo in questa scena."}</span>
        <div className="spacer" />
        <button type="button" className="btn small primary" onClick={addRule}>
          <Icon name="plus" size={13} /> Nuova regola
        </button>
      </div>
      <div className="rules-list">
        {rules.length === 0 && (
          <div className="rules-empty">
            <h3>Nessuna regola</h3>
            <p>
              Le regole dicono cosa succede nel gioco, come frasi: <b>Quando</b> il giocatore tocca una moneta <b>allora</b> aggiungi 1 a
              monete e suona un effetto.
            </p>
            <button type="button" className="btn primary" onClick={addRule}>
              <Icon name="plus" size={13} /> Crea la prima regola
            </button>
          </div>
        )}
        {rules.map((rule, i) => (
          <RuleCard
            key={rule.id}
            rule={rule}
            index={i}
            count={rules.length}
            rc={{ project, scene: scope === "global" ? undefined : scene, trigger: rule.when, triggerDef: getRuleItemDef(rule.when.type) }}
            edit={edit}
          />
        ))}
      </div>
    </div>
  );
}

function RuleCard({ rule, index, count, rc, edit }: { rule: RuleData; index: number; count: number; rc: RuleCtxInfo; edit: EditList }) {
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (key: string) => setOpen(open === key ? null : key);
  const upd = (fn: (r: RuleData) => void, merge?: string) =>
    edit((list) => {
      const r = list.find((x) => x.id === rule.id);
      if (r) fn(r);
    }, merge);
  const move = (dir: number) =>
    edit((list) => {
      const i = list.findIndex((x) => x.id === rule.id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
    });
  const moveItem = (key: "conditions" | "actions", i: number, dir: number) =>
    upd((r) => {
      const arr = r[key];
      const j = i + dir;
      if (j < 0 || j >= arr.length) return;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    });
  const off = rule.enabled === false;

  return (
    <div className={`rule-card${off ? " off" : ""}`}>
      <div className="rule-head">
        <span className="rule-num">{index + 1}</span>
        <CommitInput
          className="rule-comment"
          value={rule.comment ?? ""}
          placeholder="Descrivi la regola (facoltativo)"
          onCommit={(v) => upd((r) => void (r.comment = v.trim() || undefined))}
        />
        <label className="rule-flag" title="Dopo la prima volta la regola non scatta più in questa scena">
          <input type="checkbox" checked={!!rule.once} onChange={(e) => upd((r) => void (r.once = e.target.checked || undefined))} />
          una volta sola
        </label>
        <label className="rule-flag">
          <input type="checkbox" checked={!off} onChange={(e) => upd((r) => void (r.enabled = e.target.checked ? undefined : false))} />
          attiva
        </label>
        <button type="button" className="icon-btn" disabled={index === 0} onClick={() => move(-1)} title="Sposta su">
          ↑
        </button>
        <button type="button" className="icon-btn" disabled={index === count - 1} onClick={() => move(1)} title="Sposta giù">
          ↓
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Duplica la regola"
          onClick={() =>
            edit((list) => {
              const i = list.findIndex((x) => x.id === rule.id);
              const copy = structuredClone(rule);
              copy.id = uniqueId("regola", new Set(list.map((r) => r.id)));
              list.splice(i + 1, 0, copy);
            })
          }
        >
          <Icon name="copy" size={13} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Elimina la regola"
          onClick={() =>
            edit((list) => {
              const i = list.findIndex((x) => x.id === rule.id);
              if (i >= 0) list.splice(i, 1);
            })
          }
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
      <div className="rule-body">
        <div className="rule-col when">
          <div className="rule-label">Quando</div>
          <ItemRow
            item={rule.when}
            kind="trigger"
            rc={rc}
            open={open === "w"}
            onToggle={() => toggle("w")}
            onChange={(it) => upd((r) => void (r.when = it), `rw:${rule.id}`)}
            onReplace={(type) => upd((r) => void (r.when = { type, params: defaultParams(getRuleItemDef(type)!) }))}
          />
          {rule.conditions.map((c, i) => (
            <ItemRow
              key={i}
              prefix={i === 0 ? "e se" : "e"}
              item={c}
              kind="condition"
              rc={rc}
              open={open === `c${i}`}
              onToggle={() => toggle(`c${i}`)}
              onChange={(it) => upd((r) => void (r.conditions[i] = it), `rc:${rule.id}:${i}`)}
              onNot={() => upd((r) => void (r.conditions[i].not = !r.conditions[i].not || undefined))}
              onMove={(dir) => moveItem("conditions", i, dir)}
              onRemove={() => {
                setOpen(null);
                upd((r) => void r.conditions.splice(i, 1));
              }}
            />
          ))}
          <ItemPicker
            kind="condition"
            label="condizione"
            onPick={(type) => {
              upd((r) => void r.conditions.push({ type, params: defaultParams(getRuleItemDef(type)!, rc) }));
              setOpen(`c${rule.conditions.length}`);
            }}
          />
        </div>
        <div className="rule-col then">
          <div className="rule-label">Allora</div>
          {rule.actions.map((a, i) => (
            <ItemRow
              key={i}
              item={a}
              kind="action"
              rc={rc}
              open={open === `a${i}`}
              onToggle={() => toggle(`a${i}`)}
              onChange={(it) => upd((r) => void (r.actions[i] = it), `ra:${rule.id}:${i}`)}
              onMove={(dir) => moveItem("actions", i, dir)}
              onRemove={() => {
                setOpen(null);
                upd((r) => void r.actions.splice(i, 1));
              }}
            />
          ))}
          {rule.actions.length === 0 && <p className="field-note">Aggiungi almeno un'azione: cosa deve succedere?</p>}
          <ItemPicker
            kind="action"
            label="azione"
            onPick={(type) => {
              upd((r) => void r.actions.push({ type, params: defaultParams(getRuleItemDef(type)!, rc) }));
              setOpen(`a${rule.actions.length}`);
            }}
          />
        </div>
      </div>
    </div>
  );
}

function Sentence({ def, item, rc }: { def: RuleItemDef; item: RuleItem; rc: RuleCtxInfo }) {
  return (
    <>
      {def.sentence.split(/(\{\w+\})/).map((part, i) => {
        const m = /^\{(\w+)\}$/.exec(part);
        if (!m) return <span key={i}>{part}</span>;
        const { text, missing } = formatToken(def.params[m[1]], item.params[m[1]], item, def, rc);
        return (
          <span key={i} className={`tok${missing ? " missing" : ""}`}>
            {text}
          </span>
        );
      })}
    </>
  );
}

function ItemRow({
  item,
  kind,
  rc,
  open,
  prefix,
  onToggle,
  onChange,
  onReplace,
  onNot,
  onMove,
  onRemove,
}: {
  item: RuleItem;
  kind: RuleKind;
  rc: RuleCtxInfo;
  open: boolean;
  prefix?: string;
  onToggle: () => void;
  onChange: (it: RuleItem) => void;
  onReplace?: (type: string) => void;
  onNot?: () => void;
  onMove?: (dir: number) => void;
  onRemove?: () => void;
}) {
  const def = getRuleItemDef(item.type);
  if (!def) {
    return (
      <div className="rule-item bad">
        <span className="rule-sentence">Elemento sconosciuto: {item.type}</span>
        {onRemove && (
          <button type="button" className="icon-btn" onClick={onRemove}>
            <Icon name="trash" size={12} />
          </button>
        )}
      </div>
    );
  }
  return (
    <div className={`rule-item-wrap${open ? " open" : ""}`}>
      <div className={`rule-item ${kind}`} onClick={onToggle} title="Clic per modificare">
        <span className="rule-bullet" />
        {prefix && <span className="rule-prefix">{prefix}</span>}
        {item.not && <span className="rule-not">non</span>}
        <span className="rule-sentence">
          <Sentence def={def} item={item} rc={rc} />
        </span>
        <span className="rule-item-tools" onClick={(e) => e.stopPropagation()}>
          {onNot && (
            <button type="button" className={`mini${item.not ? " on" : ""}`} onClick={onNot} title="Inverti la condizione">
              non
            </button>
          )}
          {onMove && (
            <>
              <button type="button" className="icon-btn" onClick={() => onMove(-1)} title="Sposta su">
                ↑
              </button>
              <button type="button" className="icon-btn" onClick={() => onMove(1)} title="Sposta giù">
                ↓
              </button>
            </>
          )}
          {onRemove && (
            <button type="button" className="icon-btn" onClick={onRemove} title="Rimuovi">
              <Icon name="trash" size={12} />
            </button>
          )}
        </span>
      </div>
      {open && <ItemEditor item={item} def={def} rc={rc} onChange={onChange} onReplace={onReplace} />}
    </div>
  );
}

function ItemEditor({
  item,
  def,
  rc,
  onChange,
  onReplace,
}: {
  item: RuleItem;
  def: RuleItemDef;
  rc: RuleCtxInfo;
  onChange: (it: RuleItem) => void;
  onReplace?: (type: string) => void;
}) {
  const setParam = (name: string, v: unknown) => onChange({ ...item, params: { ...item.params, [name]: v } });
  const args = argSchemas(def, item);
  const given = (item.params.args ?? {}) as Record<string, unknown>;
  const setArg = (name: string, v: unknown) => onChange({ ...item, params: { ...item.params, args: { ...given, [name]: v } } });
  return (
    <div className="rule-editor">
      <div className="rule-editor-top">
        <span className="dim">{def.label}</span>
        {onReplace && <ItemPicker kind="trigger" label="Cambia evento" variant="button" onPick={onReplace} />}
      </div>
      {Object.entries(def.params).map(([name, schema]) => (
        <Field key={name} label={schema.label} help={schema.help}>
          <RuleParamField name={name} schema={schema} item={item} def={def} rc={rc} onChange={(v) => setParam(name, v)} />
        </Field>
      ))}
      {Object.entries(args).map(([name, schema]) => (
        <Field key={`arg-${name}`} label={schema.label} help={schema.help}>
          <PropField
            schema={schema}
            value={given[name] ?? schema.default}
            ctx={{ project: rc.project, states: [], animations: [] }}
            onChange={(v) => setArg(name, v)}
          />
        </Field>
      ))}
      {Object.keys(def.params).length === 0 && <p className="field-note pad">Nessuna impostazione da scegliere.</p>}
    </div>
  );
}

function ChoiceSelect({ value, choices, onChange, empty = "— scegli —" }: { value: string; choices: Choice[]; onChange: (v: string) => void; empty?: string }) {
  const groups = [...new Set(choices.map((c) => c.group ?? ""))];
  const known = choices.some((c) => c.value === value);
  const opts = (list: Choice[]) =>
    list.map((c) => (
      <option key={c.value} value={c.value}>
        {c.label}
      </option>
    ));
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{empty}</option>
      {groups.map((g) =>
        g ? (
          <optgroup key={g} label={g}>
            {opts(choices.filter((c) => c.group === g))}
          </optgroup>
        ) : (
          opts(choices.filter((c) => !c.group))
        ),
      )}
      {value && !known && <option value={value}>{value} (non trovato)</option>}
    </select>
  );
}

function RuleParamField({
  name,
  schema,
  item,
  def,
  rc,
  onChange,
}: {
  name: string;
  schema: PropSchema;
  item: RuleItem;
  def: RuleItemDef;
  rc: RuleCtxInfo;
  onChange: (v: unknown) => void;
}) {
  const value = String(item.params[name] ?? "");
  const blocks = () => blocksForRef(item.params.target, rc);
  const note = (text: string) => <p className="field-note">{text}</p>;
  switch (schema.type) {
    case "object": {
      const trig = def.kind === "trigger";
      const td = rc.triggerDef;
      const choices: Choice[] = [];
      if (!trig && td?.subject) choices.push({ value: "self", label: `questo oggetto (${describeRef(rc.trigger.params[td.subject], rc) || "?"})` });
      if (!trig && td?.other) choices.push({ value: "other", label: `l'altro oggetto (${describeRef(rc.trigger.params[td.other], rc) || "?"})` });
      if (!trig || name === def.other) choices.push({ value: "*", label: "qualsiasi oggetto" });
      for (const t of projectTags(rc.project)) choices.push({ value: `#${t}`, label: `#${t}`, group: "Tutti gli oggetti con l'etichetta" });
      if (rc.scene) for (const f of flattenEntities(rc.scene.entities)) choices.push({ value: `@${f.data.id}`, label: f.data.name, group: "Un oggetto preciso" });
      return <ChoiceSelect value={value} choices={choices} onChange={onChange} />;
    }
    case "input": {
      const keys = Object.keys(rc.project.input ?? {}).length ? Object.keys(rc.project.input) : Object.keys(INPUT_LABELS);
      return <ChoiceSelect value={value} choices={keys.map((k) => ({ value: k, label: INPUT_LABELS[k] ?? k }))} onChange={onChange} />;
    }
    case "prefab":
      return <ChoiceSelect value={value} choices={rc.project.prefabs.map((p) => ({ value: p.id, label: p.name }))} onChange={onChange} />;
    case "compare":
      return (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {COMPARE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "value":
      return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="numero, testo, true/false" />;
    case "event": {
      const ch = eventChoices(blocks());
      if (ch.length) return <ChoiceSelect value={value} choices={ch} onChange={onChange} />;
      return (
        <>
          <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="nome dell'evento" />
          {note("Scegli prima un oggetto che abbia dei blocchi con eventi.")}
        </>
      );
    }
    case "condition": {
      const ch = conditionChoices(blocks());
      return ch.length ? <ChoiceSelect value={value} choices={ch} onChange={onChange} /> : note("L'oggetto scelto non ha blocchi con condizioni.");
    }
    case "blockAction": {
      const ch = actionChoices(blocks());
      return ch.length ? <ChoiceSelect value={value} choices={ch} onChange={onChange} /> : note("L'oggetto scelto non ha blocchi con azioni.");
    }
    case "block": {
      const ch = blockChoices(blocks());
      return ch.length ? <ChoiceSelect value={value} choices={ch} onChange={onChange} /> : note("L'oggetto scelto non ha blocchi.");
    }
    case "state": {
      const ch = stateChoices(blocks());
      return ch.length ? <ChoiceSelect value={value} choices={ch} onChange={onChange} /> : <input value={value} onChange={(e) => onChange(e.target.value)} />;
    }
    default:
      return (
        <PropField schema={schema} value={item.params[name]} ctx={{ project: rc.project, states: [], animations: [] }} onChange={onChange} />
      );
  }
}

function ItemPicker({
  kind,
  label,
  onPick,
  variant = "add",
}: {
  kind: RuleKind;
  label: string;
  onPick: (type: string) => void;
  variant?: "add" | "button";
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);
  const query = q.trim().toLowerCase();
  const defs = RULE_ITEMS.filter((d) => d.kind === kind && `${d.label} ${d.category}`.toLowerCase().includes(query));
  return (
    <div className="rule-picker" ref={ref}>
      <button type="button" className={variant === "add" ? "rule-add" : "btn small"} onClick={() => setOpen(!open)}>
        {variant === "add" && <Icon name="plus" size={12} />}
        {label}
      </button>
      {open && (
        <div className="popover rule-popover">
          <input autoFocus placeholder="Cerca…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="popover-list">
            {RULE_CATEGORIES.map((c) => {
              const list = defs.filter((d) => d.category === c);
              if (!list.length) return null;
              return (
                <div key={c}>
                  <div className="group-label">{c}</div>
                  {list.map((d) => (
                    <button
                      type="button"
                      key={d.type}
                      className="menu-item"
                      onClick={() => {
                        onPick(d.type);
                        setOpen(false);
                        setQ("");
                      }}
                    >
                      <b>{d.label}</b>
                    </button>
                  ))}
                </div>
              );
            })}
            {defs.length === 0 && <p className="empty-hint">Niente trovato.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

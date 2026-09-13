import { useEffect, useState, type ReactNode } from "react";
import { DEFAULT_INPUT, INPUT_LABELS, type NamedInfo, type ProjectData, type PropSchema } from "@runtime";

export interface FieldCtx {
  project: ProjectData;
  /** Stati dichiarati dai blocchi dell'oggetto (per le animazioni). */
  states: NamedInfo[];
  /** Animazioni disponibili nell'immagine dello Sprite. */
  animations: string[];
}

export function Field({
  label,
  help,
  children,
  modified,
  onReset,
}: {
  label: string;
  help?: string;
  children: ReactNode;
  modified?: boolean;
  onReset?: () => void;
}) {
  return (
    <div className="field">
      <label title={help ? `${label}: ${help}` : label}>
        {modified && (
          <button type="button" className="mod-dot" title="Diverso dal modello: clic per ripristinare" onClick={onReset} />
        )}
        <span className="field-label">{label}</span>
        {help && <span className="help">?</span>}
      </label>
      <div className="field-ctl">{children}</div>
    </div>
  );
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

export function NumberField({
  value,
  onChange,
  unit,
  step,
  min,
  max,
  integer,
}: {
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  integer?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className={`unit-input${unit ? " has-unit" : ""}`}>
      <input
        type="number"
        value={draft ?? fmt(value)}
        step={step ?? (integer ? 1 : 0.1)}
        min={min}
        max={max}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = parseFloat(e.target.value);
          if (!Number.isNaN(n)) onChange(integer ? Math.round(n) : n);
        }}
        onBlur={() => setDraft(null)}
      />
      {unit && <span className="unit">{unit}</span>}
    </div>
  );
}

/** Campo che conferma il valore solo con Invio o uscendo dal campo (per modifiche "pesanti"). */
export function CommitInput({
  value,
  onCommit,
  className,
  placeholder,
  title,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
  placeholder?: string;
  title?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      className={className}
      value={draft}
      placeholder={placeholder}
      title={title}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(value);
      }}
    />
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track">
        <span className="knob" />
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}

export function TagsInput({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  return (
    <CommitInput
      value={value.join(", ")}
      placeholder="es. giocatore, nemico"
      onCommit={(v) =>
        onChange(
          v
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        )
      }
    />
  );
}

const hex6 = (v: unknown) => {
  const s = String(v ?? "#ffffff");
  return /^#[0-9a-f]{6}$/i.test(s) ? s : /^#[0-9a-f]{8}$/i.test(s) ? s.slice(0, 7) : "#ffffff";
};

export function PropField({
  schema,
  value,
  onChange,
  ctx,
}: {
  schema: PropSchema;
  value: unknown;
  onChange: (v: unknown) => void;
  ctx: FieldCtx;
}) {
  const p = ctx.project;
  switch (schema.type) {
    case "number":
    case "integer":
      return (
        <NumberField
          value={Number(value ?? 0)}
          unit={schema.unit}
          step={schema.step}
          min={schema.min}
          max={schema.max}
          integer={schema.type === "integer"}
          onChange={onChange}
        />
      );
    case "boolean":
      return <Toggle checked={!!value} onChange={onChange} />;
    case "string":
      return <input type="text" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "text":
      return <textarea rows={2} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "select":
      return (
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {schema.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "image":
    case "audio": {
      const list = p.assets.filter((a) => a.type === schema.type);
      const v = String(value ?? "");
      return (
        <select value={v} onChange={(e) => onChange(e.target.value)}>
          <option value="">— nessuno —</option>
          {list.map((a) => (
            <option key={a.id} value={a.id}>
              {a.id}
            </option>
          ))}
          {v && !list.some((a) => a.id === v) && <option value={v}>{v} (mancante)</option>}
        </select>
      );
    }
    case "scene":
      return (
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">— scegli —</option>
          {p.scenes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      );
    case "group":
      return (
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {p.settings.collisionGroups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      );
    case "groups": {
      const sel = new Set(Array.isArray(value) ? (value as string[]) : []);
      return (
        <div className="chips">
          {p.settings.collisionGroups.map((g) => (
            <button
              type="button"
              key={g}
              className={`chip${sel.has(g) ? " on" : ""}`}
              onClick={() => {
                const next = new Set(sel);
                if (next.has(g)) next.delete(g);
                else next.add(g);
                onChange([...next]);
              }}
            >
              {g}
            </button>
          ))}
        </div>
      );
    }
    case "prefab":
      return (
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">— nessuno —</option>
          {p.prefabs.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      );
    case "dialogue":
      return (
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">{schema.optional ? "— qualsiasi —" : "— scegli —"}</option>
          {(p.dialogues ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      );
    case "input":
      return (
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {[...new Set([...Object.keys(DEFAULT_INPUT), ...Object.keys(p.input ?? {})])].map((k) => (
            <option key={k} value={k}>
              {INPUT_LABELS[k] ?? k}
            </option>
          ))}
        </select>
      );
    case "tag":
      return <input list="pepino-tags" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "variable":
      return <input list="pepino-vars" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "color":
      return (
        <div className="color-field">
          <input type="color" value={hex6(value)} onChange={(e) => onChange(e.target.value)} />
          <input type="text" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    case "stateMap":
      return <StateMapField value={(value ?? {}) as Record<string, string>} onChange={onChange} ctx={ctx} />;
    default:
      return <span className="dim">Tipo non supportato</span>;
  }
}

function StateMapField({
  value,
  onChange,
  ctx,
}: {
  value: Record<string, string>;
  onChange: (v: unknown) => void;
  ctx: FieldCtx;
}) {
  if (ctx.states.length === 0) {
    return <p className="empty-hint">Aggiungi un controller (Platform o Top-down): i suoi stati compariranno qui.</p>;
  }
  if (ctx.animations.length === 0) {
    return <p className="empty-hint">L'immagine dello Sprite non ha animazioni: aggiungile dal pannello Asset.</p>;
  }
  return (
    <div className="state-map">
      {ctx.states.map((s) => {
        const auto = ctx.animations.includes(s.id);
        return (
          <div className="state-row" key={s.id}>
            <span>{s.label}</span>
            <select
              value={value[s.id] ?? ""}
              onChange={(e) => {
                const next = { ...value };
                if (e.target.value) next[s.id] = e.target.value;
                else delete next[s.id];
                onChange(next);
              }}
            >
              <option value="">{auto ? `automatica (${s.id})` : "— nessuna —"}</option>
              {ctx.animations.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}

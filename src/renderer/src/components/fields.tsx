import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BUILTIN_FONTS,
  DEFAULT_FONT_ID,
  DEFAULT_INPUT,
  INPUT_LABELS,
  isBuiltinFont,
  type NamedInfo,
  type ProjectData,
  type PropSchema,
} from "@runtime";
import { T } from "../i18n";
import { useEditor } from "../store";
import { assetUrl, spriteOf } from "../projectOps";
import { FontPreview } from "./FontPreview";
import { FrameThumb } from "./thumbs";
import { Icon } from "./Icon";

type PickKind = "image" | "audio" | "prefab" | "item";

/** Tipo del trascinamento che arriva dai pannelli Asset e Modelli e dalla scheda Oggetti. */
const DRAG_TYPE: Record<PickKind | "font", string> = {
  image: "application/x-pepino-image",
  audio: "application/x-pepino-audio",
  font: "application/x-pepino-font",
  prefab: "application/x-pepino-prefab",
  item: "application/x-pepino-item",
};

interface PickItem {
  id: string;
  label: string;
  thumb: ReactNode;
}

/** Scelta di un'immagine, di un suono o di un modello: si cerca per nome o si trascina qui dai pannelli Asset e Modelli. */
function AssetPicker({ kind, value, onChange, project }: { kind: PickKind; value: string; onChange: (v: string) => void; project: ProjectData }) {
  const baseUrl = useEditor((s) => s.baseUrl);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [open]);

  const items: PickItem[] =
    kind === "item"
      ? (project.items ?? []).map((it) => {
          const a = project.assets.find((x) => x.id === it.icon);
          return {
            id: it.id,
            label: it.name,
            thumb:
              a?.type === "image" ? (
                <FrameThumb url={assetUrl(baseUrl, a.src, a.rev)} sw={a.frameWidth} sh={a.frameHeight} frame={it.frame ?? 0} size={20} />
              ) : (
                <Icon name="coin" size={14} />
              ),
          };
        })
      : kind === "prefab"
      ? project.prefabs.map((pf) => {
          const sp = spriteOf(project, pf.blocks);
          const a = sp?.asset;
          return {
            id: pf.id,
            label: pf.name,
            thumb: a ? <FrameThumb url={assetUrl(baseUrl, a.src, a.rev)} sw={a.frameWidth} sh={a.frameHeight} frame={sp.frame} size={20} /> : <Icon name="cube" size={14} />,
          };
        })
      : project.assets
          .filter((a) => a.type === kind)
          .map((a) => ({
            id: a.id,
            label: a.id,
            thumb:
              a.type === "image" ? (
                <FrameThumb url={assetUrl(baseUrl, a.src, a.rev)} sw={a.frameWidth} sh={a.frameHeight} frame={0} size={20} />
              ) : (
                <Icon name={a.type === "audio" && a.song ? "music" : "sound"} size={14} />
              ),
          }));
  const cur = items.find((i) => i.id === value);
  const query = q.trim().toLowerCase();
  const found = query ? items.filter((i) => `${i.label} ${i.id}`.toLowerCase().includes(query)) : items;
  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div
      ref={ref}
      className={`asset-pick${over ? " drop" : ""}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE[kind])) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData(DRAG_TYPE[kind]);
        if (!id) return;
        e.preventDefault();
        onChange(id);
      }}
    >
      <button
        type="button"
        className="asset-pick-btn"
        title={T("Clic per cercare, oppure trascina qui dal pannello Asset o Modelli")}
        onClick={() => {
          setOpen(!open);
          setQ("");
        }}
      >
        <span className="asset-pick-thumb">{cur?.thumb}</span>
        <span className="asset-pick-name">{cur ? cur.label : value ? `${value}${T(" (mancante)")}` : T("— nessuno —")}</span>
        <Icon name="chevron" size={11} />
      </button>
      {open && (
        <div className="asset-pop">
          <input
            autoFocus
            placeholder={T("Cerca per nome…")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter" && found[0]) pick(found[0].id);
            }}
          />
          <div className="asset-pop-list">
            {!query && (
              <button type="button" className={`asset-pop-item${!value ? " on" : ""}`} onClick={() => pick("")}>
                <span className="asset-pick-thumb" />
                <span>{T("— nessuno —")}</span>
              </button>
            )}
            {found.map((it) => (
              <button type="button" key={it.id} className={`asset-pop-item${it.id === value ? " on" : ""}`} onClick={() => pick(it.id)}>
                <span className="asset-pick-thumb">{it.thumb}</span>
                <span>{it.label}</span>
              </button>
            ))}
            {found.length === 0 && <p className="empty-hint">{T("Nessun risultato.")}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

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
      <label title={help ? `${T(label)}: ${T(help)}` : T(label)}>
        {modified && (
          <button type="button" className="mod-dot" title={T("Diverso dal modello: clic per ripristinare")} onClick={onReset} />
        )}
        <span className="field-label">{T(label)}</span>
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
      {unit && <span className="unit">{T(unit)}</span>}
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
      placeholder={T("es. giocatore, nemico")}
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
              {T(o.label)}
            </option>
          ))}
        </select>
      );
    case "image":
    case "audio":
      return <AssetPicker kind={schema.type} value={String(value ?? "")} onChange={onChange} project={p} />;
    case "font": {
      const fonts = p.assets.filter((a) => a.type === "font");
      const v = String(value ?? "");
      const known = !v || isBuiltinFont(v) || fonts.some((a) => a.id === v);
      return (
        <div
          className="font-field"
          style={{ display: "grid", gap: 4, minWidth: 0 }}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(DRAG_TYPE.font)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(e) => {
            const id = e.dataTransfer.getData(DRAG_TYPE.font);
            if (!id) return;
            e.preventDefault();
            onChange(id);
          }}
        >
          <select value={v} onChange={(e) => onChange(e.target.value)}>
            {schema.default === "" && <option value="">{T("— carattere del gioco —")}</option>}
            {BUILTIN_FONTS.map((f) => (
              <option key={f.id} value={f.id}>
                {T(f.label)}
              </option>
            ))}
            {fonts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id}
              </option>
            ))}
            {!known && <option value={v}>{v}{T(" (mancante)")}</option>}
          </select>
          <FontPreview font={v || p.settings.font || DEFAULT_FONT_ID} />
        </div>
      );
    }
    case "scene":
      return (
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">{T("— scegli —")}</option>
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
      return <AssetPicker kind="prefab" value={String(value ?? "")} onChange={onChange} project={p} />;
    case "item":
      return <AssetPicker kind="item" value={String(value ?? "")} onChange={onChange} project={p} />;
    case "itemList":
      return <ItemListField value={value} onChange={onChange} project={p} />;
    case "list":
      return <ListField schema={schema} value={value} onChange={onChange} ctx={ctx} />;
    case "dialogue":
      return (
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">{schema.optional ? T("— qualsiasi —") : T("— scegli —")}</option>
          {(p.dialogues ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      );
    case "cutscene":
      return (
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">{schema.optional ? T("— qualsiasi —") : T("— scegli —")}</option>
          {(p.cutscenes ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      );
    case "language":
      return (
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">{T("— scegli —")}</option>
          {(p.languages ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      );
    case "input":
      return (
        <select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {[...new Set([...Object.keys(DEFAULT_INPUT), ...Object.keys(p.input ?? {})])].map((k) => (
            <option key={k} value={k}>
              {T(INPUT_LABELS[k] ?? k)}
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
      return <span className="dim">{T("Tipo non supportato")}</span>;
  }
}

/**
 * Elenco di righe tutte uguali (le armi di un arsenale, le carte di un mazzo…): ogni riga è una scheda
 * con i campi descritti in `schema.fields`, che si apre e si chiude. Le righe si spostano su e giù.
 */
function ListField({
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
  const fields = Object.entries(schema.fields ?? {});
  const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const [open, setOpen] = useState<number>(rows.length === 1 ? 0 : -1);
  const setRow = (i: number, key: string, v: unknown) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
  const move = (i: number, step: number) => {
    const j = i + step;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    setOpen(j);
  };
  const blank = () => Object.fromEntries(fields.map(([k, f]) => [k, structuredClone(f.default)]));
  return (
    <div className="row-list">
      {rows.map((row, i) => {
        const title = String((schema.rowLabel && row[schema.rowLabel]) || "") || T("Riga {0}", String(i + 1));
        return (
          <div className={`row-card${open === i ? " open" : ""}`} key={i}>
            <div className="row-head">
              <button type="button" className="row-title" onClick={() => setOpen(open === i ? -1 : i)}>
                <Icon name="chevron" size={11} className={open === i ? "rot" : ""} />
                <b>{T(title)}</b>
              </button>
              <button type="button" className="icon-btn" title={T("Sposta su")} disabled={i === 0} onClick={() => move(i, -1)}>
                <Icon name="up" size={11} />
              </button>
              <button type="button" className="icon-btn" title={T("Sposta giù")} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                <Icon name="down" size={11} />
              </button>
              <button type="button" className="icon-btn" title={T("Togli")} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                <Icon name="trash" size={11} />
              </button>
            </div>
            {open === i && (
              <div className="row-fields">
                {fields.map(([k, f]) => (
                  <Field key={k} label={f.label} help={f.help}>
                    <PropField schema={f} value={k in row ? row[k] : f.default} ctx={ctx} onChange={(v) => setRow(i, k, v)} />
                  </Field>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <button
        type="button"
        className="btn small"
        onClick={() => {
          onChange([...rows, blank()]);
          setOpen(rows.length);
        }}
      >
        <Icon name="plus" size={12} />
        {T(schema.addLabel ?? " Aggiungi riga")}
      </button>
    </div>
  );
}

/** Oggetti in vendita in un negozio: oggetto e prezzo (0 = quello dell'archivio). */
function ItemListField({ value, onChange, project }: { value: unknown; onChange: (v: unknown) => void; project: ProjectData }) {
  const rows = Array.isArray(value) ? (value as { item?: string; price?: number }[]) : [];
  const setRow = (i: number, patch: { item?: string; price?: number }) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="item-list">
      {rows.length > 0 && (
        <div className="item-row head">
          <span>{T("Oggetto")}</span>
          <span>{T("Prezzo")}</span>
          <span />
        </div>
      )}
      {rows.map((r, i) => (
        <div className="item-row" key={i}>
          <AssetPicker kind="item" value={String(r?.item ?? "")} project={project} onChange={(v) => setRow(i, { item: v })} />
          <NumberField integer min={0} value={Number(r?.price ?? 0)} onChange={(v) => setRow(i, { price: Math.max(0, v) })} />
          <button type="button" className="icon-btn" title={T("Togli")} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <Icon name="trash" size={12} />
          </button>
        </div>
      ))}
      <button type="button" className="btn small" onClick={() => onChange([...rows, { item: project.items?.[0]?.id ?? "", price: 0 }])}>
        <Icon name="plus" size={12} />
        {T(" Aggiungi oggetto")}
      </button>
      {!project.items?.length && <p className="empty-hint">{T("Crea prima gli oggetti nella scheda Oggetti.")}</p>}
    </div>
  );
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
    return <p className="empty-hint">{T("Aggiungi un controller (Platform o Top-down): i suoi stati compariranno qui.")}</p>;
  }
  if (ctx.animations.length === 0) {
    return <p className="empty-hint">{T("L'immagine dello Sprite non ha animazioni: aggiungile dal pannello Asset.")}</p>;
  }
  return (
    <div className="state-map">
      {ctx.states.map((s) => {
        const auto = ctx.animations.includes(s.id);
        return (
          <div className="state-row" key={s.id}>
            <span>{T(s.label)}</span>
            <select
              value={value[s.id] ?? ""}
              onChange={(e) => {
                const next = { ...value };
                if (e.target.value) next[s.id] = e.target.value;
                else delete next[s.id];
                onChange(next);
              }}
            >
              <option value="">{auto ? T("automatica ({0})", s.id) : T("— nessuna —")}</option>
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

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  BLOCK_CATEGORIES,
  DEFAULT_FONT_ID,
  DEFAULT_TOUCH,
  INPUT_LABELS,
  SCREEN_EFFECTS,
  getBlockDef,
  listBlockDefs,
  resolveProps,
  type BlockData,
  type BlockDef,
  type EntityData,
  type ImageAsset,
  type PrefabData,
  type ProjectData,
  type PropSchema,
  type SceneData,
  type TileLayerData,
  type VariableValue,
} from "@runtime";
import { currentScene, editProject, setState, useEditor, viewInfo } from "../store";
import {
  assetUrl,
  effectiveBlocks,
  findEntity,
  missingWithRequires,
  prefabUses,
  projectTags,
  sceneOf,
  spriteOf,
  statesFor,
} from "../projectOps";
import { addEntityAt, createPrefabFromEntity, deleteSelection, duplicateSelection, unlinkPrefab } from "../commands";
import { CommitInput, Field, NumberField, PropField, TagsInput, Toggle, type FieldCtx } from "./fields";
import { Icon } from "./Icon";
import { AnimPreview, FrameThumb } from "./thumbs";
import { FontPreview } from "./FontPreview";
import { openImageAsset } from "../pixel/store";
import { openInMusic, previewAsset } from "../music/player";
import { T } from "../i18n";

export function Inspector() {
  const sel = useEditor((s) => s.selection);
  const project = useEditor((s) => s.project);
  // I blocchi personalizzati possono cambiare mentre si scrive il codice: ridisegna quando succede.
  useEditor((s) => s.blocksVersion);
  if (!project) return null;
  return (
    <aside className="panel inspector">
      <div className="panel-h">
        <Icon name="settings" size={13} />{T("Inspector")}</div>
      <div className="panel-body">
        {sel?.kind === "entity" ? (
          <EntityInspector key={sel.id} id={sel.id} />
        ) : sel?.kind === "prefab" ? (
          <PrefabInspector key={sel.id} id={sel.id} />
        ) : sel?.kind === "layer" ? (
          <LayerInspector key={sel.id} id={sel.id} />
        ) : sel?.kind === "asset" ? (
          <AssetInspector key={sel.id} id={sel.id} />
        ) : (
          <SceneInspector />
        )}
      </div>
      <datalist id="pepino-tags">
        {projectTags(project).map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <datalist id="pepino-vars">
        {Object.keys(project.variables).map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
    </aside>
  );
}

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="insp-section">
      <div className="insp-section-h">
        <span>{title}</span>
        {right}
      </div>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ Blocchi

interface BlockOps {
  setProp(type: string, key: string, value: unknown): void;
  setEnabled(type: string, enabled: boolean): void;
  remove(type: string): void;
  add(type: string): void;
  isOverridden?(type: string, key: string): boolean;
  reset?(type: string, key: string): void;
}

function BlockList({ blocks, project, ops }: { blocks: BlockData[]; project: ProjectData; ops: BlockOps }) {
  const sprite = spriteOf(project, blocks);
  const ctx: FieldCtx = { project, states: statesFor(blocks), animations: Object.keys(sprite?.asset?.animations ?? {}) };
  const active = new Set(blocks.filter((b) => b.enabled !== false).map((b) => b.type));
  return (
    <>
      {blocks.map((b) => (
        <BlockCard
          key={b.type}
          block={b}
          ctx={ctx}
          ops={ops}
          missing={(getBlockDef(b.type)?.requires ?? []).filter((r) => !active.has(r))}
        />
      ))}
      {blocks.length === 0 && (
        <p className="empty-hint">{T("Nessun blocco. Aggiungi uno Sprite per vederlo e un controller per muoverlo.")}</p>
      )}
      <AddBlockMenu existing={blocks} onAdd={ops.add} />
    </>
  );
}

function BlockCard({ block, ctx, ops, missing }: { block: BlockData; ctx: FieldCtx; ops: BlockOps; missing: string[] }) {
  const def = getBlockDef(block.type);
  const [open, setOpen] = useState(true);
  if (!def) {
    return (
      <div className="block-card unknown">
        <div className="block-h">
          <Icon name="bug" size={13} />
          <span className="block-title">{T("Blocco sconosciuto: ")}{block.type}</span>
          <button type="button" className="icon-btn" title={T("Rimuovi")} onClick={() => ops.remove(block.type)}>
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>
    );
  }
  const props = resolveProps(def, block.props);
  const groups: [string, [string, PropSchema][]][] = [];
  for (const entry of Object.entries(def.props)) {
    const g = entry[1].group ?? "";
    let grp = groups.find((x) => x[0] === g);
    if (!grp) groups.push((grp = [g, []]));
    grp[1].push(entry);
  }
  const off = block.enabled === false;
  return (
    <div className={`block-card${off ? " off" : ""}`}>
      <div className="block-h" onClick={() => setOpen(!open)}>
        <Icon name="chevron" size={12} className={open ? "rot" : ""} />
        <input
          type="checkbox"
          checked={!off}
          title={off ? T("Attiva il blocco") : T("Disattiva il blocco")}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => ops.setEnabled(block.type, e.target.checked)}
        />
        <span className="block-title">{T(def.label)}</span>
        <span className="cat">{T(def.category)}</span>
        <button
          type="button"
          className="icon-btn"
          title={T("Rimuovi blocco")}
          onClick={(e) => {
            e.stopPropagation();
            ops.remove(block.type);
          }}
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
      {open && (
        <div className="block-body">
          {def.description && <p className="block-desc">{T(def.description)}</p>}
          {missing.length > 0 && (
            <div className="warn-line">
              <span>{T("Serve anche: ")}{missing.map((m) => T(getBlockDef(m)?.label ?? m)).join(", ")}</span>
              <button type="button" className="btn small" onClick={() => missing.forEach((m) => ops.add(m))}>{T("Aggiungi")}</button>
            </div>
          )}
          {groups.map(([g, entries]) => (
            <Fragment key={g}>
              {g && <div className="group-label">{T(g)}</div>}
              {entries.map(([key, schema]) =>
                schema.type === "stateMap" ? (
                  <div className="field-wide" key={key}>
                    <div className="field-wide-label">{T(schema.label)}</div>
                    <PropField schema={schema} value={props[key]} ctx={ctx} onChange={(v) => ops.setProp(block.type, key, v)} />
                  </div>
                ) : (
                  <Field
                    key={key}
                    label={schema.label}
                    help={schema.help}
                    modified={ops.isOverridden?.(block.type, key)}
                    onReset={() => ops.reset?.(block.type, key)}
                  >
                    <PropField schema={schema} value={props[key]} ctx={ctx} onChange={(v) => ops.setProp(block.type, key, v)} />
                  </Field>
                ),
              )}
            </Fragment>
          ))}
          <Contract def={def} />
        </div>
      )}
    </div>
  );
}

/** Cosa il blocco offre alle Regole: stati, eventi, azioni. */
function Contract({ def }: { def: BlockDef }) {
  const parts: [string, string[]][] = [];
  if (def.states.length) parts.push([T("Stati"), def.states.map((s) => T(s.label))]);
  if (def.events.length) parts.push([T("Eventi"), def.events.map((s) => T(s.label))]);
  const actions = Object.values(def.actions);
  if (actions.length) parts.push([T("Azioni"), actions.map((a) => T(a.label))]);
  if (!parts.length) return null;
  return (
    <div className="contract">
      {parts.map(([k, v]) => (
        <div key={k}>
          <b>{k}</b> {v.join(" · ")}
        </div>
      ))}
    </div>
  );
}

function AddBlockMenu({ existing, onAdd }: { existing: BlockData[]; onAdd: (type: string) => void }) {
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
  const have = new Set(existing.filter((b) => b.enabled !== false).map((b) => b.type));
  const query = q.trim().toLowerCase();
  const defs = listBlockDefs().filter(
    (d) =>
      !have.has(d.type) &&
      `${d.label} ${d.description} ${d.category} ${T(d.label)} ${T(d.description)} ${T(d.category)}`.toLowerCase().includes(query),
  );
  const cats = [...new Set([...BLOCK_CATEGORIES, ...defs.map((d) => d.category)])];
  return (
    <div className="add-block" ref={ref}>
      <button type="button" className="btn add-block-btn" onClick={() => setOpen(!open)}>
        <Icon name="plus" size={13} />{T(" Aggiungi blocco")}</button>
      {open && (
        <div className="popover">
          <input autoFocus placeholder={T("Cerca: salto, camera, moneta…")} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="popover-list">
            {cats.map((c) => {
              const list = defs.filter((d) => d.category === c);
              if (!list.length) return null;
              return (
                <div key={c}>
                  <div className="group-label">{T(c)}</div>
                  {list.map((d) => (
                    <button
                      type="button"
                      key={d.type}
                      className="menu-item"
                      onClick={() => {
                        onAdd(d.type);
                        setOpen(false);
                        setQ("");
                      }}
                    >
                      <b>{T(d.label)}</b>
                      <span>{T(d.description)}</span>
                    </button>
                  ))}
                </div>
              );
            })}
            {defs.length === 0 && <p className="empty-hint">{T("Nessun blocco trovato.")}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Oggetto

function EntityInspector({ id }: { id: string }) {
  const project = useEditor((s) => s.project)!;
  const scene = useEditor(currentScene)!;
  const e = findEntity(scene.entities, id);
  if (!e) return <p className="empty-hint">{T("Oggetto non trovato.")}</p>;
  const prefab = e.prefab ? project.prefabs.find((p) => p.id === e.prefab) : undefined;
  const blocks = effectiveBlocks(project, e);

  const upd = (fn: (ent: EntityData) => void, merge?: string) =>
    editProject((p) => {
      const ent = findEntity(sceneOf(p, scene.id)!.entities, id);
      if (ent) fn(ent);
    }, merge);
  const own = (ent: EntityData, type: string) => {
    let b = ent.blocks.find((x) => x.type === type);
    if (!b) ent.blocks.push((b = { type, props: {} }));
    return b;
  };
  const ops: BlockOps = {
    setProp: (type, key, v) => upd((ent) => void (own(ent, type).props[key] = v), `prop:${id}:${type}:${key}`),
    setEnabled: (type, en) => upd((ent) => void (own(ent, type).enabled = en)),
    remove: (type) =>
      upd((ent) => {
        if (prefab?.blocks.some((b) => b.type === type)) own(ent, type).enabled = false;
        else ent.blocks = ent.blocks.filter((b) => b.type !== type);
      }),
    add: (type) =>
      upd((ent) => {
        for (const t of missingWithRequires(effectiveBlocks(project, ent), type)) own(ent, t).enabled = true;
      }),
    isOverridden: prefab ? (type, key) => !!e.blocks.find((b) => b.type === type && key in b.props) : undefined,
    reset: (type, key) =>
      upd((ent) => {
        const b = ent.blocks.find((x) => x.type === type);
        if (!b) return;
        delete b.props[key];
        if (!Object.keys(b.props).length && b.enabled !== false && prefab?.blocks.some((pb) => pb.type === type)) {
          ent.blocks = ent.blocks.filter((x) => x !== b);
        }
      }),
  };

  return (
    <>
      <div className="insp-title">
        <Icon name="cube" />
        <input className="title-input" value={e.name} onChange={(ev) => upd((ent) => void (ent.name = ev.target.value), `name:${id}`)} />
      </div>
      <div className="insp-sub mono">{T("id: ")}{e.id}</div>
      {prefab && (
        <div className="notice">
          <Icon name="link" />
          <div>
            <b>{T("Istanza del modello «")}{prefab.name}»</b>
            <p>{T("Le modifiche valgono solo per questo oggetto. Il pallino verde indica un valore diverso dal modello.")}</p>
            <div className="row-btns">
              <button type="button" className="btn small" onClick={() => setState({ selection: { kind: "prefab", id: prefab.id } })}>{T("Modifica il modello")}</button>
              <button type="button" className="btn small ghost" onClick={() => unlinkPrefab(id)}>{T("Scollega")}</button>
            </div>
          </div>
        </div>
      )}
      <Section title={T("Oggetto")}>
        <Field label={T("Etichette")} help={T("Servono ai blocchi per riconoscere gli oggetti (giocatore, nemico…).")}>
          <TagsInput value={e.tags ?? []} onChange={(tags) => upd((ent) => void (ent.tags = tags))} />
        </Field>
        {prefab?.tags?.length ? (
          <Field label={T("Dal modello")}>
            <span className="dim">{prefab.tags.join(", ")}</span>
          </Field>
        ) : null}
        <Field label={T("Posizione X")}>
          <NumberField value={e.x} unit="px" step={1} onChange={(v) => upd((ent) => void (ent.x = v), `x:${id}`)} />
        </Field>
        <Field label={T("Posizione Y")}>
          <NumberField value={e.y} unit="px" step={1} onChange={(v) => upd((ent) => void (ent.y = v), `y:${id}`)} />
        </Field>
        <Field label={T("Livello di disegno")} help={T("Più alto = disegnato davanti. I layer di tile hanno il loro livello.")}>
          <NumberField integer value={e.z ?? prefab?.z ?? 0} onChange={(v) => upd((ent) => void (ent.z = v), `z:${id}`)} />
        </Field>
        <Field label={T("Visibile")}>
          <Toggle checked={e.visible !== false} onChange={(v) => upd((ent) => void (ent.visible = v))} />
        </Field>
      </Section>
      <Section title={T("Blocchi")}>
        <BlockList blocks={blocks} project={project} ops={ops} />
      </Section>
      <div className="insp-actions">
        {!prefab && (
          <button type="button" className="btn small" onClick={() => createPrefabFromEntity(id)}>
            <Icon name="link" size={13} />{T(" Crea modello")}</button>
        )}
        <button type="button" className="btn small" onClick={duplicateSelection}>
          <Icon name="copy" size={13} />{T(" Duplica")}</button>
        <button type="button" className="btn small danger" onClick={deleteSelection}>
          <Icon name="trash" size={13} />{T(" Elimina")}</button>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Modello

function PrefabInspector({ id }: { id: string }) {
  const project = useEditor((s) => s.project)!;
  const pf = project.prefabs.find((p) => p.id === id);
  if (!pf) return <p className="empty-hint">{T("Modello non trovato.")}</p>;
  const uses = prefabUses(project, id);
  const ts = project.settings.tileSize;
  const upd = (fn: (x: PrefabData) => void, merge?: string) =>
    editProject((p) => {
      const x = p.prefabs.find((q) => q.id === id);
      if (x) fn(x);
    }, merge);
  const ops: BlockOps = {
    setProp: (type, key, v) =>
      upd((x) => {
        const b = x.blocks.find((q) => q.type === type);
        if (b) b.props[key] = v;
      }, `pprop:${id}:${type}:${key}`),
    setEnabled: (type, en) =>
      upd((x) => {
        const b = x.blocks.find((q) => q.type === type);
        if (b) b.enabled = en;
      }),
    remove: (type) => upd((x) => void (x.blocks = x.blocks.filter((b) => b.type !== type))),
    add: (type) =>
      upd((x) => {
        for (const t of missingWithRequires(x.blocks, type)) {
          const b = x.blocks.find((q) => q.type === t);
          if (b) b.enabled = true;
          else x.blocks.push({ type: t, props: {} });
        }
      }),
  };
  return (
    <>
      <div className="insp-title">
        <Icon name="link" />
        <input className="title-input" value={pf.name} onChange={(ev) => upd((x) => void (x.name = ev.target.value), `pname:${id}`)} />
      </div>
      <div className="insp-sub">{T("Modello · usato da ")}{uses} {uses === 1 ? T("oggetto") : T("oggetti")}</div>
      <div className="notice accent">
        <Icon name="link" />
        <div>
          <b>{T("Le modifiche valgono per tutti")}</b>
          <p>{T("Ogni oggetto creato da questo modello riceve i cambiamenti. Trascinalo dal pannello Modelli nella scena per piazzarne altri.")}</p>
          <div className="row-btns">
            <button
              type="button"
              className="btn small"
              onClick={() => addEntityAt(Math.floor(viewInfo.cx / ts) * ts + ts / 2, Math.floor(viewInfo.cy / ts) * ts + ts, pf.name, [], pf.id)}
            >{T("Aggiungi alla scena")}</button>
          </div>
        </div>
      </div>
      <Section title={T("Modello")}>
        <Field label={T("Etichette")}>
          <TagsInput value={pf.tags ?? []} onChange={(tags) => upd((x) => void (x.tags = tags))} />
        </Field>
        <Field label={T("Livello di disegno")}>
          <NumberField integer value={pf.z ?? 0} onChange={(v) => upd((x) => void (x.z = v), `pz:${id}`)} />
        </Field>
      </Section>
      <Section title={T("Blocchi")}>
        <BlockList blocks={pf.blocks} project={project} ops={ops} />
      </Section>
      <div className="insp-actions">
        <button
          type="button"
          className="btn small danger"
          disabled={uses > 0}
          title={uses > 0 ? T("Il modello è usato da alcuni oggetti") : T("Elimina il modello")}
          onClick={deleteSelection}
        >
          <Icon name="trash" size={13} />{T(" Elimina modello")}</button>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Layer

function LayerInspector({ id }: { id: string }) {
  const project = useEditor((s) => s.project)!;
  const scene = useEditor(currentScene)!;
  const layer = scene.layers.find((l) => l.id === id);
  if (!layer) return <p className="empty-hint">{T("Layer non trovato.")}</p>;
  const upd = (fn: (l: TileLayerData) => void, merge?: string) =>
    editProject((p) => {
      const l = sceneOf(p, scene.id)!.layers.find((x) => x.id === id);
      if (l) fn(l);
    }, merge);
  const painted = layer.data.filter((t) => t >= 0).length;
  return (
    <>
      <div className="insp-title">
        <Icon name="layers" />
        <input className="title-input" value={layer.name} onChange={(ev) => upd((l) => void (l.name = ev.target.value), `lname:${id}`)} />
      </div>
      <div className="insp-sub">{T("Layer di tile · ")}{painted}{T(" tile dipinti")}</div>
      <Section title={T("Layer")}>
        <Field label={T("Tileset")}>
          <select value={layer.tileset} onChange={(ev) => upd((l) => void (l.tileset = ev.target.value))}>
            {project.tilesets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={T("Conta per le collisioni")} help={T("I tile di questo layer bloccano, fanno male o si scalano secondo il tipo di collisione del tileset.")}>
          <Toggle checked={layer.collides} onChange={(v) => upd((l) => void (l.collides = v))} />
        </Field>
        <Field label={T("Livello di disegno")} help={T("Gli oggetti di solito hanno 0: un layer con valore più alto è disegnato davanti.")}>
          <NumberField integer value={layer.z} onChange={(v) => upd((l) => void (l.z = v), `lz:${id}`)} />
        </Field>
        <Field label={T("Parallasse")} help={T("1 = segue la camera; 0.5 = si muove a metà velocità (sfondi lontani).")}>
          <NumberField value={layer.parallax ?? 1} step={0.1} min={0} onChange={(v) => upd((l) => void (l.parallax = v), `lp:${id}`)} />
        </Field>
        <Field label={T("Opacità")}>
          <NumberField value={layer.opacity ?? 1} step={0.05} min={0} max={1} onChange={(v) => upd((l) => void (l.opacity = v), `lo:${id}`)} />
        </Field>
        <Field label={T("Visibile")}>
          <Toggle checked={layer.visible !== false} onChange={(v) => upd((l) => void (l.visible = v))} />
        </Field>
        <Field label={T("Bloccato")} help={T("Un layer bloccato non si può dipingere.")}>
          <Toggle checked={!!layer.locked} onChange={(v) => upd((l) => void (l.locked = v))} />
        </Field>
      </Section>
      <p className="empty-hint">{T("Scegli un tile nel pannello ")}<b>{T("Tileset")}</b>{T(" e dipingi con il pennello (B). La gomma (E) cancella.")}</p>
      <div className="insp-actions">
        <button type="button" className="btn small" onClick={() => setState({ layerId: id, tool: "paint", bottomTab: "tiles" })}>
          <Icon name="paint" size={13} />{T(" Dipingi qui")}</button>
        <button type="button" className="btn small danger" onClick={deleteSelection}>
          <Icon name="trash" size={13} />{T(" Elimina layer")}</button>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ Asset

function AssetInspector({ id }: { id: string }) {
  const project = useEditor((s) => s.project)!;
  const baseUrl = useEditor((s) => s.baseUrl);
  const [selAnim, setSelAnim] = useState("");
  const a = project.assets.find((x) => x.id === id);
  if (!a) return <p className="empty-hint">{T("Asset non trovato.")}</p>;
  const url = assetUrl(baseUrl, a.src, a.type === "image" ? a.rev : undefined);
  const upd = (fn: (x: ImageAsset) => void, merge?: string) =>
    editProject((p) => {
      const x = p.assets.find((q) => q.id === id);
      if (x && x.type === "image") fn(x);
    }, merge);

  if (a.type === "font") {
    return (
      <>
        <div className="insp-title">
          <Icon name="font" />
          <span className="title-text">{a.id}</span>
        </div>
        <div className="insp-sub mono">{a.src}</div>
        <div className="asset-preview" style={{ display: "grid", gap: 8, justifyItems: "start" }}>
          <FontPreview font={a.id} size={24} text="Aa Bb Cc 0123" />
          <FontPreview font={a.id} size={14} text={T("Il veloce Pepino salta la siepe.")} />
        </div>
        <p className="empty-hint">
          {T("Usalo nei blocchi Testo e Pulsante (campo Carattere) o come carattere del gioco (Inspector della scena → Progetto).")}
        </p>
      </>
    );
  }

  if (a.type === "audio") {
    return (
      <>
        <div className="insp-title">
          <Icon name="sound" />
          <span className="title-text">{a.id}</span>
        </div>
        <div className="insp-sub mono">{a.src}</div>
        <div className="asset-preview">
          {a.song || a.sfx ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <button type="button" className="px-btn" onClick={() => previewAsset(a)}>
                <Icon name="play" size={13} />
                {T(" Ascolta")}
              </button>
              <button type="button" className="px-btn" onClick={() => openInMusic(a.id)}>
                <Icon name="music" size={13} />
                {T(" Modifica nella scheda Musica")}
              </button>
            </div>
          ) : (
            <audio controls src={url} />
          )}
        </div>
        <p className="empty-hint">{T("Usalo nei blocchi con campi audio (suono salto, suono moneta…) o come musica della scena.")}</p>
      </>
    );
  }

  const anims = Object.entries(a.animations ?? {});
  const currentName = selAnim && a.animations?.[selAnim] ? selAnim : anims[0]?.[0];
  const current = currentName ? a.animations?.[currentName] : undefined;
  return (
    <>
      <div className="insp-title">
        <Icon name="image" />
        <span className="title-text">{a.id}</span>
      </div>
      <div className="insp-sub mono">{a.src.startsWith("data:") ? T("immagine in memoria (non salvata su file)") : a.src}</div>
      <div className="asset-preview checker">
        <FrameThumb url={url} size={200} />
      </div>
      <div style={{ padding: "0 12px 8px" }}>
        <button type="button" className="px-btn" onClick={() => void openImageAsset(a.id)}>
          <Icon name="paint" size={13} />
          {T(" Modifica nel Disegno")}
        </button>
      </div>
      <Section title={T("Sprite sheet")}>
        <Field label={T("Larghezza fotogramma")} help={T("0 = usa l'immagine intera.")}>
          <NumberField integer unit="px" min={0} value={a.frameWidth ?? 0} onChange={(v) => upd((x) => void (x.frameWidth = v || undefined), `fw:${id}`)} />
        </Field>
        <Field label={T("Altezza fotogramma")}>
          <NumberField integer unit="px" min={0} value={a.frameHeight ?? 0} onChange={(v) => upd((x) => void (x.frameHeight = v || undefined), `fh:${id}`)} />
        </Field>
      </Section>
      <Section
        title={T("Animazioni")}
        right={
          <button
            type="button"
            className="icon-btn"
            title={T("Nuova animazione")}
            onClick={() =>
              upd((x) => {
                x.animations ??= {};
                let n = "nuova";
                for (let i = 2; x.animations[n]; i++) n = `nuova_${i}`;
                x.animations[n] = { frames: [0], fps: 8, loop: true };
              })
            }
          >
            <Icon name="plus" size={13} />
          </button>
        }
      >
        {current && (
          <div className="anim-preview checker">
            <AnimPreview url={url} fw={a.frameWidth ?? 0} fh={a.frameHeight ?? 0} frames={current.frames} fps={current.fps} />
          </div>
        )}
        {anims.length === 0 && (
          <p className="empty-hint">{T("Nessuna animazione. Se le chiami come gli stati (idle, run, jump…) si collegano da sole.")}</p>
        )}
        {anims.length > 0 && (
          <div className="anim-head">
            <span>{T("Nome")}</span>
            <span>{T("Fotogrammi")}</span>
            <span>{T("fps")}</span>
            <span>{T("Loop")}</span>
            <span />
          </div>
        )}
        {anims.map(([name, an]) => (
          <div key={name} className={`anim-row${currentName === name ? " on" : ""}`} onClick={() => setSelAnim(name)}>
            <CommitInput
              value={name}
              onCommit={(nn) =>
                upd((x) => {
                  const key = nn.trim();
                  const obj = x.animations!;
                  if (!key || obj[key]) return;
                  obj[key] = obj[name];
                  delete obj[name];
                })
              }
            />
            <CommitInput
              value={an.frames.join(", ")}
              title={T("Numeri dei fotogrammi, separati da virgola")}
              onCommit={(v) =>
                upd((x) => {
                  x.animations![name].frames = v
                    .split(/[\s,]+/)
                    .map(Number)
                    .filter((n) => Number.isInteger(n) && n >= 0);
                })
              }
            />
            <NumberField integer min={1} value={an.fps} onChange={(v) => upd((x) => void (x.animations![name].fps = Math.max(1, v)), `afps:${id}:${name}`)} />
            <input type="checkbox" checked={an.loop} onChange={(ev) => upd((x) => void (x.animations![name].loop = ev.target.checked))} />
            <button
              type="button"
              className="icon-btn"
              title={T("Elimina animazione")}
              onClick={(ev) => {
                ev.stopPropagation();
                upd((x) => void delete x.animations![name]);
              }}
            >
              <Icon name="trash" size={12} />
            </button>
          </div>
        ))}
      </Section>
    </>
  );
}

// ------------------------------------------------------------------ Scena e progetto

function parseValue(v: string): VariableValue {
  if (v === "true" || v === "false") return v === "true";
  const n = Number(v);
  return v.trim() !== "" && !Number.isNaN(n) ? n : v;
}

function resizeScene(sc: SceneData, w: number, h: number) {
  for (const l of sc.layers) {
    const data = new Array(w * h).fill(-1);
    for (let y = 0; y < Math.min(h, l.height); y++) for (let x = 0; x < Math.min(w, l.width); x++) data[y * w + x] = l.data[y * l.width + x];
    l.data = data;
    l.width = w;
    l.height = h;
  }
  sc.width = w;
  sc.height = h;
}

/** Comandi che hanno senso come pulsanti touch (le direzioni le fa il joystick). */
const TOUCH_ACTIONS = Object.keys(INPUT_LABELS).filter((a) => !["left", "right", "up", "down", "pause"].includes(a));

function TouchSettingsFields() {
  const project = useEditor((s) => s.project)!;
  const touch = { ...DEFAULT_TOUCH, ...project.settings.touch };
  const set = (patch: Partial<typeof touch>) => editProject((p) => void (p.settings.touch = { ...DEFAULT_TOUCH, ...p.settings.touch, ...patch }));
  return (
    <>
      <Field label={T("Controlli touch")} help={T("Joystick e pulsanti sullo schermo nel gioco esportato. «Automatici» = solo su telefoni e tablet.")}>
        <select value={touch.mode} onChange={(e) => set({ mode: e.target.value as typeof touch.mode })}>
          <option value="auto">{T("Automatici")}</option>
          <option value="always">{T("Sempre")}</option>
          <option value="off">{T("Mai")}</option>
        </select>
      </Field>
      {touch.mode !== "off" && (
        <Field label={T("Pulsanti")} help={T("Al massimo 4, a destra dello schermo. Il joystick a sinistra fa le direzioni.")}>
          <div className="chips">
            {TOUCH_ACTIONS.map((a) => {
              const on = touch.buttons.includes(a);
              return (
                <button
                  type="button"
                  key={a}
                  className={`chip${on ? " on" : ""}`}
                  disabled={!on && touch.buttons.length >= 4}
                  onClick={() => set({ buttons: on ? touch.buttons.filter((x) => x !== a) : [...touch.buttons, a] })}
                >
                  {T(INPUT_LABELS[a])}
                </button>
              );
            })}
          </div>
        </Field>
      )}
    </>
  );
}

function SceneInspector() {
  const project = useEditor((s) => s.project)!;
  const scene = useEditor(currentScene)!;
  const [newGroup, setNewGroup] = useState("");
  const updScene = (fn: (sc: SceneData) => void, merge?: string) =>
    editProject((p) => {
      const sc = sceneOf(p, scene.id);
      if (sc) fn(sc);
    }, merge);
  const size = (v: string) => Math.max(1, Math.min(1000, Math.round(Number(v) || 1)));
  return (
    <>
      <div className="insp-title">
        <Icon name="image" />
        <input className="title-input" value={scene.name} onChange={(ev) => updScene((sc) => void (sc.name = ev.target.value), `sname:${scene.id}`)} />
      </div>
      <div className="insp-sub">{project.settings.startScene === scene.id ? T("Scena iniziale") : T("Scena")} · {scene.width} × {scene.height}{T(" tile")}</div>
      <Section title={T("Scena")}>
        <Field label={T("Larghezza")} help={T("In tile. Si conferma con Invio.")}>
          <CommitInput value={String(scene.width)} onCommit={(v) => updScene((sc) => resizeScene(sc, size(v), sc.height))} />
        </Field>
        <Field label={T("Altezza")} help={T("In tile. Si conferma con Invio.")}>
          <CommitInput value={String(scene.height)} onCommit={(v) => updScene((sc) => resizeScene(sc, sc.width, size(v)))} />
        </Field>
        <Field label={T("Colore di sfondo")}>
          <PropField
            schema={{ type: "color", label: "" }}
            value={scene.background ?? project.settings.background}
            ctx={{ project, states: [], animations: [] }}
            onChange={(v) => updScene((sc) => void (sc.background = String(v)), `sbg:${scene.id}`)}
          />
        </Field>
        <Field label={T("Ordina per Y")} help={T("Chi sta più in basso è disegnato davanti: per top-down e beat 'em up.")}>
          <Toggle checked={!!scene.ySort} onChange={(v) => updScene((sc) => void (sc.ySort = v))} />
        </Field>
        <Field label={T("Si può cadere fuori")} help={T("Se attivo, sotto la scena non c'è pavimento.")}>
          <Toggle checked={!!scene.openBottom} onChange={(v) => updScene((sc) => void (sc.openBottom = v))} />
        </Field>
        <Field label={T("Musica")}>
          <PropField
            schema={{ type: "audio", label: "" }}
            value={scene.music ?? ""}
            ctx={{ project, states: [], animations: [] }}
            onChange={(v) => updScene((sc) => void (sc.music = String(v) || undefined))}
          />
        </Field>
        <Field label={T("Luci 2D")} help={T("La scena diventa buia (colore della luce ambiente) e la illuminano gli oggetti con il blocco Luce.")}>
          <Toggle checked={!!scene.ambient} onChange={(v) => updScene((sc) => void (v ? (sc.ambient = "#262a40") : delete sc.ambient))} />
        </Field>
        {scene.ambient && (
          <Field label={T("Luce ambiente")} help={T("Nero = buio totale, bianco = pieno giorno. Si vede nell'anteprima.")}>
            <PropField
              schema={{ type: "color", label: "" }}
              value={scene.ambient}
              ctx={{ project, states: [], animations: [] }}
              onChange={(v) => updScene((sc) => void (sc.ambient = String(v) || "#000000"), `samb:${scene.id}`)}
            />
          </Field>
        )}
        <Field label={T("Effetto schermo")} help={T("Filtro su tutta l'immagine di gioco. Si vede nell'anteprima.")}>
          <select
            value={scene.effect ?? "none"}
            onChange={(e) =>
              updScene((sc) => {
                if (e.target.value === "none") {
                  delete sc.effect;
                  delete sc.effectStrength;
                } else sc.effect = e.target.value;
              })
            }
          >
            {SCREEN_EFFECTS.map((o) => (
              <option key={o.value} value={o.value}>
                {T(o.label)}
              </option>
            ))}
          </select>
        </Field>
        {scene.effect && scene.effect !== "none" && (
          <Field label={T("Intensità effetto")}>
            <PropField
              schema={{ type: "number", label: "", min: 0, max: 1, step: 0.1 }}
              value={scene.effectStrength ?? 1}
              ctx={{ project, states: [], animations: [] }}
              onChange={(v) => updScene((sc) => void (sc.effectStrength = Number(v)), `seff:${scene.id}`)}
            />
          </Field>
        )}
        {project.settings.startScene !== scene.id && (
          <div className="insp-actions">
            <button type="button" className="btn small" onClick={() => editProject((p) => void (p.settings.startScene = scene.id))}>{T("Imposta come scena iniziale")}</button>
          </div>
        )}
      </Section>

      <Section
        title={T("Variabili globali")}
        right={
          <button
            type="button"
            className="icon-btn"
            title={T("Nuova variabile")}
            onClick={() =>
              editProject((p) => {
                let n = "variabile";
                for (let i = 2; n in p.variables; i++) n = `variabile_${i}`;
                p.variables[n] = 0;
              })
            }
          >
            <Icon name="plus" size={13} />
          </button>
        }
      >
        {Object.entries(project.variables).map(([k, v]) => (
          <div className="var-row" key={k}>
            <CommitInput
              value={k}
              onCommit={(nk) =>
                editProject((p) => {
                  const key = nk.trim().replace(/\W+/g, "_");
                  if (!key || key in p.variables) return;
                  p.variables = Object.fromEntries(Object.entries(p.variables).map(([a, b]) => [a === k ? key : a, b]));
                })
              }
            />
            <CommitInput value={String(v)} onCommit={(nv) => editProject((p) => void (p.variables[k] = parseValue(nv)))} />
            <button type="button" className="icon-btn" title={T("Elimina")} onClick={() => editProject((p) => void delete p.variables[k])}>
              <Icon name="trash" size={12} />
            </button>
          </div>
        ))}
        <p className="empty-hint">{T("Nei testi scrivi il nome tra graffe per mostrarne il valore: ")}<code>Monete: {"{monete}"}</code>.
        </p>
      </Section>

      <Section title={T("Gruppi di collisione")}>
        <div className="chips pad">
          {project.settings.collisionGroups.map((g) => (
            <span className="chip on" key={g}>
              {g}
              <button
                type="button"
                title={T("Rimuovi gruppo")}
                onClick={() => editProject((p) => void (p.settings.collisionGroups = p.settings.collisionGroups.filter((x) => x !== g)))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="var-row">
          <input
            placeholder={T("Nuovo gruppo…")}
            value={newGroup}
            onChange={(e) => setNewGroup(e.target.value)}
            onKeyDown={(e) => {
              const g = newGroup.trim().toLowerCase();
              if (e.key === "Enter" && g && !project.settings.collisionGroups.includes(g)) {
                editProject((p) => void p.settings.collisionGroups.push(g));
                setNewGroup("");
              }
            }}
          />
        </div>
      </Section>

      <Section title={T("Progetto")}>
        <Field label={T("Nome del gioco")}>
          <input value={project.name} onChange={(ev) => editProject((p) => void (p.name = ev.target.value), "pname")} />
        </Field>
        <Field label={T("Risoluzione")} help={T("Dimensione dello schermo di gioco in pixel virtuali.")}>
          <div className="pair">
            <CommitInput value={String(project.settings.resolution.width)} onCommit={(v) => editProject((p) => void (p.settings.resolution.width = size(v)))} />
            <span className="dim">×</span>
            <CommitInput value={String(project.settings.resolution.height)} onCommit={(v) => editProject((p) => void (p.settings.resolution.height = size(v)))} />
          </div>
        </Field>
        <Field label={T("Pixel perfect")} help={T("Ingrandisce solo per multipli interi: la pixel art resta nitida.")}>
          <Toggle checked={project.settings.pixelPerfect} onChange={(v) => editProject((p) => void (p.settings.pixelPerfect = v))} />
        </Field>
        <Field label={T("Scena iniziale")}>
          <PropField
            schema={{ type: "scene", label: "" }}
            value={project.settings.startScene}
            ctx={{ project, states: [], animations: [] }}
            onChange={(v) => editProject((p) => void (p.settings.startScene = String(v)))}
          />
        </Field>
        <Field
          label={T("Carattere del gioco")}
          help={T("Per messaggi, dialoghi, pausa e per i testi che non scelgono un carattere. I caratteri Pixel sono disegnati punto per punto e restano nitidi.")}
        >
          <PropField
            schema={{ type: "font", label: "", default: DEFAULT_FONT_ID }}
            value={project.settings.font || DEFAULT_FONT_ID}
            ctx={{ project, states: [], animations: [] }}
            onChange={(v) => editProject((p) => void (p.settings.font = String(v) === DEFAULT_FONT_ID ? undefined : String(v)))}
          />
        </Field>
        <Field label={T("Dimensione tile")}>
          <span className="dim">{project.settings.tileSize}{T(" px")}</span>
        </Field>
        <TouchSettingsFields />
      </Section>
    </>
  );
}

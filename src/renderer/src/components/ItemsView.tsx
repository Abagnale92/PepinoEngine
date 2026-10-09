import { useState } from "react";
import { EFFECT_TYPES, ITEM_KINDS, POWERUP_OPTIONS, type ItemData, type ItemEffect } from "@runtime";
import { editProject, useEditor } from "../store";
import { assetUrl, replaceItemRefs, uniqueId } from "../projectOps";
import { T } from "../i18n";
import { Field, NumberField, PropField, type FieldCtx } from "./fields";
import { FrameThumb } from "./thumbs";
import { Icon } from "./Icon";
import { Splitter, usePanelVar } from "./Splitter";

/** Oggetto aperto l'ultima volta (resta scelto cambiando scheda). */
let lastId = "";

/**
 * Scheda Oggetti: l'archivio degli oggetti del gioco. Ognuno ha nome, icona, prezzo, quanti se ne tengono
 * e cosa fa quando si usa (cura, variabile, potenziamento). Li usano i blocchi Oggetto da raccogliere,
 * Negozio e Inventario e le Regole dell'inventario.
 */
export function ItemsView() {
  const listVar = usePanelVar("--list-w", "items");
  const project = useEditor((s) => s.project)!;
  const baseUrl = useEditor((s) => s.baseUrl);
  const items = project.items ?? [];
  const [sel, setSel] = useState(lastId);
  const [q, setQ] = useState("");
  const cur = items.find((i) => i.id === sel) ?? items[0];
  if (cur) lastId = cur.id;
  const ctx: FieldCtx = { project, states: [], animations: [] };

  const edit = (fn: (it: ItemData) => void, merge?: string) =>
    editProject((p) => {
      const it = p.items?.find((x) => x.id === cur?.id);
      if (it) fn(it);
    }, merge);
  const setFx = (patch: Partial<ItemEffect>, merge?: string) => edit((it) => void (it.effect = { type: "none", ...(it.effect ?? {}), ...patch }), merge);

  const add = () => {
    const id = uniqueId("oggetto", new Set(items.map((i) => i.id)));
    editProject((p) => void (p.items ??= []).push({ id, name: T("Nuovo oggetto"), kind: "consumable", price: 1, max: 0, effect: { type: "heal", amount: 1 } }));
    setSel(id);
  };

  const remove = (id: string) => {
    const uses = replaceItemRefs(project, id, null);
    if (uses > 0 && !window.confirm(T("L'oggetto è usato in {0} punti del progetto: quei campi resteranno vuoti. Eliminarlo lo stesso?", uses))) return;
    editProject((p) => {
      replaceItemRefs(p, id, "");
      p.items = (p.items ?? []).filter((x) => x.id !== id);
    });
  };

  const thumb = (it: ItemData, size: number) => {
    const a = project.assets.find((x) => x.id === it.icon);
    return a?.type === "image" ? (
      <FrameThumb url={assetUrl(baseUrl, a.src, a.rev)} sw={a.frameWidth} sh={a.frameHeight} frame={it.frame ?? 0} size={size} />
    ) : (
      <Icon name="coin" size={Math.min(24, size)} />
    );
  };

  const query = q.trim().toLowerCase();
  const shown = query ? items.filter((i) => `${i.name} ${i.id} ${i.description ?? ""}`.toLowerCase().includes(query)) : items;
  const fx: ItemEffect = cur?.effect ?? { type: "none" };

  return (
    <div className="it-view" style={listVar}>
      <Splitter id="items" />
      <aside className="it-list">
        <div className="px-h">{T("Archivio oggetti")}</div>
        <input placeholder={T("Cerca un oggetto…")} value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="px-btn" onClick={add}>
          <Icon name="plus" size={13} />
          {T(" Nuovo oggetto")}
        </button>
        {shown.map((it) => (
          <div
            key={it.id}
            className={`it-item${it.id === cur?.id ? " on" : ""}`}
            onClick={() => setSel(it.id)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/x-pepino-item", it.id);
              e.dataTransfer.effectAllowed = "copy";
            }}
            title={T("Trascinalo in un campo Oggetto di un blocco")}
          >
            <span className="asset-pick-thumb">{thumb(it, 20)}</span>
            <span className="it-name">{it.name}</span>
            {!!it.price && <span className="dim">{it.price}</span>}
          </div>
        ))}
        {items.length === 0 && <p className="empty-hint">{T("Nessun oggetto: creane uno.")}</p>}
      </aside>
      <section className="it-main">
        {!cur ? (
          <div className="mu-intro">
            <Icon name="coin" size={28} />
            <p>
              {T(
                "Gli oggetti del gioco: pozioni, chiavi, potenziamenti. Si mettono nella scena con il blocco «Oggetto da raccogliere», si comprano nel «Negozio», finiscono nell'«Inventario» e si usano anche con le Regole.",
              )}
            </p>
          </div>
        ) : (
          <>
            <div className="it-head">
              <div className="it-icon checker">{thumb(cur, 48)}</div>
              <div className="it-title">
                <input className="title-input" value={cur.name} onChange={(e) => edit((it) => void (it.name = e.target.value), `iname:${cur.id}`)} />
                <div className="insp-sub mono">
                  {T("id: ")}
                  {cur.id} · {T("usato in {0} punti", replaceItemRefs(project, cur.id, null))}
                </div>
              </div>
              <button type="button" className="btn small danger" onClick={() => remove(cur.id)}>
                <Icon name="trash" size={13} />
                {T(" Elimina")}
              </button>
            </div>
            <div className="it-form">
              <Field label={T("Icona")}>
                <PropField schema={{ type: "image", label: "" }} value={cur.icon ?? ""} ctx={ctx} onChange={(v) => edit((it) => void (it.icon = String(v) || undefined))} />
              </Field>
              <Field label={T("Fotogramma")} help={T("Se l'immagine è uno sprite sheet: quale fotogramma fa da icona.")}>
                <NumberField integer min={0} value={cur.frame ?? 0} onChange={(v) => edit((it) => void (it.frame = Math.max(0, v) || undefined), `iframe:${cur.id}`)} />
              </Field>
              <Field label={T("Descrizione")} help={T("Si legge nel negozio.")}>
                <textarea rows={2} value={cur.description ?? ""} onChange={(e) => edit((it) => void (it.description = e.target.value), `idesc:${cur.id}`)} />
              </Field>
              <Field label={T("Tipo")}>
                <select value={cur.kind} onChange={(e) => edit((it) => void (it.kind = e.target.value as ItemData["kind"]))}>
                  {ITEM_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {T(k.label)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={T("Prezzo")} help={T("Quanto costa nei negozi.")}>
                <NumberField integer min={0} value={cur.price ?? 0} onChange={(v) => edit((it) => void (it.price = Math.max(0, v)), `iprice:${cur.id}`)} />
              </Field>
              {cur.kind !== "instant" && (
                <Field label={T("Quanti se ne tengono")} help={T("0 = senza limite.")}>
                  <NumberField integer min={0} value={cur.max ?? 0} onChange={(v) => edit((it) => void (it.max = Math.max(0, v)), `imax:${cur.id}`)} />
                </Field>
              )}
              <div className="group-label">{T("Quando si usa")}</div>
              <Field label={T("Effetto")}>
                <select value={fx.type} onChange={(e) => setFx({ type: e.target.value as ItemEffect["type"] })}>
                  {EFFECT_TYPES.map((k) => (
                    <option key={k.value} value={k.value}>
                      {T(k.label)}
                    </option>
                  ))}
                </select>
              </Field>
              {fx.type === "heal" && (
                <Field label={T("Vita recuperata")}>
                  <NumberField integer min={1} value={fx.amount ?? 1} onChange={(v) => setFx({ amount: Math.max(1, v) }, `ifx:${cur.id}`)} />
                </Field>
              )}
              {fx.type === "variable" && (
                <>
                  <Field label={T("Variabile")}>
                    <PropField schema={{ type: "variable", label: "" }} value={fx.variable ?? ""} ctx={ctx} onChange={(v) => setFx({ variable: String(v) }, `ifxv:${cur.id}`)} />
                  </Field>
                  <Field label={T("Quantità")} help={T("Negativa = toglie.")}>
                    <NumberField value={fx.amount ?? 1} onChange={(v) => setFx({ amount: v }, `ifx:${cur.id}`)} />
                  </Field>
                </>
              )}
              {fx.type === "powerup" && (
                <>
                  <Field label={T("Potenziamento")} help={T("Chi lo usa deve avere il blocco Potenziamenti.")}>
                    <select value={fx.powerup ?? "speed"} onChange={(e) => setFx({ powerup: e.target.value })}>
                      {POWERUP_OPTIONS.map((k) => (
                        <option key={k.value} value={k.value}>
                          {T(k.label)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={T("Durata")} help={T("0 = finché non si toglie.")}>
                    <NumberField unit="s" min={0} step={0.5} value={fx.seconds ?? 8} onChange={(v) => setFx({ seconds: Math.max(0, v) }, `ifxs:${cur.id}`)} />
                  </Field>
                  <Field label={T("Intensità")} help={T("0 = quella normale (velocità ×1,6, salto ×1,5, forza ×2, calamita 4 tile, scudo 1 colpo).")}>
                    <NumberField min={0} step={0.1} value={fx.strength ?? 0} onChange={(v) => setFx({ strength: Math.max(0, v) }, `ifxk:${cur.id}`)} />
                  </Field>
                </>
              )}
            </div>
            <p className="empty-hint">
              {T(
                "Per metterlo nella scena usa il blocco «Oggetto da raccogliere»; per venderlo aggiungilo a un «Negozio»; la barra «Inventario» lo mostra e lo usa. Nelle Regole: «Metti nell'inventario», «Usa un oggetto dell'inventario», «Un oggetto viene usato».",
              )}
            </p>
          </>
        )}
      </section>
    </div>
  );
}

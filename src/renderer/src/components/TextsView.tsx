import { Fragment, useMemo, useState } from "react";
import { LANGUAGE_PRESETS, collectTexts, type LanguageInfo, type ProjectData } from "@runtime";
import { editProject, useEditor } from "../store";
import { Icon } from "./Icon";
import { T, Twhere } from "../i18n";

/** La prima lingua è quella dei testi originali: se il progetto non ne ha, si parte dall'italiano. */
function languagesOf(p: ProjectData): LanguageInfo[] {
  if (!p.languages?.length) p.languages = [{ ...LANGUAGE_PRESETS[0] }];
  return p.languages;
}

/**
 * Scheda Testi: tutti i testi che il giocatore vede, raccolti da soli dal progetto,
 * con una colonna per ogni lingua in cui tradurli.
 */
export function TextsView() {
  const project = useEditor((s) => s.project)!;
  useEditor((s) => s.blocksVersion);
  const [query, setQuery] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [custom, setCustom] = useState({ id: "", name: "" });
  const texts = useMemo(() => collectTexts(project), [project]);
  const known = useMemo(() => new Set(texts.map((t) => t.text)), [texts]);

  const langs = project.languages ?? [];
  const original = langs[0] ?? LANGUAGE_PRESETS[0];
  const extra = langs.slice(1);
  const tr = project.translations ?? {};
  const has = (lang: string, text: string) => !!tr[lang]?.[text]?.trim();
  const available = LANGUAGE_PRESETS.filter((l) => l.id !== original.id && !extra.some((x) => x.id === l.id));

  const addLanguage = (l: LanguageInfo) => {
    const id = l.id.trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{0,9}$/.test(id)) return;
    editProject((p) => {
      const list = languagesOf(p);
      if (!list.some((x) => x.id === id)) list.push({ id, name: l.name.trim() || id });
    });
  };
  const removeLanguage = (id: string) =>
    editProject((p) => {
      p.languages = (p.languages ?? []).filter((l) => l.id !== id);
      if (p.translations) delete p.translations[id];
    });
  const setOriginal = (l: LanguageInfo) => editProject((p) => void (languagesOf(p)[0] = { ...l }));
  const setTranslation = (lang: string, text: string, value: string) =>
    editProject((p) => {
      const all = (p.translations ??= {});
      const map = (all[lang] ??= {});
      if (value) map[text] = value;
      else delete map[text];
    }, `tr:${lang}:${text}`);
  const unusedCount = extra.reduce((n, l) => n + Object.keys(tr[l.id] ?? {}).filter((k) => !known.has(k)).length, 0);
  const cleanUnused = () =>
    editProject((p) => {
      for (const l of extra) {
        const map = p.translations?.[l.id];
        if (map) for (const k of Object.keys(map)) if (!known.has(k)) delete map[k];
      }
    });

  const q = query.trim().toLowerCase();
  const rows = texts.filter(
    (t) =>
      (!q || t.text.toLowerCase().includes(q) || extra.some((l) => (tr[l.id]?.[t.text] ?? "").toLowerCase().includes(q))) &&
      (!onlyMissing || extra.some((l) => !has(l.id, t.text))),
  );

  return (
    <div className="tx-view">
      <div className="tx-head">
        <div className="tx-title">
          <Icon name="text" />
          <b>{T("Testi e lingue")}</b>
          <span className="dim">{texts.length}{T(" testi nel gioco")}</span>
        </div>
        <div className="tx-langs">
          <span className="tx-lang orig" title={T("La lingua in cui hai scritto i testi")}>
            <select
              value={original.id}
              onChange={(e) => {
                const l = LANGUAGE_PRESETS.find((x) => x.id === e.target.value);
                if (l) setOriginal(l);
              }}
            >
              {!LANGUAGE_PRESETS.some((l) => l.id === original.id) && <option value={original.id}>{original.name}</option>}
              {LANGUAGE_PRESETS.filter((l) => l.id === original.id || !extra.some((x) => x.id === l.id)).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            <span className="dim">{T("originale")}</span>
          </span>
          {extra.map((l) => {
            const done = texts.filter((t) => has(l.id, t.text)).length;
            return (
              <span className="tx-lang" key={l.id}>
                <b>{l.name}</b>
                <span className={`tx-progress${done === texts.length ? " ok" : ""}`} title={T("Testi tradotti")}>
                  {done}/{texts.length}
                </span>
                <button type="button" className="icon-btn" title={T("Togli la lingua {0} e le sue traduzioni", l.name)} onClick={() => removeLanguage(l.id)}>
                  <Icon name="close" size={11} />
                </button>
              </span>
            );
          })}
          {available.length > 0 && (
            <select
              className="tx-add"
              value=""
              onChange={(e) => {
                const l = LANGUAGE_PRESETS.find((x) => x.id === e.target.value);
                if (l) addLanguage(l);
              }}
            >
              <option value="">{T("+ Aggiungi una lingua…")}</option>
              {available.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
          <span className="tx-custom" title={T("Una lingua che non è nell'elenco")}>
            <input placeholder={T("codice (ru)")} value={custom.id} onChange={(e) => setCustom({ ...custom, id: e.target.value })} />
            <input placeholder={T("nome (Русский)")} value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
            <button
              type="button"
              className="btn small"
              disabled={!/^[a-zA-Z][a-zA-Z0-9-]{0,9}$/.test(custom.id.trim()) || langs.some((l) => l.id === custom.id.trim().toLowerCase())}
              onClick={() => {
                addLanguage(custom);
                setCustom({ id: "", name: "" });
              }}
            >{T("Aggiungi")}</button>
          </span>
        </div>
      </div>

      {extra.length === 0 ? (
        <div className="rules-empty">
          <h3>{T("Il gioco è in una lingua sola")}</h3>
          <p>{T("Aggiungi una lingua per tradurlo. Pepino raccoglie da solo tutti i testi che il giocatore vede (Testi, Pulsanti, fumetti, messaggi delle Regole, dialoghi): tu scrivi la traduzione accanto a ciascuno. La prima volta il gioco sceglie da solo la lingua del browser; poi si cambia con la Regola «Cambia lingua» o «Passa alla lingua successiva».")}</p>
          <div className="row-btns">
            {available.slice(0, 3).map((l) => (
              <button type="button" key={l.id} className="btn primary" onClick={() => addLanguage(l)}>
                <Icon name="plus" size={13} /> {l.name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="tx-tools">
            <input className="tx-search" placeholder={T("Cerca un testo…")} value={query} onChange={(e) => setQuery(e.target.value)} />
            <label className="tx-check">
              <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />{T(" Solo da tradurre")}</label>
            <div className="spacer" />
            {unusedCount > 0 && (
              <button type="button" className="btn small" onClick={cleanUnused} title={T("Traduzioni di testi che nel gioco non ci sono più")}>
                <Icon name="trash" size={12} />{T(" Rimuovi ")}{unusedCount} {unusedCount === 1 ? T("traduzione non usata") : T("traduzioni non usate")}
              </button>
            )}
          </div>
          <div className="tx-table" style={{ gridTemplateColumns: `minmax(220px, 1.2fr) repeat(${extra.length}, minmax(200px, 1fr))` }}>
            <div className="tx-th">{original.name}</div>
            {extra.map((l) => (
              <div className="tx-th" key={l.id}>
                {l.name}
              </div>
            ))}
            {rows.map((t) => (
              <Fragment key={t.text}>
                <div className="tx-src">
                  <div className="tx-text">{t.text}</div>
                  <div className="tx-where" title={t.where.map(Twhere).join("\n")}>
                    {Twhere(t.where[0])}
                    {t.where.length > 1 ? T(" e altri {0}", t.where.length - 1) : ""}
                  </div>
                </div>
                {extra.map((l) => {
                  const v = tr[l.id]?.[t.text] ?? "";
                  return (
                    <textarea
                      key={l.id}
                      className={`tx-cell${v.trim() ? "" : " missing"}`}
                      rows={Math.min(4, Math.max(1, Math.ceil(t.text.length / 36)))}
                      value={v}
                      placeholder={t.text}
                      aria-label={`${l.name}: ${t.text}`}
                      onChange={(e) => setTranslation(l.id, t.text, e.target.value)}
                    />
                  );
                })}
              </Fragment>
            ))}
          </div>
          {rows.length === 0 && <p className="empty-hint">{onlyMissing ? T("Tutto tradotto!") : T("Nessun testo trovato.")}</p>}
          <p className="dlg-help tx-note">{T("Le parti tra graffe come ")}<code>{"{monete}"}</code>{T(" vanno lasciate uguali: diventano il valore della variabile. Una cella vuota (in grigio c'è l'originale) lascia il testo nella lingua originale.")}</p>
        </>
      )}
    </div>
  );
}

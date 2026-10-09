import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { afterAll, describe, expect, it } from "vitest";
import {
  BLOCK_CATEGORIES,
  BUILTIN_FONTS,
  DRUMS,
  SFX_PRESETS,
  WAVES,
  COLLISION_TYPES,
  COMPARE_OPTIONS,
  INPUT_LABELS,
  RULE_CATEGORIES,
  RULE_ITEMS,
  SCREEN_EFFECTS,
  listBlockDefs,
  validateProject,
  type ProjectData,
  type PropSchema,
} from "@runtime";
import { T, Twhere, lookupEnglish, setEditorLang } from "../src/renderer/src/i18n";
import { TEMPLATES } from "../src/renderer/src/templates";
import { PALETTES } from "../src/renderer/src/pixel/doc";

/** Tutti i testi che l'editor mostra: quelli scritti nell'interfaccia e quelli che arrivano dal motore. */
function editorTexts(): string[] {
  const keys = new Set<string>();
  const add = (s: unknown) => {
    if (typeof s !== "string") return;
    const t = s.trim();
    if (t && /\p{L}/u.test(t)) keys.add(t);
  };
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) {
        if (f !== "en") walk(p);
      } else if (/\.(ts|tsx)$/.test(f) && f !== "en.ts") {
        const src = readFileSync(p, "utf8");
        for (const m of src.matchAll(/\b[TN]\(\s*("(?:[^"\\]|\\.)*")/g)) add(JSON.parse(m[1]));
        for (const m of src.matchAll(/\s(?:label|help|title|placeholder)="([^"]*)"/g)) add(m[1]);
      }
    }
  };
  walk(resolve("src/renderer/src"));

  const schema = (s: PropSchema) => {
    add(s.label);
    add(s.help);
    add(s.unit);
    add(s.group);
    add(s.addLabel);
    for (const o of s.options ?? []) add(o.label);
    // Elenchi di righe (armi, carte…): anche i campi di una riga hanno etichette da tradurre.
    Object.values(s.fields ?? {}).forEach(schema);
  };
  for (const d of listBlockDefs()) {
    if (d.source === "custom") continue;
    add(d.label);
    add(d.description);
    add(d.category);
    Object.values(d.props).forEach(schema);
    d.states.forEach((x) => add(x.label));
    d.events.forEach((x) => add(x.label));
    for (const c of [...Object.values(d.conditions), ...Object.values(d.actions)]) {
      add(c.label);
      Object.values(c.params ?? {}).forEach(schema);
    }
  }
  for (const r of RULE_ITEMS) {
    add(r.label);
    add(r.sentence);
    add(r.category);
    Object.values(r.params).forEach(schema);
  }
  [...RULE_CATEGORIES, ...BLOCK_CATEGORIES].forEach(add);
  COMPARE_OPTIONS.forEach((o) => add(o.label));
  Object.values(INPUT_LABELS).forEach(add);
  COLLISION_TYPES.forEach((c) => add(c.label));
  SCREEN_EFFECTS.forEach((e) => add(e.label));
  BUILTIN_FONTS.forEach((f) => add(f.label));
  PALETTES.forEach((p) => add(p.label));
  [...WAVES, ...DRUMS, ...SFX_PRESETS].forEach((x) => add(x.label));
  TEMPLATES.forEach((t) => {
    add(t.label);
    add(t.description);
  });
  return [...keys];
}

describe("editor in inglese", () => {
  afterAll(() => setEditorLang("it"));

  it("ogni testo dell'editor e dei blocchi ha la traduzione inglese", () => {
    setEditorLang("en");
    const texts = editorTexts();
    expect(texts.length).toBeGreaterThan(900);
    expect(texts.filter((k) => lookupEnglish(k) === undefined)).toEqual([]);
  });

  it("i segnaposto {param} delle frasi delle Regole restano uguali", () => {
    for (const r of RULE_ITEMS) {
      const it = [...r.sentence.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const en = [...(lookupEnglish(r.sentence) ?? "").matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(en, r.sentence).toEqual(it);
    }
  });

  it("T lascia l'italiano, traduce in inglese e riempie i segnaposto", () => {
    setEditorLang("it");
    expect(T("Salva")).toBe("Salva");
    setEditorLang("en");
    expect(T("Salva")).toBe("Save");
    expect(T(" · usato da ")).toBe(" · used by ");
    expect(T("Importati {0} file", 3)).toBe("Imported 3 files");
    expect(T("Un testo che non esiste")).toBe("Un testo che non esiste");
  });

  it("i messaggi del controllo del progetto si traducono con le parti variabili", () => {
    setEditorLang("en");
    const platform = JSON.parse(readFileSync(resolve("samples/templates/platform.json"), "utf8")) as ProjectData;
    const broken: ProjectData = structuredClone(platform);
    broken.settings.startScene = "scena-che-non-c-e";
    for (const issue of validateProject(broken)) {
      expect(lookupEnglish(issue.message), issue.message).toBeDefined();
      expect(Twhere(issue.where)).not.toMatch(/\b(oggetto|regola|scena)\b/);
    }
  });
});

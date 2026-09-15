import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_FONTS,
  PIXEL_GLYPHS,
  TINY_GLYPHS,
  bitmapFont,
  canDrawBitmap,
  getBlockDef,
  glyphRows,
  isBuiltinFont,
  measureBitmapText,
  validateProject,
  type ProjectData,
} from "@runtime";

const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("");
const EXTRA = "àèéìòùÀÈÉÌÒÙçÇñüö«»…·▶▼←→↑↓♥’";

const demo = () => JSON.parse(readFileSync(resolve("samples/demo/project.json"), "utf8")) as ProjectData;

describe("caratteri a punti", () => {
  it("ogni lettera ha righe della stessa larghezza", () => {
    for (const [name, specs] of [
      ["pixel", PIXEL_GLYPHS],
      ["tiny", TINY_GLYPHS],
    ] as const) {
      for (const [ch, spec] of Object.entries(specs)) {
        const rows = glyphRows(spec);
        expect(new Set(rows.map((r) => r.length)).size, `${name} «${ch}»: ${spec}`).toBe(1);
        expect(rows.every((r) => /^[#.]+$/.test(r)), `${name} «${ch}»`).toBe(true);
      }
    }
  });

  it("scrivono tutto l'ASCII, le lettere accentate e le frecce dei menù", () => {
    for (const id of ["pixel", "pixel-bold", "pixel-tiny"]) {
      const f = bitmapFont(id)!;
      expect(canDrawBitmap(f, ASCII), id).toBe(true);
      expect(canDrawBitmap(f, EXTRA), id).toBe(true);
      // Le lettere che mancano (giapponese…) passano al carattere del sistema.
      expect(canDrawBitmap(f, "日本語"), id).toBe(false);
    }
  });

  it("le lettere hanno larghezze diverse, il grassetto è più largo", () => {
    const px = bitmapFont("pixel")!;
    expect(measureBitmapText(px, "il")).toBeLessThan(measureBitmapText(px, "MW"));
    expect(measureBitmapText(px, "MW")).toBe(11);
    expect(measureBitmapText(bitmapFont("pixel-bold")!, "MW")).toBe(13);
    const tiny = bitmapFont("pixel-tiny")!;
    expect(measureBitmapText(tiny, "pepino")).toBe(measureBitmapText(tiny, "PEPINO"));
  });

  it("gli accenti delle maiuscole stanno sopra la lettera, quelli delle minuscole dentro la riga", () => {
    const px = bitmapFont("pixel")!;
    const minY = (ch: string) => Math.min(...px.glyphs.get(ch)!.pixels.filter((_, i) => i % 2 === 1));
    expect(minY("È")).toBeLessThan(0);
    expect(minY("è")).toBe(0);
    expect(minY("E")).toBe(0);
  });
});

describe("caratteri nel progetto", () => {
  it("Testo e Pulsante hanno il campo Carattere, vuoto = quello del gioco", () => {
    for (const name of ["Text", "Button"]) {
      const font = getBlockDef(name)!.props.font;
      expect(font.type).toBe("font");
      expect(font.default).toBe("");
    }
    expect(getBlockDef("Text")!.props.outline.type).toBe("boolean");
  });

  it("il controllo del progetto accetta i caratteri pronti e quelli importati, e segnala gli altri", () => {
    expect(BUILTIN_FONTS.map((f) => f.id)).toEqual(["pixel", "pixel-bold", "pixel-tiny", "sans", "serif", "mono"]);
    expect(isBuiltinFont("pixel") && !isBuiltinFont("comic")).toBe(true);

    const p = demo();
    p.assets.push({ id: "mio_font", type: "font", src: "assets/mio_font.ttf" });
    const text = p.scenes.flatMap((s) => s.entities).find((e) => e.blocks.some((b) => b.type === "Text"))!;
    const block = text.blocks.find((b) => b.type === "Text")!;
    const fontErrors = () => validateProject(p).filter((i) => i.message.startsWith("Il carattere"));

    p.settings.font = "pixel";
    block.props.font = "mio_font";
    expect(fontErrors()).toEqual([]);

    p.settings.font = "comic";
    block.props.font = "sparito";
    expect(fontErrors().map((i) => i.message)).toEqual(["Il carattere «comic» non esiste.", "Il carattere «sparito» non esiste."]);
  });
});

import { describe, expect, it } from "vitest";
import * as px from "../src/renderer/src/pixel/doc";

const doc = (w = 8, h = 8) => px.createDoc(w, h, "1");
const RED = px.hexToColor("#ff0000");
const BLUE = px.hexToColor("#0000ff");

describe("disegno in pixel art", () => {
  it("legge e scrive i colori esadecimali", () => {
    expect(px.colorToHex(px.hexToColor("#ff8000"))).toBe("#ff8000");
    expect(px.colorToHex(px.hexToColor("#11223380"))).toBe("#11223380");
    expect(px.hexToColor("#f00")).toBe(RED);
    expect(RED >>> 24).toBe(255);
  });

  it("linee senza buchi, pennello grande e a specchio", () => {
    expect(px.linePoints(0, 0, 3, 1)).toEqual([
      [0, 0],
      [1, 0],
      [2, 1],
      [3, 1],
    ]);
    const d = doc();
    const cel = d.cels[0][0];
    px.stamp(d, cel, 1, 2, RED, { size: 1, mirrorX: true });
    expect(px.getPixel(d, cel, 1, 2)).toBe(RED);
    expect(px.getPixel(d, cel, 6, 2)).toBe(RED);
    px.stamp(d, cel, 4, 4, BLUE, { size: 3 });
    expect([3, 4, 5].every((x) => [3, 4, 5].every((y) => px.getPixel(d, cel, x, y) === BLUE))).toBe(true);
    // Fuori dal disegno non succede niente.
    px.stamp(d, cel, -5, 20, RED, { size: 2 });
  });

  it("rettangoli ed ellissi, vuoti o pieni", () => {
    expect(px.rectPoints(0, 0, 3, 2, false)).toHaveLength(10);
    expect(px.rectPoints(3, 2, 0, 0, true)).toHaveLength(12);
    const pts = px.ellipsePoints(0, 0, 6, 4, false);
    const set = new Set(pts.map(([x, y]) => `${x},${y}`));
    for (const [x, y] of pts) {
      expect(set.has(`${6 - x},${y}`)).toBe(true);
      expect(set.has(`${x},${4 - y}`)).toBe(true);
    }
    expect(set.has("3,0") && set.has("0,2")).toBe(true);
    expect(set.has("3,2")).toBe(false);
    expect(px.ellipsePoints(0, 0, 6, 4, true).some(([x, y]) => x === 3 && y === 2)).toBe(true);
  });

  it("il secchiello riempie solo l'area chiusa", () => {
    const d = doc();
    const cel = d.cels[0][0];
    px.drawPoints(d, cel, px.rectPoints(1, 1, 5, 5, false), RED, { size: 1 });
    expect(px.floodFill(d, cel, 3, 3, BLUE)).toBe(9);
    expect(px.getPixel(d, cel, 0, 0)).toBe(0);
    expect(px.floodFill(d, cel, 0, 0, BLUE)).toBe(64 - 25);
    expect(px.floodFill(d, cel, 0, 0, BLUE)).toBe(0);
  });

  it("i livelli si sovrappongono, quelli nascosti no", () => {
    const d = doc(2, 1);
    px.addLayer(d, 0, "2");
    d.cels[0][0].fill(BLUE);
    d.cels[0][1][0] = px.hexToColor("#ff000080");
    const img = px.composite(d, 0);
    expect(img[1]).toBe(BLUE);
    const mixed = img[0];
    expect(mixed & 255).toBeGreaterThan(100);
    expect((mixed >>> 16) & 255).toBeGreaterThan(100);
    expect(mixed >>> 24).toBe(255);
    d.layers[1].visible = false;
    expect(px.composite(d, 0)[0]).toBe(BLUE);
    d.layers[1].visible = true;
    expect(px.mergeDown(d, 1)).toBe(0);
    expect(d.layers).toHaveLength(1);
    expect(d.cels[0][0][0]).toBe(mixed);
  });

  it("fotogrammi: sprite sheet in fila e ritorno", () => {
    const d = doc(2, 2);
    d.cels[0][0].fill(RED);
    px.duplicateFrame(d, 0);
    d.cels[1][0][3] = BLUE;
    px.addFrame(d, 1);
    expect(d.cels).toHaveLength(3);
    const sheet = px.sheetPixels(d);
    expect([sheet.width, sheet.height]).toEqual([6, 2]);
    expect(sheet.data[0]).toBe(RED);
    expect(sheet.data[1 * 6 + 3]).toBe(BLUE);
    expect(sheet.data[4]).toBe(0);
    const back = px.framesFromPixels(sheet.data, 6, 2, 2, 2);
    expect(back.map((f) => [...f])).toEqual(d.cels.map((f) => [...f[0]]));
    expect(px.moveFrame(d, 2, -1)).toBe(1);
    expect(px.removeFrame(d, 1)).toBe(1);
    expect(d.cels).toHaveLength(2);
  });

  it("si salva e si riapre; si ridimensiona, si sposta e si riflette", () => {
    const d = doc(3, 2);
    d.cels[0][0][0] = RED;
    d.palette.push("#ff0000");
    d.fps = 12;
    px.addLayer(d, 0, "sopra");
    d.layers[1].visible = false;
    const back = px.deserializeDoc(JSON.parse(JSON.stringify(px.serializeDoc(d))));
    expect([back.w, back.h, back.fps]).toEqual([3, 2, 12]);
    expect(back.palette).toEqual(["#ff0000"]);
    expect(back.layers).toEqual([
      { name: "1", visible: true },
      { name: "sopra", visible: false },
    ]);
    expect([...back.cels[0][0]]).toEqual([...d.cels[0][0]]);

    const shifted = px.shiftCel(d, d.cels[0][0], 1, 1);
    expect(shifted[1 * 3 + 1]).toBe(RED);
    expect(shifted[0]).toBe(0);
    px.flipCel(d, d.cels[0][0], true);
    expect(d.cels[0][0][2]).toBe(RED);
    px.resizeDoc(d, 5, 1);
    expect([d.w, d.h, d.cels[0][0].length]).toEqual([5, 1, 5]);
    expect(d.cels[0][0][2]).toBe(RED);
    expect(() => px.deserializeDoc({} as px.PixelFile)).toThrow();
  });
});

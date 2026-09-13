import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { exportProject, isInside, slug } from "../src/main/exporter";

const temps: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "pepino-test-"));
  temps.push(d);
  return d;
};

afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fixture() {
  const root = temp();
  const projectDir = join(root, "progetto");
  const playerDir = join(root, "player");
  mkdirSync(join(projectDir, "assets"), { recursive: true });
  mkdirSync(playerDir);
  writeFileSync(join(playerDir, "index.html"), "<script src='./pepino.js'></script>");
  writeFileSync(join(playerDir, "pepino.js"), "console.log('pepino')");
  writeFileSync(join(projectDir, "assets", "eroe.png"), "png");
  writeFileSync(join(root, "segreto.txt"), "non copiarmi");
  return { root, projectDir, playerDir };
}

describe("esportazione WebGL", () => {
  it("copia player, project.json e asset", async () => {
    const f = fixture();
    const out = temp();
    const res = await exportProject({
      data: { name: "Il Mio Gioco!", assets: [{ src: "assets/eroe.png" }] },
      projectDir: f.projectDir,
      playerDir: f.playerDir,
      parentDir: out,
    });
    expect(res.dir).toBe(join(out, "il-mio-gioco-web"));
    expect(res.copied).toBe(1);
    expect(existsSync(join(res.dir, "index.html"))).toBe(true);
    expect(existsSync(join(res.dir, "pepino.js"))).toBe(true);
    expect(readFileSync(join(res.dir, "assets", "eroe.png"), "utf8")).toBe("png");
    expect(JSON.parse(readFileSync(join(res.dir, "project.json"), "utf8")).name).toBe("Il Mio Gioco!");
  });

  it("salta file mancanti e percorsi fuori dal progetto invece di fallire", async () => {
    const f = fixture();
    const out = temp();
    const res = await exportProject({
      data: { name: "x", assets: [{ src: "assets/manca.png" }, { src: "../segreto.txt" }, { src: "assets/eroe.png" }] },
      projectDir: f.projectDir,
      playerDir: f.playerDir,
      parentDir: out,
    });
    expect(res.skipped).toEqual(["assets/manca.png", "../segreto.txt"]);
    expect(res.copied).toBe(1);
    expect(existsSync(join(out, "segreto.txt"))).toBe(false);
  });

  it("senza player compilato spiega cosa fare", async () => {
    const f = fixture();
    await expect(
      exportProject({ data: { name: "x", assets: [] }, projectDir: f.projectDir, playerDir: join(f.root, "vuota"), parentDir: temp() }),
    ).rejects.toThrow("npm run build:player");
  });

  it("isInside e slug", () => {
    expect(isInside("/a/b", "/a/b/c.png")).toBe(true);
    expect(isInside("/a/b", "/a/b/../c.png")).toBe(false);
    expect(isInside("/a/b", "/a/bc/d.png")).toBe(false);
    expect(slug("Città di Pepino")).toBe("citta-di-pepino");
    expect(slug("!!!")).toBe("gioco");
  });
});

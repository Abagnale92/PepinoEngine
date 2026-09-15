import { existsSync } from "fs";
import { copyFile, cp, mkdir, writeFile } from "fs/promises";
import { dirname, join, resolve, sep } from "path";

/** Vero se `target` sta dentro la cartella `base` (niente "../" che escono). */
export const isInside = (base: string, target: string) => resolve(target).startsWith(resolve(base) + sep);

export const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "gioco";

export interface ExportOptions {
  data: { name: string; assets: { src: string }[] };
  /** Cartella del progetto (dove si trovano gli asset). */
  projectDir: string;
  /** Player compilato: index.html + pepino.js. */
  playerDir: string;
  /** Cartella scelta dall'utente: la build va in <parentDir>/<nome-del-gioco>-web. */
  parentDir: string;
}

export interface ExportResult {
  dir: string;
  copied: number;
  /** Asset non copiati: file mancante o percorso fuori dal progetto. */
  skipped: string[];
}

/** Crea la build WebGL: player + project.json + asset usati. */
export async function exportProject(o: ExportOptions): Promise<ExportResult> {
  if (!existsSync(join(o.playerDir, "pepino.js"))) {
    throw new Error('Il player non è compilato: esegui "npm run build:player" e riprova.');
  }
  const out = join(o.parentDir, `${slug(o.data.name)}-web`);
  await mkdir(out, { recursive: true });
  await cp(o.playerDir, out, { recursive: true });
  let copied = 0;
  const skipped: string[] = [];
  for (const a of o.data.assets) {
    // Brani ed effetti della scheda Musica e immagini in memoria sono già dentro project.json.
    if (!a.src || a.src.startsWith("data:")) continue;
    const src = resolve(o.projectDir, a.src);
    const dst = resolve(out, a.src);
    if (!isInside(o.projectDir, src) || !isInside(out, dst) || !existsSync(src)) {
      skipped.push(a.src);
      continue;
    }
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(src, dst);
    copied++;
  }
  await writeFile(join(out, "project.json"), JSON.stringify(o.data), "utf8");
  return { dir: out, copied, skipped };
}

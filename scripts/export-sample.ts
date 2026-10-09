// Esporta un gioco di esempio (samples/<id>/project.json) con la stessa funzione dell'editor.
// Uso: npm run export:sample -- <id> [cartella]; compila prima il player. La cartella predefinita è dist/export.
import { existsSync, readFileSync, rmSync } from "fs";
import { resolve } from "path";
import { exportProject, slug } from "../src/main/exporter";

const root = resolve(__dirname, "..");
const id = process.argv[2] ?? "";
const projectDir = resolve(root, "samples", id);
if (!/^[a-z0-9_-]+$/.test(id) || !existsSync(resolve(projectDir, "project.json"))) {
  console.error(`Esempio "${id}" non trovato: indica l'id di una cartella in samples/ con un project.json (npm run export:sample -- <id>).`);
  process.exit(1);
}
const parentDir = resolve(root, process.argv[3] ?? "dist/export");
const data = JSON.parse(readFileSync(resolve(projectDir, "project.json"), "utf8"));

// Si rifà solo la cartella di questo gioco: le build degli altri esempi restano.
rmSync(resolve(parentDir, `${slug(data.name)}-web`), { recursive: true, force: true });
const res = await exportProject({ data, projectDir, playerDir: resolve(root, "dist/player"), parentDir });
console.log(`Build pronta in ${res.dir} (${res.copied} asset copiati${res.skipped.length ? `, saltati: ${res.skipped.join(", ")}` : ""})`);

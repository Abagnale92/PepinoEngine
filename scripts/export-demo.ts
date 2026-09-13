// Esporta il progetto demo in dist/demo-web con la stessa funzione dell'editor.
// Uso: npm run export:demo (compila prima il player).
import { readFileSync, rmSync } from "fs";
import { resolve } from "path";
import { exportProject } from "../src/main/exporter";

const root = resolve(__dirname, "..");
const projectDir = resolve(root, "samples/demo");
const parentDir = resolve(root, process.argv[2] ?? "dist/export");
const data = JSON.parse(readFileSync(resolve(projectDir, "project.json"), "utf8"));

rmSync(parentDir, { recursive: true, force: true });
const res = await exportProject({ data, projectDir, playerDir: resolve(root, "dist/player"), parentDir });
console.log(`Build pronta in ${res.dir} (${res.copied} asset copiati${res.skipped.length ? `, saltati: ${res.skipped.join(", ")}` : ""})`);

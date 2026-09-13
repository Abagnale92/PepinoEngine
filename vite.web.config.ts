// Editor nel browser, senza Electron: utile per sviluppo e test rapidi.
// I progetti di esempio in /samples sono serviti come file statici (es. /demo/project.json).
import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: resolve("src/renderer"),
  publicDir: resolve("samples"),
  // Cache separata: se gira insieme al player o a "npm run dev", i server non si invalidano a vicenda.
  cacheDir: resolve("node_modules/.vite-web"),
  resolve: { alias: { "@runtime": resolve("src/runtime") } },
  plugins: [react()],
  server: { port: 5180 },
});

// Player standalone: è il file pepino.js che finisce dentro ogni build WebGL.
import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  root: resolve("src/player"),
  base: "./",
  publicDir: command === "serve" ? resolve("samples") : false,
  // Cache separata dall'editor: i due server di sviluppo possono girare insieme.
  cacheDir: resolve("node_modules/.vite-player"),
  resolve: { alias: { "@runtime": resolve("src/runtime") } },
  build: {
    outDir: resolve("dist/player"),
    emptyOutDir: true,
    assetsDir: ".",
    rollupOptions: {
      output: {
        entryFileNames: "pepino.js",
        chunkFileNames: "pepino-[name].js",
        assetFileNames: "[name][extname]",
      },
    },
  },
  server: { port: 5181 },
}));

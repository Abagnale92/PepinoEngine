// Costruisce il comando `pepino` (Pepino Language fuori dall'engine): un solo file per Node, senza dipendenze.
import { build } from "esbuild";

await build({
  entryPoints: ["src/lang/pepino-cli.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: "dist/pepino/pepino.mjs",
  banner: { js: "#!/usr/bin/env node" },
  logLevel: process.argv.includes("--quiet") ? "error" : "info",
});

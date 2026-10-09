/** Punto di partenza del comando `pepino` (Node). */
import { main, nodeIO } from "./cli";

process.exitCode = main(process.argv.slice(2), nodeIO());

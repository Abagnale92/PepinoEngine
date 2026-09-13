/** Collega gli errori a gioco avviato al file e alla riga dello script (anche per il Python tradotto). */

interface ScriptInfo {
  name: string;
  lineMap?: number[];
}

const infos = new Map<string, ScriptInfo>();

/** Righe che `new Function` aggiunge prima del corpo dello script. */
export const FUNCTION_HEADER_LINES = 2;

export const safeScriptId = (id: string) => id.replace(/[^\w.-]/g, "_");

export function registerScriptInfo(id: string, info: ScriptInfo): void {
  // La mappa delle righe va rifatta a ogni caricamento: il codice Python può essere cambiato.
  infos.set(safeScriptId(id), info);
}

export function clearScriptInfo(): void {
  infos.clear();
}

/** Copia delle informazioni correnti, indicizzate per id "sicuro". */
export function snapshotScriptInfo(): Map<string, ScriptInfo> {
  return new Map(infos);
}

export interface ScriptErrorInfo {
  message: string;
  scriptId?: string;
  line?: number;
  /** "Molla, riga 12": pronto da mostrare. */
  where?: string;
}

export function describeScriptError(err: unknown): ScriptErrorInfo {
  const e = err instanceof Error ? err : new Error(String(err));
  const m = /pepino-script\/([\w.-]+):(\d+):(\d+)/.exec(e.stack ?? "");
  if (!m) return { message: e.message };
  const info = infos.get(m[1]);
  let line = Number(m[2]) - FUNCTION_HEADER_LINES;
  if (info?.lineMap) line = info.lineMap[line - 1] || line;
  return { message: e.message, scriptId: m[1], line, where: `${info?.name ?? m[1]}, riga ${line}` };
}

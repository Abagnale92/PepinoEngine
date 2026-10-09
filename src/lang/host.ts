/**
 * L'ambiente in cui gira un programma Pepino: il comando `pepino` (file, tastiera) oppure l'engine
 * (blocchi, oggetti della scena). Il linguaggio non dipende dall'engine: è l'engine a descriversi qui.
 */
import type { HostTypeInfo, Type } from "./types";

export type Capability = "input" | "files" | "args";

/** Un nome sempre disponibile dentro i blocchi (oggetto, scena, gioco…). */
export interface HostName {
  it: string;
  en: string;
  /** Il tipo, sapendo quali blocchi richiede il blocco (es. «corpo» è sicuro solo con «richiede Body»). */
  type: (requires: string[]) => Type;
  /** JavaScript che lo legge: `$b` è l'istanza del blocco nell'engine. */
  js: string;
}

/** Un tipo di proprietà dell'Inspector (Suono → "audio"): nel codice vale come Testo o Numero. */
export interface HostPropType {
  it: string;
  en: string;
  /** Il tipo di campo dell'engine. */
  kind: string;
  base: "text" | "num" | "bool";
}

export interface BlockHost {
  names: HostName[];
  /** Il tipo degli oggetti della scena (per «quando tocca altro»). */
  entity: () => Type;
  propTypes: HostPropType[];
  blockExists(name: string): boolean;
}

export interface HostSpec {
  capabilities: Capability[];
  types: HostTypeInfo[];
  block?: BlockHost;
}

export const CLI_HOST: HostSpec = { capabilities: ["input", "files", "args"], types: [] };
export const NO_HOST: HostSpec = { capabilities: [], types: [] };

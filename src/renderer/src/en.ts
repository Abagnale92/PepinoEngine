import { EN_A } from "./en/a";
import { EN_B } from "./en/b";
import { EN_C } from "./en/c";
import { EN_D, EN_D_PATTERNS } from "./en/d";
import { EN_E } from "./en/e";
import { EN_F } from "./en/f";
import { EN_G, EN_G_PATTERNS } from "./en/g";
import { EN_H } from "./en/h";
import { EN_ENGINE_MESSAGES, EN_PATTERNS as PATTERNS } from "./en/patterns";

/**
 * Dizionario inglese dell'editor: testo italiano → testo inglese.
 * Contiene i testi dell'interfaccia e quelli che arrivano dal motore (blocchi, proprietà, Regole, controlli).
 * Per controllare che non manchi niente: il test «editor in inglese» elenca i testi senza traduzione.
 */
export const EN: Record<string, string> = { ...EN_ENGINE_MESSAGES, ...EN_A, ...EN_B, ...EN_C, ...EN_D, ...EN_E, ...EN_F, ...EN_G, ...EN_H };

/** Messaggi con parti variabili: {0}, {1}… sono le parti che restano uguali (nomi, numeri). */
export const EN_PATTERNS: [string, string][] = [...PATTERNS, ...EN_D_PATTERNS, ...EN_G_PATTERNS];

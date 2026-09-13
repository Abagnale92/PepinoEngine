// I blocchi si registrano quando il loro modulo viene importato.
import "./sprite";
import "./body";
import "./platform";
import "./topdown";
import "./camera";
import "./animator";
import "./patrol";
import "./health";
import "./gameplay";
import "./text";
import "./ui";

/** Garantisce che i blocchi di serie siano caricati (l'import sopra fa il lavoro). */
export function registerBuiltinBlocks(): void {}

export const BLOCK_CATEGORIES = ["Grafica", "Fisica", "Movimento", "Camera", "IA", "Combattimento", "Gameplay", "Interfaccia", "Personalizzati"];

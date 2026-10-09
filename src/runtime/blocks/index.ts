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
import "./ai";
import "./weapons";
import "./spawner";
import "./npc";
import "./beatemup";
import "./particles";
import "./light";
import "./spritefx";
import "./combo";
import "./boss";
import "./shmup";
import "./towerdefense";
import "./racing";
import "./pointclick";
import "./items";
import "./firstperson";
import "./fighting";
import "./roguelike";
import "./cards";
import "./horror";
import "./rhythm";
import "./party";

/** Garantisce che i blocchi di serie siano caricati (l'import sopra fa il lavoro). */
export function registerBuiltinBlocks(): void {}

export const BLOCK_CATEGORIES = [
  "Grafica",
  "Effetti",
  "Fisica",
  "Movimento",
  "Camera",
  "IA",
  "Personaggi",
  "Combattimento",
  "Gameplay",
  "Interfaccia",
  "Personalizzati",
];

/** Modelli di progetto: un gioco piccolo ma completo per genere, da cui partire. */
export interface ProjectTemplate {
  id: string;
  label: string;
  description: string;
  icon: string;
}

export const TEMPLATES: ProjectTemplate[] = [
  {
    id: "platform",
    label: "Platform",
    description: "Corsa, salti, monete e nemici da schiacciare, con la camera che anticipa la corsa.",
    icon: "play",
  },
  {
    id: "topdown",
    label: "Top-down",
    description: "Visto dall'alto: un villaggio con un personaggio che parla, slime che inseguono e un attacco.",
    icon: "person",
  },
  {
    id: "beatemup",
    label: "Beat 'em up",
    description: "Una strada di notte con i lampioni: si cammina in profondità, si salta e si combatte a ondate.",
    icon: "enemy",
  },
  {
    id: "shmup",
    label: "Shoot'em up",
    description: "Nello spazio: la navicella spara mentre lo schermo scorre, ondate di nemici con traiettorie diverse e un'astronave madre alla fine.",
    icon: "up",
  },
  {
    id: "towerdefense",
    label: "Tower defense",
    description: "Un sentiero nel prato: gli slime arrivano a ondate e tu costruisci torrette sulle piazzole con le monete guadagnate.",
    icon: "grid",
  },
];

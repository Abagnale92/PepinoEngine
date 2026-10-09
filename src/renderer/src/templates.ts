/** Modelli di progetto: un gioco piccolo ma completo per genere, da cui partire. */
export interface ProjectTemplate {
  id: string;
  label: string;
  description: string;
  icon: string;
}

export const TEMPLATES: ProjectTemplate[] = [
  {
    id: "vuoto",
    label: "Progetto vuoto",
    description: "Una scena vuota con il tileset e le immagini di base: parti da zero.",
    icon: "plus",
  },
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
  {
    id: "racing",
    label: "Corse 2D",
    description: "Gran premio dei cetrioli: un circuito visto dall'alto, tre avversari, tre giri, conto alla rovescia, tempo e posizione in classifica.",
    icon: "flag",
  },
  {
    id: "pointclick",
    label: "Punta e clicca",
    description: "La casa del nonno: clicca per camminare, raccogli gli oggetti, usali dall'inventario e parla con il nonno per riuscire ad aprire la porta.",
    icon: "eye",
  },
  {
    id: "ritmo",
    label: "Gioco a ritmo",
    description: "Il concerto dell'orto: le note scendono su quattro corsie e vanno premute a tempo, con Perfetto, combo e punteggio.",
    icon: "music",
  },
  {
    id: "horror",
    label: "Horror",
    description: "La serra abbandonata: al buio con la torcia, un'Ombra che ti cerca seguendo i rumori, armadi in cui sparire e tre fusibili da trovare.",
    icon: "eyeOff",
  },
  {
    id: "carte",
    label: "Gioco di carte",
    description: "Il torneo dell'orto: duelli a turni con le carte, energia, scudi e una carta nuova da imparare dopo la prima vittoria.",
    icon: "copy",
  },
  {
    id: "roguelike",
    label: "Roguelike",
    description: "Le cantine del nonno: ogni piano è costruito dal computer, con stanze, slime, scrigni e la scala per scendere sempre più giù.",
    icon: "grid",
  },
  {
    id: "picchiaduro",
    label: "Picchiaduro 1 contro 1",
    description: "Sfida sul tetto: due lottatori uno di fronte all'altro, parate, combo di tre colpi, round al meglio dei tre e barre della vita.",
    icon: "enemy",
  },
  {
    id: "fps",
    label: "Prima persona",
    description: "Il labirinto degli slime: si gioca in prima persona, con muri di pietra, slime che inseguono, munizioni, medikit e l'uscita da trovare.",
    icon: "cube",
  },
];

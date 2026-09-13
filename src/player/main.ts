import { Game, defineBlock, type ProjectData } from "@runtime";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const loading = document.getElementById("loading")!;
const bar = document.getElementById("bar")!;

// API globale per i blocchi custom caricati come script.
(window as unknown as { Pepino: unknown }).Pepino = { defineBlock };

async function boot() {
  const params = new URLSearchParams(location.search);
  const projectUrl = new URL(params.get("project") ?? "project.json", location.href);
  try {
    const res = await fetch(projectUrl);
    if (!res.ok) throw new Error(`${projectUrl.pathname} non trovato (${res.status})`);
    let project: ProjectData;
    try {
      project = JSON.parse(await res.text());
    } catch {
      // Tipico quando il server risponde con una pagina HTML al posto del file.
      throw new Error(`${projectUrl.pathname} manca o non è un progetto valido`);
    }
    if (project?.format !== "pepino") throw new Error(`${projectUrl.pathname} non è un progetto Pepino`);
    document.title = project.name;
    const game = new Game(canvas, project, { baseUrl: projectUrl.href, debug: params.has("debug") });
    (window as unknown as { game: Game }).game = game;
    await game.start((p) => (bar.style.width = `${Math.round(p * 100)}%`));
    loading.remove();
    canvas.focus();
  } catch (err) {
    loading.textContent = `Impossibile avviare il gioco: ${(err as Error).message}`;
    console.error(err);
  }
}

boot();

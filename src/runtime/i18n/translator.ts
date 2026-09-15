import type { LanguageInfo, ProjectData } from "../project/format";

/**
 * Traduce i testi del gioco. La chiave è il testo originale stesso (come in gettext):
 * chi crea il gioco scrive i testi normalmente e poi li traduce in una tabella, senza codici da inventare.
 */
export class Translator {
  language: string;

  constructor(
    private project: Pick<ProjectData, "languages" | "translations">,
    initial?: string,
  ) {
    this.language = initial && this.has(initial) ? initial : this.original;
  }

  get languages(): LanguageInfo[] {
    return this.project.languages ?? [];
  }

  /** Lingua in cui sono scritti i testi: la prima dell'elenco ("" se il gioco non ha lingue). */
  get original(): string {
    return this.languages[0]?.id ?? "";
  }

  has(id: string): boolean {
    return this.languages.some((l) => l.id === id);
  }

  /** Il testo nella lingua scelta; se manca la traduzione resta quello originale. */
  t(text: string): string {
    if (!text || !this.language || this.language === this.original) return text;
    const tr = this.project.translations?.[this.language]?.[text];
    return tr && tr.trim() ? tr : text;
  }

  set(id: string): boolean {
    if (!this.has(id)) return false;
    this.language = id;
    return true;
  }

  /** La lingua dopo quella attuale, ricominciando dalla prima. */
  nextId(): string {
    const list = this.languages;
    if (!list.length) return "";
    const i = list.findIndex((l) => l.id === this.language);
    return list[(i + 1) % list.length].id;
  }
}

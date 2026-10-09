import type { Entity } from "../core/entity";
import { DIALOGUE_END, type DialogueChoice, type DialogueData, type DialogueLine, type VariableValue } from "../project/format";
import { interpolate } from "../blocks/text";

export interface DialogueInput {
  pressed(action: string): boolean;
  /** Clic o tocco: va avanti come Azione. */
  readonly pointer?: { readonly pressed: boolean };
}

export interface ActiveDialogue {
  data: DialogueData;
  index: number;
  /** Caratteri già comparsi (effetto macchina da scrivere). */
  shown: number;
  /** Scelta evidenziata. */
  choice: number;
  /** Testo della battuta con le {variabili} già sostituite. */
  text: string;
  speaker?: Entity;
  /** Breve pausa all'inizio di ogni battuta: il tasto appena premuto non la salta. */
  wait: number;
}

const parse = (v: string): VariableValue => {
  if (v === "true" || v === "false") return v === "true";
  const n = Number(v);
  return v.trim() !== "" && !Number.isNaN(n) ? n : v;
};

/** Fa scorrere un dialogo: battute, effetto macchina da scrivere, scelte e variabili. */
export class DialogueRunner {
  current: ActiveDialogue | null = null;

  constructor(
    private dialogues: () => DialogueData[],
    private vars: () => Record<string, VariableValue>,
    private onEnd: (id: string, speaker?: Entity) => void,
    /** Traduzione dei testi nella lingua scelta dal giocatore. */
    private translate: (text: string) => string = (s) => s,
  ) {}

  get active(): boolean {
    return !!this.current;
  }

  get line(): DialogueLine | undefined {
    return this.current ? this.current.data.lines[this.current.index] : undefined;
  }

  get fullyShown(): boolean {
    return !!this.current && this.current.shown >= this.current.text.length;
  }

  get choices(): DialogueChoice[] {
    return (this.line?.choices ?? []).filter((c) => c.text?.trim());
  }

  start(id: string, speaker?: Entity): boolean {
    const data = this.dialogues().find((d) => d.id === id);
    if (!data || !data.lines.length) return false;
    this.current = { data, index: 0, shown: 0, choice: 0, text: "", speaker, wait: 0 };
    this.enter(0);
    return true;
  }

  private enter(index: number) {
    const c = this.current!;
    c.index = index;
    c.text = interpolate(this.translate(c.data.lines[index].text ?? ""), this.vars());
    c.shown = 0;
    c.choice = 0;
    c.wait = 0.12;
  }

  /** `pointed` = la risposta sotto il puntatore, se si è appena mosso o ha cliccato (-1 = nessuna). */
  update(dt: number, input: DialogueInput, pointed = -1): void {
    const c = this.current;
    if (!c) return;
    if (c.wait > 0) c.wait -= dt;
    const ready = c.wait <= 0;
    const confirm = ready && (input.pressed("action") || input.pressed("jump"));
    const click = ready && !!input.pointer?.pressed;
    if (!this.fullyShown) {
      c.shown = confirm || click ? c.text.length : Math.min(c.text.length, c.shown + dt * 45);
      return;
    }
    const choices = this.choices;
    if (choices.length) {
      if (pointed >= 0 && pointed < choices.length) c.choice = pointed;
      if (input.pressed("down")) c.choice = (c.choice + 1) % choices.length;
      if (input.pressed("up")) c.choice = (c.choice - 1 + choices.length) % choices.length;
      // Un clic sceglie solo se è sopra una risposta.
      if (confirm || (click && pointed >= 0 && pointed < choices.length)) this.choose(c.choice);
      return;
    }
    if (confirm || click) this.go(this.line!.goto);
  }

  /** Sceglie la risposta `i` (anche da mouse o dai test). */
  choose(i: number): void {
    const ch = this.choices[i];
    if (!ch) return;
    if (ch.setVar) this.vars()[ch.setVar] = parse(interpolate(ch.setValue ?? "", this.vars()));
    this.go(ch.goto);
  }

  private go(target?: string) {
    const c = this.current!;
    if (target === DIALOGUE_END) return this.end();
    let next = c.index + 1;
    if (target) {
      next = c.data.lines.findIndex((l) => l.id === target);
      if (next < 0) return this.end();
    }
    if (next >= c.data.lines.length) return this.end();
    this.enter(next);
  }

  end(): void {
    const c = this.current;
    this.current = null;
    if (c) this.onEnd(c.data.id, c.speaker);
  }

  /** Interrompe senza avvisare nessuno (es. cambio di scena). */
  cancel(): void {
    this.current = null;
  }
}

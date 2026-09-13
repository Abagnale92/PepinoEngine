import { Component, type ReactNode } from "react";
import { log } from "../store";

interface Props {
  name: string;
  /** Area della griglia dell'editor da occupare se il pannello si blocca. */
  area?: string;
  /** Riempie il contenitore (per le viste al centro). */
  fill?: boolean;
  children: ReactNode;
}

/** Se un pannello va in errore mostra un avviso al suo posto: il resto dell'editor continua a funzionare. */
export class PanelBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    log("error", `Il pannello «${this.props.name}» si è bloccato: ${error.message}`);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={`panel-crash${this.props.fill ? " fill" : ""}`} style={this.props.area ? { gridArea: this.props.area } : undefined}>
        <b>Il pannello «{this.props.name}» si è bloccato.</b>
        <p>{error.message}</p>
        <button type="button" className="btn small" onClick={() => this.setState({ error: null })}>
          Riprova
        </button>
      </div>
    );
  }
}

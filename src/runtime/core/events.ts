export type Handler<T = any> = (data: T) => void;

export class Emitter {
  private handlers = new Map<string, Set<Handler>>();

  on<T = any>(event: string, fn: Handler<T>): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(fn);
    return () => this.off(event, fn);
  }

  off(event: string, fn: Handler): void {
    this.handlers.get(event)?.delete(fn);
  }

  emit<T = any>(event: string, data?: T): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) fn(data);
  }

  clear(): void {
    this.handlers.clear();
  }
}

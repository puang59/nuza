import { useSyncExternalStore } from "react";

/** Something added that can be taken away again. */
export interface Disposable {
  dispose(): void;
}

/** Who added an item: nuza itself, or a plugin by its id. */
export const CORE = "core";

interface Entry<T> {
  item: T;
  owner: string;
}

/**
 * An ordered set of items by id, which the parts of the app that show them -
 * the palette, the status bar, the sidebar - read from, and which nuza's own
 * features and plugins both add to.
 *
 * Items keep the order they were added in. `list()` hands back the same array
 * until something changes, so a component reading it through
 * `useSyncExternalStore` renders again only when there is something new.
 */
export class Registry<T extends { id: string }> {
  private entries = new Map<string, Entry<T>>();
  private listeners = new Set<() => void>();
  private snapshot: readonly T[] = [];

  /**
   * Adds `item`. A second item with an id already taken is a mistake in
   * whoever added it - two commands under one name would make one of them
   * unreachable - so it throws rather than quietly replacing the first.
   */
  register(item: T, owner: string = CORE): Disposable {
    if (this.entries.has(item.id)) throw new Error(`"${item.id}" is already registered`);

    const entry = { item, owner };
    this.entries.set(item.id, entry);
    this.changed();

    return {
      dispose: () => {
        // Only this registration: the id may have been freed and taken again
        // since, by something this handle knows nothing about.
        if (this.entries.get(item.id) !== entry) return;
        this.entries.delete(item.id);
        this.changed();
      },
    };
  }

  get(id: string): T | undefined {
    return this.entries.get(id)?.item;
  }

  ownerOf(id: string): string | undefined {
    return this.entries.get(id)?.owner;
  }

  list(): readonly T[] {
    return this.snapshot;
  }

  /** Everything one owner added, at once: what turning a plugin off falls back on. */
  disposeOwner(owner: string) {
    let removed = false;
    for (const [id, entry] of this.entries) {
      if (entry.owner !== owner) continue;
      this.entries.delete(id);
      removed = true;
    }
    if (removed) this.changed();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private changed() {
    this.snapshot = [...this.entries.values()].map((entry) => entry.item);
    for (const listener of [...this.listeners]) listener();
  }
}

/** The items in `registry`, kept current. */
export function useRegistry<T extends { id: string }>(registry: Registry<T>): readonly T[] {
  return useSyncExternalStore(
    registry.subscribe,
    () => registry.list(),
    () => registry.list()
  );
}

/** One disposable for several, undone in the reverse of the order they were made. */
export function disposeAll(disposables: Disposable[]): Disposable {
  return {
    dispose() {
      for (const disposable of disposables.splice(0).reverse()) disposable.dispose();
    },
  };
}

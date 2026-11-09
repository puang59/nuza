import type { Disposable } from "./registry";

/** A file or folder in the vault that appeared, changed, went or moved, by its full path. */
export interface VaultChange {
  kind: "create" | "modify" | "delete" | "rename";
  path: string;
  /** Where it was, for a rename. */
  from?: string;
  /** Whether this is only nuza's own save of a note it holds. */
  own: boolean;
}

/** What can be listened for, and what each listener is given. */
export interface AppEvents {
  /** Anything in the open folder changing on disk, nuza's own saves included. */
  "vault-change": VaultChange;
  /** A folder opened in this window, or closed (null). */
  "vault-open": { path: string | null };
  /** The note in the main pane is now this one (null for the scratch note). */
  "active-note-change": { path: string | null };
  /** The text of a note in an editor changed, a moment after the typing stopped. */
  "editor-change": { path: string | null };
}

type Listener<K extends keyof AppEvents> = (payload: AppEvents[K]) => void;

/**
 * Who is listening for what, in this window. Something that costs work to
 * produce - every change in the folder means the watcher reporting them - is
 * only started while somebody listens: `whileListened` says how.
 */
export class EventBus {
  private listeners = new Map<keyof AppEvents, Set<Listener<never>>>();
  private sources = new Map<keyof AppEvents, { start(): void; stop(): void }>();

  on<K extends keyof AppEvents>(name: K, listener: Listener<K>): Disposable {
    let set = this.listeners.get(name);
    if (!set) this.listeners.set(name, (set = new Set()));
    const wrapped: Listener<K> = (payload) => listener(payload);
    set.add(wrapped as Listener<never>);
    if (set.size === 1) this.sources.get(name)?.start();

    let gone = false;
    return {
      dispose: () => {
        if (gone) return;
        gone = true;
        set.delete(wrapped as Listener<never>);
        if (set.size === 0) this.sources.get(name)?.stop();
      },
    };
  }

  /**
   * Hands `payload` to everyone listening for `name`. One listener that throws
   * is reported and does not stop the rest hearing it.
   */
  emit<K extends keyof AppEvents>(name: K, payload: AppEvents[K]) {
    const set = this.listeners.get(name);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        (listener as Listener<K>)(payload);
      } catch (error) {
        console.error(`A listener for "${name}" failed:`, error);
      }
    }
  }

  listening(name: keyof AppEvents): boolean {
    return (this.listeners.get(name)?.size ?? 0) > 0;
  }

  /** Runs `start` when the first listener for `name` arrives, and `stop` when the last one leaves. */
  whileListened(name: keyof AppEvents, source: { start(): void; stop(): void }) {
    this.sources.set(name, source);
    if (this.listening(name)) source.start();
  }
}

/** This window's events. */
export const events = new EventBus();

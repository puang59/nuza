import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { events, type VaultChange } from "./registries/events";
import { listenHere } from "./windowEvents";

/** What the watcher sends while asked to, in watcher.rs. */
const VAULT_CHANGES_EVENT = "vault-changes";

/**
 * Has the watcher report every change in the folder while something in this
 * window listens for `vault-change`, and stop when nothing does - so with no
 * plugin listening it does no more than it always has.
 */
export function connectVaultChanges() {
  let listening: Promise<UnlistenFn> | null = null;

  events.whileListened("vault-change", {
    start() {
      listening = listenHere<VaultChange[]>(VAULT_CHANGES_EVENT, ({ payload }) => {
        for (const change of payload) events.emit("vault-change", change);
      });
      invoke("plugins_watch_vault", { on: true }).catch((error) =>
        console.error("Couldn't start reporting changes in the folder:", error)
      );
    },
    stop() {
      invoke("plugins_watch_vault", { on: false }).catch((error) =>
        console.error("Couldn't stop reporting changes in the folder:", error)
      );
      void listening?.then((unlisten) => unlisten());
      listening = null;
    },
  });
}

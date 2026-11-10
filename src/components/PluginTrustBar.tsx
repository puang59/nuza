import { useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { report } from "@/lib/notices";
import { listed, plugins } from "@/lib/plugins/loader";

/**
 * A vault that arrived with plugins turned on - copied, cloned or synced from
 * someone else - which this machine has not said may run them. Nothing runs
 * until this is answered.
 */
export default function PluginTrustBar() {
  const { held } = useSyncExternalStore(plugins.subscribe, () => plugins.current());
  const [busy, setBusy] = useState(false);
  if (held?.why !== "untrusted") return null;

  const answer = async (command: string, args: Record<string, unknown>, failure: string) => {
    setBusy(true);
    try {
      await invoke(command, args);
    } catch (error) {
      report(failure, error);
    } finally {
      setBusy(false);
    }
    await plugins.sync();
  };

  const count = held.names.length;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2">
      <p className="min-w-0 flex-1 basis-64 text-sm text-amber-100/90">
        This folder has {count === 1 ? "a plugin" : `${count} plugins`} turned on:{" "}
        <span className="text-amber-100">{listed(held.names)}</span>. Plugins can read and change your files.
        Turn {count === 1 ? "it" : "them"} on?
      </p>
      <div className="flex shrink-0 gap-2">
        <button
          disabled={busy}
          onClick={() =>
            void answer("plugins_set_community", { on: false }, "Couldn't turn community plugins off")
          }
          className="cursor-pointer rounded-md px-3 py-1 text-sm text-amber-100/90 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
        >
          Keep off
        </button>
        <button
          disabled={busy}
          onClick={() => void answer("plugins_trust_vault", {}, "Couldn't turn the plugins on")}
          className="cursor-pointer rounded-md bg-amber-500/80 px-3 py-1 text-sm text-black transition-colors hover:bg-amber-400 disabled:opacity-50"
        >
          Turn on
        </button>
      </div>
    </div>
  );
}

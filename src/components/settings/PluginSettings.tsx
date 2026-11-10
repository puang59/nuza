import { useEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Switch } from "@/components/ui/switch";
import { report } from "@/lib/notices";
import PluginTrustBar from "@/components/PluginTrustBar";
import {
  heldMessage,
  pluginName,
  plugins,
  SLOW_LOAD_MS,
  type Held,
  type InstalledPlugin,
  type PluginStatus,
} from "@/lib/plugins/loader";
import { useRegistry } from "@/lib/registries/registry";
import { settingTabs } from "@/lib/registries/settingTabs";
import SettingRow from "./SettingRow";

interface PluginSettingsProps {
  /** The open folder: plugins belong to a vault, so there is nothing here without one. */
  vaultPath: string | null;
  /** Opens a plugin's own pane in Settings. */
  onOpenTab: (id: string) => void;
}

/** Runs a change, then has the window catch up with it. */
async function change(command: string, args: Record<string, unknown>, failure: string) {
  try {
    await invoke(command, args);
  } catch (error) {
    report(failure, error);
  }
  await plugins.sync();
}

/** What to say under a plugin's name: why it is not running, or how its start went. */
function standing(plugin: InstalledPlugin, status: PluginStatus | undefined, held: Held | null) {
  if (plugin.problem) return { text: plugin.problem, warn: true };
  if (held?.why === "crashed" && held.id === plugin.id) {
    return { text: "Was starting when nuza stopped last time", warn: true };
  }
  if (status?.state === "failed") return { text: `Failed to start: ${status.reason}`, warn: true };
  if (status?.state === "loaded" && status.loadMs > SLOW_LOAD_MS) {
    return { text: `Slow to start (${(status.loadMs / 1000).toFixed(1)} s)`, warn: true };
  }
  return { text: plugin.manifest?.description ?? "", warn: false };
}

/**
 * Community plugins for the open folder: off until turned on, with a plain
 * word on what that means, and then every plugin installed in it, each with
 * its own switch.
 */
export default function PluginSettings({ vaultPath, onOpenTab }: PluginSettingsProps) {
  const { state, statuses, held } = useSyncExternalStore(plugins.subscribe, () => plugins.current());
  const tabs = useRegistry(settingTabs);
  const [busy, setBusy] = useState(false);

  // What is on disk may have changed since the window last looked: a plugin
  // dropped into the folder, or a build of one being worked on.
  useEffect(() => {
    if (vaultPath) void plugins.sync();
  }, [vaultPath]);

  if (!vaultPath) {
    return <p className="text-sm text-gray-500">Open a folder to use community plugins in it.</p>;
  }

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  if (!state?.community) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-300">
          Community plugins add commands, views and ways of drawing notes, written by people outside nuza.
        </p>
        <p className="text-sm text-gray-500">
          A plugin runs with the same access as nuza itself: it can read and change every note in this folder.
          Only turn on plugins from authors you trust. They are turned on for this folder only.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(() =>
              change("plugins_set_community", { on: true }, "Couldn't turn on community plugins")
            )
          }
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-white transition-colors hover:bg-zinc-700 cursor-pointer disabled:opacity-50"
        >
          Turn on community plugins
        </button>
      </div>
    );
  }

  const heldBack = held && heldMessage(held, pluginName(state.plugins, held));

  return (
    <div>
      <div className="mb-2 overflow-hidden rounded-md empty:hidden">
        <PluginTrustBar />
      </div>
      {heldBack && held && (
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <p className="min-w-0 flex-1 basis-64 text-xs text-amber-100/90">{heldBack}</p>
          {held.why !== "flag" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => plugins.release())}
              className="shrink-0 rounded-md bg-amber-500/80 px-3 py-1 text-xs text-black transition-colors hover:bg-amber-400 cursor-pointer disabled:opacity-50"
            >
              Load plugins now
            </button>
          )}
        </div>
      )}
      <div className="divide-y divide-zinc-800">
        <SettingRow title="Community plugins" description="Run the plugins turned on below, in this folder">
          <Switch
            checked
            disabled={busy}
            onCheckedChange={() =>
              void run(() =>
                change("plugins_set_community", { on: false }, "Couldn't turn off community plugins")
              )
            }
          />
        </SettingRow>
        <div className="flex items-center gap-2 py-3">
          <button
            type="button"
            onClick={() =>
              invoke("plugins_open_folder").catch((error) =>
                report("Couldn't open the plugins folder", error)
              )
            }
            className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-gray-300 transition-colors hover:bg-zinc-800 cursor-pointer"
          >
            Open plugins folder
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => plugins.sync())}
            className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-gray-300 transition-colors hover:bg-zinc-800 cursor-pointer disabled:opacity-50"
          >
            Look again
          </button>
        </div>
      </div>

      <h2 className="mt-4 mb-1 text-xs font-medium text-gray-500">Installed</h2>
      {state.plugins.length === 0 ? (
        <p className="py-3 text-xs text-gray-500">
          None yet. A plugin is a folder with a manifest.json and a main.js; put one in this folder&apos;s
          .nuza/plugins and press Look again.
        </p>
      ) : (
        <div className="divide-y divide-zinc-800">
          {state.plugins.map((plugin) => {
            const { text, warn } = standing(plugin, statuses.get(plugin.id), held);
            const manifest = plugin.manifest;
            const hasTab = tabs.some((tab) => tab.id === plugin.id);
            return (
              <div key={plugin.id} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-medium text-white">
                    {manifest?.name ?? plugin.id}
                    {manifest && (
                      <span className="ml-2 font-mono text-[11px] font-normal text-gray-500">
                        v{manifest.version}
                      </span>
                    )}
                    {plugin.linked && (
                      <span
                        className="ml-2 text-[11px] font-normal text-gray-500"
                        title="A link to a plugin being worked on"
                      >
                        linked
                      </span>
                    )}
                  </h3>
                  {manifest && <p className="mt-0.5 truncate text-xs text-gray-500">by {manifest.author}</p>}
                  <p className={`mt-1 text-xs ${warn ? "text-amber-400" : "text-gray-500"}`}>{text}</p>
                  {hasTab && plugin.enabled && (
                    <button
                      type="button"
                      onClick={() => onOpenTab(plugin.id)}
                      className="mt-1 text-xs text-gray-400 underline-offset-2 hover:text-white hover:underline cursor-pointer"
                    >
                      Options
                    </button>
                  )}
                </div>
                <div className="shrink-0 pt-0.5">
                  <Switch
                    checked={plugin.enabled}
                    disabled={busy || (!!plugin.problem && !plugin.enabled)}
                    onCheckedChange={(on) =>
                      void run(() =>
                        change(
                          "plugins_set_enabled",
                          { id: plugin.id, on },
                          `Couldn't turn ${manifest?.name ?? plugin.id} ${on ? "on" : "off"}`
                        )
                      )
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

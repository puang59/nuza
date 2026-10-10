import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { report } from "@/lib/notices";
import SettingRow from "./SettingRow";

/** What `cli_status` says, as lib.rs's `CliStatus` has it. */
interface CliStatus {
  supported: boolean;
  state: "none" | "installed" | "outdated" | "foreign";
  path: string;
}

/** The path as it would be typed: under the home folder, it starts with `~`. */
function tidy(path: string) {
  return path.replace(/^(?:\/(?:Users|home)\/|[A-Za-z]:\\Users\\)[^/\\]+/, "~");
}

/**
 * Putting a `nuza` command on the PATH, and taking it away again: a one-line
 * shim that starts the app on whatever it is given, in `~/.local/bin`, or on
 * Windows in the WindowsApps folder that is on every account's PATH.
 *
 * Left out where it is not available, which is anywhere there is no such
 * folder convention to follow.
 */
export default function CommandLineSetting() {
  const [status, setStatus] = useState<CliStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    invoke<CliStatus>("cli_status")
      .then(setStatus)
      .catch((error) => console.error("Couldn't read the command line status:", error));
  }, []);

  if (!status?.supported) return null;

  async function change(command: "install_cli" | "uninstall_cli") {
    setBusy(true);
    try {
      setStatus(await invoke<CliStatus>(command));
    } catch (error) {
      report(
        command === "install_cli" ? "Couldn't install the command" : "Couldn't remove the command",
        error
      );
    } finally {
      setBusy(false);
    }
  }

  const installed = status.state === "installed" || status.state === "outdated";
  const description = {
    none: "Open notes and folders from a terminal with nuza <path>",
    installed: `Installed at ${tidy(status.path)}. If the command isn't found, add that folder to your PATH`,
    outdated: `Installed at ${tidy(status.path)}, but for a copy of nuza that has since moved. Update it`,
    foreign: `${tidy(status.path)} is something else, so nuza has left it alone`,
  }[status.state];

  return (
    <SettingRow title="Command Line" description={description}>
      {status.state !== "foreign" && (
        <div className="flex gap-2">
          {status.state !== "installed" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void change("install_cli")}
              className="cursor-pointer rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs text-white transition-colors hover:border-[var(--nuza-accent)] disabled:cursor-default disabled:opacity-60"
            >
              {status.state === "outdated" ? "Update" : "Install"}
            </button>
          )}
          {installed && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void change("uninstall_cli")}
              className="cursor-pointer rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs text-white transition-colors hover:border-[var(--nuza-accent)] disabled:cursor-default disabled:opacity-60"
            >
              Remove
            </button>
          )}
        </div>
      )}
    </SettingRow>
  );
}

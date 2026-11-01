import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isMacPlatform } from "@/lib/platform";
import { isMainWindow } from "@/lib/windowLabel";

/** Delay before the first background check, so startup isn't slowed down. */
const INITIAL_CHECK_DELAY_MS = 5_000;
/** How often to check again while the app stays open. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** How long transient results of a manual check ("Up to date", errors) stay visible. */
const RESULT_VISIBLE_MS = 3_000;
/** Where mac users are sent to grab a build manually, since self-install isn't available there. */
const RELEASES_URL = "https://github.com/puang59/nuza/releases/latest";
/** Every release and its notes, for when the running version is not known. */
const CHANGELOG_URL = "https://github.com/puang59/nuza/releases";

/** The notes of the release this build is, rather than every release's. */
export function changelogUrl(version: string | null): string {
  return version ? `${CHANGELOG_URL}/tag/app-v${version}` : CHANGELOG_URL;
}

export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "up-to-date" }
  | { state: "available"; version: string }
  | { state: "downloading"; version: string; progress: number | null }
  | { state: "ready"; version: string; installError?: string }
  | { state: "installing"; version: string }
  | { state: "error"; message: string };

interface UseAppUpdaterOptions {
  /** Check for (and download) updates in the background on launch and periodically. */
  autoUpdate: boolean;
}

/**
 * Checks for app updates via the Tauri updater plugin and downloads them in
 * the background. Installing is always left to the user (see `installUpdate`)
 * so the app never restarts out from under unsaved work.
 */
export function useAppUpdater({ autoUpdate }: UseAppUpdaterOptions) {
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  const [version, setVersion] = useState<string | null>(null);

  const statusRef = useRef(status);
  statusRef.current = status;
  const updateRef = useRef<Update | null>(null);
  const inFlightRef = useRef(false);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  /** Shows a manual check's result briefly, then falls back to idle. */
  const showResult = useCallback((next: UpdateStatus) => {
    setStatus(next);
    clearTimeout(resultTimerRef.current);
    resultTimerRef.current = setTimeout(() => {
      setStatus((current) => (current === next ? { state: "idle" } : current));
    }, RESULT_VISIBLE_MS);
  }, []);

  useEffect(() => () => clearTimeout(resultTimerRef.current), []);

  const installUpdate = useCallback(async () => {
    const update = updateRef.current;
    const current = statusRef.current;
    if (!update || current.state !== "ready") return;

    const confirmed = await ask(
      `nuza v${current.version} is ready to install. Restart now? Unsaved changes will be lost.`,
      { title: "Update ready", kind: "info", okLabel: "Restart", cancelLabel: "Later" }
    );
    if (!confirmed) return;

    try {
      setStatus({ state: "installing", version: current.version });
      // On Windows this exits the app and hands off to the installer.
      await update.install();
      await relaunch();
    } catch (error) {
      console.error("Failed to install update:", error);
      setStatus({ state: "ready", version: current.version, installError: String(error) });
    }
  }, []);

  /**
   * Checks for a newer version and downloads it in the background.
   * `silent` checks (the automatic ones) don't surface "up to date" or errors.
   */
  const runCheck = useCallback(
    async (silent: boolean) => {
      if (statusRef.current.state === "ready") {
        // Already downloaded - a manual check is really a request to install.
        if (!silent) await installUpdate();
        return;
      }
      if (inFlightRef.current || statusRef.current.state === "installing") return;
      inFlightRef.current = true;

      clearTimeout(resultTimerRef.current);
      if (!silent) setStatus({ state: "checking" });

      try {
        const update = await check();
        if (!update) {
          if (silent) setStatus({ state: "idle" });
          else showResult({ state: "up-to-date" });
          return;
        }

        if (isMacPlatform()) {
          // Our macOS builds aren't notarized, so Tauri's in-place self-install gets
          // silently blocked by Gatekeeper. Just point people at a manual download
          // instead of downloading a build we can't actually install.
          await update.close();
          setStatus({ state: "available", version: update.version });
          return;
        }

        let total: number | null = null;
        let downloaded = 0;
        setStatus({ state: "downloading", version: update.version, progress: null });

        await update.download((event) => {
          if (event.event === "Started") {
            total = event.data.contentLength ?? null;
          } else if (event.event === "Progress") {
            downloaded += event.data.chunkLength;
            if (total) {
              const progress = Math.min(100, Math.round((downloaded / total) * 100));
              setStatus({ state: "downloading", version: update.version, progress });
            }
          }
        });

        await updateRef.current?.close();
        updateRef.current = update;
        setStatus({ state: "ready", version: update.version });
      } catch (error) {
        console.error("Failed to check for updates:", error);
        if (silent) setStatus({ state: "idle" });
        else showResult({ state: "error", message: String(error) });
      } finally {
        inFlightRef.current = false;
      }
    },
    [installUpdate, showResult]
  );

  const checkForUpdates = useCallback(() => runCheck(false), [runCheck]);

  /** Sends the user to the GitHub releases page to grab a build by hand (macOS). */
  const openDownloadPage = useCallback(() => {
    openUrl(RELEASES_URL).catch((error) => console.error("Failed to open releases page:", error));
  }, []);

  /** Opens the notes of the release being run in a browser. */
  const openChangelog = useCallback(() => {
    openUrl(changelogUrl(version)).catch((error) => console.error("Failed to open changelog:", error));
  }, [version]);

  useEffect(() => {
    // Dev builds share the release version, so auto-checking would just nag.
    if (!autoUpdate || import.meta.env.DEV) return;
    // An update is the app's business, not a window's, and every window runs
    // one of these. Left ungated, three windows meant three checks five
    // seconds after launch and every six hours after - and off macOS, three
    // downloads of the same installer at once, each into a temporary file of
    // its own. The windows the last run ended with are all restored at launch,
    // so that is the ordinary case rather than an unusual one.
    //
    // The same reasoning already decides which window reopens the last vault.
    if (!isMainWindow()) return;

    const initial = setTimeout(() => runCheck(true), INITIAL_CHECK_DELAY_MS);
    const interval = setInterval(() => runCheck(true), CHECK_INTERVAL_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [autoUpdate, runCheck]);

  return { status, version, checkForUpdates, installUpdate, openDownloadPage, openChangelog };
}

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface NoteTimes {
  modified?: number | null;
  created?: number | null;
}

/** How often "5 minutes ago" is brought up to date. */
const TICK_MS = 60_000;

/**
 * When the note at `path` was last changed and when it was made, and the time
 * now to measure them against. Read when the note is opened and again each
 * time it has just been saved (`saved` going from false to true), which is
 * when the answer changes; `now` moves once a minute so what is shown keeps
 * up without the disk being asked again.
 *
 * A note with no file - the scratch note - has no times.
 */
export function useNoteTimes(path: string | null, saved: boolean) {
  const [read, setRead] = useState<{ path: string; times: NoteTimes } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!path || !saved) return;

    let current = true;
    invoke<NoteTimes>("file_times", { path })
      .then((times) => {
        if (!current) return;
        setRead({ path, times });
        setNow(Date.now());
      })
      .catch(() => {
        // No file, or not one in the vault. Nothing is shown for it.
        if (current) setRead(null);
      });

    return () => {
      current = false;
    };
  }, [path, saved]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // What was read for another note is not this one's.
  return { times: read && read.path === path ? read.times : null, now };
}

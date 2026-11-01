import { isWithin, rewritePath, samePath } from "./path";

/**
 * Notes pinned to the top of the sidebar, kept per vault as lists of paths,
 * in the order they were pinned. Stored where anyone can edit it, so what
 * comes back is checked.
 */
export type PinStore = Record<string, string[]>;

export function readPins(stored: unknown): PinStore {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const pins: PinStore = {};
  for (const [vault, paths] of Object.entries(stored)) {
    if (!Array.isArray(paths)) continue;
    const kept = paths.filter((path): path is string => typeof path === "string" && !!path);
    if (kept.length) pins[vault] = [...new Set(kept)];
  }
  return pins;
}

/** `path` pinned in `vault` if it was not, and unpinned if it was. */
export function togglePin(pins: PinStore, vault: string, path: string): PinStore {
  const list = pins[vault] ?? [];
  const next = list.some((pinned) => samePath(pinned, path))
    ? list.filter((pinned) => !samePath(pinned, path))
    : [...list, path];
  const { [vault]: _, ...rest } = pins;
  return next.length ? { ...rest, [vault]: next } : rest;
}

/** Pins follow a file or folder that moved from `from` to `to`. */
export function movePins(pins: PinStore, from: string, to: string): PinStore {
  let changed = false;
  const next: PinStore = {};
  for (const [vault, paths] of Object.entries(pins)) {
    next[vault] = paths.map((path) => {
      const moved = rewritePath(path, from, to);
      if (moved !== path) changed = true;
      return moved;
    });
  }
  return changed ? next : pins;
}

/** Pins dropped for `gone` and anything inside it. */
export function forgetPins(pins: PinStore, gone: string): PinStore {
  let changed = false;
  const next: PinStore = {};
  for (const [vault, paths] of Object.entries(pins)) {
    const kept = paths.filter((path) => !isWithin(path, gone));
    if (kept.length !== paths.length) changed = true;
    if (kept.length) next[vault] = kept;
  }
  return changed ? next : pins;
}

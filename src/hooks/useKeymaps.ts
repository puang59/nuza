import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KEYMAP_STORAGE_KEY, type KeymapBindings } from "@/lib/keymaps";
import { firesWhileTyping, matchesBinding } from "@/lib/keybinding";
import { commands, isEnabled, resolveBindings } from "@/lib/registries/commands";
import { useRegistry } from "@/lib/registries/registry";
import { changeFrom, valueFromChange } from "@/lib/storageSync";

/** Keyed by command id; kept for commands that are not registered right now. */
type KeymapOverrides = Partial<Record<string, string>>;

function loadOverrides(): KeymapOverrides {
  try {
    const raw = localStorage.getItem(KEYMAP_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as KeymapOverrides) : {};
  } catch {
    return {};
  }
}

/** Resolves the effective binding for every command, merging user overrides onto the defaults. */
export function useKeymaps() {
  const [overrides, setOverrides] = useState<KeymapOverrides>(loadOverrides);
  const latest = useRef(overrides);
  latest.current = overrides;

  useEffect(() => {
    // Storage that is full or switched off throws, and a throw in an effect
    // takes the whole window down with it. The bindings still hold for as
    // long as the app is open; they are only not there next time.
    try {
      localStorage.setItem(KEYMAP_STORAGE_KEY, JSON.stringify(overrides));
    } catch (error) {
      console.error("Failed to keep the keyboard shortcuts:", error);
    }
  }, [overrides]);

  // A binding changed in another window applies here too.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      const changed = valueFromChange<KeymapOverrides>(changeFrom(event), KEYMAP_STORAGE_KEY, latest.current);
      if (changed && changed.value && typeof changed.value === "object") setOverrides(changed.value);
    }

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const registered = useRegistry(commands);
  const bindings = useMemo(
    () => resolveBindings(registered, overrides) as KeymapBindings,
    [registered, overrides]
  );

  const setBinding = useCallback((action: string, binding: string) => {
    setOverrides((prev) => ({ ...prev, [action]: binding }));
  }, []);

  const resetBinding = useCallback((action: string) => {
    setOverrides((prev) => {
      if (!(action in prev)) return prev;
      const next = { ...prev };
      delete next[action];
      return next;
    });
  }, []);

  const resetAll = useCallback(() => setOverrides({}), []);

  return { bindings, setBinding, resetBinding, resetAll };
}

/**
 * Whether the keystroke landed in something that takes text.
 *
 * The editor counts: CodeMirror is a contenteditable, and a shortcut bound to
 * a bare letter firing in the middle of a sentence - swallowing the letter,
 * since the listener calls `preventDefault` - is the same bug as it firing in
 * the middle of a filename.
 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * What the editor keeps for itself while Vim is on: Control and `[`, which Vim
 * has always meant as Escape. Off macOS that is the same keystroke as "mod+[",
 * Go Back, and the window's listener would take it before Vim ever saw it, so
 * insert mode could not be left that way. "ctrl" is the physical key, so on a
 * Mac, where Go Back is Command, nothing changes. (The editor's own "indent
 * less" has the chord too; useVimMode puts Vim ahead of that.)
 */
export const VIM_OWNED_KEYS = "ctrl+[";

/**
 * Whether the keystroke belongs to the part of the window it landed in.
 *
 * A region marks the chords it handles itself with `data-own-keys` - the AI
 * panel takes mod+. to stop an answer, where everywhere else it is Zen Mode.
 * Inside it, those chords are left to it; everything else still works.
 */
export function ownedHere(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const owner = target.closest("[data-own-keys]");
  const owned = owner?.getAttribute("data-own-keys");
  return !!owned && owned.split(",").some((binding) => matchesBinding(event, binding.trim()));
}

/**
 * Runs the command `bindings` give the keystroke to, if it can run, and says
 * whether it did. The first binding that matches decides, even if its command
 * cannot run just now: the keystroke is then left alone rather than handed to
 * a command further down that shares the chord.
 */
export function runBoundCommand(e: KeyboardEvent, bindings: Partial<Record<string, string>>): boolean {
  if (ownedHere(e)) return false;
  const typing = isTyping(e.target);

  for (const [id, binding] of Object.entries(bindings)) {
    if (!binding) continue;
    if (typing && !firesWhileTyping(binding)) continue;
    if (!matchesBinding(e, binding)) continue;

    const command = commands.get(id);
    if (!command || !isEnabled(command)) return false;
    e.preventDefault();
    void command.run();
    return true;
  }
  return false;
}

/**
 * Wires up a single global keydown listener that runs the registered command
 * the current (possibly user-customized) bindings give the keystroke to.
 * Uses the capture phase so shortcuts still fire while CodeMirror has focus.
 *
 * Bindings are tried in order, nuza's own first, so a plugin's shortcut on
 * a chord nuza already uses never takes it over.
 */
export function useKeymapListener(bindings: Partial<Record<string, string>>) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      runBoundCommand(e, bindings);
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [bindings]);
}

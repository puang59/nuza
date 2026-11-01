import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Appearance,
  DEFAULT_APPEARANCE,
  Theme,
  appearanceVariables,
  clampTransparency,
  isHexColor,
  isThemeChoice,
} from "@/lib/appearance";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Which of the two the system is using now, following it as it changes. */
function useSystemTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() =>
    typeof window !== "undefined" && window.matchMedia?.(DARK_QUERY).matches === false ? "light" : "dark"
  );

  useEffect(() => {
    const query = window.matchMedia?.(DARK_QUERY);
    if (!query) return;
    const follow = () => setTheme(query.matches ? "dark" : "light");
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, []);

  return theme;
}
import { usePersistedState } from "./usePersistedState";

/** The colours chosen for each theme, keeping only the ones that are colours. */
function readPalettes(stored: unknown): Appearance["palettes"] {
  if (!stored || typeof stored !== "object") return undefined;
  const palettes: NonNullable<Appearance["palettes"]> = {};
  const colour = (value: unknown) => (typeof value === "string" && isHexColor(value) ? value : undefined);
  for (const theme of ["dark", "light"] as const) {
    const palette = (stored as Record<string, { background?: unknown; text?: unknown } | undefined>)[theme];
    if (!palette || typeof palette !== "object") continue;
    const background = colour(palette.background);
    const text = colour(palette.text);
    if (background || text) palettes[theme] = { background, text };
  }
  return palettes;
}

/** The chosen colours, kept on the document root rather than in React state. */
export function useAppearance(hasBackdrop = true) {
  const [stored, setStored] = usePersistedState<Appearance>("appearance", DEFAULT_APPEARANCE, {
    // The transparency slider is a drag: a new value every frame, and only the
    // last one needs to reach storage.
    debounceMs: 250,
  });

  // Storage can hold anything; a colour that is not a colour would leave the
  // window painted in the literal string it was given.
  const appearance = useMemo<Appearance>(() => {
    const value = (stored ?? {}) as Partial<Appearance>;
    const colour = (candidate: unknown, fallback: string) =>
      typeof candidate === "string" && isHexColor(candidate) ? candidate : fallback;

    return {
      accent: colour(value.accent, DEFAULT_APPEARANCE.accent),
      transparency: clampTransparency(
        typeof value.transparency === "number" ? value.transparency : DEFAULT_APPEARANCE.transparency
      ),
      theme: isThemeChoice(value.theme) ? value.theme : DEFAULT_APPEARANCE.theme,
      palettes: readPalettes(value.palettes),
    };
  }, [stored]);

  const systemTheme = useSystemTheme();
  const theme: Theme = appearance.theme === "system" ? systemTheme : appearance.theme;

  // The stylesheet's half of the theme: the palette the components are drawn
  // in is swapped under this attribute, and so are the native form controls.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  // The window's half: the native backdrop and title bar are the system's,
  // and follow the window's own theme - left to the system for "system".
  useEffect(() => {
    getCurrentWindow()
      .setTheme(appearance.theme === "system" ? null : appearance.theme)
      .catch((error) => console.error("Couldn't set the window's theme:", error));
  }, [appearance.theme]);

  // What is already on the root, so a change only writes the properties that
  // actually moved. Dragging the transparency slider changes exactly one of
  // them, and rewriting the other fifteen with the values they already hold
  // would still dirty every element that inherits them - the whole editor -
  // once per frame.
  const applied = useRef<Record<string, string>>({});

  useEffect(() => {
    const root = document.documentElement;
    const variables = appearanceVariables(appearance, hasBackdrop, theme);

    for (const [name, value] of Object.entries(variables)) {
      if (applied.current[name] === value) continue;
      root.style.setProperty(name, value);
      applied.current[name] = value;
    }
  }, [appearance, hasBackdrop, theme]);

  const update = useCallback(
    (change: Partial<Appearance>) =>
      setStored((current) => ({ ...(current ?? DEFAULT_APPEARANCE), ...change })),
    [setStored]
  );

  // "Reset colours" is the accent, the theme's colours and the transparency;
  // the theme is a choice of its own, and stays.
  const reset = useCallback(
    () =>
      setStored((current) => ({ ...DEFAULT_APPEARANCE, theme: current?.theme ?? DEFAULT_APPEARANCE.theme })),
    [setStored]
  );

  return { appearance, theme, update, reset };
}

import { useCallback, useEffect, useMemo } from "react";
import { Appearance, DEFAULT_APPEARANCE, appearanceVariables, clampTransparency, isHexColor } from "@/lib/appearance";
import { usePersistedState } from "./usePersistedState";

/** The chosen colours, kept on the document root rather than in React state. */
export function useAppearance() {
  const [stored, setStored] = usePersistedState<Appearance>("appearance", DEFAULT_APPEARANCE);

  // Storage can hold anything; a colour that is not a colour would leave the
  // window painted in the literal string it was given.
  const appearance = useMemo<Appearance>(() => {
    const value = (stored ?? {}) as Partial<Appearance>;
    const colour = (candidate: unknown, fallback: string) =>
      typeof candidate === "string" && isHexColor(candidate) ? candidate : fallback;

    return {
      accent: colour(value.accent, DEFAULT_APPEARANCE.accent),
      background: colour(value.background, DEFAULT_APPEARANCE.background),
      foreground: colour(value.foreground, DEFAULT_APPEARANCE.foreground),
      transparency: clampTransparency(
        typeof value.transparency === "number" ? value.transparency : DEFAULT_APPEARANCE.transparency
      ),
    };
  }, [stored]);

  useEffect(() => {
    const root = document.documentElement;
    const variables = appearanceVariables(appearance);
    for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
  }, [appearance]);

  const update = useCallback(
    (change: Partial<Appearance>) => setStored((current) => ({ ...(current ?? DEFAULT_APPEARANCE), ...change })),
    [setStored]
  );

  const reset = useCallback(() => setStored(DEFAULT_APPEARANCE), [setStored]);

  return { appearance, update, reset };
}

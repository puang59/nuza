import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Appearance,
  DEFAULT_APPEARANCE,
  appearanceVariables,
  clampTransparency,
  isHexColor,
} from "@/lib/appearance";
import { usePersistedState } from "./usePersistedState";

/** The chosen colours, kept on the document root rather than in React state. */
export function useAppearance(hasBackdrop = true) {
  const [stored, setStored] = usePersistedState<Appearance>("appearance", DEFAULT_APPEARANCE);

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
    };
  }, [stored]);

  // What is already on the root, so a change only writes the properties that
  // actually moved. Dragging the transparency slider changes exactly one of
  // them, and rewriting the other fifteen with the values they already hold
  // would still dirty every element that inherits them - the whole editor -
  // once per frame.
  const applied = useRef<Record<string, string>>({});

  useEffect(() => {
    const root = document.documentElement;
    const variables = appearanceVariables(appearance, hasBackdrop);

    for (const [name, value] of Object.entries(variables)) {
      if (applied.current[name] === value) continue;
      root.style.setProperty(name, value);
      applied.current[name] = value;
    }
  }, [appearance, hasBackdrop]);

  const update = useCallback(
    (change: Partial<Appearance>) =>
      setStored((current) => ({ ...(current ?? DEFAULT_APPEARANCE), ...change })),
    [setStored]
  );

  const reset = useCallback(() => setStored(DEFAULT_APPEARANCE), [setStored]);

  return { appearance, update, reset };
}

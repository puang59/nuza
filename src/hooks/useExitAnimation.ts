import { useEffect, useState } from "react";

/** How long the `animate-*-out` classes in App.css run for. */
export const EXIT_DURATION = 140;

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Keeps a component on screen long enough to animate out. React unmounts the
 * moment a flag flips, which is why panels appear with an animation and then
 * vanish without one; this holds the mount open for the length of the exit and
 * reports when it is running so the right class can be applied.
 *
 * Reopening mid-exit cancels it, so a quick toggle does not leave a stale
 * panel behind.
 */
export function useExitAnimation(isOpen: boolean, duration = EXIT_DURATION) {
  const [isMounted, setIsMounted] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsMounted(true);
      setIsClosing(false);
      return;
    }

    if (!isMounted) return;

    setIsClosing(true);
    const timer = setTimeout(
      () => {
        setIsMounted(false);
        setIsClosing(false);
      },
      prefersReducedMotion() ? 0 : duration
    );

    return () => clearTimeout(timer);
  }, [isOpen, isMounted, duration]);

  return { isMounted, isClosing };
}

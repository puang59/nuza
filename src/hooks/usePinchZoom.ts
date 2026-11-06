import { useEffect, useRef } from "react";
import { createPinchAccumulator } from "@/lib/pinchZoom";

/** Safari's pinch event, which WebKit (macOS) sends in place of ctrl+wheel. */
interface GestureEvent extends UIEvent {
  scale: number;
}

/** A scale ratio is tiny next to a wheel delta; this puts it in the same range. */
const GESTURE_SCALE_FACTOR = 100;

/**
 * Pinching to zoom, the same as Ctrl+= and Ctrl+-.
 *
 * Chromium-based webviews (Windows, Linux) report a trackpad pinch as a wheel
 * event with ctrlKey set - which is also what Ctrl plus the mouse wheel is - and
 * WebKit (macOS) reports it as gesture events. Either way the webview would
 * otherwise zoom the whole page, so the default is cancelled and `zoomBy` gets
 * the number of steps instead: positive to zoom in, negative to zoom out.
 */
export function usePinchZoom(zoomBy: (steps: number) => void) {
  // Read through a ref so a new callback doesn't mean tearing the listeners
  // down - and losing the movement that has not yet made a step.
  const latest = useRef(zoomBy);
  useEffect(() => {
    latest.current = zoomBy;
  }, [zoomBy]);

  useEffect(() => {
    const accumulate = createPinchAccumulator();
    let lastScale = 1;

    const apply = (amount: number) => {
      const steps = accumulate(amount);
      if (steps !== 0) latest.current(steps);
    };

    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey) return;
      event.preventDefault();
      // Wheel up (negative) is zoom in, as it is in a browser.
      apply(-event.deltaY);
    }
    function onGestureStart(event: Event) {
      event.preventDefault();
      lastScale = 1;
    }
    function onGestureChange(event: Event) {
      event.preventDefault();
      const { scale } = event as GestureEvent;
      apply((scale - lastScale) * GESTURE_SCALE_FACTOR);
      lastScale = scale;
    }

    // Not passive: a passive listener may not cancel the page zoom.
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("gesturestart", onGestureStart);
    window.addEventListener("gesturechange", onGestureChange);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("gesturestart", onGestureStart);
      window.removeEventListener("gesturechange", onGestureChange);
    };
  }, []);
}

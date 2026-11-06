import { useCallback, useEffect, useRef, useState } from "react";
import { usePersistedState } from "./usePersistedState";

/**
 * As narrow as the sidebar goes: the width at which its four view names -
 * Files, Outline, Tags, Links - still read in full. Any narrower and they
 * were cut down to a letter and an ellipsis each.
 */
export const MIN_SIDEBAR_WIDTH = 224;
export const MAX_SIDEBAR_WIDTH = 480;
const DEFAULT_SIDEBAR_WIDTH = 240;

/** The AI panel: wide enough for a proposal card, never wider than the note deserves. */
export const MIN_AI_PANEL_WIDTH = 300;
export const MAX_AI_PANEL_WIDTH = 560;
const DEFAULT_AI_PANEL_WIDTH = 360;

/** How long a width has to hold still before it is written to storage. */
const PERSIST_DELAY_MS = 250;

interface PanelLimits {
  min: number;
  max: number;
  initial: number;
}

const SIDEBAR: PanelLimits = {
  min: MIN_SIDEBAR_WIDTH,
  max: MAX_SIDEBAR_WIDTH,
  initial: DEFAULT_SIDEBAR_WIDTH,
};
const AI_PANEL: PanelLimits = {
  min: MIN_AI_PANEL_WIDTH,
  max: MAX_AI_PANEL_WIDTH,
  initial: DEFAULT_AI_PANEL_WIDTH,
};

function clampTo(limits: PanelLimits, width: number) {
  if (!Number.isFinite(width)) return limits.initial;
  return Math.min(limits.max, Math.max(limits.min, Math.round(width)));
}

export function clampWidth(width: number) {
  return clampTo(SIDEBAR, width);
}

export function clampAiPanelWidth(width: number) {
  return clampTo(AI_PANEL, width);
}

/** Which edge of the window a panel is docked against. */
export type PanelSide = "left" | "right";

/** The edge across the note from `side`, where the other panel goes. */
export function oppositeSide(side: PanelSide): PanelSide {
  return side === "left" ? "right" : "left";
}

export function isPanelSide(value: unknown): value is PanelSide {
  return value === "left" || value === "right";
}

/**
 * How far a drag has widened a panel. A panel docked on the right grows as
 * the pointer moves left, one docked on the left as it moves right.
 */
export function widthAfterDrag(side: PanelSide, startWidth: number, startX: number, x: number) {
  return startWidth + (side === "right" ? startX - x : x - startX);
}

/**
 * Drag-to-resize for a docked panel, with the width persisted across
 * restarts under `storageKey`. Tracks the pointer by delta rather than
 * absolute position so the handle stays glued to the cursor regardless of
 * surrounding padding.
 */
function useResizablePanel(side: PanelSide, storageKey: string, limits: PanelLimits) {
  const [storedWidth, setWidth] = usePersistedState(storageKey, limits.initial, {
    // Every pointermove is a new width; storage only needs the one it stops on.
    debounceMs: PERSIST_DELAY_MS,
  });
  // Held to the limits on the way out of storage as well as while dragging: a
  // width kept by a build whose minimum was narrower would otherwise bring the
  // panel back too narrow for what is in it now.
  const width = clampTo(limits, storedWidth);
  const [isResizing, setIsResizing] = useState(false);
  const dragStart = useRef({ x: 0, width: limits.initial });

  const startResize = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      dragStart.current = { x: event.clientX, width };
      setIsResizing(true);
    },
    [width]
  );

  useEffect(() => {
    if (!isResizing) return;

    function onPointerMove(event: PointerEvent) {
      const { x, width } = dragStart.current;
      setWidth(clampTo(limits, widthAfterDrag(side, width, x, event.clientX)));
    }

    function stopResize() {
      setIsResizing(false);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
  }, [isResizing, setWidth, side, limits]);

  // Keep the resize cursor while dragging even when the pointer strays off the
  // handle, and stop the drag from selecting editor text on the way past.
  useEffect(() => {
    if (!isResizing) return;

    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
    };
  }, [isResizing]);

  /** Double-click the handle to snap back to the default width. */
  const resetWidth = useCallback(() => setWidth(limits.initial), [setWidth, limits]);

  return { width, isResizing, startResize, resetWidth };
}

/** The file sidebar, docked on `side` - the right unless Settings says otherwise. */
export function useResizableSidebar(side: PanelSide) {
  return useResizablePanel(side, "sidebarWidth", SIDEBAR);
}

/** The AI panel, docked on `side`: opposite the sidebar. */
export function useResizableAiPanel(side: PanelSide) {
  return useResizablePanel(side, "aiPanelWidth", AI_PANEL);
}

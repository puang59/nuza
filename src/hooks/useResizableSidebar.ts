import { useCallback, useEffect, useRef, useState } from "react";
import { usePersistedState } from "./usePersistedState";

export const MIN_SIDEBAR_WIDTH = 160;
export const MAX_SIDEBAR_WIDTH = 480;
/** Matches the sidebar's old fixed `w-48`, so existing users see no jump. */
const DEFAULT_SIDEBAR_WIDTH = 192;

function clampWidth(width: number) {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
}

/**
 * Drag-to-resize for the right-docked sidebar, with the width persisted
 * across restarts. Tracks the pointer by delta rather than absolute position
 * so the handle stays glued to the cursor regardless of surrounding padding.
 */
export function useResizableSidebar() {
  const [width, setWidth] = usePersistedState("sidebarWidth", DEFAULT_SIDEBAR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const dragStart = useRef({ x: 0, width: DEFAULT_SIDEBAR_WIDTH });

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
      // Docked on the right, so dragging left (a negative delta) widens it.
      const delta = dragStart.current.x - event.clientX;
      setWidth(clampWidth(dragStart.current.width + delta));
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
  }, [isResizing, setWidth]);

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
  const resetWidth = useCallback(() => setWidth(DEFAULT_SIDEBAR_WIDTH), [setWidth]);

  return { width, isResizing, startResize, resetWidth };
}

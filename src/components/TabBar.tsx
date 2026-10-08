import { memo, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

/** Width of the fade at each end of the strip when there's more to scroll to. */
const FADE_WIDTH = 28;

interface TabBarProps {
  paths: string[];
  activePath: string;
  dirtyPaths: ReadonlySet<string>;
  /** Open notes whose file has gone from disk; their names are struck through. */
  missingPaths: ReadonlySet<string>;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  /** Moves a tab so it sits before the tab at `before`; the strip's length is the end. */
  onReorder: (path: string, before: number) => void;
}

/**
 * The type a dragged tab is carried as. Its own, rather than text, so a tab
 * let go of over the note or the sidebar is nothing to them - neither writes
 * its path into the note nor tries to move a file.
 */
const TAB_TYPE = "application/x-nuza-tab";

function fileName(path: string) {
  return path.split(/[/\\]/).pop() || path;
}

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * The open-document strip in the title bar. Scrolls horizontally once the tabs
 * outgrow the space and masks itself at whichever end still has tabs hidden,
 * so they fade out rather than colliding with the window controls. A mask is
 * used rather than a gradient overlay because the title bar is transparent
 * over the window vibrancy - there's no solid colour to fade into.
 *
 * The strip is sized to its content rather than filling the bar, so whatever
 * space the tabs don't need stays draggable for moving the window.
 */
function TabBar({ paths, activePath, dirtyPaths, missingPaths, onSelect, onClose, onReorder }: TabBarProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ start: false, end: false });
  const [dragged, setDragged] = useState<string | null>(null);
  /** Where a dragged tab would land: before the tab at this index. */
  const [dropBefore, setDropBefore] = useState<number | null>(null);

  function endDrag() {
    setDragged(null);
    setDropBefore(null);
  }

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    function update() {
      const { scrollLeft, scrollWidth, clientWidth } = scroller!;
      setFade({
        start: scrollLeft > 1,
        end: scrollLeft + clientWidth < scrollWidth - 1,
      });
    }

    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [paths.length]);

  // Keep the active tab reachable when it's switched to from a keybind while
  // scrolled out of view.
  useEffect(() => {
    const active = scrollerRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({
      inline: "nearest",
      block: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [activePath]);

  if (paths.length === 0) return null;

  const mask = `linear-gradient(to right, transparent 0, #000 ${fade.start ? FADE_WIDTH : 0}px, #000 calc(100% - ${
    fade.end ? FADE_WIDTH : 0
  }px), transparent 100%)`;

  return (
    <div
      ref={scrollerRef}
      data-tauri-drag-region="false"
      role="tablist"
      aria-label="Open files"
      onWheel={(event) => {
        const scroller = scrollerRef.current;
        if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return;
        // Trackpads already scroll sideways; only translate vertical intent.
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        scroller.scrollLeft += event.deltaY;
      }}
      className="no-scrollbar flex min-w-0 shrink items-center gap-0.5 overflow-x-auto"
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    >
      {paths.map((path, index) => {
        const isActive = path === activePath;
        const isDirty = dirtyPaths.has(path);
        const isMissing = missingPaths.has(path);
        // The marker sits on the left edge of the tab it would land before,
        // or the right edge of the last tab for the end of the strip.
        const markerBefore = dragged !== null && dropBefore === index;
        const markerAfter = dragged !== null && dropBefore === paths.length && index === paths.length - 1;

        return (
          <div
            key={path}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            data-active={isActive}
            title={isMissing ? `${path}\nNo longer on disk` : path}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(TAB_TYPE, path);
              event.dataTransfer.effectAllowed = "move";
              setDragged(path);
            }}
            onDragEnd={endDrag}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes(TAB_TYPE)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              // Which half of the tab the pointer is over decides the side.
              const rect = event.currentTarget.getBoundingClientRect();
              setDropBefore(event.clientX < rect.left + rect.width / 2 ? index : index + 1);
            }}
            onDrop={(event) => {
              const moving = event.dataTransfer.getData(TAB_TYPE);
              if (!moving || dropBefore === null) return;
              event.preventDefault();
              onReorder(moving, dropBefore);
              endDrag();
            }}
            onClick={() => onSelect(path)}
            onAuxClick={(event) => {
              // Middle-click closes, as it does in a browser.
              if (event.button === 1) onClose(path);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(path);
              }
            }}
            className={`animate-fade-in group relative flex h-7 compact:h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded-md pl-2.5 pr-1 text-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-[var(--nuza-accent)] ${
              isActive ? "bg-zinc-800 text-white" : "text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300"
            } ${dragged === path ? "opacity-40" : ""}`}
          >
            {(markerBefore || markerAfter) && (
              <span
                className={`pointer-events-none absolute inset-y-1 w-[2px] rounded-full bg-[var(--nuza-accent)] ${
                  markerBefore ? "-left-[2px]" : "-right-[2px]"
                }`}
              />
            )}
            {/* Inset from the corners and positioned rather than set as a border,
                so the accent stays a straight line instead of bending around the
                pill's radius. */}
            {isActive && (
              <span className="pointer-events-none absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-[var(--nuza-accent)]" />
            )}

            <span className={`max-w-[140px] truncate ${isMissing ? "line-through opacity-70" : ""}`}>
              {fileName(path)}
            </span>

            {/* The dot marks unsaved edits and gives way to the close button on hover,
                so the tab never changes width between the two states. */}
            <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
              {isDirty && (
                <span className="pointer-events-none absolute h-[5px] w-[5px] rounded-full bg-current opacity-70 transition-opacity group-hover:opacity-0" />
              )}
              <button
                type="button"
                aria-label={`Close ${fileName(path)}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(path);
                }}
                className={`flex h-4 w-4 cursor-pointer items-center justify-center rounded-sm text-zinc-400 transition-colors hover:bg-white/10 hover:text-white group-hover:opacity-100 ${
                  // The active tab keeps its close button visible; the rest reveal
                  // one on hover, and a dirty dot holds the slot until then.
                  isActive && !isDirty ? "opacity-60" : "opacity-0"
                }`}
              >
                <X size={12} strokeWidth={2.25} />
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default memo(TabBar);

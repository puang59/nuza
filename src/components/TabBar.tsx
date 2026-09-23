import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

/** Width of the fade at each end of the strip when there's more to scroll to. */
const FADE_WIDTH = 28;

interface TabBarProps {
  paths: string[];
  activePath: string;
  dirtyPaths: Set<string>;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}

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
export default function TabBar({ paths, activePath, dirtyPaths, onSelect, onClose }: TabBarProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ start: false, end: false });

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
      className="no-scrollbar flex min-w-0 shrink items-center gap-1 overflow-x-auto"
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    >
      {paths.map((path) => {
        const isActive = path === activePath;
        const isDirty = dirtyPaths.has(path);

        return (
          <div
            key={path}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            data-active={isActive}
            title={path}
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
            className={`animate-fade-in group flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border-b-2 pl-2.5 pr-1.5 text-xs transition-colors outline-none focus-visible:ring-1 focus-visible:ring-[#FF9696] ${
              isActive
                ? "border-[#FF9696] bg-zinc-800/80 text-white"
                : "border-transparent text-gray-400 hover:bg-zinc-800/40 hover:text-gray-200"
            }`}
          >
            <span className="max-w-[140px] truncate">{fileName(path)}</span>

            {/* The dot marks unsaved edits and gives way to the close button on hover,
                so the tab never changes width between the two states. */}
            <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
              {isDirty && (
                <span className="absolute h-1.5 w-1.5 rounded-full bg-current opacity-80 transition-opacity group-hover:opacity-0" />
              )}
              <button
                type="button"
                aria-label={`Close ${fileName(path)}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(path);
                }}
                className={`flex h-4 w-4 cursor-pointer items-center justify-center rounded transition-all hover:bg-zinc-600/60 hover:text-white ${
                  isDirty ? "opacity-0 group-hover:opacity-100" : "opacity-0 group-hover:opacity-80"
                } ${isActive ? "opacity-60" : ""}`}
              >
                <X size={11} />
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

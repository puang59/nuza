import { CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "cn";
import { DEFAULT_EDITOR_FONT, editorFontFamily } from "@/lib/fonts";

/** What the empty "no preference" value is called in the list. */
const DEFAULT_LABEL = "Default";

/** Tallest the list gets before it scrolls, and how close to an edge it may sit. */
const MAX_LIST_HEIGHT = 260;
const EDGE_GAP = 8;

interface FontPickerProps {
  fonts: string[];
  value: string;
  onChange: (font: string) => void;
}

function labelFor(font: string) {
  return font || DEFAULT_LABEL;
}

/**
 * The font list runs to hundreds of entries on most machines, which a native
 * `<select>` turns into an unsearchable column of identical-looking names in
 * the OS's own colours. This one filters as you type and sets every row in the
 * font it names, so you pick by how the font looks rather than by remembering
 * what it is called.
 */
export default function FontPicker({ fonts, value, onChange }: FontPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [placement, setPlacement] = useState<CSSProperties | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const options = useMemo(() => {
    // A font saved before it was uninstalled stays selectable, so opening the
    // picker never silently changes what the editor is already using.
    const all = [
      DEFAULT_EDITOR_FONT,
      ...(value && !fonts.includes(value) ? [value] : []),
      ...fonts,
    ];
    const needle = query.trim().toLowerCase();
    return needle ? all.filter((font) => labelFor(font).toLowerCase().includes(needle)) : all;
  }, [fonts, value, query]);

  // Anchor the popup to the trigger. It is portalled to the body because the
  // settings panel scrolls and would otherwise clip it.
  useLayoutEffect(() => {
    if (!isOpen) return;

    function place() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const roomBelow = window.innerHeight - rect.bottom - EDGE_GAP;
      const roomAbove = rect.top - EDGE_GAP;
      const openUpwards = roomBelow < 180 && roomAbove > roomBelow;
      const width = Math.max(rect.width, 220);

      // Aligned to the trigger's right edge, which is the edge it shares with
      // the settings panel - growing leftwards keeps a popup wider than the
      // trigger inside the dialog instead of hanging off it.
      setPlacement({
        position: "fixed",
        left: Math.max(EDGE_GAP, Math.min(rect.right - width, window.innerWidth - width - EDGE_GAP)),
        width,
        maxHeight: Math.min(MAX_LIST_HEIGHT, openUpwards ? roomAbove : roomBelow),
        ...(openUpwards
          ? { bottom: window.innerHeight - rect.top + 4 }
          : { top: rect.bottom + 4 }),
      });
    }

    place();
    // Captured, because the settings pane scrolls, not the window. Following
    // the trigger rather than closing keeps the popup put while focus and
    // arrow keys scroll things around underneath it.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [isOpen]);

  // Anything outside the popup and its trigger closes it. This has to be a
  // native listener: the popup is portalled, so React would still route its
  // events through the settings dialog above it.
  useEffect(() => {
    if (!isOpen) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (popupRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setIsOpen(false);
    }

    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    listRef.current?.children[highlighted]?.scrollIntoView({ block: "nearest" });
  }, [isOpen, highlighted]);

  function open() {
    setQuery("");
    setHighlighted(Math.max(options.indexOf(value), 0));
    setIsOpen(true);
  }

  function choose(font: string) {
    onChange(font);
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape" || event.key === "Tab") {
      // Escape belongs to the picker while it is open - without this it would
      // carry on up to the settings dialog and close that instead.
      if (event.key === "Escape") event.stopPropagation();
      setIsOpen(false);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlighted((index) => Math.min(Math.max(index + step, 0), options.length - 1));
      return;
    }

    if (event.key === "Enter" && options[highlighted] !== undefined) {
      event.preventDefault();
      choose(options[highlighted]);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Editor font"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => (isOpen ? setIsOpen(false) : open())}
        className={cn(
          "flex w-40 cursor-pointer items-center justify-between gap-2 rounded-md border bg-zinc-800 px-2 py-1 text-xs text-white outline-none transition-colors",
          isOpen ? "border-[#FF9696]" : "border-zinc-700 hover:border-zinc-600"
        )}
      >
        <span className="truncate" style={{ fontFamily: editorFontFamily(value) }}>
          {labelFor(value)}
        </span>
        <ChevronDown
          size={12}
          className={cn("shrink-0 text-gray-400 transition-transform", isOpen && "rotate-180")}
        />
      </button>

      {isOpen &&
        placement &&
        createPortal(
          <div
            ref={popupRef}
            style={placement}
            onKeyDown={onKeyDown}
            className="animate-menu-in z-60 flex flex-col overflow-hidden rounded-md border border-zinc-700 bg-[#1E1E1E] shadow-xl"
          >
            <div className="flex items-center gap-2 border-b border-zinc-800 px-2 py-1.5">
              <Search size={12} className="shrink-0 text-gray-500" />
              <input
                autoFocus
                value={query}
                placeholder="Search fonts"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setHighlighted(0);
                }}
                className="w-full bg-transparent text-xs text-white outline-none placeholder:text-gray-600"
              />
            </div>

            <div ref={listRef} role="listbox" className="min-h-0 flex-1 overflow-y-auto py-1">
              {options.map((font, index) => (
                <button
                  key={font || "__default"}
                  type="button"
                  role="option"
                  aria-selected={font === value}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => choose(font)}
                  className={cn(
                    "flex w-full cursor-pointer items-center justify-between gap-2 px-2 py-1 text-left text-xs",
                    index === highlighted ? "bg-zinc-800 text-white" : "text-gray-300"
                  )}
                >
                  <span className="truncate" style={{ fontFamily: editorFontFamily(font) }}>
                    {labelFor(font)}
                  </span>
                  {font === value && <Check size={12} className="shrink-0 text-[#FF9696]" />}
                </button>
              ))}

              {options.length === 0 && (
                <p className="px-2 py-3 text-center text-xs text-gray-500">No fonts match.</p>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

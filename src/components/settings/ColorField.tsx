import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { hexToHsv, hsvToHex, normalizeHex, type Hsv } from "@/lib/color";

interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

const PRESETS = [
  "#ff9696",
  "#ff6b6b",
  "#ffa94d",
  "#ffd43b",
  "#96ff96",
  "#38d9a9",
  "#66d9e8",
  "#74c0fc",
  "#91a7ff",
  "#b197fc",
  "#f783ac",
  "#ffffff",
  "#adb5bd",
  "#495057",
  "#1e1e2e",
  "#000000",
];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Drags inside an element, reporting where the pointer is as 0-1 on each axis. */
function useDrag(onMove: (x: number, y: number) => void) {
  const dragging = useRef(false);

  function at(event: PointerEvent<HTMLElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    onMove(clamp01((event.clientX - box.left) / box.width), clamp01((event.clientY - box.top) / box.height));
  }

  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      dragging.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      at(event);
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      if (dragging.current) at(event);
    },
    onPointerUp() {
      dragging.current = false;
    },
  };
}

/**
 * A swatch that opens a colour picker, next to the hex it stands for. The
 * picker is a saturation/brightness square and a hue strip, with a row of
 * presets and the hex to type into. Typing is only committed once it reads as
 * a colour, so a half-typed `#ff9` does not repaint the window on its way to
 * `#ff9696`.
 */
export default function ColorField({ label, value, onChange }: ColorFieldProps) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  const [open, setOpen] = useState(false);
  // Hue and saturation are lost in grey and black, so the picker keeps its own
  // and only takes the value's when it is a different colour to what it made.
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const root = useRef<HTMLDivElement>(null);

  if (seen !== value) {
    setSeen(value);
    setText(value);
    if (hsvToHex(hsv) !== value.toLowerCase()) setHsv(hexToHsv(value));
  }

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  function pick(next: Hsv) {
    setHsv(next);
    onChange(hsvToHex(next));
  }

  function commit(next: string) {
    const hex = normalizeHex(next);
    if (hex) onChange(hex);
    else setText(value);
  }

  const square = useDrag((x, y) => pick({ ...hsv, s: x, v: 1 - y }));
  const strip = useDrag((x) => pick({ ...hsv, h: x * 360 }));

  /** Arrow keys move a slider by 1%, or 10% with Shift; `apply` turns that into the next colour. */
  function nudge(event: KeyboardEvent, apply: (delta: number) => Hsv) {
    const direction = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
    if (!direction) return;
    event.preventDefault();
    pick(apply(direction * (event.shiftKey ? 0.1 : 0.01)));
  }

  return (
    <div ref={root} className="relative flex w-40 items-center gap-2">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        style={{ backgroundColor: value }}
        className="h-6 w-8 shrink-0 cursor-pointer rounded border border-zinc-600 transition-colors hover:border-[var(--nuza-accent)]"
      />
      <input
        aria-label={`${label} hex value`}
        value={text}
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => commit(text)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setText(value);
        }}
        className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 font-mono text-xs text-white outline-none focus-visible:border-[var(--nuza-accent)]"
      />

      {open && (
        <div
          role="dialog"
          aria-label={`${label} picker`}
          className="absolute right-0 top-full z-50 mt-2 w-52 rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl"
        >
          <div
            {...square}
            role="slider"
            tabIndex={0}
            aria-label={`${label} saturation and brightness`}
            aria-valuetext={`saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
            aria-valuenow={Math.round(hsv.s * 100)}
            onKeyDown={(event) =>
              nudge(event, (delta) =>
                event.key === "ArrowUp" || event.key === "ArrowDown"
                  ? { ...hsv, v: clamp01(hsv.v + delta) }
                  : { ...hsv, s: clamp01(hsv.s + delta) }
              )
            }
            style={{
              backgroundColor: hsvToHex({ h: hsv.h, s: 1, v: 1 }),
              backgroundImage:
                "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)",
            }}
            className="relative h-32 w-full cursor-crosshair touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--nuza-accent)]"
          >
            <span
              style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: value }}
              className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
            />
          </div>

          <div
            {...strip}
            role="slider"
            tabIndex={0}
            aria-label={`${label} hue`}
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hsv.h)}
            onKeyDown={(event) => nudge(event, (delta) => ({ ...hsv, h: (hsv.h + delta * 360 + 360) % 360 }))}
            style={{
              backgroundImage: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
            }}
            className="relative mt-3 h-3 w-full cursor-pointer touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--nuza-accent)]"
          >
            <span
              style={{ left: `${(hsv.h / 360) * 100}%`, backgroundColor: hsvToHex({ h: hsv.h, s: 1, v: 1 }) }}
              className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
            />
          </div>

          <div className="mt-3 grid grid-cols-8 gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-label={preset}
                title={preset}
                onClick={() => onChange(preset)}
                style={{ backgroundColor: preset }}
                className={`h-4 w-4 cursor-pointer rounded-sm border transition-transform hover:scale-125 ${
                  preset === value.toLowerCase() ? "border-white" : "border-zinc-600"
                }`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

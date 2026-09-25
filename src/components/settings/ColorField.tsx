import { useEffect, useState } from "react";
import { isHexColor } from "@/lib/appearance";

interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

/**
 * A swatch that opens the system colour picker, next to the hex it stands for.
 * Typing is only committed once it reads as a colour, so a half-typed `#ff9`
 * does not repaint the window on its way to `#ff9696`.
 */
export default function ColorField({ label, value, onChange }: ColorFieldProps) {
  const [text, setText] = useState(value);

  useEffect(() => setText(value), [value]);

  function commit(next: string) {
    const candidate = next.trim().startsWith("#") ? next.trim() : `#${next.trim()}`;
    if (isHexColor(candidate)) onChange(candidate.toLowerCase());
    else setText(value);
  }

  return (
    <div className="flex w-40 items-center gap-2">
      <input
        type="color"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-6 w-8 shrink-0 cursor-pointer rounded border border-zinc-700 bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-none"
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
    </div>
  );
}

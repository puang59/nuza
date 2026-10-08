import { useEffect, useRef } from "react";
import { Heading } from "@/lib/markdown/headings";
import FooterSection from "./FooterSection";

interface OutlineProps {
  headings: Heading[];
  /** Index of the section at the top of the editor, or -1 above the first heading. */
  active: number;
  isOpen: boolean;
  onToggle: () => void;
  /** Goes to the heading whose line starts at `from`. */
  onJump: (from: number) => void;
}

/**
 * The open note's headings, under the tree: the shape of a long note at a
 * glance, and a way to any part of it. Each row is set in by its level, and
 * the section the editor is showing is marked and kept in sight as the note
 * scrolls.
 */
export default function Outline({ headings, active, isOpen, onToggle, onJump }: OutlineProps) {
  const activeRow = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) activeRow.current?.scrollIntoView({ block: "nearest" });
  }, [active, isOpen]);

  // Set in from the shallowest level the note uses, so one that starts at
  // `##` does not have every row pushed in by a level nobody wrote.
  const top = headings.reduce((least, heading) => Math.min(least, heading.level), 6);

  return (
    <FooterSection title="Outline" count={headings.length} isOpen={isOpen} onToggle={onToggle}>
      {headings.length === 0 ? (
        <p className="px-2 py-1 text-xs text-zinc-600">No headings in this note.</p>
      ) : (
        <ul>
          {headings.map((heading, index) => {
            const isActive = index === active;
            return (
              <li key={`${heading.from}:${heading.text}`}>
                <button
                  ref={isActive ? activeRow : undefined}
                  type="button"
                  onClick={() => onJump(heading.from)}
                  title={heading.text}
                  aria-current={isActive ? "location" : undefined}
                  style={{ paddingLeft: `${0.5 + (heading.level - top) * 0.75}rem` }}
                  className={`flex w-full cursor-pointer items-center rounded-md py-1 pr-2 text-left text-xs transition-colors hover:bg-zinc-800/50 compact:py-0.5 ${
                    isActive ? "text-[var(--nuza-accent)]" : "text-zinc-400"
                  }`}
                >
                  <span className="truncate">{heading.text}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </FooterSection>
  );
}

import { useState } from "react";
import { TagIndex, firstUseInEachNote } from "@/lib/tagIndex";
import { fileNameOf } from "@/lib/media";
import { FileIcon } from "@/lib/utils";

interface TagsProps {
  index: TagIndex;
  onOpen: (path: string, line: number) => void;
}

/**
 * Every `#tag` in the vault: each a row with the number of notes it is in,
 * and choosing one lists those notes - each opening at the line the tag is on.
 *
 * The tags are not read at all until this is the view being shown: it means
 * reading every note in the vault, which is not worth doing for a list nobody
 * is looking at.
 */
export default function Tags({ index, onOpen }: TagsProps) {
  // The tag whose notes are showing, by name - one at a time keeps the list short.
  const [chosen, setChosen] = useState<string | null>(null);

  return (
    <>
      {index.tags.length === 0 ? (
        <p className="px-2 py-1 text-xs text-zinc-600">No tags yet. Write #something in a note.</p>
      ) : (
        <ul>
          {index.tags.map((tag) => {
            const open = chosen === tag.name;
            return (
              <li key={tag.name}>
                <button
                  type="button"
                  onClick={() => setChosen(open ? null : tag.name)}
                  aria-expanded={open}
                  className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-zinc-400 transition-colors hover:bg-zinc-800/50 hover:text-zinc-200 compact:py-0.5"
                >
                  <span className="truncate">
                    <span className="text-[var(--nuza-accent)]">#</span>
                    {tag.name}
                  </span>
                  <span className="ml-auto shrink-0 pl-2 text-[10px] tabular-nums text-zinc-600">
                    {tag.notes}
                  </span>
                </button>

                {open && (
                  <ul className="animate-fade-in ml-3.5 border-l border-zinc-800 pl-1 pb-0.5">
                    {firstUseInEachNote(tag).map((use) => (
                      <li key={use.from}>
                        <button
                          type="button"
                          onClick={() => onOpen(use.from, use.line)}
                          title={`${use.from}:${use.line}`}
                          className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-0.5 text-left text-xs text-zinc-500 transition-colors hover:bg-zinc-800/50 hover:text-zinc-200"
                        >
                          <FileIcon name={fileNameOf(use.from)} />
                          <span className="truncate">{fileNameOf(use.from)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

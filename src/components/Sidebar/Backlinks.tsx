import { WikiLinkRef } from "@/lib/markdown/wikiLinks";
import { fileNameOf } from "@/lib/media";
import { FileIcon } from "@/lib/utils";

interface BacklinksProps {
  links: WikiLinkRef[];
  onOpen: (path: string, line: number) => void;
}

/**
 * The notes that link to the open one: each link a row naming the note it is
 * in and showing the line it is on, and choosing it opens that note at that
 * line.
 */
export default function Backlinks({ links, onOpen }: BacklinksProps) {
  return (
    <>
      {links.length === 0 ? (
        <p className="px-2 py-1 text-xs text-zinc-600">No notes link here.</p>
      ) : (
        <ul>
          {links.map((link) => (
            <li key={`${link.from}:${link.line}:${link.target}`}>
              <button
                type="button"
                onClick={() => onOpen(link.from, link.line)}
                title={`${link.from}:${link.line}`}
                className="flex w-full cursor-pointer flex-col rounded-md px-2 py-1 text-left transition-colors hover:bg-zinc-800/50 compact:py-0.5"
              >
                <span className="flex w-full min-w-0 items-center gap-1.5 text-xs text-zinc-300">
                  <FileIcon name={fileNameOf(link.from)} />
                  <span className="truncate">{fileNameOf(link.from)}</span>
                  <span className="ml-auto shrink-0 pl-2 text-[10px] tabular-nums text-zinc-600">
                    {link.line}
                  </span>
                </span>
                <span className="w-full truncate pl-5 text-[11px] leading-snug text-zinc-500">
                  {link.preview}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

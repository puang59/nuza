import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { FileText, MessageSquare, Plus, Search, Trash2 } from "lucide-react";
import { cn } from "cn";
import { THREAD_DAYS, type Thread } from "@/lib/ai/memory";
import { agoFor, dayFor } from "@/lib/ai/time";

interface ThreadListProps {
  threads: Thread[];
  current: string;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  /** Starts a new chat, when there is one to leave. */
  onNew?: () => void;
}

/** With more chats than this, a field to look for one. */
const SEARCH_FROM = 6;

/** The note a thread was about, if it was about one. */
function noteOf(thread: Thread): string | null {
  return thread.turns.find((turn) => turn.about)?.about?.title ?? null;
}

/** The title without the note's name on the end, since the note has a line of its own. */
function shortTitle(thread: Thread, note: string | null): string {
  const suffix = note ? ` · ${note}` : "";
  return suffix && thread.title.endsWith(suffix) ? thread.title.slice(0, -suffix.length) : thread.title;
}

/** The vault's threads, newest first, to go back to one or let one go. */
export default function ThreadList({ threads, current, onOpen, onDelete, onClose, onNew }: ThreadListProps) {
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  /** The thread whose delete button has been pressed once, waiting for a second press. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const searchable = threads.length >= SEARCH_FROM;
  /** The list is made afresh each time it opens, so when it opened will do for "today". */
  const [now] = useState(Date.now);

  useEffect(() => {
    const root = list.current;
    if (!root) return;
    const first =
      root.querySelector<HTMLElement>("input") ??
      root.querySelector<HTMLElement>("button[data-current]") ??
      root.querySelector<HTMLElement>("button[data-thread]");
    first?.focus();
  }, []);

  const groups = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    const byDay = new Map<string, Thread[]>();
    for (const thread of threads) {
      const note = noteOf(thread);
      if (wanted && !`${thread.title} ${note ?? ""}`.toLowerCase().includes(wanted)) continue;
      const day = dayFor(thread.updatedAt, now);
      byDay.set(day, [...(byDay.get(day) ?? []), thread]);
    }
    return [...byDay];
  }, [threads, query, now]);

  /** Up and down move between the chats, the way a menu does. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (confirming) setConfirming(null);
      else onClose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = [...(list.current?.querySelectorAll<HTMLElement>("input, button[data-row]") ?? [])];
    if (rows.length === 0) return;
    event.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    rows[(at + step + rows.length) % rows.length]?.focus();
  };

  return (
    <>
      <div aria-hidden className="absolute inset-x-0 top-9 bottom-0 z-10 bg-black/25" onClick={onClose} />
      <div
        ref={list}
        role="dialog"
        aria-label="Chats"
        onKeyDown={onKeyDown}
        className="animate-menu-in absolute inset-x-2 top-10 z-20 flex max-h-[min(70%,26rem)] flex-col overflow-hidden rounded-lg border border-zinc-700/80 bg-[var(--nuza-bg)] shadow-2xl shadow-black/40"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-2.5 pb-1.5">
          <h3 className="text-xs font-medium text-gray-300">
            Chats
            {threads.length > 0 && (
              <span className="ml-1.5 text-gray-600 tabular-nums">{threads.length}</span>
            )}
          </h3>
          {onNew && (
            <button
              type="button"
              data-row
              onClick={onNew}
              className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-gray-400 hover:bg-zinc-800 hover:text-white focus:bg-zinc-800 focus:text-white focus:outline-none"
            >
              <Plus size={12} />
              New chat
            </button>
          )}
        </div>

        {searchable && (
          <label className="mx-2 mb-1 flex shrink-0 items-center gap-2 rounded-md border border-zinc-800 bg-[var(--nuza-surface)] px-2 py-1 focus-within:border-zinc-600">
            <Search size={12} className="shrink-0 text-gray-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search chats"
              aria-label="Search chats"
              className="min-w-0 flex-1 bg-transparent text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none"
            />
          </label>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
          {threads.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-3 py-6 text-center">
              <MessageSquare size={16} className="text-gray-600" />
              <p className="text-xs text-gray-500">No earlier chats in this folder.</p>
            </div>
          ) : groups.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-gray-500">No chat matches “{query.trim()}”.</p>
          ) : (
            groups.map(([day, inDay]) => (
              <section key={day} aria-label={day}>
                <h4 className="px-2 pt-2 pb-1 text-[10px] font-medium tracking-wide text-gray-600 uppercase">
                  {day}
                </h4>
                <ul>
                  {inDay.map((thread) => {
                    const note = noteOf(thread);
                    const isCurrent = thread.id === current;
                    const messages = thread.turns.length;
                    const asking = confirming === thread.id;
                    return (
                      <li key={thread.id} className="group relative">
                        <button
                          type="button"
                          data-row
                          data-thread
                          data-current={isCurrent || undefined}
                          aria-current={isCurrent || undefined}
                          onClick={() => onOpen(thread.id)}
                          className={cn(
                            "flex w-full cursor-pointer items-start gap-2 rounded-lg py-1.5 pr-2 pl-2 text-left hover:bg-zinc-800/70 focus:bg-zinc-800/70 focus:outline-none",
                            isCurrent && "bg-[var(--nuza-accent-faint)]"
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              "mt-[7px] size-1.5 shrink-0 rounded-full",
                              isCurrent ? "bg-[var(--nuza-accent)]" : "bg-transparent"
                            )}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-2">
                              <span
                                className={cn(
                                  "truncate text-[13px]",
                                  isCurrent ? "text-[var(--nuza-accent)]" : "text-gray-200"
                                )}
                              >
                                {shortTitle(thread, note)}
                              </span>
                              <span
                                className={cn(
                                  "ml-auto shrink-0 text-[11px] text-gray-500 tabular-nums group-focus-within:invisible group-hover:invisible",
                                  asking && "invisible"
                                )}
                              >
                                {agoFor(thread.updatedAt)}
                              </span>
                            </span>
                            <span className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-500">
                              {note && (
                                <>
                                  <FileText size={10} className="shrink-0" />
                                  <span className="truncate">{note}</span>
                                  <span aria-hidden>·</span>
                                </>
                              )}
                              <span className="shrink-0">
                                {messages === 1 ? "1 message" : `${messages} messages`}
                              </span>
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (asking) {
                              setConfirming(null);
                              onDelete(thread.id);
                            } else {
                              setConfirming(thread.id);
                            }
                          }}
                          onBlur={() => setConfirming((was) => (was === thread.id ? null : was))}
                          title={asking ? "Press again to delete" : "Delete this chat"}
                          aria-label={
                            asking ? `Confirm deleting “${thread.title}”` : `Delete “${thread.title}”`
                          }
                          className={cn(
                            "absolute top-1 right-1.5 cursor-pointer rounded-md text-gray-500 focus:opacity-100 focus:outline-none group-hover:opacity-100",
                            asking
                              ? "bg-red-500/15 px-1.5 py-0.5 text-[11px] text-red-400 opacity-100"
                              : "p-1 opacity-0 hover:bg-zinc-700/60 hover:text-white focus:bg-zinc-700/60"
                          )}
                        >
                          {asking ? "Delete" : <Trash2 size={12} />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>

        <p className="shrink-0 border-t border-zinc-800 px-3 py-1.5 text-[11px] text-gray-600">
          Saved on this computer only. Chats untouched for {THREAD_DAYS} days are deleted.
        </p>
      </div>
    </>
  );
}

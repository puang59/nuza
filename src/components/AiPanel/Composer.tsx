import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArrowUp, ChevronUp, Plus, Square } from "lucide-react";
import { cn } from "cn";
import { canRun, matchActions, type WritingAction } from "@/lib/ai/actions";
import type { Intent } from "@/lib/ai/prompt";
import type { ModelInfo } from "@/lib/ai/protocol";

export interface ComposerHandle {
  focus: () => void;
}

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** Sends what was typed - a question, or a `/command`. */
  onSend: (text: string) => void;
  onStop: () => void;
  /** Runs an action picked from the menu. */
  onAction: (action: WritingAction, rest: string) => void;
  onEscape: () => void;
  onFocus: () => void;
  running: boolean;
  intent: Intent;
  /** What there is to act on, for which actions the menu offers. */
  selected: boolean;
  onWord: boolean;
  models: ModelInfo[];
  model: string | null;
  onModel: (model: string | null) => void;
  /** How much of the agent's context window is in use. */
  used: number | null;
}

/** `/` and what follows it, while it is still a command being typed. */
function commandQuery(value: string): string | null {
  const match = /^\/(\S*)$/.exec(value);
  return match ? match[1] : null;
}

/**
 * Where a question is written: one rounded box, with the writing actions a
 * `/` away (or behind the `+`), the model to answer with, and send.
 */
const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  {
    value,
    onChange,
    onSend,
    onStop,
    onAction,
    onEscape,
    onFocus,
    running,
    intent,
    selected,
    onWord,
    models,
    model,
    onModel,
    used,
  },
  ref
) {
  const box = useRef<HTMLTextAreaElement>(null);
  const [highlight, setHighlight] = useState(0);
  useImperativeHandle(ref, () => ({ focus: () => box.current?.focus() }), []);

  const query = commandQuery(value);
  // What can run now comes first, and only that is reached with the keyboard.
  const matched = query === null ? [] : matchActions(query);
  const usable = matched.filter((action) => canRun(action, selected, onWord));
  const menu = [...usable, ...matched.filter((action) => !usable.includes(action))];
  const open = menu.length > 0;
  const at = usable.length ? highlight % usable.length : -1;

  // The box grows with what is typed, up to a point.
  useEffect(() => {
    const area = box.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, 160)}px`;
  }, [value]);

  const pick = (action: WritingAction) => {
    if (!canRun(action, selected, onWord)) return;
    // Remembering needs words; everything else runs as it is.
    if (action.id === "remember") onChange("/remember ");
    else onAction(action, "");
    box.current?.focus();
  };

  const onKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        if (usable.length) setHighlight((now) => (now + step + usable.length) % usable.length);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        if (at >= 0) onChange(`/${usable[at].command} `);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (at >= 0) pick(usable[at]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onChange("");
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSend(value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onEscape();
    }
  };

  return (
    <div className="relative">
      {open && (
        <ul
          role="listbox"
          aria-label="Writing actions"
          className="animate-ai-in absolute inset-x-0 bottom-full mb-1.5 overflow-hidden rounded-lg border border-zinc-700 bg-[var(--nuza-bg)] py-1 shadow-xl"
        >
          {menu.map((action, index) => {
            const runs = index < usable.length;
            return (
              <li key={action.id} role="option" aria-selected={index === at}>
                <button
                  type="button"
                  disabled={!runs}
                  onMouseEnter={() => runs && setHighlight(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pick(action);
                  }}
                  className={cn(
                    "flex w-full cursor-pointer items-baseline gap-2 px-3 py-1.5 text-left disabled:cursor-default disabled:opacity-40",
                    index === at && "bg-zinc-800/80"
                  )}
                >
                  <span className="shrink-0 text-[13px] text-gray-200">{action.label}</span>
                  <span className="truncate text-[11px] text-gray-500">
                    {runs
                      ? action.hint
                      : action.needs === "word"
                        ? "Put the caret on a word"
                        : "Select some text first"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="rounded-lg border border-zinc-700/80 bg-zinc-900/70 transition-colors focus-within:border-zinc-600">
        <textarea
          ref={box}
          value={value}
          rows={2}
          onChange={(event) => {
            onChange(event.target.value);
            setHighlight(0);
          }}
          onKeyDown={onKey}
          onFocus={onFocus}
          placeholder={intent === "edit" ? "Describe the change…" : "Ask anything, / for actions"}
          aria-label={intent === "edit" ? "The change you want" : "Your question"}
          className="block w-full resize-none bg-transparent px-3 pt-2.5 text-[13px] text-white outline-none placeholder:text-gray-600"
        />
        <div className="flex items-center gap-1.5 px-2 pb-2">
          <button
            type="button"
            title="Writing actions"
            aria-label="Writing actions"
            onClick={() => {
              onChange("/");
              box.current?.focus();
            }}
            className="flex size-6 cursor-pointer items-center justify-center rounded-md text-gray-500 hover:bg-zinc-800 hover:text-gray-200"
          >
            <Plus size={14} />
          </button>
          {models.length > 0 && (
            // The name and its arrow as text, with the real menu laid over
            // them unseen: a menu is as wide as its longest model, and its
            // arrow would sit far from the name.
            <label className="relative flex min-w-0 cursor-pointer items-center gap-0.5 text-xs text-gray-500 hover:text-gray-300">
              <span className="truncate">
                {models.find((offered) => offered.id === model)?.name ?? "Default model"}
              </span>
              <ChevronUp size={12} className="shrink-0" aria-hidden />
              <select
                value={model ?? ""}
                onChange={(event) => onModel(event.target.value || null)}
                aria-label="Model"
                className="absolute inset-0 cursor-pointer opacity-0"
              >
                {models.map((offered) => (
                  <option key={offered.id} value={offered.id}>
                    {offered.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className="flex-1" />
          {used !== null && (
            <span
              className="cursor-default text-[11px] text-gray-600"
              title={`This conversation fills ${used}% of what the agent can keep in mind at once - your notes, the questions and its answers. Near 100% it starts losing the earliest parts; a new chat starts it fresh.`}
            >
              {used}% context
            </span>
          )}
          <button
            type="button"
            onClick={running ? onStop : () => onSend(value)}
            disabled={!running && !value.trim()}
            title={running ? "Stop" : "Send"}
            aria-label={running ? "Stop the answer" : "Send"}
            className={cn(
              "flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors disabled:cursor-default disabled:bg-zinc-800 disabled:text-gray-600",
              running
                ? "bg-zinc-700 text-white hover:bg-zinc-600"
                : "bg-[var(--nuza-accent)] text-black hover:bg-[var(--nuza-accent-strong)]"
            )}
          >
            {running ? <Square size={10} fill="currentColor" /> : <ArrowUp size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
});

export default Composer;

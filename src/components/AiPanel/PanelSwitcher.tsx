export type PanelView = "chat" | "files";

interface PanelSwitcherProps {
  view: PanelView;
  onChange: (view: PanelView) => void;
  /** How many notes are picked for the context, shown beside Files. */
  picked: number;
}

/**
 * The conversation, or the vault's notes to pick from for its context - in
 * the sidebar's own switcher: one box, and a highlight that slides between
 * the two halves of it.
 */
export default function PanelSwitcher({ view, onChange, picked }: PanelSwitcherProps) {
  const views: { id: PanelView; label: string; title: string }[] = [
    { id: "chat", label: "Chat", title: "The conversation" },
    { id: "files", label: "Files", title: "Notes to include with your questions" },
  ];
  return (
    <div
      role="tablist"
      aria-label="AI panel view"
      className="relative grid grid-cols-2 rounded-md bg-zinc-800/30 p-[3px]"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-[3px] left-[3px] w-[calc((100%-6px)/2)] rounded bg-zinc-700/30 transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{ transform: `translateX(${view === "files" ? 100 : 0}%)` }}
      />
      {views.map(({ id, label, title }) => {
        const selected = id === view;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            title={title}
            onClick={() => onChange(id)}
            className={`relative flex cursor-pointer items-center justify-center gap-1.5 rounded py-0.5 text-[11px] leading-4 font-medium transition-colors duration-200 ${
              selected ? "text-zinc-200" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {label}
            {id === "files" && picked > 0 && (
              <span className="animate-ai-in rounded bg-zinc-700/60 px-1 text-[10px] leading-4 text-zinc-300 tabular-nums">
                {picked}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

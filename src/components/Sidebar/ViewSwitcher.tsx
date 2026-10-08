export type SidebarView = "files" | "outline" | "tags" | "links";

const VIEWS: { id: SidebarView; label: string; title: string }[] = [
  { id: "files", label: "Files", title: "The vault's files" },
  { id: "outline", label: "Outline", title: "The open note's headings" },
  { id: "tags", label: "Tags", title: "Every tag in the vault" },
  { id: "links", label: "Links", title: "Notes that link to the open one" },
];

/** A stored value read back as a view, or the files if it is not one. */
export function readView(stored: unknown): SidebarView {
  return VIEWS.some((view) => view.id === stored) ? (stored as SidebarView) : "files";
}

interface ViewSwitcherProps {
  view: SidebarView;
  onChange: (view: SidebarView) => void;
}

/**
 * What the sidebar is showing: the files, or one of the three other ways of
 * looking at the vault and the note that is open.
 *
 * Those three used to be folded sections stacked under the tree, each a few
 * rows tall at most, and between them they crowded the foot of the sidebar
 * whether or not any was in use. Here each has the whole panel when it is
 * asked for, and takes none of it when it is not.
 */
export default function ViewSwitcher({ view, onChange }: ViewSwitcherProps) {
  const index = Math.max(
    0,
    VIEWS.findIndex(({ id }) => id === view)
  );

  return (
    <div className="px-2 pt-2">
      {/* One box behind all four, and one highlight inside it that slides to
          whichever is chosen rather than going out under one name and coming
          on under another. The names are equal widths, so the highlight is a
          quarter of the box and moves by its own width at a time. */}
      <div
        role="tablist"
        aria-label="Sidebar view"
        className="relative grid grid-cols-4 rounded-md bg-zinc-800/30 p-[3px]"
      >
        <span
          aria-hidden
          // Set in from the box on every side, and only a shade lighter than
          // it: enough to say which view is up, not enough to look at.
          className="pointer-events-none absolute inset-y-[3px] left-[3px] w-[calc((100%-6px)/4)] rounded bg-zinc-700/30 transition-transform duration-200 ease-out motion-reduce:transition-none"
          style={{ transform: `translateX(${index * 100}%)` }}
        />
        {VIEWS.map(({ id, label, title }) => {
          const selected = id === view;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              title={title}
              onClick={() => onChange(id)}
              className={`relative cursor-pointer whitespace-nowrap rounded py-0.5 text-center text-[11px] leading-4 font-medium transition-colors duration-200 compact:py-px ${
                selected ? "text-zinc-200" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

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
        className="relative grid grid-cols-4 rounded-lg bg-zinc-800/40 p-0.5"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc((100%-0.25rem)/4)] rounded-md bg-zinc-700/70 shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none"
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
              className={`relative cursor-pointer whitespace-nowrap rounded-md py-1 text-center text-[11px] font-medium transition-colors duration-200 compact:py-0.5 ${
                selected ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
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

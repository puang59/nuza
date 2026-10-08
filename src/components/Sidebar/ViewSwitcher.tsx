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
  return (
    <div role="tablist" aria-label="Sidebar view" className="flex items-center gap-0.5 px-2 pt-2">
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
            className={`min-w-0 flex-1 cursor-pointer truncate rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors compact:py-0.5 ${
              selected
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

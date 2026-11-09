import { useRegistry } from "@/lib/registries/registry";
import { sidebarViews } from "@/lib/registries/sidebarViews";

type BuiltInView = "files" | "outline" | "tags" | "links";

/** One of nuza's four views, or the id of one added (see registries/sidebarViews.ts). */
export type SidebarView = BuiltInView | (string & {});

const VIEWS: { id: BuiltInView; label: string; title: string }[] = [
  { id: "files", label: "Files", title: "The vault's files" },
  { id: "outline", label: "Outline", title: "The open note's headings" },
  { id: "tags", label: "Tags", title: "Every tag in the vault" },
  { id: "links", label: "Links", title: "Notes that link to the open one" },
];

/**
 * A stored value read back as a view, or the files if it is not one - which
 * includes an added view whose plugin is off, or not loaded yet. The stored
 * value is left as it is, so the view comes back when its plugin does.
 */
export function readView(stored: unknown, added: readonly string[] = []): SidebarView {
  if (typeof stored !== "string") return "files";
  return VIEWS.some((view) => view.id === stored) || added.includes(stored) ? stored : "files";
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
  const added = useRegistry(sidebarViews);
  const views: { id: SidebarView; label: string; title?: string }[] = [...VIEWS, ...added];
  const index = Math.max(
    0,
    views.findIndex(({ id }) => id === view)
  );

  return (
    <div className="px-2 pt-2">
      {/* One box behind all of them, and one highlight inside it that slides
          to whichever is chosen rather than going out under one name and
          coming on under another. The names are equal widths, so the
          highlight is one name wide and moves by its own width at a time. */}
      <div
        role="tablist"
        aria-label="Sidebar view"
        className="relative grid rounded-md bg-zinc-800/30 p-[3px]"
        style={{ gridTemplateColumns: `repeat(${views.length}, minmax(0, 1fr))` }}
      >
        <span
          aria-hidden
          // Set in from the box on every side, and only a shade lighter than
          // it: enough to say which view is up, not enough to look at.
          className="pointer-events-none absolute inset-y-[3px] left-[3px] rounded bg-zinc-700/30 transition-transform duration-200 ease-out motion-reduce:transition-none"
          style={{ width: `calc((100% - 6px) / ${views.length})`, transform: `translateX(${index * 100}%)` }}
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
              className={`relative cursor-pointer truncate whitespace-nowrap rounded py-0.5 text-center text-[11px] leading-4 font-medium transition-colors duration-200 compact:py-px ${
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

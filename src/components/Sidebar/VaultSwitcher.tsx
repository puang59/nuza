import { memo, useEffect, useRef, useState } from "react";
import { ChevronsUpDown, FolderOpen, Pencil, X } from "lucide-react";
import { cn } from "cn";
import { Vault } from "@/lib/vaults";
import InlineInput from "./InlineInput";

export interface VaultSwitcherProps {
  vaults: Vault[];
  /** The folder currently open, or null before one has been chosen. */
  currentPath: string | null;
  onSelect: (path: string) => Promise<boolean> | boolean;
  onOpenFolder?: () => void;
  onRename: (path: string, name: string) => void;
  onForget: (path: string) => void;
}

/**
 * The vault the app is pointed at, and the way to point it somewhere else.
 *
 * It sits at the foot of the sidebar rather than in the header because it is
 * the thing you touch least: once a morning to pick up where you left off, and
 * otherwise never.
 */
function VaultSwitcher({ vaults, currentPath, onSelect, onOpenFolder, onRename, onForget }: VaultSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  /** A vault that would not open, e.g. a folder that has since been moved. */
  const [missing, setMissing] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  const current = vaults.find((vault) => vault.path === currentPath);

  useEffect(() => {
    if (!isOpen) return;

    function onPointerDown(event: MouseEvent) {
      if (panel.current && !panel.current.contains(event.target as Node)) setIsOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  function close() {
    setIsOpen(false);
    setRenaming(null);
    setMissing(null);
  }

  async function select(path: string) {
    if (path === currentPath) {
      close();
      return;
    }
    // The panel stays up if the folder has gone, so the row that failed can
    // say so and be removed without having to find it again.
    if (await onSelect(path)) close();
    else setMissing(path);
  }

  return (
    <div ref={panel} className="relative shrink-0 border-t border-zinc-800">
      {isOpen && (
        <div className="animate-menu-in absolute bottom-full left-2 right-2 z-50 mb-1 overflow-hidden rounded-md border border-zinc-700 bg-[#252526] shadow-xl">
          <div className="max-h-64 overflow-y-auto py-1">
            {vaults.length === 0 && (
              <p className="px-3 py-2 text-xs text-zinc-500">No vaults yet. Open a folder to start one.</p>
            )}

            {vaults.map((vault) => (
              <div key={vault.path} className="group px-1">
                {renaming === vault.path ? (
                  <div className="px-2 py-1">
                    <InlineInput
                      initialValue={vault.name}
                      onSubmit={(name) => {
                        onRename(vault.path, name);
                        setRenaming(null);
                      }}
                      onCancel={() => setRenaming(null)}
                      className="w-full rounded bg-zinc-900 px-1 py-0.5 text-sm text-white outline outline-1 outline-blue-500"
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-1 rounded transition-colors hover:bg-zinc-700/50">
                    <button
                      onClick={() => void select(vault.path)}
                      title={vault.path}
                      className="min-w-0 flex-1 cursor-pointer px-2 py-1.5 text-left"
                    >
                      <span
                        className={cn(
                          "block truncate text-sm",
                          vault.path === currentPath ? "text-[#FF9696]" : "text-zinc-200"
                        )}
                      >
                        {vault.name}
                      </span>
                      <span className="block truncate text-[10px] text-zinc-600">{vault.path}</span>
                    </button>

                    <button
                      onClick={() => setRenaming(vault.path)}
                      title="Rename in this list"
                      className="cursor-pointer rounded p-1 text-zinc-600 opacity-0 transition-colors hover:text-white focus:opacity-100 group-hover:opacity-100"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => {
                        onForget(vault.path);
                        setMissing(null);
                      }}
                      title="Remove from this list"
                      className="mr-1 cursor-pointer rounded p-1 text-zinc-600 opacity-0 transition-colors hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}

                {missing === vault.path && (
                  <p className="px-2 pb-1.5 text-[10px] text-red-400">
                    Could not open this folder - it may have been moved or renamed.
                  </p>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={() => {
              close();
              onOpenFolder?.();
            }}
            className="flex w-full cursor-pointer items-center gap-2 border-t border-zinc-700 px-3 py-2 text-left text-sm text-zinc-300 transition-colors hover:bg-zinc-700/60 hover:text-white"
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            Open folder...
          </button>
        </div>
      )}

      <button
        onClick={() => (isOpen ? close() : setIsOpen(true))}
        title={currentPath ?? "Choose a vault"}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-zinc-800/40"
      >
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <span className="truncate text-xs font-semibold text-zinc-300">
          {current?.name ?? "Choose a vault"}
        </span>
      </button>
    </div>
  );
}

export default memo(VaultSwitcher);

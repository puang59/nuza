import { useMemo } from "react";
import { conflictingActions, KEYMAP_ACTIONS, type KeymapBindings } from "@/lib/keymaps";
import { commands, CORE_GROUP } from "@/lib/registries/commands";
import { useRegistry } from "@/lib/registries/registry";
import KeyRecorder from "./KeyRecorder";

interface KeymapSettingsProps {
  bindings: KeymapBindings;
  setBinding: (action: string, binding: string) => void;
  resetBinding: (action: string) => void;
  resetAll: () => void;
}

interface Row {
  id: string;
  label: string;
  description: string;
  defaultBinding: string;
}

/** Commands plugins added, by the plugin they came from, in the order they arrived. */
function pluginGroups(registered: ReturnType<typeof commands.list>): [string, Row[]][] {
  const groups = new Map<string, Row[]>();
  for (const command of registered) {
    if (command.group === CORE_GROUP) continue;
    const row = {
      id: command.id,
      label: command.label,
      description: command.description ?? "",
      defaultBinding: command.defaultBinding ?? "",
    };
    groups.set(command.group, [...(groups.get(command.group) ?? []), row]);
  }
  return [...groups];
}

export default function KeymapSettings({
  bindings,
  setBinding,
  resetBinding,
  resetAll,
}: KeymapSettingsProps) {
  const registered = useRegistry(commands);
  const groups = useMemo(() => pluginGroups(registered), [registered]);
  const hasCustomBindings =
    KEYMAP_ACTIONS.some((action) => bindings[action.id] !== action.defaultBinding) ||
    groups.some(([, rows]) => rows.some((row) => (bindings[row.id] ?? "") !== row.defaultBinding));

  // Two actions on one chord is resolved by whichever the listener reaches
  // first, which is an order nobody chose and nothing shows. Both of them are
  // marked instead, so the one that stopped working says why.
  const clashing = useMemo(() => conflictingActions(bindings), [bindings]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1">
        <p className="text-xs text-gray-500">Click a shortcut to record a new one. Esc cancels.</p>
        {hasCustomBindings && (
          <button
            onClick={resetAll}
            className="text-xs text-gray-500 hover:text-white transition-colors cursor-pointer shrink-0"
          >
            Reset all
          </button>
        )}
      </div>

      <Rows rows={KEYMAP_ACTIONS} {...{ bindings, clashing, setBinding, resetBinding }} />

      {groups.map(([group, rows]) => (
        <section key={group} className="mt-5">
          <h2 className="mb-1 text-xs font-medium text-gray-500">{group}</h2>
          <Rows rows={rows} {...{ bindings, clashing, setBinding, resetBinding }} />
        </section>
      ))}
    </div>
  );
}

interface RowsProps {
  rows: readonly Row[];
  bindings: KeymapBindings;
  clashing: Set<string>;
  setBinding: (action: string, binding: string) => void;
  resetBinding: (action: string) => void;
}

function Rows({ rows, bindings, clashing, setBinding, resetBinding }: RowsProps) {
  return (
    <div className="divide-y divide-zinc-800">
      {rows.map((action) => (
        <div key={action.id} className="flex items-center justify-between gap-4 py-2.5">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-white truncate">{action.label}</h3>
            {clashing.has(action.id) ? (
              <p className="mt-0.5 truncate text-xs text-amber-400">
                Shared with another shortcut — only one of them will run.
              </p>
            ) : (
              <p className="text-xs text-gray-500 mt-0.5 truncate">{action.description}</p>
            )}
          </div>
          <KeyRecorder
            binding={bindings[action.id] ?? ""}
            defaultBinding={action.defaultBinding}
            onChange={(nextBinding) => setBinding(action.id, nextBinding)}
            onReset={() => resetBinding(action.id)}
          />
        </div>
      ))}
    </div>
  );
}

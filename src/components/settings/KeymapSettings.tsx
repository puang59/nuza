import { KEYMAP_ACTIONS, KeymapAction } from "@/lib/keymaps";
import KeyRecorder from "./KeyRecorder";

interface KeymapSettingsProps {
  bindings: Record<KeymapAction, string>;
  setBinding: (action: KeymapAction, binding: string) => void;
  resetBinding: (action: KeymapAction) => void;
  resetAll: () => void;
}

export default function KeymapSettings({
  bindings,
  setBinding,
  resetBinding,
  resetAll,
}: KeymapSettingsProps) {
  const hasCustomBindings = KEYMAP_ACTIONS.some((action) => bindings[action.id] !== action.defaultBinding);

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

      <div className="divide-y divide-zinc-800">
        {KEYMAP_ACTIONS.map((action) => (
          <div key={action.id} className="flex items-center justify-between gap-4 py-2.5">
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-white truncate">{action.label}</h3>
              <p className="text-xs text-gray-500 mt-0.5 truncate">{action.description}</p>
            </div>
            <KeyRecorder
              binding={bindings[action.id]}
              defaultBinding={action.defaultBinding}
              onChange={(nextBinding) => setBinding(action.id, nextBinding)}
              onReset={() => resetBinding(action.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

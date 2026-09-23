import { useEffect, useState } from "react";
import { X, SlidersHorizontal, Keyboard, LucideIcon } from "lucide-react";
import { cn } from "cn";
import { KeymapAction } from "@/lib/keymaps";
import GeneralSettings from "./settings/GeneralSettings";
import KeymapSettings from "./settings/KeymapSettings";

type SettingsSection = "general" | "keymaps";

const SECTIONS: { id: SettingsSection; label: string; icon: LucideIcon }[] = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "keymaps", label: "Keymaps", icon: Keyboard },
];

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  vimEnabled: boolean;
  setVimEnabled: (enabled: boolean) => void;
  transparencyEnabled: boolean;
  setTransparencyEnabled: (enabled: boolean) => void;
  autoUpdateEnabled: boolean;
  setAutoUpdateEnabled: (enabled: boolean) => void;
  keymapBindings: Record<KeymapAction, string>;
  setKeymapBinding: (action: KeymapAction, binding: string) => void;
  resetKeymapBinding: (action: KeymapAction) => void;
  resetAllKeymaps: () => void;
}

export default function SettingsModal({
  isOpen,
  onClose,
  vimEnabled,
  setVimEnabled,
  transparencyEnabled,
  setTransparencyEnabled,
  autoUpdateEnabled,
  setAutoUpdateEnabled,
  keymapBindings,
  setKeymapBinding,
  resetKeymapBinding,
  resetAllKeymaps,
}: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");

  useEffect(() => {
    if (!isOpen) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#1E1E1E] border border-zinc-700 rounded-lg shadow-xl w-[640px] h-[520px] max-w-full max-h-full overflow-hidden flex flex-col"
      >
        <div className="flex items-center justify-between p-4 border-b border-zinc-800 shrink-0">
          <h2 className="text-lg font-semibold text-white">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-col sm:flex-row flex-1 min-h-0">
          <nav className="flex sm:flex-col gap-1 p-2 sm:w-40 sm:shrink-0 border-b sm:border-b-0 sm:border-r border-zinc-800 overflow-x-auto sm:overflow-x-visible">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveSection(id)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0",
                  activeSection === id
                    ? "bg-zinc-800 text-white"
                    : "text-gray-400 hover:text-white hover:bg-zinc-800/50"
                )}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </nav>

          <div className="flex-1 min-w-0 overflow-y-auto p-4">
            {activeSection === "general" ? (
              <GeneralSettings
                vimEnabled={vimEnabled}
                setVimEnabled={setVimEnabled}
                transparencyEnabled={transparencyEnabled}
                setTransparencyEnabled={setTransparencyEnabled}
                autoUpdateEnabled={autoUpdateEnabled}
                setAutoUpdateEnabled={setAutoUpdateEnabled}
              />
            ) : (
              <KeymapSettings
                bindings={keymapBindings}
                setBinding={setKeymapBinding}
                resetBinding={resetKeymapBinding}
                resetAll={resetAllKeymaps}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

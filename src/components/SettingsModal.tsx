import { useEffect, useState } from "react";
import { X, SlidersHorizontal, Palette, Keyboard, Info, LucideIcon } from "lucide-react";
import { cn } from "cn";
import { useExitAnimation } from "@/hooks/useExitAnimation";
import { KeymapAction } from "@/lib/keymaps";
import { UpdateStatus } from "@/hooks/useAppUpdater";
import GeneralSettings from "./settings/GeneralSettings";
import { Appearance } from "@/lib/appearance";
import AppearanceSettings from "./settings/AppearanceSettings";
import KeymapSettings from "./settings/KeymapSettings";
import InfoSettings from "./settings/InfoSettings";

type SettingsSection = "general" | "appearance" | "keymaps" | "info";

const SECTIONS: { id: SettingsSection; label: string; icon: LucideIcon }[] = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "keymaps", label: "Keymaps", icon: Keyboard },
  { id: "info", label: "Info", icon: Info },
];

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  vimEnabled: boolean;
  setVimEnabled: (enabled: boolean) => void;
  appearance: Appearance;
  setAppearance: (change: Partial<Appearance>) => void;
  resetAppearance: () => void;
  autoUpdateEnabled: boolean;
  setAutoUpdateEnabled: (enabled: boolean) => void;
  editorFont: string;
  setEditorFont: (font: string) => void;
  editorFontSize: number;
  setEditorFontSize: (size: number) => void;
  keymapBindings: Record<KeymapAction, string>;
  setKeymapBinding: (action: KeymapAction, binding: string) => void;
  resetKeymapBinding: (action: KeymapAction) => void;
  resetAllKeymaps: () => void;
  updateStatus: UpdateStatus;
  appVersion: string | null;
  onCheckUpdates: () => void;
  onOpenDownloadPage: () => void;
  onOpenChangelog: () => void;
}

export default function SettingsModal({
  isOpen,
  onClose,
  vimEnabled,
  setVimEnabled,
  appearance,
  setAppearance,
  resetAppearance,
  autoUpdateEnabled,
  setAutoUpdateEnabled,
  editorFont,
  setEditorFont,
  editorFontSize,
  setEditorFontSize,
  keymapBindings,
  setKeymapBinding,
  resetKeymapBinding,
  resetAllKeymaps,
  updateStatus,
  appVersion,
  onCheckUpdates,
  onOpenDownloadPage,
  onOpenChangelog,
}: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const { isMounted, isClosing } = useExitAnimation(isOpen);

  useEffect(() => {
    if (!isOpen) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isMounted) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4",
        isClosing ? "animate-fade-out" : "animate-fade-in"
      )}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "bg-[var(--nuza-bg)] border border-zinc-700 rounded-lg shadow-xl w-[640px] h-[520px] max-w-full max-h-full overflow-hidden flex flex-col",
          isClosing ? "animate-panel-out" : "animate-panel-in"
        )}
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
            {activeSection === "general" && (
              <GeneralSettings vimEnabled={vimEnabled} setVimEnabled={setVimEnabled} />
            )}

            {activeSection === "appearance" && (
              <AppearanceSettings
                appearance={appearance}
                setAppearance={setAppearance}
                resetAppearance={resetAppearance}
                editorFont={editorFont}
                setEditorFont={setEditorFont}
                editorFontSize={editorFontSize}
                setEditorFontSize={setEditorFontSize}
              />
            )}

            {activeSection === "keymaps" && (
              <KeymapSettings
                bindings={keymapBindings}
                setBinding={setKeymapBinding}
                resetBinding={resetKeymapBinding}
                resetAll={resetAllKeymaps}
              />
            )}

            {activeSection === "info" && (
              <InfoSettings
                autoUpdateEnabled={autoUpdateEnabled}
                setAutoUpdateEnabled={setAutoUpdateEnabled}
                updateStatus={updateStatus}
                appVersion={appVersion}
                onCheckUpdates={onCheckUpdates}
                onOpenDownloadPage={onOpenDownloadPage}
                onOpenChangelog={onOpenChangelog}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

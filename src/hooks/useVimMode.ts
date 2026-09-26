import { useEffect, useRef, useState } from "react";
import type { Extension } from "@codemirror/state";
import { report } from "@/lib/notices";

type VimModule = typeof import("@replit/codemirror-vim");

/**
 * Vim support, fetched the first time it is switched on rather than shipped in
 * the bundle the app starts from - it is a whole keymap and command parser that
 * someone who writes in insert mode never touches.
 *
 * The extension itself is built once and then kept: a fresh instance would
 * throw away Vim's own state every time the editor reconfigures, which is to
 * say on every font change.
 */
export function useVimMode(enabled: boolean) {
  const [module, setModule] = useState<VimModule | null>(null);
  const extension = useRef<Extension | null>(null);

  useEffect(() => {
    if (!enabled || module) return;

    let active = true;
    import("@replit/codemirror-vim")
      .then((loaded) => {
        if (!active) return;
        extension.current ??= loaded.vim();
        setModule(loaded);
      })
      .catch((error) => report("Couldn't turn Vim mode on", error));

    return () => {
      active = false;
    };
  }, [enabled, module]);

  return { module, extension: enabled ? extension.current : null };
}

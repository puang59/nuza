import { useEffect, useRef, useState } from "react";
import { Prec, type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { report } from "@/lib/notices";

type VimModule = typeof import("@replit/codemirror-vim");

/**
 * Control and `[` as Escape, which is what Vim has always made of it.
 *
 * The editor's own keymap has that chord too, as "indent less" (Mod-[, and off
 * macOS Mod is Control), and in insert mode it is read before Vim gets a look,
 * so the chord indented the line and left Vim where it was. This one is read
 * ahead of it and hands the chord to Vim as typed, so Vim's own mapping - and
 * anyone's changes to it - decide what it does. On a Mac the chord is not
 * Mod-[, which is Command, and nothing about it changes.
 */
function escapeWithControlBracket(vim: VimModule): Extension {
  return Prec.high(
    keymap.of([
      {
        key: "Ctrl-[",
        run: (view) => {
          const cm = vim.getCM(view);
          if (!cm) return false;
          vim.Vim.handleKey(cm, "<C-[>", "user");
          return true;
        },
      },
    ])
  );
}

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
        extension.current ??= [escapeWithControlBracket(loaded), loaded.vim()];
        setModule(loaded);
      })
      .catch((error) => report("Couldn't turn Vim mode on", error));

    return () => {
      active = false;
    };
  }, [enabled, module]);

  return { module, extension: enabled ? extension.current : null };
}

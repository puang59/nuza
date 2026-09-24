import { markdown } from "@codemirror/lang-markdown";
import { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { GFM } from "@lezer/markdown";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isMacPlatform } from "../platform";
import { liveMarkdownPreview } from "./livePreview";
import { nuzaEditorTheme } from "./theme";

/**
 * Mod-click opens a link in the browser. A plain click has to stay as it is -
 * that is how you put the caret inside a link to edit it - which is the same
 * bargain VS Code and Obsidian strike.
 */
const openLinkOnModClick = EditorView.domEventHandlers({
  mousedown(event) {
    if (event.button !== 0) return false;
    if (!(isMacPlatform() ? event.metaKey : event.ctrlKey)) return false;

    const target = event.target as HTMLElement | null;
    const href = target?.closest<HTMLElement>("[data-href]")?.dataset.href;
    if (!href) return false;

    event.preventDefault();
    openUrl(href).catch((error) => console.error("Failed to open link:", error));
    return true;
  },
});

/**
 * The whole writing surface: GFM parsing, the rendered-as-you-type decorations
 * and the theme that sizes them. Built once at module scope so reconfiguring
 * the editor (font changes, switching Vim on) reuses the same state field
 * instead of throwing the rendered document away and rebuilding it.
 */
export const liveMarkdown: Extension = [
  markdown({ extensions: GFM }),
  EditorView.lineWrapping,
  nuzaEditorTheme,
  liveMarkdownPreview,
  openLinkOnModClick,
];

export { directoryOf, noteDirectory } from "./sources";

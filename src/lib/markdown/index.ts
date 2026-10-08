import {
  deleteMarkupBackward,
  insertNewlineContinueMarkupCommand,
  markdown,
} from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { GFM } from "@lezer/markdown";
import { openUrl } from "@tauri-apps/plugin-opener";
import { report } from "../notices";
import { isMacPlatform } from "../platform";
import { attachments } from "./attachments";
import { listIndent } from "./listIndent";
import { continueListItem, insertNewLine } from "./lists";
import { liveMarkdownPreview } from "./livePreview";
import { MathSyntax } from "./math";
import { findInNote } from "./searchPanel";
import { scrollbarOnDemand } from "./scrollbar";
import { noteDirectory } from "./sources";
import { headingFlash, jumpToHeading, outlineReporter } from "./headings";
import { Tag } from "./tags";
import { WikiEmbed, WikiLink, followWikiLink } from "./wikiLinks";
import { nuzaEditorTheme } from "./theme";

/**
 * Mod-click opens a link in the browser. A plain click has to stay as it is -
 * that is how you put the caret inside a link to edit it - which is the same
 * bargain VS Code and Obsidian strike.
 */
const openLinkOnModClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) return false;
    if (!(isMacPlatform() ? event.metaKey : event.ctrlKey)) return false;

    const target = event.target as HTMLElement | null;

    // A wiki-link is a note in the vault, opened in a tab rather than a browser.
    const wiki = target?.closest<HTMLElement>("[data-wikilink]")?.dataset.wikilink;
    if (wiki !== undefined) {
      event.preventDefault();
      const heading =
        target?.closest<HTMLElement>("[data-wikilink-heading]")?.dataset.wikilinkHeading ?? null;
      followWikiLink({ target: wiki, heading, fromDirectory: view.state.facet(noteDirectory), view });
      return true;
    }

    // `[text](#heading)`: a heading further up or down this note.
    const anchor = target?.closest<HTMLElement>("[data-anchor]")?.dataset.anchor;
    if (anchor !== undefined) {
      event.preventDefault();
      let heading = anchor;
      try {
        heading = decodeURIComponent(anchor);
      } catch {
        // A stray `%` is not valid percent-encoding; use it as written.
      }
      if (!jumpToHeading(view, heading)) report(`There's no heading "${heading}" in this note`);
      return true;
    }

    const href = target?.closest<HTMLElement>("[data-href]")?.dataset.href;
    if (!href) return false;

    event.preventDefault();
    openUrl(href).catch((error) => report("Couldn't open that link", error));
    return true;
  },
});

/**
 * Enter continues a list, a quote or a task; Enter on an item you have left
 * empty ends the list. `nonTightLists` is off because the stock behaviour does
 * the opposite - it keeps the marker and inserts a blank line above it, which
 * turns a list into a gappy one the moment you try to get out of it.
 *
 * Shift+enter is the other half of that: a second line of the same point
 * rather than a point of its own, carried on underneath the text it belongs
 * to. Outside a list it is left to do what it does everywhere else.
 */
const markdownEditingKeymap = Prec.high(
  keymap.of([
    {
      key: "Enter",
      run: insertNewLine(insertNewlineContinueMarkupCommand({ nonTightLists: false })),
      shift: continueListItem,
    },
    { key: "Backspace", run: deleteMarkupBackward },
  ])
);

/**
 * The whole writing surface: GFM parsing, the rendered-as-you-type decorations
 * and the theme that sizes them. Built once at module scope so reconfiguring
 * the editor (font changes, switching Vim on) reuses the same state field
 * instead of throwing the rendered document away and rebuilding it.
 */
export const liveMarkdown: Extension = [
  // `codeLanguages` is what gives a fenced block its own colours. Each grammar
  // is fetched the first time a block asks for it, so a note that never shows
  // code never pays for one.
  markdown({
    extensions: [GFM, WikiEmbed, WikiLink, Tag, MathSyntax],
    codeLanguages: languages,
    addKeymap: false,
  }),
  markdownEditingKeymap,
  EditorView.lineWrapping,
  nuzaEditorTheme,
  liveMarkdownPreview,
  headingFlash,
  outlineReporter,
  findInNote,
  scrollbarOnDemand,
  listIndent,
  openLinkOnModClick,
  attachments,
];

export { directoryOf, noteDirectory } from "./sources";
export { vaultDirectory } from "./attachments";

import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/**
 * The writing surface is deliberately quiet: one ink colour for prose, one
 * accent for anything you can act on (links, bullets, the caret), and a single
 * hairline for structure. Everything else is a tint of white over whatever the
 * window is showing, so the theme survives transparency being toggled on and
 * off without a second palette.
 */
const ink = {
  text: "#D4D4D8",
  heading: "#FAFAFA",
  muted: "#8A8A93",
  accent: "#FF9696",
  code: "#9696FF",
  caret: "#FF9696",
  /* Warm, and keyed to the caret: a drag-select reads as one gesture rather
     than as the browser's default blue turning up uninvited. */
  selection: "rgba(255, 150, 150, 0.24)",
  /* Neutral when the editor does not have focus, so it is obvious that a
     highlighted run is a leftover rather than a live selection. */
  selectionInactive: "rgba(255, 255, 255, 0.09)",
  hairline: "rgba(255, 255, 255, 0.10)",
  surface: "rgba(255, 255, 255, 0.045)",
  surfaceStrong: "rgba(255, 255, 255, 0.07)",
};

/**
 * How wide the text column is allowed to get. Long lines are tiring to read,
 * so the column stops here and the rest of the window becomes margin - which is
 * what makes a maximised window feel calm rather than empty.
 */
const MEASURE = "44rem";

/** The checkbox tick: a centred background image, so it never drifts off. */
const CHECK_MARK =
  "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiI+PHBhdGggZD0i" +
  "TTMuNSA4LjRsMy4xIDMuMUwxMi41IDUiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzFFMUUxRSIgc3Ryb2tlLXdpZHRoPSIy" +
  "LjYiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjwvc3ZnPg==";

/** A cross-platform monospace stack for code, independent of the prose font. */
export const CODE_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';

const editorTheme = EditorView.theme(
  {
    "&": {
      color: ink.text,
      backgroundColor: "transparent",
      height: "100%",
    },
    "&.cm-focused": { outline: "none" },

    /* The horizontal breathing room. `clamp` keeps a narrow window usable
       instead of squeezing the text into a gutter-wide strip. */
    ".cm-scroller": {
      padding: "0 clamp(1rem, 7vw, 4.5rem)",
      alignItems: "flex-start",
    },

    /* The column itself: capped, centred, with a deep run-out at the bottom so
       the line you are typing never sits pinned to the window edge. */
    ".cm-content": {
      maxWidth: MEASURE,
      width: "100%",
      flexGrow: "1",
      margin: "0 auto",
      padding: "4rem 0 45vh",
      lineHeight: "1.75",
      caretColor: ink.caret,
    },
    ".cm-line": {
      padding: "0",
    },

    "&.cm-focused > .cm-scroller > .cm-cursorLayer .cm-cursor, .cm-cursor, .cm-dropCursor": {
      borderLeft: `2px solid ${ink.caret}`,
    },
    /* Vim's block cursor draws itself as a background, not a border. */
    ".cm-fat-cursor": {
      background: `${ink.caret} !important`,
      color: "#1E1E1E !important",
    },
    "&:not(.cm-focused) .cm-fat-cursor": {
      background: "none !important",
      outline: `1px solid ${ink.caret}`,
      color: "transparent !important",
    },
    /* Spelled out through the scroller and the selection layer, rather than as
       a flat `.cm-selectionBackground`: CodeMirror's own dark base theme sets
       the same property through that full path, and a shorter selector loses
       to it no matter what colour it names. */
    "&:not(.cm-focused) > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
      background: ink.selectionInactive,
    },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-content ::selection":
      {
        background: ink.selection,
      },
    ".cm-activeLine": { backgroundColor: "transparent" },

    /* Other copies of what you have selected, in the second accent so they
       read as related to the selection without being mistaken for it.
       CodeMirror's own default here is a bright green that belongs to no part
       of this app. */
    ".cm-selectionMatch": { backgroundColor: "rgba(150, 150, 255, 0.18)" },
    ".cm-searchMatch": {
      backgroundColor: "rgba(245, 201, 123, 0.2)",
      outline: "1px solid rgba(245, 201, 123, 0.35)",
      borderRadius: "2px",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "rgba(245, 201, 123, 0.42)",
    },

    /* The find panel is CodeMirror's, and it arrives in CodeMirror's colours:
       a mid-grey bar with borderless, transparent controls. Only the colours
       are restated here - the layout is left to the base theme. */
    ".cm-panels": {
      backgroundColor: "#1E1E1E",
      color: ink.text,
      fontSize: "12px",
    },
    ".cm-panels-bottom": { borderTop: `1px solid ${ink.hairline}` },
    ".cm-panels-top": { borderBottom: `1px solid ${ink.hairline}` },
    ".cm-panel.cm-search label": { color: ink.muted },
    ".cm-panel.cm-search input:not([type=checkbox])": {
      backgroundColor: ink.surface,
      border: `1px solid ${ink.hairline}`,
      borderRadius: "4px",
      color: ink.text,
      padding: "2px 6px",
      outline: "none",
    },
    ".cm-panel.cm-search input:not([type=checkbox]):focus": { borderColor: ink.accent },
    ".cm-panel.cm-search button": {
      backgroundColor: ink.surface,
      backgroundImage: "none",
      border: `1px solid ${ink.hairline}`,
      borderRadius: "4px",
      color: ink.text,
      cursor: "pointer",
    },
    ".cm-panel.cm-search button:hover": { borderColor: ink.accent },
    ".cm-panel.cm-search button[name=close]": {
      background: "none",
      border: "none",
      color: ink.muted,
      cursor: "pointer",
    },

    /* ---- Markdown syntax that is still visible ------------------------- */

    /* Markup on the line you are editing stays legible but steps back, so the
       reveal reads as "the text opened up" rather than "the styling broke". */
    ".cm-md-mark": {
      color: ink.muted,
      opacity: "0.55",
      fontWeight: "400",
    },

    /* ---- Headings ------------------------------------------------------ */

    ".cm-md-heading": {
      color: ink.heading,
      fontWeight: "650",
      lineHeight: "1.3",
    },
    ".cm-md-h1": { fontSize: "1.9em", padding: "0.55em 0 0.2em" },
    ".cm-md-h2": { fontSize: "1.52em", padding: "0.6em 0 0.2em" },
    ".cm-md-h3": { fontSize: "1.28em", padding: "0.65em 0 0.2em" },
    ".cm-md-h4": { fontSize: "1.12em", padding: "0.7em 0 0.2em" },
    ".cm-md-h5": { fontSize: "1em", padding: "0.75em 0 0.2em" },
    ".cm-md-h6": {
      fontSize: "0.92em",
      padding: "0.8em 0 0.2em",
      color: ink.muted,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
    },
    /* Setext headings keep their underline - hiding it would swallow a whole
       line - so it is dimmed to a rule instead. */
    ".cm-md-setext-mark": {
      color: ink.hairline,
      opacity: "0.8",
    },

    /* ---- Lists --------------------------------------------------------- */

    ".cm-md-bullet": {
      color: "rgba(255, 150, 150, 0.85)",
      display: "inline-block",
      fontSize: "1.25em",
      lineHeight: "1",
      verticalAlign: "-0.05em",
      fontWeight: "700",
    },
    ".cm-md-ordered-mark": {
      color: ink.accent,
      fontWeight: "600",
    },
    ".cm-md-task": {
      appearance: "none",
      WebkitAppearance: "none",
      position: "relative",
      display: "inline-block",
      boxSizing: "border-box",
      width: "1.05em",
      height: "1.05em",
      margin: "0 0.2em 0 0",
      verticalAlign: "-0.17em",
      border: `1.5px solid ${ink.muted}`,
      borderRadius: "0.3em",
      background: "transparent",
      cursor: "pointer",
      transition: "background-color 140ms ease, border-color 140ms ease",
    },
    ".cm-md-task:hover": { borderColor: ink.accent },
    ".cm-md-task:checked": {
      backgroundColor: ink.accent,
      borderColor: ink.accent,
    },
    /* The tick is a centred background image rather than a rotated box, which
       is what keeps it centred at any font size. It scales in on check -
       `updateDOM` reuses the same input so the transition has something to
       animate from. */
    ".cm-md-task::after": {
      content: '""',
      position: "absolute",
      inset: "0",
      backgroundImage: `url("data:image/svg+xml;base64,${CHECK_MARK}")`,
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
      backgroundSize: "70%",
      opacity: "0",
      transform: "scale(0.5)",
      transition: "opacity 110ms ease-out, transform 180ms cubic-bezier(0.34, 1.5, 0.64, 1)",
    },
    ".cm-md-task:checked::after": {
      opacity: "1",
      transform: "scale(1)",
    },
    ".cm-md-task-done": {
      color: ink.muted,
      textDecoration: "line-through",
      textDecorationColor: "rgba(255, 255, 255, 0.25)",
      transition: "color 160ms ease",
    },

    /* ---- Inline emphasis ------------------------------------------------ */

    ".cm-md-strong": { fontWeight: "700", color: ink.heading },
    ".cm-md-em": { fontStyle: "italic" },
    ".cm-md-strike": {
      textDecoration: "line-through",
      textDecorationColor: "rgba(255, 255, 255, 0.4)",
      color: ink.muted,
    },
    ".cm-md-inline-code": {
      fontFamily: CODE_FONT_FAMILY,
      fontSize: "0.9em",
      color: ink.code,
      backgroundColor: ink.surface,
      borderRadius: "0.3em",
      padding: "0.12em 0.35em",
    },
    ".cm-md-link": {
      color: ink.accent,
      textDecoration: "underline",
      textDecorationColor: "rgba(255, 150, 150, 0.35)",
      textUnderlineOffset: "0.2em",
      cursor: "pointer",
      transition: "text-decoration-color 140ms ease",
    },
    ".cm-md-link:hover": {
      textDecorationColor: ink.accent,
    },

    /* ---- Blocks --------------------------------------------------------- */

    ".cm-md-quote": {
      borderLeft: "3px solid rgba(150, 150, 255, 0.45)",
      paddingLeft: "1em",
      color: ink.muted,
    },
    ".cm-md-code-line": {
      backgroundColor: ink.surface,
      fontFamily: CODE_FONT_FAMILY,
      fontSize: "0.9em",
      padding: "0 0.9em",
    },
    /* Once the backticks fold away, the fence lines are empty - which is
       exactly the padding the block wants at its top and bottom. */
    ".cm-md-code-info": {
      color: ink.muted,
      fontSize: "0.85em",
      letterSpacing: "0.08em",
      textTransform: "uppercase",
    },
    ".cm-md-code-first": {
      borderTopLeftRadius: "0.5em",
      borderTopRightRadius: "0.5em",
    },
    ".cm-md-code-last": {
      borderBottomLeftRadius: "0.5em",
      borderBottomRightRadius: "0.5em",
    },
    ".cm-md-hr-wrap": {
      display: "block",
      padding: "0.85em 0",
    },
    ".cm-md-hr": {
      border: "none",
      borderTop: `1px solid ${ink.hairline}`,
      margin: "0",
    },

    /* ---- Tables --------------------------------------------------------- */

    /* A wide table scrolls inside its own box rather than widening the
       document and giving the whole editor a horizontal scrollbar. */
    ".cm-md-table-wrap": {
      display: "block",
      overflowX: "auto",
      padding: "0.5em 0",
      whiteSpace: "normal",
    },
    ".cm-md-table": {
      borderCollapse: "collapse",
      width: "100%",
      fontSize: "0.94em",
      lineHeight: "1.5",
    },
    ".cm-md-table th, .cm-md-table td": {
      border: `1px solid ${ink.hairline}`,
      padding: "0.4em 0.8em",
      textAlign: "left",
      verticalAlign: "top",
    },
    ".cm-md-table th": {
      color: ink.heading,
      fontWeight: "600",
      backgroundColor: ink.surfaceStrong,
    },
    ".cm-md-table tbody td": {
      transition: "background-color 120ms ease",
    },
    ".cm-md-table tbody tr:hover td": {
      backgroundColor: "rgba(255, 255, 255, 0.025)",
    },

    /* ---- Images --------------------------------------------------------- */

    ".cm-md-image": {
      display: "inline-block",
      maxWidth: "100%",
      verticalAlign: "top",
    },
    ".cm-md-image img": {
      maxWidth: "100%",
      height: "auto",
      borderRadius: "0.5em",
      display: "block",
      opacity: "0",
      transition: "opacity 220ms ease",
    },
    ".cm-md-image-loaded img": { opacity: "1" },
    ".cm-md-image-broken": {
      color: ink.muted,
      fontStyle: "italic",
      border: `1px dashed ${ink.hairline}`,
      borderRadius: "0.4em",
      padding: "0.2em 0.6em",
    },

    /* ---- Inline and block HTML ------------------------------------------ */

    /* The note supplies the structure; this only lends it the same ink,
       spacing and rules the markdown around it already uses.

       `white-space: normal` is the important one: the editor lays the document
       out as preformatted text, and without this the newlines and indentation
       inside an HTML block are drawn as real blank lines. Headings and list
       markers have to be restated too, since Tailwind's preflight strips them
       from every element on the page. */
    ".cm-md-html": { whiteSpace: "normal" },
    ".cm-md-html-block": { display: "block", padding: "0.3em 0" },
    ".cm-md-html h1": { fontSize: "1.6em" },
    ".cm-md-html h2": { fontSize: "1.4em" },
    ".cm-md-html h3": { fontSize: "1.2em" },
    ".cm-md-html h4": { fontSize: "1.1em" },
    ".cm-md-html ul": { listStyle: "disc outside" },
    ".cm-md-html ol": { listStyle: "decimal outside" },
    ".cm-md-html li": { display: "list-item" },
    ".cm-md-html img, .cm-md-html video": {
      maxWidth: "100%",
      height: "auto",
      borderRadius: "0.4em",
    },
    ".cm-md-html p": { margin: "0.35em 0" },
    ".cm-md-html h1, .cm-md-html h2, .cm-md-html h3, .cm-md-html h4, .cm-md-html h5, .cm-md-html h6":
      {
        color: ink.heading,
        fontWeight: "650",
        lineHeight: "1.3",
        margin: "0.5em 0 0.25em",
      },
    ".cm-md-html ul, .cm-md-html ol": { margin: "0.35em 0", paddingLeft: "1.5em" },
    ".cm-md-html a": {
      color: ink.accent,
      textDecoration: "underline",
      textUnderlineOffset: "0.2em",
    },
    ".cm-md-html code": {
      fontFamily: CODE_FONT_FAMILY,
      fontSize: "0.9em",
      color: ink.code,
      backgroundColor: ink.surface,
      borderRadius: "0.3em",
      padding: "0.12em 0.35em",
    },
    ".cm-md-html pre": {
      fontFamily: CODE_FONT_FAMILY,
      fontSize: "0.9em",
      backgroundColor: ink.surface,
      borderRadius: "0.5em",
      padding: "0.7em 0.9em",
      overflowX: "auto",
    },
    ".cm-md-html pre code": { background: "none", padding: "0" },
    ".cm-md-html blockquote": {
      borderLeft: "3px solid rgba(150, 150, 255, 0.45)",
      margin: "0.4em 0",
      paddingLeft: "1em",
      color: ink.muted,
    },
    ".cm-md-html hr": {
      border: "none",
      borderTop: `1px solid ${ink.hairline}`,
      margin: "0.8em 0",
    },
    ".cm-md-html table": {
      borderCollapse: "collapse",
      width: "100%",
      fontSize: "0.94em",
    },
    ".cm-md-html th, .cm-md-html td": {
      border: `1px solid ${ink.hairline}`,
      padding: "0.4em 0.8em",
      textAlign: "left",
    },
    ".cm-md-html th": {
      color: ink.heading,
      fontWeight: "600",
      backgroundColor: ink.surfaceStrong,
    },

    "@media (prefers-reduced-motion: reduce)": {
      ".cm-md-task, .cm-md-task::after, .cm-md-task-done, .cm-md-link, .cm-md-table tbody td": {
        transition: "none",
      },
    },
  },
  { dark: true }
);

/**
 * Tag-based colours, which cover what the decorations do not: the inside of
 * fenced code, and the fallback styling for markup we do not decorate by hand.
 * Registering any non-fallback highlighter also keeps CodeMirror's stock
 * light-theme highlighting from leaking in underneath.
 */
const markdownHighlighting = HighlightStyle.define([
  { tag: t.heading, color: ink.heading, fontWeight: "650" },
  { tag: t.strong, fontWeight: "700", color: ink.heading },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: ink.accent },
  { tag: [t.monospace, t.special(t.string)], color: ink.code },
  { tag: t.quote, color: ink.muted },
  { tag: t.contentSeparator, color: ink.hairline },
  { tag: [t.processingInstruction, t.meta], color: ink.muted },

  { tag: [t.keyword, t.moduleKeyword], color: "#C792EA" },
  { tag: [t.controlKeyword, t.operatorKeyword], color: "#FF9696" },
  { tag: [t.string, t.regexp], color: "#96FF96" },
  { tag: [t.number, t.bool, t.null], color: "#F5C97B" },
  { tag: [t.variableName, t.propertyName], color: ink.text },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#9696FF" },
  { tag: [t.typeName, t.className, t.namespace], color: "#7BD7F5" },
  { tag: t.comment, color: ink.muted, fontStyle: "italic" },
  { tag: t.invalid, color: "#FF9696" },
]);

/** The complete look of the writing surface: layout, colours and highlighting. */
export const nuzaEditorTheme = [editorTheme, syntaxHighlighting(markdownHighlighting)];

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
  text: "var(--nuza-fg)",
  heading: "var(--nuza-heading)",
  muted: "var(--nuza-muted)",
  accent: "var(--nuza-accent)",
  code: "var(--nuza-code)",
  caret: "var(--nuza-accent)",
  /* Warm, and keyed to the caret: a drag-select reads as one gesture rather
     than as the browser's default blue turning up uninvited. */
  selection: "var(--nuza-accent-wash)",
  /* Neutral when the editor does not have focus, so it is obvious that a
     highlighted run is a leftover rather than a live selection. */
  selectionInactive: "var(--nuza-selection-idle)",
  hairline: "var(--nuza-hairline)",
  surface: "var(--nuza-surface)",
  surfaceStrong: "var(--nuza-surface-strong)",
};

/**
 * How wide the text column is allowed to get. Long lines are tiring to read,
 * so the column stops here and the rest of the window becomes margin - which is
 * what makes a maximised window feel calm rather than empty.
 */
const MEASURE = "var(--nuza-measure, 44rem)";
/** The space between lines of prose; set, like the measure, from Settings. */
const LINE_HEIGHT = "var(--nuza-line-height, 1.75)";

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
      lineHeight: LINE_HEIGHT,
      caretColor: ink.caret,
    },
    ".cm-line": {
      padding: "0",
    },
    /* A wrapped list line hangs by carrying a negative `text-indent`, and
       `text-indent` is inherited: anything in the line that lays out content
       of its own - a bullet, a checkbox, a rendered table - would take that
       indent as well and shift its contents out of place, or collapse to
       nothing. It stops at the line's own text. */
    ".cm-line > *": {
      textIndent: "0",
    },

    "&.cm-focused > .cm-scroller > .cm-cursorLayer .cm-cursor, .cm-cursor, .cm-dropCursor": {
      borderLeft: `2px solid ${ink.caret}`,
    },
    /* Vim's block cursor draws itself as a background, not a border. */
    ".cm-fat-cursor": {
      background: `${ink.caret} !important`,
      color: "var(--nuza-bg) !important",
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
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-content ::selection": {
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
    /* The match you are on, in the first accent, so it stands out from the
       rest of them rather than only being a shade darker. */
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "var(--nuza-accent-wash)",
      outline: "1px solid var(--nuza-accent-line)",
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
      /* A heading that runs to a second line is split evenly, rather than
         leaving a word or two on a line of their own. */
      textWrapStyle: "balance",
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
      color: "var(--nuza-accent-strong)",
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
      textDecorationColor: "var(--nuza-scrollbar-strong)",
      transition: "color 160ms ease",
    },

    /* ---- Inline emphasis ------------------------------------------------ */

    ".cm-md-strong": { fontWeight: "700", color: ink.heading },
    ".cm-md-em": { fontStyle: "italic" },
    ".cm-md-strike": {
      textDecoration: "line-through",
      textDecorationColor: "var(--nuza-rule-strong)",
      color: ink.muted,
    },
    ".cm-md-inline-code": {
      fontFamily: CODE_FONT_FAMILY,
      fontSize: "0.9em",
      color: ink.code,
      backgroundColor: ink.surface,
      borderRadius: "0.3em",
      padding: "0.12em 0.35em",
      /* Wrapped onto a second line, each part keeps its own padding and
         corners instead of being cut off square where the line ended. */
      boxDecorationBreak: "clone",
      WebkitBoxDecorationBreak: "clone",
    },
    /* A tag: the accent, set in a quiet pill so it reads as a label and not as a
       link - it is not something you follow from here, it is listed in the sidebar. */
    ".cm-md-tag": {
      color: ink.accent,
      backgroundColor: "var(--nuza-accent-faint)",
      boxShadow: "inset 0 0 0 1px var(--nuza-accent-underline)",
      borderRadius: "0.6em",
      padding: "0.05em 0.45em",
      boxDecorationBreak: "clone",
      WebkitBoxDecorationBreak: "clone",
    },
    ".cm-md-link": {
      color: ink.accent,
      textDecoration: "underline",
      textDecorationColor: "var(--nuza-accent-underline)",
      textUnderlineOffset: "0.2em",
      cursor: "pointer",
      transition: "text-decoration-color 140ms ease",
    },
    /* A link to a note rather than a page: the same link, drawn without the
       underline's gap, so the two can be told apart at a glance. */
    ".cm-md-wikilink": {
      textDecorationStyle: "dotted",
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
    /* The editor wraps its lines with `overflow-wrap: anywhere`, which is
       right for prose and wrong in here: it lets a word break between any two
       letters *and* tells the table that a column may be one letter wide. The
       layout then starves the short columns to feed the long one, and
       ordinary words came out split across lines. `break-word` only breaks a
       word that is wider than its column by itself, and a column is never
       narrower than its longest word - a table too wide for that scrolls. */
    ".cm-md-table-wrap": {
      display: "block",
      overflowX: "auto",
      padding: "0.5em 0",
      whiteSpace: "normal",
      overflowWrap: "break-word",
      wordBreak: "normal",
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
      backgroundColor: "var(--nuza-surface)",
    },

    /* ---- Frontmatter ---------------------------------------------------- */

    /* A note's properties: the key stepped back, the value in front of it.
       Quiet enough to scroll past, close enough to read at a glance. */
    /* The room under the rule is padding, not margin: CodeMirror measures a
       block widget without its margins, so a margin here left everything
       below it drawn lower than the editor believed - the gutter's numbers,
       and where a click landed, both came out a margin's height too high. */
    ".cm-md-props": {
      position: "relative",
      paddingBottom: "calc(0.7em + 1px + 1.4em)",
      fontSize: "0.88em",
    },
    ".cm-md-props::after": {
      content: '""',
      position: "absolute",
      left: "0",
      right: "0",
      bottom: "1.4em",
      borderTop: `1px solid ${ink.hairline}`,
    },
    ".cm-md-prop": {
      display: "grid",
      gridTemplateColumns: "minmax(0, 9em) 1fr auto",
      gap: "0 1.2em",
      alignItems: "baseline",
      padding: "0.16em 0.3em",
      borderRadius: "0.3em",
      cursor: "text",
    },
    ".cm-md-prop:hover, .cm-md-prop:focus-within": { backgroundColor: ink.surface },
    /* One per property, and only there while the row is pointed at: a block of
       notes is read far more often than it is edited. */
    ".cm-md-prop-remove": {
      width: "1.3em",
      margin: "0",
      padding: "0",
      border: "none",
      background: "none",
      font: "inherit",
      lineHeight: "1",
      color: ink.muted,
      opacity: "0",
      cursor: "pointer",
      transition: "opacity 120ms ease, color 120ms ease",
    },
    ".cm-md-prop:hover .cm-md-prop-remove, .cm-md-prop:focus-within .cm-md-prop-remove, .cm-md-prop-remove:focus-visible":
      {
        opacity: "1",
      },
    ".cm-md-prop-remove:hover": { color: ink.accent },
    /* The fields are form controls wearing the document's clothes: no border,
       no background, the editor's own type - so the block reads as text right
       up until the caret lands in it. */
    ".cm-md-props input, .cm-md-props textarea": {
      width: "100%",
      margin: "0",
      padding: "0",
      border: "none",
      outline: "none",
      background: "transparent",
      font: "inherit",
      lineHeight: "inherit",
      color: "inherit",
      resize: "none",
      overflow: "hidden",
    },
    ".cm-md-props input::placeholder, .cm-md-props textarea::placeholder": {
      color: ink.muted,
      opacity: "0.6",
    },
    ".cm-md-prop-key": { color: ink.muted },
    ".cm-md-prop-value": { color: ink.text, fontWeight: "500" },
    ".cm-md-props input:focus, .cm-md-props textarea:focus": { color: ink.heading },
    ".cm-md-prop-add": {
      display: "block",
      margin: "0.3em 0 0",
      padding: "0.16em 0.3em",
      border: "none",
      background: "none",
      font: "inherit",
      fontSize: "0.95em",
      color: ink.muted,
      cursor: "pointer",
      transition: "color 120ms ease",
    },
    ".cm-md-prop-add:hover": { color: ink.accent },
    /* Inside the table's wrapper, whose padding keeps this margin from
       reaching the widget's own box - a margin there would put everything
       below the table out of step with where the editor thinks it is. */
    ".cm-md-table-add": {
      display: "block",
      margin: "0.35em 0 0",
      padding: "0.16em 0.3em",
      border: "none",
      background: "none",
      font: "inherit",
      fontSize: "0.85em",
      color: ink.muted,
      cursor: "pointer",
      opacity: "0",
      transition: "opacity 120ms ease, color 120ms ease",
    },
    ".cm-md-table-wrap:hover .cm-md-table-add, .cm-md-table-add:focus-visible": { opacity: "1" },
    ".cm-md-table-add:hover": { color: ink.accent },

    /* The same block with the caret in it: the YAML behind the properties,
       left as plain text rather than read as markdown. */
    ".cm-md-frontmatter": {
      fontFamily: CODE_FONT_FAMILY,
      fontSize: "0.85em",
      color: ink.muted,
    },

    /* ---- Images --------------------------------------------------------- */

    ".cm-md-image": {
      display: "inline-block",
      maxWidth: "100%",
      verticalAlign: "top",
      // For the resize handle, which sits in its corner.
      position: "relative",
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
    /* The corner a picture is resized by: there when the picture is pointed
       at, and for as long as it is being dragged. */
    ".cm-md-image-handle": {
      position: "absolute",
      right: "4px",
      bottom: "4px",
      width: "14px",
      height: "14px",
      borderRadius: "4px",
      backgroundColor: "var(--nuza-bg)",
      boxShadow: `0 0 0 1px ${ink.hairline}`,
      backgroundImage: `linear-gradient(135deg, transparent 0 45%, ${ink.muted} 45% 55%, transparent 55% 70%, ${ink.muted} 70% 80%, transparent 80%)`,
      cursor: "nwse-resize",
      opacity: "0",
      transition: "opacity 120ms ease",
    },
    ".cm-md-image:hover .cm-md-image-handle, .cm-md-image-resizing .cm-md-image-handle": { opacity: "0.9" },
    ".cm-md-image-broken .cm-md-image-handle": { display: "none" },
    /* Nothing under the pointer is selected or dragged off while a picture
       is being sized. */
    ".cm-md-image-resizing img": { pointerEvents: "none", userSelect: "none" },

    /* The small picture after a link to an image: a line tall and a bit more,
       set on the text's own baseline so it does not push the line apart. */
    ".cm-md-link-thumb": {
      display: "inline-block",
      marginLeft: "0.4em",
      verticalAlign: "middle",
      cursor: "zoom-in",
    },
    ".cm-md-link-thumb img": {
      display: "block",
      height: "1.7em",
      maxWidth: "4.5em",
      objectFit: "cover",
      borderRadius: "0.3em",
      boxShadow: `0 0 0 1px ${ink.hairline}`,
      opacity: "0",
      transition: "opacity 200ms ease, transform 140ms ease",
    },
    ".cm-md-link-thumb-loaded img": { opacity: "1" },
    ".cm-md-link-thumb:hover img": { transform: "scale(1.06)" },
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
    ".cm-md-math": { whiteSpace: "normal" },
    ".cm-md-math-block": { display: "block", padding: "0.5em 0", textAlign: "center", overflowX: "auto" },
    ".cm-md-math-source": { fontFamily: CODE_FONT_FAMILY, color: ink.code },
    ".cm-md-html": { whiteSpace: "normal" },
    ".cm-md-html-block": { display: "block", padding: "0.3em 0", overflowX: "auto" },
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
    ".cm-md-html h1, .cm-md-html h2, .cm-md-html h3, .cm-md-html h4, .cm-md-html h5, .cm-md-html h6": {
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
    /* As for a markdown table: columns no narrower than their longest word. */
    ".cm-md-html table": {
      overflowWrap: "break-word",
      wordBreak: "normal",
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

  { tag: [t.keyword, t.moduleKeyword], color: "var(--nuza-syntax-keyword)" },
  { tag: [t.controlKeyword, t.operatorKeyword], color: "var(--nuza-accent)" },
  { tag: [t.string, t.regexp], color: "var(--nuza-syntax-string)" },
  { tag: [t.number, t.bool, t.null], color: "var(--nuza-syntax-number)" },
  { tag: [t.variableName, t.propertyName], color: ink.text },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--nuza-syntax-function)" },
  { tag: [t.typeName, t.className, t.namespace], color: "var(--nuza-syntax-type)" },
  { tag: t.comment, color: ink.muted, fontStyle: "italic" },
  { tag: t.invalid, color: "var(--nuza-accent)" },
]);

/** The complete look of the writing surface: layout, colours and highlighting. */
export const nuzaEditorTheme = [editorTheme, syntaxHighlighting(markdownHighlighting)];

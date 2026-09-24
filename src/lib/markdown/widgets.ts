import { EditorView, WidgetType } from "@codemirror/view";
import { sanitizeHtml } from "./sanitize";
import { safeExternalHref } from "./sources";

/**
 * Emphasis, code, strikethrough and links, in that order of precedence. Only
 * used for text that is already inside a rendered widget - table cells - where
 * we have a plain string rather than a slice of the document to decorate.
 */
const INLINE_PATTERN =
  /(\*\*|__)([\s\S]+?)\1|(\*|_)([\s\S]+?)\3|~~([\s\S]+?)~~|`([^`]+)`|\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/g;

/** Unescapes the `\|` a table cell needs to carry a literal pipe. */
export function unescapeCell(text: string) {
  return text.replace(/\\\|/g, "|");
}

function inlineElement(match: RegExpExecArray): Node {
  if (match[2] !== undefined) return wrap("strong", "cm-md-strong", match[2]);
  if (match[4] !== undefined) return wrap("em", "cm-md-em", match[4]);
  if (match[5] !== undefined) return wrap("span", "cm-md-strike", match[5]);

  if (match[6] !== undefined) {
    const code = document.createElement("code");
    code.className = "cm-md-inline-code";
    code.textContent = match[6];
    return code;
  }

  const link = document.createElement("span");
  link.className = "cm-md-link";
  const href = safeExternalHref(match[8] ?? "");
  if (href) link.dataset.href = href;
  renderInline(link, match[7] ?? "");
  return link;
}

function wrap(tag: string, className: string, text: string) {
  const element = document.createElement(tag);
  element.className = className;
  renderInline(element, text);
  return element;
}

/**
 * Renders markdown emphasis into `parent` as real DOM nodes. Text always goes
 * through `textContent`, never `innerHTML`, so a note can never inject markup
 * into the editor.
 */
export function renderInline(parent: HTMLElement, text: string) {
  const pattern = new RegExp(INLINE_PATTERN.source, "g");
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > last) {
      parent.appendChild(document.createTextNode(text.slice(last, match.index)));
    }
    parent.appendChild(inlineElement(match));
    last = match.index + match[0].length;
  }

  if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

/** The `•`/`◦`/`▪` standing in for the `-`, `*` or `+` in the source. */
export class BulletWidget extends WidgetType {
  constructor(readonly depth: number) {
    super();
  }

  eq(other: BulletWidget) {
    return other.depth === this.depth;
  }

  toDOM() {
    const bullet = document.createElement("span");
    bullet.className = "cm-md-bullet";
    bullet.textContent = ["•", "◦", "▪"][this.depth % 3];
    // The source indent is a run of spaces, which is narrow in a proportional
    // font; this widens each level enough to read as a step.
    if (this.depth > 0) bullet.style.paddingLeft = `${this.depth * 0.9}em`;
    return bullet;
  }

  /** Clicking a bullet should put the caret on that line, as the text would. */
  ignoreEvent() {
    return false;
  }
}

/** A real checkbox in place of `[ ]` / `[x]`, which writes back on click. */
export class TaskWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
    readonly to: number
  ) {
    super();
  }

  eq(other: TaskWidget) {
    return other.checked === this.checked && other.from === this.from && other.to === this.to;
  }

  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-md-task";
    box.setAttribute("aria-label", "Toggle task");

    // Keep the caret in the document: without this the browser moves focus to
    // the input, and the editor loses its selection on every tick.
    box.addEventListener("mousedown", (event) => event.preventDefault());

    // The write happens on `click`, after the browser has already flipped the
    // box, and follows that flip rather than inverting it. Cancelling the
    // click instead would not help: the browser restores the pre-click state
    // *after* the listener runs, undoing whatever we had just written.
    //
    // The marker's position is read off the element rather than closed over,
    // because `updateDOM` reuses this input across edits - a closure over
    // `this.from` would go stale as soon as anything above it changed.
    box.addEventListener("click", () => {
      view.dispatch({
        changes: {
          from: Number(box.dataset.from),
          to: Number(box.dataset.to),
          insert: box.checked ? "[x]" : "[ ]",
        },
      });
    });

    this.updateDOM(box);
    return box;
  }

  /**
   * Toggling swaps in a new widget, and rebuilding the input from scratch
   * would put a finished checkbox on screen with no transition to play.
   * Updating the one that is already there lets the tick animate in.
   */
  updateDOM(dom: HTMLElement) {
    const box = dom as HTMLInputElement;
    box.checked = this.checked;
    box.dataset.from = String(this.from);
    box.dataset.to = String(this.to);
    return true;
  }

  ignoreEvent() {
    return true;
  }
}

/** Raw HTML from the note, rendered through the sanitiser in `sanitize.ts`. */
export class HtmlWidget extends WidgetType {
  constructor(
    readonly html: string,
    readonly directory: string,
    readonly block: boolean
  ) {
    super();
  }

  eq(other: HtmlWidget) {
    return other.html === this.html && other.directory === this.directory && other.block === this.block;
  }

  toDOM() {
    const wrapper = document.createElement(this.block ? "div" : "span");
    wrapper.className = this.block ? "cm-md-html cm-md-html-block" : "cm-md-html";
    wrapper.appendChild(sanitizeHtml(this.html, this.directory));
    return wrapper;
  }

  /** Clicking rendered HTML should put the caret in the source behind it. */
  ignoreEvent() {
    return false;
  }
}

/** `***` / `---` drawn as the rule it stands for. */
export class RuleWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-hr-wrap";

    const rule = document.createElement("hr");
    rule.className = "cm-md-hr";
    wrapper.appendChild(rule);

    return wrapper;
  }
}

/** An embedded image, falling back to its alt text when the file is missing. */
export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string
  ) {
    super();
  }

  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt;
  }

  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-md-image";

    const image = document.createElement("img");
    image.src = this.src;
    image.alt = this.alt;
    image.loading = "lazy";
    image.addEventListener("error", () => {
      wrapper.classList.add("cm-md-image-broken");
      wrapper.textContent = this.alt || "image not found";
    });

    wrapper.appendChild(image);
    return wrapper;
  }
}

export type TableAlignment = "left" | "center" | "right" | null;

export type TableCell = {
  text: string;
  /** Where this cell's text starts in the document, so a click can land there. */
  from: number;
};

export type TableRow = {
  cells: TableCell[];
  header: boolean;
};

/** A GFM table drawn as an actual table, with cells that are click-to-edit. */
export class TableWidget extends WidgetType {
  constructor(
    readonly rows: TableRow[],
    readonly alignment: TableAlignment[],
    /** Identity of the rendered result, so redraws only happen on real change. */
    readonly key: string
  ) {
    super();
  }

  eq(other: TableWidget) {
    return other.key === this.key;
  }

  toDOM(view: EditorView) {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-table-wrap";

    const table = document.createElement("table");
    table.className = "cm-md-table";
    const head = document.createElement("thead");
    const body = document.createElement("tbody");

    for (const row of this.rows) {
      const tr = document.createElement("tr");

      row.cells.forEach((cell, index) => {
        const td = document.createElement(row.header ? "th" : "td");
        const align = this.alignment[index];
        if (align) td.style.textAlign = align;
        td.dataset.pos = String(cell.from);
        renderInline(td, unescapeCell(cell.text));
        tr.appendChild(td);
      });

      (row.header ? head : body).appendChild(tr);
    }

    if (head.childNodes.length) table.appendChild(head);
    if (body.childNodes.length) table.appendChild(body);
    wrapper.appendChild(table);

    // Clicking a cell drops the caret into that cell's source text, which
    // immediately swaps the rendered table back for the markdown behind it.
    wrapper.addEventListener("mousedown", (event) => {
      const target = event.target as HTMLElement | null;
      const cell = target?.closest<HTMLElement>("[data-pos]");
      if (!cell) return;

      event.preventDefault();
      const position = Number(cell.dataset.pos);
      view.dispatch({ selection: { anchor: Math.min(position, view.state.doc.length) } });
      view.focus();
    });

    return wrapper;
  }

  ignoreEvent() {
    return true;
  }
}

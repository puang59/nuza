import { EditorView, WidgetType } from "@codemirror/view";
import { areaField, refresh, textField } from "./fields";
import { Property, frontmatterRange, readFrontmatter } from "./frontmatter";
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
  // Scanned to the end before a single node is built, because building one
  // recurses back in here for the text inside it - and the pattern is shared,
  // so a nested scan would otherwise wind this one's position on with it.
  // The alternative, a fresh regex per call, put one behind every cell of
  // every table on every redraw.
  INLINE_PATTERN.lastIndex = 0;
  const matches: RegExpExecArray[] = [];
  for (let match = INLINE_PATTERN.exec(text); match; match = INLINE_PATTERN.exec(text)) {
    matches.push(match);
  }

  let last = 0;
  for (const match of matches) {
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

/** The length of `[ ]` / `[x]`, the marker a checkbox stands in for. */
const MARKER_LENGTH = 3;

/** A real checkbox in place of `[ ]` / `[x]`, which writes back on click. */
export class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  eq(other: TaskWidget) {
    return other.checked === this.checked;
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
    // Where the marker is gets asked for at the moment of the click rather
    // than remembered: this widget outlives edits made above it, and a
    // position captured when it was built would by then point somewhere else.
    box.addEventListener("click", () => {
      const at = view.posAtDOM(box);
      const marker = view.state.doc.sliceString(at, at + MARKER_LENGTH);
      // If that is not a task marker the position is not to be trusted, and
      // writing to it would corrupt whatever is actually there.
      if (!/^\[[ xX]\]$/.test(marker)) return;

      view.dispatch({
        changes: { from: at, to: at + MARKER_LENGTH, insert: box.checked ? "[x]" : "[ ]" },
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
    (dom as HTMLInputElement).checked = this.checked;
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

    // Faded in once the bytes are there, so a picture arriving mid-scroll does
    // not snap into place. One already in cache is marked loaded in the same
    // frame, which is what keeps moving the caret past it from flickering.
    const reveal = () => wrapper.classList.add("cm-md-image-loaded");
    image.addEventListener("load", reveal);

    image.addEventListener("error", () => {
      reveal();
      wrapper.classList.add("cm-md-image-broken");
      wrapper.textContent = this.alt || "image not found";
    });

    wrapper.appendChild(image);
    if (image.complete) reveal();
    return wrapper;
  }
}

export type TableAlignment = "left" | "center" | "right" | null;

export type TableCell = {
  text: string;
  /**
   * Where this cell's text starts, counted from the start of the table rather
   * than from the start of the document - the table survives edits made above
   * it, which would leave an absolute position pointing at the wrong text.
   */
  offset: number;
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

  /** Where a cell's source sits right now, read back through the widget's own DOM. */
  private rangeOf(view: EditorView, wrapper: HTMLElement, cell: HTMLElement) {
    const from = view.posAtDOM(wrapper) + Number(cell.dataset.offset);
    return { from, to: from + Number(cell.dataset.length) };
  }

  /** Draws a cell as markdown, which is how it sits when nobody is in it. */
  private render(view: EditorView, wrapper: HTMLElement, cell: HTMLElement) {
    const { from, to } = this.rangeOf(view, wrapper, cell);
    cell.textContent = "";
    renderInline(cell, unescapeCell(view.state.doc.sliceString(from, to)));
  }

  /**
   * Turns one cell into a field, leaving the rest of the table as it is. The
   * editor's own caret is deliberately left where it was: moving it into the
   * table is what used to drop the whole thing back to its markdown.
   */
  private edit(view: EditorView, wrapper: HTMLElement, cell: HTMLElement) {
    if (cell.querySelector("input")) return;

    const { from, to } = this.rangeOf(view, wrapper, cell);
    const field = textField({
      className: "cm-md-cell",
      value: view.state.doc.sliceString(from, to),
      onInput: (text) => {
        const range = this.rangeOf(view, wrapper, cell);
        // A bare pipe would start a new column, and a newline a new row.
        const insert = text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
        if (view.state.doc.sliceString(range.from, range.to) === insert) return;

        cell.dataset.length = String(insert.length);
        view.dispatch({ changes: { from: range.from, to: range.to, insert } });
      },
      onCommit: () => field.blur(),
    });

    field.addEventListener("blur", () => this.render(view, wrapper, cell));

    cell.textContent = "";
    cell.appendChild(field);
    field.focus();
    field.select();
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
        td.dataset.offset = String(cell.offset);
        td.dataset.length = String(cell.text.length);
        renderInline(td, unescapeCell(cell.text));
        tr.appendChild(td);
      });

      (row.header ? head : body).appendChild(tr);
    }

    if (head.childNodes.length) table.appendChild(head);
    if (body.childNodes.length) table.appendChild(body);
    wrapper.appendChild(table);

    wrapper.addEventListener("mousedown", (event) => {
      const cell = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-offset]");
      if (!cell || cell.querySelector("input")) return;

      event.preventDefault();
      this.edit(view, wrapper, cell);
    });

    // Adding or removing whole rows is a thing you do to the markdown rather
    // than to a cell, so a double click still hands the table's source over.
    wrapper.addEventListener("dblclick", (event) => {
      const cell = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-offset]");
      if (!cell) return;

      event.preventDefault();
      const { from } = this.rangeOf(view, wrapper, cell);
      view.dispatch({ selection: { anchor: Math.min(from, view.state.doc.length) } });
      view.focus();
    });

    return wrapper;
  }

  /**
   * Keeps the drawn cells in step with the document. The cell being typed in
   * is left alone - it is the one thing on screen that is already right.
   */
  updateDOM(dom: HTMLElement, view: EditorView) {
    const cells = dom.querySelectorAll<HTMLElement>("[data-offset]");
    const flat = this.rows.flatMap((row) => row.cells);
    if (cells.length !== flat.length) return false;

    flat.forEach((cell, index) => {
      const element = cells[index];
      element.dataset.offset = String(cell.offset);
      element.dataset.length = String(cell.text.length);
      if (!element.querySelector("input")) {
        element.textContent = "";
        renderInline(element, unescapeCell(cell.text));
      }
    });

    void view;
    return true;
  }

  ignoreEvent() {
    return true;
  }
}

/**
 * A note's frontmatter, as the short form it actually is: the key stepped
 * back, the value in front of it, and a way to add another.
 *
 * The fields write straight back into the YAML underneath, so the block never
 * has to fall back to its source to be edited. Where each property lives is
 * looked up at the moment of the keystroke rather than remembered, because the
 * positions move as the text does and this widget outlives its own edits.
 */
export class PropertiesWidget extends WidgetType {
  constructor(
    readonly properties: Property[],
    /** Identity of the rendered result, so it only redraws on real change. */
    readonly key: string
  ) {
    super();
  }

  eq(other: PropertiesWidget) {
    return other.key === this.key;
  }

  /** The property at `index` as it stands right now, or null if it has gone. */
  private current(view: EditorView, index: number) {
    const range = frontmatterRange(view.state.doc);
    if (!range) return null;
    return readFrontmatter(view.state.doc, range)?.[index] ?? null;
  }

  private write(view: EditorView, index: number, part: "key" | "value", text: string) {
    const property = this.current(view, index);
    if (!property) return;

    const [from, to] =
      part === "key" ? [property.keyFrom, property.keyTo] : [property.valueFrom, property.valueTo];
    // A newline would end the property, and a stray one arriving by paste
    // would quietly break the block in half.
    const insert = text.replace(/\r?\n/g, " ");
    if (view.state.doc.sliceString(from, to) === insert) return;

    view.dispatch({ changes: { from, to, insert } });
  }

  /**
   * Takes the whole property out, line and newline together - leaving the line
   * behind would put a blank row in the block, and leaving the newline would
   * weld the next property onto the one above it.
   */
  private remove(view: EditorView, index: number) {
    const property = this.current(view, index);
    if (!property) return;

    const line = view.state.doc.lineAt(property.keyFrom);
    view.dispatch({ changes: { from: line.from, to: Math.min(line.to + 1, view.state.doc.length) } });
  }

  toDOM(view: EditorView) {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-props";

    this.properties.forEach((property, index) => {
      const row = document.createElement("div");
      row.className = "cm-md-prop";

      const key = textField({
        className: "cm-md-prop-key",
        value: property.key,
        placeholder: "key",
        onInput: (text) => this.write(view, index, "key", text),
        onCommit: () => row.querySelector<HTMLTextAreaElement>(".cm-md-prop-value")?.focus(),
      });

      const value = areaField({
        className: "cm-md-prop-value",
        value: property.value,
        onInput: (text) => this.write(view, index, "value", text),
        onCommit: () => (document.activeElement as HTMLElement | null)?.blur(),
      });

      // Kept out of the way until the row is pointed at or typed in, so the
      // block still reads as text rather than as a list of controls.
      const remove = document.createElement("button");
      remove.className = "cm-md-prop-remove";
      remove.type = "button";
      remove.textContent = "×";
      remove.title = `Delete ${property.key || "property"}`;
      remove.setAttribute("aria-label", `Delete ${property.key || "property"}`);
      remove.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.remove(view, index);
      });

      row.append(key, value, remove);
      wrapper.appendChild(row);
    });

    const add = document.createElement("button");
    add.className = "cm-md-prop-add";
    add.textContent = "+ Add property";
    add.addEventListener("mousedown", (event) => {
      event.preventDefault();

      const range = frontmatterRange(view.state.doc);
      if (!range) return;

      const at = view.state.doc.line(range.closingLine).from;
      view.dispatch({ changes: { from: at, insert: "key: \n" } });

      // The new row only exists once the editor has drawn it, and drawing it
      // may have replaced this whole block - so the field is looked for in the
      // editor rather than in the wrapper this handler was built with.
      requestAnimationFrame(() => {
        const keys = view.dom.querySelectorAll<HTMLInputElement>(".cm-md-prop-key");
        const last = keys[keys.length - 1];
        last?.focus();
        last?.select();
      });
    });
    wrapper.appendChild(add);

    return wrapper;
  }

  /**
   * Keeps the fields in step with the document without rebuilding them - the
   * one being typed into is left alone, since replacing its contents would
   * throw the caret to the end on every keystroke.
   */
  updateDOM(dom: HTMLElement, view: EditorView) {
    const rows = dom.querySelectorAll<HTMLElement>(".cm-md-prop");
    if (rows.length !== this.properties.length) return false;

    this.properties.forEach((property, index) => {
      const row = rows[index];
      const key = row.querySelector<HTMLInputElement>(".cm-md-prop-key");
      const value = row.querySelector<HTMLTextAreaElement>(".cm-md-prop-value");
      const remove = row.querySelector<HTMLButtonElement>(".cm-md-prop-remove");
      if (key) refresh(key, property.key);
      if (value) refresh(value, property.value);
      if (remove) {
        const label = `Delete ${property.key || "property"}`;
        remove.title = label;
        remove.setAttribute("aria-label", label);
      }
    });

    void view;
    return true;
  }

  ignoreEvent() {
    return true;
  }
}

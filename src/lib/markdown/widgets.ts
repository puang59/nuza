import { syntaxTree } from "@codemirror/language";
import { EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { areaField, refresh, textField } from "./fields";
import { Property, frontmatterRange, readFrontmatter } from "./frontmatter";
import { DEFAULT_EDITOR_FONT_SIZE } from "../fonts";
import { clampImageWidth, withImageWidth } from "./imageSize";
import { renderHtml } from "./sanitize";
import { showLightbox } from "./lightbox";
import { safeExternalHref } from "./sources";
import { showPopupMenu } from "./popupMenu";
import {
  TableModel,
  cellAt,
  deleteColumn,
  deleteRow,
  formatTable,
  insertColumn,
  insertRow,
  parseTable,
} from "./tableEdit";

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

/**
 * A cell's text as it has to be written in the table: a bare pipe would start
 * a new column, and a newline a new row. The other half of `unescapeCell`.
 */
export function escapeCell(text: string) {
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
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
    wrapper.appendChild(renderHtml(this.html, this.directory));
    return wrapper;
  }

  /** Clicking rendered HTML should put the caret in the source behind it. */
  ignoreEvent() {
    return false;
  }
}

/**
 * KaTeX is the largest thing the editor can ask for, and most notes have no
 * math in them, so it is fetched the first time a note shows some.
 */
let katex: Promise<typeof import("katex").default> | null = null;

function loadKatex() {
  katex ??= import("katex").then((module) => module.default);
  return katex;
}

/**
 * TeX drawn as the math it stands for. Rendered as MathML, which the webviews
 * nuza runs in all draw themselves: that needs none of KaTeX's stylesheet or
 * fonts, so the app does not grow by a megabyte of typefaces for it.
 */
export class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly block: boolean
  ) {
    super();
  }

  eq(other: MathWidget) {
    return other.tex === this.tex && other.block === this.block;
  }

  toDOM(view: EditorView) {
    const wrapper = document.createElement(this.block ? "div" : "span");
    wrapper.className = this.block ? "cm-md-math cm-md-math-block" : "cm-md-math";
    // The source stands in for the few milliseconds the first render takes.
    wrapper.textContent = this.tex;

    loadKatex().then(
      (renderer) => {
        wrapper.textContent = "";
        renderer.render(this.tex, wrapper, {
          displayMode: this.block,
          output: "mathml",
          throwOnError: false,
        });
        // A block changes height when it is drawn; the editor has to hear it.
        view.requestMeasure();
      },
      () => {
        // The chunk did not load: the source it already shows is the fallback.
      }
    );
    return wrapper;
  }

  /** Clicking rendered math should put the caret in the TeX behind it. */
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
    /** Where the picture is, or empty for one that could not be found. */
    readonly src: string,
    readonly alt: string,
    /** How wide to draw it, in pixels, when the note says. */
    readonly width: number | null = null
  ) {
    super();
  }

  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt && other.width === this.width;
  }

  toDOM(view: EditorView) {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-md-image";

    // Nothing to load: said straight away, rather than left to an `<img>`
    // with no source, which never reports that it failed.
    if (!this.src) {
      wrapper.classList.add("cm-md-image-loaded", "cm-md-image-broken");
      wrapper.textContent = this.alt || "image not found";
      return wrapper;
    }

    const image = document.createElement("img");
    image.src = this.src;
    image.alt = this.alt;
    image.loading = "lazy";
    // Still held to the column by the stylesheet's `max-width`.
    if (this.width) image.style.width = `${this.width}px`;

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
    wrapper.appendChild(this.resizeHandle(view, wrapper, image));
    if (image.complete) reveal();
    return wrapper;
  }

  /**
   * The corner a picture is resized by. Dragging it sizes the picture as it
   * goes, and letting go writes the width into the note - after a bar in the
   * alt text or the embed, which is where other tools look for it. A double
   * click takes the width off again.
   */
  private resizeHandle(view: EditorView, wrapper: HTMLElement, image: HTMLImageElement) {
    const handle = document.createElement("span");
    handle.className = "cm-md-image-handle";
    handle.title = "Drag to resize, double-click to reset";
    handle.setAttribute("aria-hidden", "true");

    /** Rewrites the source behind this picture to carry `width`, or none. */
    const write = (width: number | null) => {
      const at = view.posAtDOM(wrapper);
      let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(at, 1);
      while (node && node.name !== "Image" && node.name !== "WikiEmbed") node = node.parent;
      if (!node) return;

      const source = view.state.sliceDoc(node.from, node.to);
      const insert = withImageWidth(source, width);
      if (insert === null || insert === source) return;
      view.dispatch({ changes: { from: node.from, to: node.to, insert }, userEvent: "input.resize" });
    };

    handle.addEventListener("pointerdown", (down) => {
      if (down.button !== 0) return;
      // The drag is the handle's: it must not put the caret in the line, which
      // would swap the picture for its markdown under the pointer.
      down.preventDefault();
      down.stopPropagation();
      handle.setPointerCapture(down.pointerId);
      wrapper.classList.add("cm-md-image-resizing");

      const startX = down.clientX;
      const startWidth = image.getBoundingClientRect().width;
      let width = startWidth;

      const move = (event: PointerEvent) => {
        width = clampImageWidth(startWidth + (event.clientX - startX));
        image.style.width = `${width}px`;
      };
      const finish = (event: PointerEvent) => {
        handle.releasePointerCapture(event.pointerId);
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", finish);
        handle.removeEventListener("pointercancel", finish);
        wrapper.classList.remove("cm-md-image-resizing");
        // Held to the column by the stylesheet, so what is written is the
        // width it was actually drawn at.
        const drawn = Math.round(image.getBoundingClientRect().width);
        if (Math.abs(drawn - startWidth) >= 1) write(drawn);
      };

      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("pointercancel", finish);
    });

    // Kept from the editor, like the press that starts a drag.
    handle.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    handle.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      write(null);
    });

    return handle;
  }
}

/**
 * A small picture after a link to an image in the vault, which opens it large
 * when clicked. The link's own text is left as it is: this sits beside it, so
 * the note still reads the way it was written.
 */
export class LinkThumbnailWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string
  ) {
    super();
  }

  eq(other: LinkThumbnailWidget) {
    return other.src === this.src && other.alt === this.alt;
  }

  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-md-link-thumb";
    wrapper.title = this.alt ? `Preview ${this.alt}` : "Preview";

    const image = document.createElement("img");
    image.src = this.src;
    image.alt = this.alt;
    image.loading = "lazy";

    const reveal = () => wrapper.classList.add("cm-md-link-thumb-loaded");
    image.addEventListener("load", reveal);
    // A picture that is not there is not worth a hole in the line.
    image.addEventListener("error", () => wrapper.remove());
    if (image.complete) reveal();

    wrapper.appendChild(image);
    wrapper.addEventListener("click", (event) => {
      event.preventDefault();
      showLightbox(this.src, this.alt);
    });
    return wrapper;
  }

  /** The click is the thumbnail's: it must not also put the caret in the line. */
  ignoreEvent() {
    return true;
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

/**
 * How tall a rendered table is likely to be, in pixels, worked out from the
 * metrics in `.cm-md-table` (theme.ts) rather than measured.
 *
 * The editor places everything below a table by the height it believes the
 * table has, and only learns the real one once the table has been drawn in
 * the viewport. Left to guess, it sizes the block by the lines of source it
 * replaces - which is one row out, ignores the cell padding and the "add row"
 * button under the table, and is wrong by more with every row. A guess close
 * enough to the real height is what keeps the page from jumping when the
 * table above the viewport is measured. Cells whose text wraps make the real
 * table taller than this; that is the remaining jump, and it is the smaller.
 */
export function estimateTableHeight(rowCount: number, fontSize = DEFAULT_EDITOR_FONT_SIZE) {
  // The table's own font is 0.94em, so its line and its cell padding are too.
  const row = 0.94 * (1.5 + 2 * 0.4);
  // Top and bottom padding of the wrapper.
  const wrapper = 2 * 0.5;
  // The add-row button: 0.85em type at the editor's 1.75 line height, its own
  // vertical padding, and the margin above it.
  const add = 0.85 * (1.75 + 2 * 0.16 + 0.35);
  // The collapsed borders are a pixel a row, and one more under the last.
  return Math.round((wrapper + add + row * rowCount) * fontSize + rowCount + 1);
}

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

  get estimatedHeight() {
    return estimateTableHeight(this.rows.length);
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
      // As the cell reads, not as it is written: a pipe is shown as a pipe and
      // escaped again on the way back. Filled with the source, the field held
      // the backslash of an escaped pipe as well, and escaping that a second
      // time left a backslash followed by a pipe that split the cell in two.
      value: unescapeCell(view.state.doc.sliceString(from, to)),
      onInput: (text) => {
        const range = this.rangeOf(view, wrapper, cell);
        const insert = escapeCell(text);
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

  /** The whole table's source, from the start of its first line to the end of its last. */
  private tableRange(view: EditorView, wrapper: HTMLElement) {
    const start = view.posAtDOM(wrapper);
    for (
      let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(start, 1);
      node;
      node = node.parent
    ) {
      if (node.name === "Table") {
        const doc = view.state.doc;
        return { from: doc.lineAt(node.from).from, to: doc.lineAt(node.to).to };
      }
    }
    return null;
  }

  /**
   * Rewrites the table with `change` made to it, and puts a field in the cell
   * at `focus` in the table that comes back - a new row or column is there to
   * be typed into. The table is found again by where it starts, which a
   * change to the table itself never moves.
   */
  private restructure(
    view: EditorView,
    wrapper: HTMLElement,
    change: (model: TableModel) => TableModel,
    focus?: { row: number; column: number }
  ) {
    const range = this.tableRange(view, wrapper);
    if (!range) return;
    const model = parseTable(view.state.sliceDoc(range.from, range.to));
    if (!model) return;

    const next = change(model);
    const insert = formatTable(next);
    if (insert === view.state.sliceDoc(range.from, range.to)) return;
    view.dispatch({ changes: { from: range.from, to: range.to, insert }, userEvent: "input.table" });

    if (!focus) return;
    requestAnimationFrame(() => {
      const table = Array.from(view.dom.querySelectorAll<HTMLElement>(".cm-md-table-wrap")).find(
        (candidate) => view.posAtDOM(candidate) === range.from
      );
      const columns = next.header.length;
      const cell =
        table?.querySelectorAll<HTMLElement>("[data-offset]")[(focus.row + 1) * columns + focus.column];
      // Through the table's own handler, which is what turns a cell into a field.
      cell?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
  }

  /** The row and column edits for the cell that was right-clicked. */
  private openCellMenu(view: EditorView, wrapper: HTMLElement, cell: HTMLElement, event: MouseEvent) {
    const range = this.tableRange(view, wrapper);
    if (!range) return;
    const source = view.state.sliceDoc(range.from, range.to);
    const model = parseTable(source);
    const at = cellAt(source, Number(cell.dataset.offset));
    if (!model || !at) return;

    const { row, column } = at;
    const edit = (change: (m: TableModel) => TableModel, focus?: { row: number; column: number }) => () =>
      this.restructure(view, wrapper, change, focus);

    showPopupMenu(event.clientX, event.clientY, [
      ...(row >= 0
        ? [{ label: "Insert Row Above", onSelect: edit((m) => insertRow(m, row), { row, column }) }]
        : []),
      { label: "Insert Row Below", onSelect: edit((m) => insertRow(m, row + 1), { row: row + 1, column }) },
      { label: "Insert Column Left", onSelect: edit((m) => insertColumn(m, column), { row, column }) },
      {
        label: "Insert Column Right",
        onSelect: edit((m) => insertColumn(m, column + 1), { row, column: column + 1 }),
      },
      ...(row >= 0 ? [{ label: "Delete Row", danger: true, onSelect: edit((m) => deleteRow(m, row)) }] : []),
      ...(model.header.length > 1
        ? [{ label: "Delete Column", danger: true, onSelect: edit((m) => deleteColumn(m, column)) }]
        : []),
    ]);
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

    const add = document.createElement("button");
    add.type = "button";
    add.className = "cm-md-table-add";
    add.textContent = "+ Add row";
    add.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const rows = this.rows.filter((row) => !row.header).length;
      this.restructure(view, wrapper, (model) => insertRow(model, model.rows.length), {
        row: rows,
        column: 0,
      });
    });
    wrapper.appendChild(add);

    // Rows and columns, from the cell they are relative to. Kept from the
    // editor's own menu, which has nothing to offer inside a table.
    wrapper.addEventListener("contextmenu", (event) => {
      const cell = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-offset]");
      if (!cell) return;
      event.preventDefault();
      event.stopPropagation();
      this.openCellMenu(view, wrapper, cell, event);
    });

    wrapper.addEventListener("mousedown", (event) => {
      // The left button only: a right click is for the cell's menu, and
      // opening the cell underneath it as well selected its text for nothing.
      if (event.button !== 0) return;
      const cell = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-offset]");
      if (!cell || cell.querySelector("input")) return;

      event.preventDefault();
      this.edit(view, wrapper, cell);
    });

    // The table's source is still a double click away, for anything the
    // menu does not do - alignment, above all.
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

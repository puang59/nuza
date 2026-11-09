import { beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { Compartment, EditorState } from "@codemirror/state";
import {
  codeBlockRenderers,
  RenderedCodeBlockWidget,
  type CodeBlockRenderer,
} from "../src/lib/markdown/codeBlocks";
import { liveMarkdownPreview } from "../src/lib/markdown/livePreview";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";

beforeAll(() => {
  const window = new Window();
  globalThis.document = window.document as unknown as Document;
});

const view = { requestMeasure() {} } as never;

function renderer(language: string, overrides: Partial<CodeBlockRenderer> = {}): CodeBlockRenderer {
  return { language, render: (source, el) => void (el.textContent = `drawn: ${source}`), ...overrides };
}

/** The widgets live preview puts in `doc`, with the caret at `caret`. */
function widgetsIn(doc: string, renderers: CodeBlockRenderer[], caret = 0) {
  const state = EditorState.create({
    doc,
    selection: { anchor: caret },
    extensions: [markdown(), renderers.map((r) => codeBlockRenderers.of(r)), liveMarkdownPreview],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const found: RenderedCodeBlockWidget[] = [];
  state.field(liveMarkdownPreview).between(0, state.doc.length, (_from, _to, decoration) => {
    const widget = decoration.spec.widget;
    if (widget instanceof RenderedCodeBlockWidget) found.push(widget);
  });
  return found;
}

const NOTE = "Before\n\n```chart\na: 1\n```\n\nAfter\n";

describe("code block renderers", () => {
  test("draw a block in their language while the caret is elsewhere", () => {
    const [widget] = widgetsIn(NOTE, [renderer("chart")]);
    expect(widget.source).toBe("a: 1");
    expect(widget.toDOM(view).textContent).toBe("drawn: a: 1");
  });

  test("leave the block as source while the caret is in it", () => {
    expect(widgetsIn(NOTE, [renderer("chart")], NOTE.indexOf("a: 1"))).toHaveLength(0);
  });

  test("leave blocks in other languages alone", () => {
    expect(widgetsIn(NOTE, [renderer("plot")])).toHaveLength(0);
  });

  test("match the fence's language whatever its case", () => {
    expect(widgetsIn(NOTE.replace("chart", "Chart"), [renderer("chart")])).toHaveLength(1);
  });

  test("keep a language for whichever claimed it first", () => {
    const first = renderer("chart");
    const [widget] = widgetsIn(NOTE, [first, renderer("chart")]);
    expect(widget.renderer).toBe(first);
  });

  test("show the source and why when drawing fails", () => {
    const [widget] = widgetsIn(NOTE, [
      renderer("chart", {
        render() {
          throw new Error("bad data");
        },
      }),
    ]);
    const el = widget.toDOM(view);
    expect(el.querySelector("pre")?.textContent).toBe("a: 1");
    expect(el.textContent).toContain("bad data");
  });

  test("clean up the drawing when it is thrown away", () => {
    let cleaned = 0;
    const [widget] = widgetsIn(NOTE, [renderer("chart", { render: () => () => void cleaned++ })]);
    const el = widget.toDOM(view);
    widget.destroy(el);
    widget.destroy(el);
    expect(cleaned).toBe(1);
  });

  test("are drawn again only when the source changes", () => {
    const chart = renderer("chart");
    expect(new RenderedCodeBlockWidget(chart, "a").eq(new RenderedCodeBlockWidget(chart, "a"))).toBe(true);
    expect(new RenderedCodeBlockWidget(chart, "a").eq(new RenderedCodeBlockWidget(chart, "b"))).toBe(false);
  });

  test("added to an open note, draw its blocks straight away", () => {
    const additions = new Compartment();
    let state = EditorState.create({
      doc: NOTE,
      extensions: [markdown(), additions.of([]), liveMarkdownPreview],
    });
    ensureSyntaxTree(state, state.doc.length, 5000);
    state = state.update({ effects: additions.reconfigure(codeBlockRenderers.of(renderer("chart"))) }).state;

    let drawn = 0;
    state.field(liveMarkdownPreview).between(0, state.doc.length, (_from, _to, decoration) => {
      if (decoration.spec.widget instanceof RenderedCodeBlockWidget) drawn++;
    });
    expect(drawn).toBe(1);
  });
});

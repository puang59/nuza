import { Facet } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";

/** What a renderer is told about the block it is drawing. */
export interface CodeBlockContext {
  /** The block's language, as written after the fence, lower-cased. */
  language: string;
  view: EditorView;
}

/**
 * Draws fenced code blocks of one language as something other than code: a
 * ```mermaid block as its diagram, say. The block is drawn whenever the caret
 * is not in it, and opens back up as source when it is.
 */
export interface CodeBlockRenderer {
  /** Lower-cased, as written after the fence. */
  language: string;
  /** Given to the block's element, beside `cm-md-codeblock`. */
  className?: string;
  /**
   * Fills `el` from the block's source. What it hands back is called when the
   * drawing is thrown away - the source changed, the caret went in, the note
   * closed.
   */
  render(source: string, el: HTMLElement, context: CodeBlockContext): void | (() => void) | Promise<void>;
  /**
   * Events on the drawing the editor should leave alone - a button inside it,
   * say. By default a click anywhere on it puts the caret in the source, as
   * math does.
   */
  ignoreEvent?(event: Event): boolean;
}

/**
 * Every renderer the editor has, by language. The first to claim a language
 * keeps it - nuza's own come first - so a second can never quietly take over
 * a kind of block someone is used to seeing drawn one way.
 */
export const codeBlockRenderers = Facet.define<CodeBlockRenderer, ReadonlyMap<string, CodeBlockRenderer>>({
  combine(renderers) {
    const byLanguage = new Map<string, CodeBlockRenderer>();
    for (const renderer of renderers) {
      const language = renderer.language.toLowerCase();
      if (!byLanguage.has(language)) byLanguage.set(language, renderer);
    }
    return byLanguage;
  },
});

/**
 * What to call when a drawn block's element is thrown away. Kept by element,
 * not by widget: when a new widget is equal to the old one, CodeMirror keeps
 * the element and hands it to the new widget, which is then the one told to
 * destroy it.
 */
const cleanups = new WeakMap<HTMLElement, () => void>();

/**
 * A code block drawn by its renderer. Drawn again only when the source or the
 * renderer changes, not on every edit elsewhere in the note.
 */
export class RenderedCodeBlockWidget extends WidgetType {
  constructor(
    readonly renderer: CodeBlockRenderer,
    readonly source: string
  ) {
    super();
  }

  eq(other: RenderedCodeBlockWidget) {
    return other.renderer === this.renderer && other.source === this.source;
  }

  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = this.renderer.className ? `cm-md-codeblock ${this.renderer.className}` : "cm-md-codeblock";
    const context = { language: this.renderer.language.toLowerCase(), view };

    const failed = (error: unknown) => {
      el.replaceChildren(fallback(this.source, error));
      view.requestMeasure();
    };

    try {
      const result = this.renderer.render(this.source, el, context);
      if (typeof result === "function") cleanups.set(el, result);
      else if (result instanceof Promise) {
        result.then(
          () => view.requestMeasure(),
          (error) => failed(error)
        );
      }
    } catch (error) {
      failed(error);
    }
    return el;
  }

  destroy(el: HTMLElement) {
    const cleanup = cleanups.get(el);
    if (!cleanup) return;
    cleanups.delete(el);
    try {
      cleanup();
    } catch (error) {
      console.error(`Failed to clean up a drawn \`${this.renderer.language}\` block:`, error);
    }
  }

  ignoreEvent(event: Event) {
    return this.renderer.ignoreEvent?.(event) ?? false;
  }
}

/** The source as plain code, with why it could not be drawn underneath: never a blank gap. */
function fallback(source: string, error: unknown) {
  const box = document.createElement("div");
  box.className = "cm-md-codeblock-failed";
  const code = document.createElement("pre");
  code.textContent = source;
  const reason = document.createElement("p");
  reason.textContent = `Couldn't draw this block: ${error instanceof Error ? error.message : String(error)}`;
  box.append(code, reason);
  return box;
}

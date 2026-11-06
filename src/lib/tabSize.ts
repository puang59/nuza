import { EditorState, Extension } from "@codemirror/state";
import { indentUnit } from "@codemirror/language";

/**
 * How far Tab indents, in spaces: a nested point, a line of code, a row of
 * HTML. A tab typed mid-sentence is drawn this wide too, so the two agree.
 */
export type TabSize = 2 | 4 | 8;

export const TAB_SIZES: TabSize[] = [2, 4, 8];

/** CodeMirror's own indent, which is what Tab did before this was a setting. */
export const DEFAULT_TAB_SIZE: TabSize = 2;

export function isTabSize(value: unknown): value is TabSize {
  return TAB_SIZES.includes(value as TabSize);
}

export function tabSizeExtension(size: TabSize): Extension {
  return [indentUnit.of(" ".repeat(size)), EditorState.tabSize.of(size)];
}

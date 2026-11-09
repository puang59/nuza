import type { Extension } from "@codemirror/state";
import { Registry } from "./registry";

/** A CodeMirror extension added to every note's editor, after nuza's own. */
export interface EditorExtensionSpec {
  id: string;
  extension: Extension;
}

/** The extensions added to this window's editors. */
export const editorExtensions = new Registry<EditorExtensionSpec>();

let lastList: readonly EditorExtensionSpec[] | null = null;
let lastExtension: Extension = [];

/**
 * Every added extension, as one. The same value until the registry changes,
 * so handing it to an editor that already has it costs nothing.
 */
export function addedExtensions(): Extension {
  const list = editorExtensions.list();
  if (list !== lastList) {
    lastList = list;
    lastExtension = list.map((spec) => spec.extension);
  }
  return lastExtension;
}

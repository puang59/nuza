/**
 * The tree row currently being dragged, for the length of one drag.
 *
 * A drag that starts in the sidebar and ends in the editor crosses from React
 * into CodeMirror, and the two only meet at the module level. The obvious
 * alternative - hanging the path off the drag's `DataTransfer` - cannot be read
 * back during `dragover`, which is exactly when the editor has to decide
 * whether it is willing to take the drop.
 */
export interface DraggedEntry {
  path: string;
  isDirectory: boolean;
}

let dragged: DraggedEntry | null = null;

export function setDraggedEntry(entry: DraggedEntry | null) {
  dragged = entry;
}

/** The row being dragged, or null if the drag came from outside the app. */
export function draggedEntry() {
  return dragged;
}

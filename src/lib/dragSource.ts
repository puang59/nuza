import { useSyncExternalStore } from "react";

/**
 * What is being dragged in the file tree, and which row the pointer is over.
 *
 * Module state rather than React state, for two reasons.
 *
 * A drag that starts in the sidebar and ends in the editor crosses from React
 * into CodeMirror, and the two only meet at the module level. The obvious
 * alternative - hanging the path off the drag's `DataTransfer` - cannot be read
 * back during `dragover`, which is exactly when the editor has to decide
 * whether it is willing to take the drop.
 *
 * And `dragover` fires on every pointer move. While these two paths were React
 * state on the sidebar, each of those frames re-rendered the panel, which built
 * a new tree context, which re-rendered every row in the vault - thousands of
 * components per animation frame to move one highlight. Here, a row subscribes
 * to the one question it actually asks - am I the row being dragged, am I the
 * row under the pointer - so a frame re-renders the two rows whose answer just
 * changed and nothing else.
 */
export interface DraggedEntry {
  path: string;
  isDirectory: boolean;
}

let dragged: DraggedEntry | null = null;
/** Everything being dragged: the row taken hold of, or every row picked with it. */
let group: readonly string[] = [];
let over: string | null = null;

const listeners = new Set<() => void>();

function announce() {
  for (const listener of listeners) listener();
}

/**
 * Called whenever either half of the drag changes. The hooks below are the
 * only consumers in the app; it is exported so that the announcing itself can
 * be tested, since how often it happens is the whole point of this module.
 */
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setDraggedEntry(entry: DraggedEntry | null, picked?: readonly string[]) {
  const next = entry ? (picked && picked.length > 1 ? picked : [entry.path]) : [];
  if (dragged?.path === entry?.path && next.length === group.length) return;
  dragged = entry;
  group = next;
  announce();
}

/** Every path being dragged - more than one when picked rows are dragged together. */
export function draggedPaths(): readonly string[] {
  return group;
}

/** The row being dragged, or null if the drag came from outside the app. */
export function draggedEntry() {
  return dragged;
}

/** Its path, which is all the tree itself needs to know. */
export function draggedPath() {
  return dragged?.path ?? null;
}

export function setDragOver(path: string | null) {
  if (over === path) return;
  over = path;
  announce();
}

/** Clears both, for a drop or a drag that ended anywhere at all. */
export function endDrag() {
  if (!dragged && over === null) return;
  dragged = null;
  group = [];
  over = null;
  announce();
}

/** Whether `path` is the row being dragged. */
export function useIsDragged(path: string) {
  return useSyncExternalStore(
    subscribe,
    () => group.includes(path),
    () => false
  );
}

/** Whether `path` is the row the pointer is currently over. */
export function useIsDragOver(path: string) {
  return useSyncExternalStore(
    subscribe,
    () => over === path,
    () => false
  );
}

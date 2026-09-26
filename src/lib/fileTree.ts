import { FileEntry } from "./types";

/**
 * The file tree, edited in place.
 *
 * Creating or renaming a note changes one row in a vault that may hold
 * thousands, so the tree is patched where it changed rather than read back off
 * disk - a re-read costs a walk of every directory and a fresh copy of the
 * whole tree across the process boundary, for a result that differs in one
 * entry.
 */

/** The separator the host is already using, inferred from the path itself. */
function separatorFor(path: string) {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

function lastSeparator(path: string) {
  return Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
}

/** The directory part of a path, for either separator style. */
export function parentOf(path: string) {
  const index = lastSeparator(path);
  return index < 0 ? "" : path.slice(0, index);
}

/** The final segment of a path, for either separator style. */
export function nameOf(path: string) {
  return path.slice(lastSeparator(path) + 1);
}

export function joinPath(parent: string, name: string) {
  return `${parent}${separatorFor(parent)}${name}`;
}

/** True if `path` is `ancestor` itself, or lives somewhere underneath it. */
function isWithin(path: string, ancestor: string) {
  return path === ancestor || path.startsWith(ancestor + "/") || path.startsWith(ancestor + "\\");
}

/** Directories first, then by name - the order the backend hands the tree over in. */
function inOrder(entries: FileEntry[]) {
  return entries.slice().sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    const left = a.name.toLowerCase();
    const right = b.name.toLowerCase();
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/**
 * Replaces the children of the directory at `path`. Only the branch leading to
 * it is rebuilt; every other subtree is carried over by reference, so a change
 * deep in the tree leaves the rest of it untouched for React to skip over.
 */
function updateDirectory(
  nodes: FileEntry[],
  path: string,
  change: (children: FileEntry[]) => FileEntry[]
): FileEntry[] {
  return nodes.map((node) => {
    if (!node.isDirectory || !isWithin(path, node.path)) return node;
    if (node.path === path) return { ...node, children: change(node.children ?? []) };
    return { ...node, children: updateDirectory(node.children ?? [], path, change) };
  });
}

/** The entry at `path`, or null if the tree has no such row. */
export function findEntry(nodes: FileEntry[], path: string): FileEntry | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.isDirectory && node.children && isWithin(path, node.path)) {
      const found = findEntry(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

/** Adds `entry` to the tree, under whichever directory its path names. */
export function addEntry(tree: FileEntry[], rootPath: string, entry: FileEntry): FileEntry[] {
  const parent = parentOf(entry.path);
  const insert = (children: FileEntry[]) => inOrder([...children, entry]);
  return parent === rootPath ? insert(tree) : updateDirectory(tree, parent, insert);
}

/** Drops the entry at `path`, and everything underneath it, from the tree. */
export function removeEntry(tree: FileEntry[], rootPath: string, path: string): FileEntry[] {
  const parent = parentOf(path);
  const drop = (children: FileEntry[]) => children.filter((child) => child.path !== path);
  return parent === rootPath ? drop(tree) : updateDirectory(tree, parent, drop);
}

/** Rewrites an entry's own path, and its descendants', after it has moved. */
function relocate(entry: FileEntry, from: string, to: string): FileEntry {
  const path = entry.path === from ? to : to + entry.path.slice(from.length);
  return {
    ...entry,
    path,
    name: nameOf(path),
    children: entry.children?.map((child) => relocate(child, from, to)),
  };
}

/** Moves the entry at `path` to `newPath`, covering renames as well as drags. */
export function moveEntry(tree: FileEntry[], rootPath: string, path: string, newPath: string): FileEntry[] {
  const entry = findEntry(tree, path);
  if (!entry) return tree;
  return addEntry(removeEntry(tree, rootPath, path), rootPath, relocate(entry, path, newPath));
}

/**
 * Makes sure the tree has a row for the directory at `path`, adding it - and
 * any missing directory above it - if it does not. Used when a file lands
 * somewhere the sidebar has never shown, such as a `media` folder created on
 * the first paste.
 */
export function ensureDirectory(tree: FileEntry[], rootPath: string, path: string): FileEntry[] {
  if (!path || path === rootPath || findEntry(tree, path)) return tree;

  const parent = parentOf(path);
  const withParent = parent && parent !== rootPath ? ensureDirectory(tree, rootPath, parent) : tree;
  return addEntry(withParent, rootPath, { name: nameOf(path), path, isDirectory: true, children: [] });
}

/** Adds a file that has just been written, creating its folder if need be. */
export function addFile(tree: FileEntry[], rootPath: string, path: string): FileEntry[] {
  if (findEntry(tree, path)) return tree;
  const withFolder = ensureDirectory(tree, rootPath, parentOf(path));
  return addEntry(withFolder, rootPath, { name: nameOf(path), path, isDirectory: false });
}

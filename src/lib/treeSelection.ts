import { parentOf } from "./fileTree";
import { isWithin, samePath } from "./path";

/**
 * Several rows of the file tree picked at once, for moving or deleting them
 * together. These are the parts of that which do not need a tree on screen.
 */

/** `paths` without any that sit inside another of them: a folder takes its contents along. */
export function outermost(paths: Iterable<string>): string[] {
  const all = Array.from(new Set(paths));
  return all.filter((path) => !all.some((other) => other !== path && isWithin(path, other)));
}

/**
 * Which of `paths` can be put in `target`: not ones already there, and not a
 * folder that `target` is, or is inside.
 */
export function movableInto(paths: Iterable<string>, target: string): string[] {
  return outermost(paths).filter((path) => !isWithin(target, path) && !samePath(parentOf(path), target));
}

/** The rows from `anchor` to `to`, both included, in the order they are shown. */
export function rowsBetween(order: readonly string[], anchor: string, to: string): string[] {
  const from = order.indexOf(anchor);
  const until = order.indexOf(to);
  if (from < 0 || until < 0) return [to];
  return order.slice(Math.min(from, until), Math.max(from, until) + 1);
}

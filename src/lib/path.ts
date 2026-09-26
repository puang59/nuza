/** True if `path` is `ancestor` itself, or lives somewhere underneath it. */
export function isWithin(path: string, ancestor: string) {
  return path === ancestor || path.startsWith(ancestor + "/") || path.startsWith(ancestor + "\\");
}

/** Replaces an ancestor prefix literally, without interpreting `$` patterns. */
export function rewritePath(path: string, from: string, to: string) {
  return isWithin(path, from) ? to + path.slice(from.length) : path;
}

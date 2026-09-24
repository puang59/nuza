import { Facet } from "@codemirror/state";
import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Directory of the note being edited, used to resolve relative image paths.
 * A facet rather than a module-level variable so each editor reconfiguration
 * carries its own value and nothing has to be reset when tabs change.
 */
export const noteDirectory = Facet.define<string, string>({
  combine: (values) => (values.length ? values[values.length - 1] : ""),
});

/** Splits a path on either separator, so Windows and POSIX paths both work. */
function splitPath(path: string) {
  return path.split(/[\\/]+/);
}

/** The separator the host is already using, inferred from the path itself. */
function separatorFor(path: string) {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

/**
 * Joins a relative markdown link onto the note's directory, folding away `.`
 * and `..` segments. Done by hand rather than with `path` so the same code runs
 * in the browser during `bun run dev` as in the packaged app.
 */
export function resolveRelativePath(directory: string, relative: string) {
  const separator = separatorFor(directory);
  const segments = splitPath(directory);

  for (const segment of splitPath(relative)) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }

  return segments.join(separator);
}

/** URL schemes we are willing to hand to the OS or to an `<img>` element. */
const WEB_URL = /^https?:\/\//i;
const DATA_IMAGE = /^data:image\/[a-z0-9.+-]+;/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The `href` to open for a link, or null if we should leave it alone. Anything
 * with a scheme we do not recognise - `javascript:` above all - is dropped
 * rather than passed on, since note content is just text from disk.
 */
export function safeExternalHref(url: string) {
  const trimmed = url.trim();
  if (WEB_URL.test(trimmed)) return trimmed;
  if (/^mailto:/i.test(trimmed)) return trimmed;
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
  return null;
}

/**
 * The `src` to render for an image: web and data URLs pass through, a path
 * relative to the note is handed to Tauri's asset protocol, and anything with
 * another scheme is refused.
 */
export function resolveImageSource(url: string, directory: string) {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (WEB_URL.test(trimmed) || DATA_IMAGE.test(trimmed)) return trimmed;
  if (HAS_SCHEME.test(trimmed)) return null;
  if (!directory) return null;

  let decoded = trimmed;
  try {
    decoded = decodeURI(trimmed);
  } catch {
    // A path with a stray `%` is not valid percent-encoding; use it verbatim.
  }

  return convertFileSrc(resolveRelativePath(directory, decoded));
}

/** The directory part of a file path, for either separator style. */
export function directoryOf(path: string) {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index < 0 ? "" : path.slice(0, index);
}

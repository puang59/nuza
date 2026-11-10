/**
 * Plugins name files the same way on every platform: relative to the vault,
 * with `/` between folders. These turn those names into the full paths the
 * rest of the app uses, and back.
 */

/** The app's own folder in a vault, which no plugin reads or writes by path. */
const APP_FOLDER = ".nuza";

function separatorOf(root: string) {
  return root.includes("\\") && !root.includes("/") ? "\\" : "/";
}

/**
 * The full path of `relative` in the vault at `root`. Refuses a name that
 * would leave the vault or reach into `.nuza`, rather than trusting the file
 * commands to: a plugin should hear "no" from its own call, in its own words.
 */
export function toAbsolute(root: string, relative: string): string {
  const parts = relative.split(/[\\/]+/).filter((part) => part !== "" && part !== ".");
  if (/^([a-zA-Z]:|[\\/])/.test(relative) || parts.includes("..")) {
    throw new Error(`"${relative}" is not a path inside the vault`);
  }
  if (parts.length === 0) throw new Error("A path in the vault is needed");
  if (parts[0] === APP_FOLDER) throw new Error(`"${relative}" is nuza's own folder`);
  const separator = separatorOf(root);
  return [root.replace(/[\\/]+$/, ""), ...parts].join(separator);
}

/** `path` relative to the vault at `root`, with `/` between folders, or null if it is not in it. */
export function toRelative(root: string, path: string): string | null {
  const base = root.replace(/[\\/]+$/, "");
  if (path !== base && !path.startsWith(base + "/") && !path.startsWith(base + "\\")) return null;
  const inside = path.slice(base.length + 1).replace(/\\/g, "/");
  if (inside === "" || inside === APP_FOLDER || inside.startsWith(APP_FOLDER + "/")) return null;
  return inside;
}

/** The last part of a path. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** The part of a path before its last part. */
export function parentOf(path: string): string {
  const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return at > 0 ? path.slice(0, at) : "";
}

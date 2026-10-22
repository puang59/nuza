/** True when running on macOS, used to pick "mod" key semantics and display glyphs. */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = uaData?.platform ?? navigator.platform ?? navigator.userAgent ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** True on desktop Linux (Android reports itself as Linux too, and is not it). */
export function isLinuxPlatform(): boolean {
  return /linux/i.test(platformName()) && !/android/i.test(platformName());
}

/** The platform's user-agent string, however it chooses to report it. */
function platformName(): string {
  if (typeof navigator === "undefined") return "";
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return uaData?.platform ?? navigator.platform ?? navigator.userAgent ?? "";
}

/**
 * What this platform calls the place deleted files wait in.
 *
 * Worth getting right rather than saying "trash" everywhere: the dialog is
 * telling someone their note is recoverable, and it can only do that by
 * naming somewhere they will recognise when they go looking.
 */
export function trashName(): string {
  return /win/i.test(platformName()) ? "Recycle Bin" : "Trash";
}

/**
 * What the item that shows a file in the system's file manager is called
 * here - each platform has its own words for it, and they are the ones
 * people look for.
 */
export function revealLabel(): string {
  if (isMacPlatform()) return "Reveal in Finder";
  if (/win/i.test(platformName())) return "Show in Explorer";
  return "Open Containing Folder";
}

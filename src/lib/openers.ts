import { isImagePath } from "./media";

/**
 * What clicking a file in the vault should do with it.
 *
 * Every row in the tree used to be opened as a note, which for a picture or a
 * PDF meant reading it as text and reporting that it was not any. A vault
 * holds attachments as well as notes, and each kind has somewhere better to
 * go: a picture is shown, a document or a recording is handed to whatever the
 * system opens it with, and everything else is read as text.
 */
export type Opener = "editor" | "image" | "system";

/**
 * Kinds handed to the system: documents and media the editor cannot show, and
 * that are safe to open by double-click's rules. Deliberately a list of what
 * is, rather than of what is not - a vault can come from anywhere, and a
 * script or an app in it must never be run by a click in the sidebar.
 * Matches `OPENED_BY_THE_SYSTEM` in `src-tauri/src/files.rs`, which is what
 * enforces it.
 */
const SYSTEM_KINDS = new Set([
  "pdf",
  "epub",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "pages",
  "numbers",
  "key",
  "odt",
  "ods",
  "odp",
  "rtf",
  "zip",
  "mp3",
  "wav",
  "m4a",
  "ogg",
  "flac",
  "aac",
  "mp4",
  "mov",
  "m4v",
  "webm",
  "mkv",
  "avi",
  "heic",
  "tif",
  "tiff",
  "psd",
]);

/** The part of a file's name after its last dot, lower case; empty if it has none. */
export function extensionOf(path: string) {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function openerFor(path: string): Opener {
  if (isImagePath(path)) return "image";
  return SYSTEM_KINDS.has(extensionOf(path)) ? "system" : "editor";
}

/** Whether a failed read failed because the file is not text at all. */
export function isNotText(error: unknown) {
  return /valid UTF-8/i.test(String(error));
}
